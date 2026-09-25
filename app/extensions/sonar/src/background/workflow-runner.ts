/**
 * 工作流流水线编排：拉入一条视频后自动「准备素材 → 爆款拆解」，停在待确认（ready）。
 *
 * preparing：确保转录（无则跑 processing.process，requireSummary=false 只转录）。
 * analyzing：用 InsightProvider 生成爆款拆解，putInsight。
 * ready：等用户确认送二创（pushWorkflowItem 才推桥）。
 * 任意失败 → setWorkflowStage('failed', { error })。后台 fire-and-forget，阶段写 repo 供 UI 轮询。
 */
import { SonarException, makeError, toSonarError } from '@/domain/errors';
import type { Repository } from './repository';
import type { ProcessingService } from './services';
import type { InsightProvider } from '@/processing/insight-provider';

export interface WorkflowRunnerDeps {
  repo: Pick<
    Repository,
    'getWorkflowItem' | 'getTranscript' | 'setWorkflowStage' | 'putInsight'
  >;
  processing: Pick<ProcessingService, 'process'>;
  /** 按当前设置构建拆解 Provider；未配置 LLM 时返回 null。 */
  buildInsightProvider: () => Promise<InsightProvider | null>;
}

export interface WorkflowRunner {
  /** 运行/重跑某条流水线到 ready 或 failed。重复调用同一 id 会被忽略（单飞）。 */
  run(itemId: string): Promise<void>;
}

export function createWorkflowRunner(deps: WorkflowRunnerDeps): WorkflowRunner {
  const running = new Set<string>();

  async function execute(itemId: string): Promise<void> {
    const item = await deps.repo.getWorkflowItem(itemId);
    if (!item) return;
    const { videoId } = item;
    try {
      // ① + ② 准备素材：确保有转录（已转录则复用，避免重复下载/转录）。
      await deps.repo.setWorkflowStage(itemId, 'preparing');
      let transcript = await deps.repo.getTranscript(videoId);
      if (!transcript) {
        // process 同步跑到终态；失败会抛标准化错误。requireSummary=false：只要字幕。
        await deps.processing.process(videoId, { requireSummary: false });
        transcript = await deps.repo.getTranscript(videoId);
      }
      if (!transcript || !transcript.fullText.trim()) {
        throw new SonarException(
          makeError('AUDIO_EXTRACTION_FAILED', '未能获得转录，无法继续拆解', { retryable: true }),
        );
      }

      // ③ 爆款拆解。
      await deps.repo.setWorkflowStage(itemId, 'analyzing');
      const insightProvider = await deps.buildInsightProvider();
      if (!insightProvider) {
        throw new SonarException(
          makeError('INSIGHT_NOT_CONFIGURED', '未配置 AI 模型，无法生成爆款拆解', {
            nextAction: '在设置中添加 LLM Provider 并填写 API Key',
          }),
        );
      }
      const insight = await insightProvider.analyze(transcript, { videoId });
      await deps.repo.putInsight(insight);

      // ④ 待用户确认送二创。
      await deps.repo.setWorkflowStage(itemId, 'ready');
    } catch (thrown) {
      const error = toSonarError(thrown);
      await deps.repo.setWorkflowStage(itemId, 'failed', { error: error.message });
    }
  }

  return {
    async run(itemId) {
      if (running.has(itemId)) return;
      running.add(itemId);
      try {
        await execute(itemId);
      } finally {
        running.delete(itemId);
      }
    },
  };
}

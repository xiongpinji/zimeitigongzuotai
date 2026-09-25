import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeSrt } from '../../../src/lib/ai-analysis';
import { parseSrt } from '../../../src/lib/srt-parser';
import { createPersistedAIState } from '../../../src/lib/ai-persistence';
import { handleGenerateCardImage } from '../../card-media-handlers';
import { assertCardRenders } from '../../remotion/smoke-render';
import { loadFullHeadlessAISettings, loadHeadlessProjectBindings } from '../headless-settings';
import { GenerationError } from '../generation-error';
import { HeadlessProjectContext } from '../context';
import { loadEffectivePromptTemplate } from '../../prompts-io';
import { loadProjectFile } from '../../project-file';
import type { GenerationRunCtx } from '../headless-generation';
import type { SrtEntry } from '../../../src/types';
import type { AISettings, AIAnalysisResult } from '../../../src/types/ai';

interface AnalyzeDeps {
  analyze?: (
    entries: SrtEntry[],
    settings: AISettings,
    options: Record<string, unknown>,
  ) => Promise<AIAnalysisResult>;
}

/**
 * 主进程 headless：分析字幕 → segments+cards → 写 project.json aiAnalysis 节。
 *
 * 默认 analyze 装配与 electron/main.ts 的 `analyze-srt` IPC 处理体保持一致的
 * LLM 注入（generateStructuredData/generateText/generateMotionSource 由 lib 层
 * 默认实现注入，main 也不显式传；本运行复刻 main 显式注入的 validateMotionSource
 * = assertCardRenders 与 generateCardImage = handleGenerateCardImage）。deps.analyze
 * 仅用于单测，跳过真实 LLM/网络。
 */
export async function runAnalyzeHeadless(
  ctx: GenerationRunCtx,
  deps: AnalyzeDeps = {},
): Promise<AIAnalysisResult> {
  const { projectPath, userDataPath, handle } = ctx;

  handle.update({ phase: '装配设置', percent: 5 });
  const settings = await loadFullHeadlessAISettings(userDataPath);
  const projectBindings = await loadHeadlessProjectBindings(projectPath);

  let srt: string;
  try {
    srt = await readFile(join(projectPath, 'podcast-subtitles.srt'), 'utf-8');
  } catch {
    throw new GenerationError('no_subtitles', '未找到 podcast-subtitles.srt，请先生成音频/字幕。');
  }
  const entries = parseSrt(srt);
  if (entries.length === 0) {
    throw new GenerationError('empty_subtitles', '字幕为空。');
  }

  // 模板与样式（mirror electron/main.ts 的 analyze-srt 处理体；kind 以源码为准）
  const [planningTemplate, cardTemplate, imageTemplate, coverTemplate] = await Promise.all([
    loadEffectivePromptTemplate('planning.segment', { userDataPath, projectDir: projectPath }),
    loadEffectivePromptTemplate('cards.segment', { userDataPath, projectDir: projectPath }),
    loadEffectivePromptTemplate('card.image', { userDataPath, projectDir: projectPath }),
    loadEffectivePromptTemplate('cover.regeneration', { userDataPath, projectDir: projectPath }),
  ]);
  const projectStylePresetId = (await loadProjectFile(projectPath)).stylePresetId;

  // 默认 analyzeSrt 装配：复刻 main.ts analyze-srt 的 LLM 注入。
  // generateCardImage 复用主进程 handleGenerateCardImage（与 UI 行为一致，即时 materialize 图片卡）。
  const analyze =
    deps.analyze ??
    ((srtEntries: SrtEntry[], aiSettings: AISettings, options: Record<string, unknown>) =>
      analyzeSrt(srtEntries, aiSettings, {
        ...options,
        generateCardImage: async (invoke) =>
          handleGenerateCardImage(
            {
              projectDir: projectPath,
              cardId: invoke.cardId,
              prompt: invoke.prompt,
              aspectRatio: invoke.aspectRatio,
            },
            {
              settings: aiSettings,
              projectBindings,
              onProgress: () => {
                // analyze 主进度已由 onProgress 覆盖；图像生成内部进度暂不上报
              },
              signal: handle.signal,
            },
          ),
        validateMotionSource: assertCardRenders,
      }));

  handle.update({ phase: '分析与卡片', percent: 20 });
  const result = await analyze(entries, settings, {
    projectStylePresetId,
    defaultStylePresetId: settings.defaultStylePresetId,
    planningTemplate,
    cardTemplate,
    imageTemplate,
    coverTemplate,
    projectBindings,
    onProgress: (p: { phase?: string; percent?: number }) =>
      handle.update({ phase: p.phase ?? '分析', percent: Math.min(95, 20 + (p.percent ?? 0) * 0.75) }),
  });

  handle.update({ phase: '写入', percent: 96 });
  const persisted = createPersistedAIState(result, []);
  const headless = new HeadlessProjectContext(projectPath);
  const existing = (await loadProjectFile(projectPath)).aiAnalysis;
  await headless.saveSection('aiAnalysis', {
    analysisResult: persisted.analysisResult,
    coverCandidates: existing?.coverCandidates ?? [],
  });

  handle.update({ phase: '完成', percent: 100 });
  return result;
}

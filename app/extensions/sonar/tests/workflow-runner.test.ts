import { describe, it, expect, vi } from 'vitest';
import { createWorkflowRunner } from '@/background/workflow-runner';
import { createMemoryRepository } from '@/background/repository';
import type { TranscriptDocument, ViralInsight } from '@/domain/models';

const NOW = 1_700_000_000_000;

function makeRepo() {
  let seq = 0;
  return createMemoryRepository({ now: () => NOW, newId: () => `wf-${++seq}` });
}

const transcript: TranscriptDocument = {
  videoId: 'v1',
  provider: 'bcut',
  language: 'zh',
  fullText: '一段口播转录',
  srtText: 's',
  segments: [{ text: '一段口播转录', startMs: 0, endMs: 1 }],
  createdAt: 0,
};

const insight: ViralInsight = {
  videoId: 'v1',
  angle: '反常识',
  hook: '开头钩子',
  structure: ['一', '二'],
  highlights: [],
  dataPoints: [],
  remixSuggestions: ['换案例'],
  model: 'm',
  createdAt: NOW,
};

describe('createWorkflowRunner', () => {
  it('已有转录：直接拆解 → ready，落库 insight', async () => {
    const repo = makeRepo();
    const item = await repo.addWorkflowItem({ videoId: 'v1' });
    await repo.putTranscript(transcript);
    const process = vi.fn();
    const analyze = vi.fn(async () => insight);
    const runner = createWorkflowRunner({
      repo,
      processing: { process },
      buildInsightProvider: async () => ({ analyze }),
    });

    await runner.run(item.id);

    expect(process).not.toHaveBeenCalled(); // 复用已有转录
    expect(analyze).toHaveBeenCalledOnce();
    expect((await repo.getWorkflowItem(item.id))?.stage).toBe('ready');
    expect((await repo.getInsight('v1'))?.angle).toBe('反常识');
  });

  it('无转录：先 process 转录，再拆解 → ready', async () => {
    const repo = makeRepo();
    const item = await repo.addWorkflowItem({ videoId: 'v1' });
    const process = vi.fn(async () => {
      await repo.putTranscript(transcript);
      return { id: 'p1', videoId: 'v1', stage: 'completed' as const, progress: 1 };
    });
    const runner = createWorkflowRunner({
      repo,
      processing: { process },
      buildInsightProvider: async () => ({ analyze: async () => insight }),
    });

    await runner.run(item.id);

    expect(process).toHaveBeenCalledWith('v1', { requireSummary: false });
    expect((await repo.getWorkflowItem(item.id))?.stage).toBe('ready');
  });

  it('未配置拆解 Provider → failed', async () => {
    const repo = makeRepo();
    const item = await repo.addWorkflowItem({ videoId: 'v1' });
    await repo.putTranscript(transcript);
    const runner = createWorkflowRunner({
      repo,
      processing: { process: vi.fn() },
      buildInsightProvider: async () => null,
    });

    await runner.run(item.id);

    const got = await repo.getWorkflowItem(item.id);
    expect(got?.stage).toBe('failed');
    expect(got?.error).toContain('未配置');
  });

  it('转录始终拿不到 → failed', async () => {
    const repo = makeRepo();
    const item = await repo.addWorkflowItem({ videoId: 'v1' });
    const runner = createWorkflowRunner({
      repo,
      processing: { process: vi.fn(async () => ({ id: 'p1', videoId: 'v1', stage: 'completed' as const, progress: 1 })) },
      buildInsightProvider: async () => ({ analyze: async () => insight }),
    });

    await runner.run(item.id);

    expect((await repo.getWorkflowItem(item.id))?.stage).toBe('failed');
  });

  it('process 抛错 → failed，错误写入条目', async () => {
    const repo = makeRepo();
    const item = await repo.addWorkflowItem({ videoId: 'v1' });
    const runner = createWorkflowRunner({
      repo,
      processing: { process: vi.fn(async () => { throw new Error('提音失败'); }) },
      buildInsightProvider: async () => ({ analyze: async () => insight }),
    });

    await runner.run(item.id);

    const got = await repo.getWorkflowItem(item.id);
    expect(got?.stage).toBe('failed');
    expect(got?.error).toContain('提音失败');
  });
});

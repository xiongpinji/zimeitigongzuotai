import { describe, it, expect, vi } from 'vitest';
import { createProcessingService } from '@/processing/processing-service';
import { createMemoryRepository } from '@/background/repository';
import type { TranscriptDocument, VideoAnalysis, VideoSource } from '@/domain/models';

const source: VideoSource = {
  url: 'https://v3-web.douyinvod.com/fake/h264.mp4',
  watermark: 'none',
  watermarkConfidence: 'high',
  watermarkEvidence: [],
};
const transcript: TranscriptDocument = {
  videoId: 'v1',
  provider: 'openai',
  language: 'zh',
  fullText: '全文',
  srtText: '',
  segments: [{ text: '全文', startMs: 0, endMs: 1000 }],
  createdAt: 0,
};
const analysis: VideoAnalysis = {
  videoId: 'v1',
  category: '深度分析',
  summary: '摘要',
  keyPoints: [],
  tags: [],
  model: 'gpt-x',
  createdAt: 0,
};

function makeDeps(over: Record<string, unknown> = {}) {
  let seq = 0;
  const repo = createMemoryRepository({ now: () => 0, newId: () => `id-${++seq}` });
  return {
    repo,
    resolveSources: vi.fn(async () => [source]),
    fetchMedia: vi.fn(async () => new Blob(['video'])),
    extractAudio: vi.fn(async () => new Blob(['audio'])),
    asr: { transcribe: vi.fn(async () => transcript) },
    summary: { summarize: vi.fn(async () => analysis) },
    now: () => 0,
    newId: () => `task-1`,
    ...over,
  };
}

describe('createProcessingService', () => {
  it('runs the full pipeline and persists transcript + analysis', async () => {
    const deps = makeDeps();
    const svc = createProcessingService(deps as never);
    const task = await svc.process('v1');

    expect(task.stage).toBe('completed');
    expect(task.progress).toBe(1);
    expect(deps.resolveSources).toHaveBeenCalled();
    expect(deps.extractAudio).toHaveBeenCalled();
    expect((await deps.repo.getTranscript('v1'))?.fullText).toBe('全文');
    expect((await deps.repo.getAnalysis('v1'))?.category).toBe('深度分析');
    expect((await deps.repo.getProcessingTask('task-1'))?.stage).toBe('completed');
  });

  it('falls back to the next candidate source when the first yields no audio', async () => {
    const videoOnly: VideoSource = { ...source, url: 'https://v5.douyinvod.com/dash/video-only.mp4' };
    const muxed: VideoSource = { ...source, url: 'https://aweme.snssdk.com/aweme/v1/play/muxed.mp4' };
    const extractAudio = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('no stream'), { error: { code: 'AUDIO_EXTRACTION_FAILED' } }),
      )
      .mockResolvedValueOnce(new Blob(['audio']));
    const deps = makeDeps({ resolveSources: vi.fn(async () => [videoOnly, muxed]), extractAudio });
    const svc = createProcessingService(deps as never);
    const task = await svc.process('v1');

    expect(task.stage).toBe('completed');
    expect(extractAudio).toHaveBeenCalledTimes(2);
    expect((await deps.repo.getTranscript('v1'))?.fullText).toBe('全文');
  });

  it('folds duplicate-resolution video-only gears so a later audio-bearing source still gets tried', async () => {
    // 抖音音视频分离时，多个同分辨率纯视频 bit_rate 档位会占满尝试窗口，把带音轨的
    // download_addr 挤出去。折叠同分辨率候选后，download_addr 必须能被尝试到。
    const gear = (u: string): VideoSource => ({ ...source, url: u, width: 1280, height: 720 });
    const downloadAddr: VideoSource = {
      url: 'https://v3-web.douyinvod.com/dl/download.mp4',
      watermark: 'present',
      watermarkConfidence: 'medium',
      watermarkEvidence: [],
      width: 1280,
      height: 720,
    };
    const ranked = [gear('g1'), gear('g2'), gear('g3'), gear('g4'), gear('g5'), downloadAddr];
    const extractAudio = vi.fn(async (media: Blob) => {
      const tag = await media.text();
      if (tag === 'download.mp4') return new Blob(['audio']);
      throw Object.assign(new Error('no stream'), { error: { code: 'AUDIO_EXTRACTION_FAILED' } });
    });
    const deps = makeDeps({
      resolveSources: vi.fn(async () => ranked),
      fetchMedia: vi.fn(async (url: string) => new Blob([url.split('/').at(-1) ?? ''])),
      extractAudio,
    });
    const svc = createProcessingService(deps as never);
    const task = await svc.process('v1');

    expect(task.stage).toBe('completed');
    // 5 个同分辨率纯视频档位折叠成 1 个，download_addr 得以进入窗口被尝试。
    expect(extractAudio).toHaveBeenCalledTimes(2);
    expect((await deps.repo.getTranscript('v1'))?.fullText).toBe('全文');
  });

  it('fails with the per-candidate reasons when every source lacks audio', async () => {
    const a: VideoSource = { ...source, url: 'https://v5.douyinvod.com/dash/a.mp4' };
    const b: VideoSource = { ...source, url: 'https://v9.douyinvod.com/dash/b.mp4' };
    const extractAudio = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { error: { code: 'AUDIO_EXTRACTION_FAILED', detail: '退出码 1：does not contain any stream' } });
    });
    const deps = makeDeps({ resolveSources: vi.fn(async () => [a, b]), extractAudio });
    const svc = createProcessingService(deps as never);

    await expect(svc.process('v1')).rejects.toMatchObject({ error: { code: 'AUDIO_EXTRACTION_FAILED' } });
    const task = await deps.repo.getProcessingTask('task-1');
    expect(task?.error?.detail).toContain('v5.douyinvod.com');
    expect(task?.error?.detail).toContain('v9.douyinvod.com');
  });

  it('throws ASR_NOT_CONFIGURED when no ASR provider is set', async () => {
    const svc = createProcessingService(makeDeps({ asr: null }) as never);
    await expect(svc.process('v1')).rejects.toMatchObject({ error: { code: 'ASR_NOT_CONFIGURED' } });
  });

  it('completes with transcript only when no summary provider is configured', async () => {
    const deps = makeDeps({ summary: null });
    const svc = createProcessingService(deps as never);
    const task = await svc.process('v1');

    expect(task.stage).toBe('completed');
    expect((await deps.repo.getTranscript('v1'))?.fullText).toBe('全文');
    expect(await deps.repo.getAnalysis('v1')).toBeNull();
  });

  it('throws SUMMARY_NOT_CONFIGURED when summary is required but no provider, keeping the transcript', async () => {
    const deps = makeDeps({ summary: null });
    const svc = createProcessingService(deps as never);
    await expect(svc.process('v1', { requireSummary: true })).rejects.toMatchObject({
      error: { code: 'SUMMARY_NOT_CONFIGURED' },
    });
    // 字幕已转录落库，不因摘要未配置而丢失。
    expect((await deps.repo.getTranscript('v1'))?.fullText).toBe('全文');
    expect(await deps.repo.getAnalysis('v1')).toBeNull();
    expect((await deps.repo.getProcessingTask('task-1'))?.stage).toBe('failed');
  });

  it('onlySummary throws SUMMARY_NOT_CONFIGURED when no provider (reuses transcript, no media work)', async () => {
    const deps = makeDeps({ summary: null });
    await deps.repo.putTranscript(transcript);
    const svc = createProcessingService(deps as never);
    await expect(svc.process('v1', { onlySummary: true })).rejects.toMatchObject({
      error: { code: 'SUMMARY_NOT_CONFIGURED' },
    });
    expect(deps.resolveSources).not.toHaveBeenCalled();
    expect(deps.fetchMedia).not.toHaveBeenCalled();
  });

  it('throws NO_DOWNLOADABLE_SOURCE when no source resolves', async () => {
    const svc = createProcessingService(makeDeps({ resolveSources: vi.fn(async () => []) }) as never);
    await expect(svc.process('v1')).rejects.toMatchObject({
      error: { code: 'NO_DOWNLOADABLE_SOURCE' },
    });
  });

  it('keeps the transcript when summarization fails and marks the task failed', async () => {
    const deps = makeDeps({
      summary: {
        summarize: vi.fn(async () => {
          throw new Error('llm down');
        }),
      },
    });
    const svc = createProcessingService(deps as never);
    await expect(svc.process('v1')).rejects.toBeTruthy();
    expect((await deps.repo.getTranscript('v1'))?.fullText).toBe('全文');
    expect((await deps.repo.getProcessingTask('task-1'))?.stage).toBe('failed');
  });

  it('start() returns a queued task immediately and finishes the pipeline in the background', async () => {
    let release!: (t: TranscriptDocument) => void;
    const gate = new Promise<TranscriptDocument>((r) => {
      release = r;
    });
    const deps = makeDeps({ asr: { transcribe: vi.fn(() => gate) } });
    const svc = createProcessingService(deps as never);

    const task = await svc.start('v1');
    // 即时返回 queued —— 没有等待（仍被 gate 阻塞的）转录管线跑完。
    expect(task.stage).toBe('queued');
    expect(await deps.repo.getAnalysis('v1')).toBeNull();

    release(transcript);
    await vi.waitFor(async () => {
      expect((await deps.repo.getProcessingTask('task-1'))?.stage).toBe('completed');
    });
    expect((await deps.repo.getAnalysis('v1'))?.category).toBe('深度分析');
  });

  it('start() captures pipeline failure into the task without throwing to the caller', async () => {
    const deps = makeDeps({ resolveSources: vi.fn(async () => []) });
    const svc = createProcessingService(deps as never);

    const task = await svc.start('v1');
    expect(task.stage).toBe('queued');
    await vi.waitFor(async () => {
      const t = await deps.repo.getProcessingTask('task-1');
      expect(t?.stage).toBe('failed');
      expect(t?.error?.code).toBe('NO_DOWNLOADABLE_SOURCE');
    });
  });

  it('reuses an existing transcript on a plain re-run (no re-download / re-transcribe)', async () => {
    const deps = makeDeps();
    await deps.repo.putTranscript(transcript);
    const svc = createProcessingService(deps as never);
    const task = await svc.process('v1'); // 无 options —— 即「分析此视频」按钮的调用

    expect(task.stage).toBe('completed');
    expect(deps.resolveSources).not.toHaveBeenCalled();
    expect(deps.fetchMedia).not.toHaveBeenCalled();
    expect(deps.extractAudio).not.toHaveBeenCalled();
    expect(deps.asr.transcribe).not.toHaveBeenCalled();
    expect((await deps.repo.getAnalysis('v1'))?.summary).toBe('摘要');
  });

  it('force re-transcribes even when a transcript already exists', async () => {
    const deps = makeDeps();
    await deps.repo.putTranscript(transcript);
    const svc = createProcessingService(deps as never);
    await svc.process('v1', { force: true });

    expect(deps.fetchMedia).toHaveBeenCalled();
    expect(deps.asr.transcribe).toHaveBeenCalled();
  });

  it('reuses an existing transcript even without an ASR provider', async () => {
    const deps = makeDeps({ asr: null });
    await deps.repo.putTranscript(transcript);
    const svc = createProcessingService(deps as never);
    const task = await svc.process('v1');

    expect(task.stage).toBe('completed');
    expect((await deps.repo.getAnalysis('v1'))?.summary).toBe('摘要');
  });

  it('onlySummary reuses an existing transcript and skips media/audio/asr', async () => {
    const deps = makeDeps();
    await deps.repo.putTranscript(transcript);
    const svc = createProcessingService(deps as never);
    const task = await svc.process('v1', { onlySummary: true });

    expect(task.stage).toBe('completed');
    expect(deps.fetchMedia).not.toHaveBeenCalled();
    expect(deps.extractAudio).not.toHaveBeenCalled();
    expect(deps.asr.transcribe).not.toHaveBeenCalled();
    expect((await deps.repo.getAnalysis('v1'))?.summary).toBe('摘要');
  });
});

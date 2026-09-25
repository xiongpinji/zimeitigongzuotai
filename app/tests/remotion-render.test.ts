import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planRemotionRenderDimensions } from '../electron/remotion/render-dimensions';
import { renderRemotionVideo } from '../electron/remotion/render';
import type { TimelineData } from '../src/types';

const renderer = vi.hoisted(() => ({
  selectComposition: vi.fn(async () => ({ id: 'lingji-composition' })),
  renderMedia: vi.fn(async (_options: unknown) => undefined),
}));

vi.mock('@remotion/renderer', () => renderer);

const timeline = { version: 2, width: 1920, height: 1080 } as TimelineData;

async function render(outputWidth: number, outputHeight: number) {
  await renderRemotionVideo({
    serveUrl: 'file:///mock',
    outputPath: 'out.mp4',
    timeline,
    srtEntries: [],
    compiledCards: {},
    renderPlan: planRemotionRenderDimensions(1920, 1080, outputWidth, outputHeight),
    x264Preset: 'ultrafast',
    videoBitrate: '1800k',
    audioBitrate: '96k',
    concurrency: 1,
    hardwareAcceleration: 'disable',
  });
  return renderer.renderMedia.mock.calls[0][0] as Record<string, unknown>;
}

describe('Remotion render pipeline', () => {
  beforeEach(() => renderer.renderMedia.mockClear());

  it('需要最终缩放时关闭并行预编码，避免 FFmpeg copy 流与缩放滤镜冲突', async () => {
    const options = await render(854, 480);
    expect(options.scale).toBe(0.45);
    expect(options.disallowParallelEncoding).toBe(true);
    const override = options.ffmpegOverride as (info: { type: string; args: string[] }) => string[];
    expect(override({ type: 'stitcher', args: ['-i', 'frames', 'out.mp4'] })).toEqual([
      '-i', 'frames', '-vf', 'scale=854:480:flags=lanczos', 'out.mp4',
    ]);
  });

  it('原本可精确等比的尺寸保持并行编码与原始参数', async () => {
    const options = await render(1280, 720);
    expect(options.disallowParallelEncoding).toBe(false);
    const override = options.ffmpegOverride as (info: { type: string; args: string[] }) => string[];
    expect(override({ type: 'stitcher', args: ['-i', 'frames', 'out.mp4'] })).toEqual([
      '-i', 'frames', 'out.mp4',
    ]);
  });
});

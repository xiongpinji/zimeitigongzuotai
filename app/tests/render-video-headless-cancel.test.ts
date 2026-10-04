import { describe, expect, it, vi } from 'vitest';
import { renderVideoHeadless } from '../electron/remotion/render-video-headless';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const args = {
  timeline: '{}', outputPath: 'unused.mp4',
  exportConfig: { resolution: '480p' as const, quality: 'speed' as const },
};

describe('headless render early cancellation and batch limits', () => {
  it('rejects an already-aborted batch before preparing any media', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(renderVideoHeadless(args, { signal: controller.signal }))
      .rejects.toThrow('render_cancelled');
  });

  it('rejects an unbounded per-render frame concurrency before preparing media', async () => {
    await expect(renderVideoHeadless(args, { frameConcurrency: 100 }))
      .rejects.toThrow('render_invalid_concurrency');
  });
});

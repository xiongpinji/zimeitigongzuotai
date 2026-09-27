import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OverlayItem } from '../src/types';

vi.mock('../src/remotion/use-is-rendering', () => ({
  useIsRendering: () => false,
}));

vi.mock('../src/remotion/asset-src', () => ({
  resolveAssetSrc: (path: string) => path,
}));

vi.mock('remotion', () => ({
  AbsoluteFill: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Video: ({ startFrom }: { startFrom?: number }) => <div data-source-frame={startFrom ?? 'missing'} />,
  OffthreadVideo: ({ startFrom }: { startFrom?: number }) => <div data-source-frame={startFrom ?? 'missing'} />,
}));

import { VideoOverlay } from '../src/remotion/overlays/VideoOverlay';

function videoOverlay(trimStartMs?: number): OverlayItem {
  return {
    id: 'clip-1',
    type: 'video',
    assetPath: 'recording.mp4',
    trackId: 'visual-1',
    startMs: 0,
    durationMs: 1000,
    position: { x: 0, y: 0, width: 1080, height: 1920 },
    ...(trimStartMs === undefined ? {} : { videoData: { trimStartMs, sourceDurationMs: 5000 } }),
  };
}

describe('VideoOverlay source timecode', () => {
  it('plays a recording from the source in-point instead of frame zero', () => {
    const html = renderToStaticMarkup(
      <VideoOverlay overlay={videoOverlay(2500)} zIndex={1} fps={30} />,
    );
    expect(html).toContain('data-source-frame="75"');
  });

  it('preserves frame-zero playback for existing timelines without videoData', () => {
    const html = renderToStaticMarkup(
      <VideoOverlay overlay={videoOverlay()} zIndex={1} fps={30} />,
    );
    expect(html).toContain('data-source-frame="0"');
  });
});

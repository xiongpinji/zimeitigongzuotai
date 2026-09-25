import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { toFileSrc } from '../src/lib/utils';
import { OverlayBlock } from '../src/components/OverlayBlock';
import { DEFAULT_VISUAL_TRACK_ID } from '../src/types';

vi.mock('../src/store/timeline', () => ({
  useTimelineStore: () => ({
    assets: [
      {
        path: '/tmp/cover.png',
        type: 'image',
        name: 'cover.png',
        durationMs: 5_000,
      },
    ],
    timeline: {
      podcast: {
        durationMs: 20_000,
      },
    },
    overlayClipboard: null,
    updateOverlay: () => undefined,
    removeOverlay: () => undefined,
    copyOverlay: () => true,
    cutOverlay: () => true,
    pasteOverlay: () => null,
  }),
}));

describe('OverlayBlock', () => {
  it('renders an image thumbnail inside image overlays on the timeline', () => {
    const html = renderToStaticMarkup(
      <OverlayBlock
        overlay={{
          id: 'overlay-1',
          type: 'image',
          assetPath: '/tmp/cover.png',
          trackId: DEFAULT_VISUAL_TRACK_ID,
          startMs: 0,
          durationMs: 5_000,
          position: { x: 0, y: 0, width: 1920, height: 1080 },
        }}
        pxPerMs={0.08}
      />,
    );

    expect(html).toContain('<img');
    expect(html).toContain(`src="${toFileSrc('/tmp/cover.png')}"`);
    expect(html).toContain('cover.png');
  });
});

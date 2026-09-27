// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { OverlayInspector } from '../src/components/OverlayInspector';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('editable video source in-point', () => {
  it('lets an editor change the source in-point without moving the clip on the timeline', async () => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [{
          id: 'video-1', type: 'video', assetPath: '/owned/recording.mp4',
          trackId: 'visual-1', startMs: 2000, durationMs: 1000,
          position: { x: 0, y: 0, width: 1080, height: 1920 },
          videoData: { trimStartMs: 1000, sourceDurationMs: 5000 },
        }],
      },
      historyPast: [], historyFuture: [], canUndo: false, canRedo: false,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<OverlayInspector overlayId="video-1" onDelete={() => {}} />));
      const label = Array.from(host.querySelectorAll('label')).find((item) =>
        item.textContent?.includes('源起点（ms）'));
      expect(label).toBeTruthy();
      const increase = label?.querySelector<HTMLButtonElement>('button[aria-label="增加"]');
      expect(increase).toBeTruthy();
      await act(async () => increase?.click());
      const clip = useTimelineStore.getState().timeline.overlays[0];
      expect(clip.startMs).toBe(2000);
      expect(clip.durationMs).toBe(1000);
      expect(clip.videoData?.trimStartMs).toBe(1100);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

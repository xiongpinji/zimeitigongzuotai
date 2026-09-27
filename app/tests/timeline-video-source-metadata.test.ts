import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('source media metadata in the editable timeline', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: createDefaultTimeline(),
      assets: [{ path: '/owned/recording.mp4', type: 'video', name: 'recording.mp4', durationMs: 5000 }],
      historyPast: [], historyFuture: [], canUndo: false, canRedo: false,
    });
  });

  it('carries the source duration into a newly inserted video clip', () => {
    const id = useTimelineStore.getState().addOverlay({
      type: 'video', assetPath: '/owned/recording.mp4', trackId: 'visual-1',
      startMs: 0, durationMs: 1000,
      position: { x: 0, y: 0, width: 1080, height: 1920 },
    });
    const clip = useTimelineStore.getState().timeline.overlays.find((overlay) => overlay.id === id);
    expect(clip?.videoData).toEqual({ trimStartMs: 0, sourceDurationMs: 5000 });
  });

  it('does not extend a video clip past its source end via updateOverlay', () => {
    const id = useTimelineStore.getState().addOverlay({
      type: 'video', assetPath: '/owned/recording.mp4', trackId: 'visual-1',
      startMs: 0, durationMs: 1000,
      position: { x: 0, y: 0, width: 1080, height: 1920 },
      videoData: { trimStartMs: 2500, sourceDurationMs: 5000 },
    });
    useTimelineStore.getState().updateOverlay(id, { durationMs: 4000 });
    const clip = useTimelineStore.getState().timeline.overlays.find((overlay) => overlay.id === id);
    expect(clip?.durationMs).toBe(2500);
    expect(clip?.videoData?.trimStartMs).toBe(2500);
  });
});

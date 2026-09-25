import { describe, expect, it } from 'vitest';
import { getEditorLayoutMode, getSetupLayoutMode, getTimelinePanelBounds } from '../src/lib/layout';

describe('getSetupLayoutMode', () => {
  it('keeps two-column hero on wide desktop windows', () => {
    expect(getSetupLayoutMode(1440, 900)).toEqual({
      stackColumns: false,
      featureColumns: 3,
      compactHero: false,
    });
  });

  it('stacks the setup layout on narrower windows', () => {
    expect(getSetupLayoutMode(1024, 900)).toEqual({
      stackColumns: true,
      featureColumns: 2,
      compactHero: false,
    });
  });

  it('uses the most compact layout on short mobile-like windows', () => {
    expect(getSetupLayoutMode(720, 680)).toEqual({
      stackColumns: true,
      featureColumns: 1,
      compactHero: true,
    });
  });
});

describe('getEditorLayoutMode', () => {
  it('keeps sidebar beside preview on wide desktop windows', () => {
    expect(getEditorLayoutMode(1440, 900)).toEqual({
      stackSidebar: false,
      compactToolbar: false,
      compactTimeline: false,
      timelineHeight: 198,
      sidebarRailHeight: 0,
    });
  });

  it('stacks the sidebar under the preview on narrower windows', () => {
    expect(getEditorLayoutMode(980, 900)).toEqual({
      stackSidebar: true,
      compactToolbar: false,
      compactTimeline: true,
      timelineHeight: 176,
      sidebarRailHeight: 138,
    });
  });

  it('uses compact toolbar and timeline on short windows', () => {
    expect(getEditorLayoutMode(1100, 700)).toEqual({
      stackSidebar: true,
      compactToolbar: true,
      compactTimeline: true,
      timelineHeight: 140,
      sidebarRailHeight: 126,
    });
  });
});

describe('getTimelinePanelBounds', () => {
  it('returns bounded defaults for regular desktop timelines', () => {
    expect(getTimelinePanelBounds(900, false)).toEqual({
      minHeight: 156,
      maxHeight: 495,
      defaultHeight: 198,
    });
  });

  it('keeps compact timelines resizable without crushing the preview', () => {
    expect(getTimelinePanelBounds(700, true)).toEqual({
      minHeight: 132,
      maxHeight: 385,
      defaultHeight: 140,
    });
  });
});

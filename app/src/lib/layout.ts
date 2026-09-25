export interface SetupLayoutMode {
  stackColumns: boolean;
  featureColumns: 1 | 2 | 3;
  compactHero: boolean;
}

export interface EditorLayoutMode {
  stackSidebar: boolean;
  compactToolbar: boolean;
  compactTimeline: boolean;
  timelineHeight: number;
  sidebarRailHeight: number;
}

export interface TimelinePanelBounds {
  minHeight: number;
  maxHeight: number;
  defaultHeight: number;
}

function clampDimension(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getTimelinePanelBounds(height: number, compactTimeline: boolean): TimelinePanelBounds {
  const minHeight = compactTimeline ? 132 : 156;
  const defaultHeight = compactTimeline
    ? clampDimension(Math.round(height * 0.2), 132, 176)
    : clampDimension(Math.round(height * 0.22), 156, 210);
  const maxHeight = Math.max(
    minHeight + 72,
    Math.min(Math.round(height * 0.55), height - (compactTimeline ? 140 : 180)),
  );

  return {
    minHeight,
    maxHeight,
    defaultHeight: clampDimension(defaultHeight, minHeight, maxHeight),
  };
}

export function getSetupLayoutMode(width: number, height: number): SetupLayoutMode {
  const stackColumns = width < 1240;
  const compactHero = width < 760 || height < 760;
  const featureColumns = compactHero ? 1 : width < 820 ? 1 : width < 1180 ? 2 : 3;

  return {
    stackColumns,
    featureColumns,
    compactHero,
  };
}

export function getEditorLayoutMode(width: number, height: number): EditorLayoutMode {
  const compactToolbar = width < 860 || height < 760;
  const compactTimeline = width < 1040 || height < 820;
  const stackSidebar = width < 1180 || height < 760;
  const timelineHeight = getTimelinePanelBounds(height, compactTimeline).defaultHeight;
  const sidebarRailHeight = stackSidebar
    ? clampDimension(Math.round(height * 0.18), 108, 138)
    : 0;

  return {
    stackSidebar,
    compactToolbar,
    compactTimeline,
    timelineHeight,
    sidebarRailHeight,
  };
}

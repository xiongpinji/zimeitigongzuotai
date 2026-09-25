import type { SrtEntry, TimelineData } from '../types';

export interface HyperframesCompositionInput {
  timeline: TimelineData;
  srtEntries: SrtEntry[];
  projectDir?: string | null;
  gsapSrc?: string;
  gsapScript?: string;
}

export interface HyperframesCompositionResult {
  html: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
}

export interface HyperframesAssetDescriptor {
  sourcePath: string;
  publicPath: string;
}

export interface PreparedHyperframesTimeline {
  timeline: TimelineData;
  assets: HyperframesAssetDescriptor[];
}

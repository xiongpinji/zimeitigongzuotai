import type { FilterPreset } from './contracts';

export interface FilterAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export const FILTER_PRESETS: Record<FilterPreset, FilterAdjustments> = {
  none: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
  bw: { brightness: 0, contrast: 10, saturation: -100, temperature: 0 },
  vivid: { brightness: 5, contrast: 20, saturation: 30, temperature: 0 },
  vintage: { brightness: -5, contrast: -10, saturation: -20, temperature: 20 },
  cool: { brightness: 0, contrast: 5, saturation: -5, temperature: -25 },
  warm: { brightness: 0, contrast: 5, saturation: 5, temperature: 25 },
};

export function getPresetAdjustments(preset: FilterPreset): FilterAdjustments {
  return FILTER_PRESETS[preset];
}

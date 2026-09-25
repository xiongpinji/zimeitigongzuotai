import type { AspectRatioPreset } from './contracts';

export interface AspectRatioPresetDef {
  id: AspectRatioPreset;
  label: string;
  ratio: number | null;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPresetDef[] = [
  { id: 'timeline', label: '时间线比例', ratio: null },
  { id: '16:9', label: '16:9 横版', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 竖版', ratio: 9 / 16 },
  { id: '1:1', label: '1:1 方版', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '4:5', label: '4:5 小红书', ratio: 4 / 5 },
  { id: 'free', label: '自由裁剪', ratio: null },
];

export function resolveAspectRatio(
  preset: AspectRatioPreset,
  timelineSize: { width: number; height: number },
): number | null {
  if (preset === 'free') return null;
  if (preset === 'timeline') {
    if (!timelineSize.width || !timelineSize.height) return 16 / 9;
    return timelineSize.width / timelineSize.height;
  }
  const def = ASPECT_RATIO_PRESETS.find((p) => p.id === preset);
  return def?.ratio ?? null;
}

export function computeClipSize(
  ratio: number | null,
  containerWidth: number,
  containerHeight: number,
): { width: number; height: number } {
  if (!ratio) return { width: containerWidth, height: containerHeight };
  const maxByWidth = { width: containerWidth, height: containerWidth / ratio };
  if (maxByWidth.height <= containerHeight) return maxByWidth;
  return { width: containerHeight * ratio, height: containerHeight };
}

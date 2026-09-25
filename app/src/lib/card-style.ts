import {
  DEFAULT_STYLE_PRESET_ID,
  type VisualStyleFacetKind,
  type VisualStylePreset,
} from '../types/ai';
import { VISUAL_STYLE_PRESETS } from './card-style-presets';

const PRESET_BY_ID = new Map<string, VisualStylePreset>(
  VISUAL_STYLE_PRESETS.map((p) => [p.id, p]),
);

export function getStylePresetById(id: string | undefined | null): VisualStylePreset {
  const found = id ? PRESET_BY_ID.get(id) : undefined;
  return found ?? PRESET_BY_ID.get(DEFAULT_STYLE_PRESET_ID)!;
}

export interface StylePresetScope {
  card?: string | null;
  project?: string | null;
  global?: string | null;
}

function pick(value: string | null | undefined): string | undefined {
  const v = typeof value === 'string' ? value.trim() : '';
  return v.length > 0 ? v : undefined;
}

/** 单卡 → 项目 → 全局 → 内置默认；仅做优先级选择，不校验存在性（下游 getStylePresetById 兜底）。 */
export function resolveStylePresetId(scope: StylePresetScope): string {
  return pick(scope.card) ?? pick(scope.project) ?? pick(scope.global) ?? DEFAULT_STYLE_PRESET_ID;
}

/**
 * 取某风格某 facet 的提示词块；缺失 facet（空串 / undefined）回退到内置默认风格的同 facet。
 * 注入到提示词的 {{styleSystemBlock}}。
 */
export function getStyleFacetBlock(
  presetId: string | undefined | null,
  facet: VisualStyleFacetKind,
): string {
  const preset = getStylePresetById(presetId);
  const block = preset.facets[facet];
  if (block && block.trim().length > 0) return block;
  const fallback = getStylePresetById(DEFAULT_STYLE_PRESET_ID).facets[facet];
  return fallback ?? '';
}

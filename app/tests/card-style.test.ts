import { describe, expect, it } from 'vitest';
import { buildAICardOverlayData, getDefaultCardStyle, type AICard } from '../src/types/ai';

function makeCard(overrides: Partial<AICard> = {}): AICard {
  return {
    id: 'c1',
    segmentId: 's1',
    type: 'summary',
    title: 'T',
    content: '',
    startMs: 0,
    endMs: 1000,
    displayDurationMs: 5000,
    displayMode: 'fullscreen',
    template: 'summary-default',
    enabled: true,
    style: getDefaultCardStyle('summary'),
    ...overrides,
  };
}

describe('buildAICardOverlayData stylePresetId 透传', () => {
  it('保留单卡 stylePresetId', () => {
    const overlay = buildAICardOverlayData(makeCard({ stylePresetId: 'swiss-grid' }));
    expect(overlay.stylePresetId).toBe('swiss-grid');
  });

  it('未设置时为 undefined', () => {
    const overlay = buildAICardOverlayData(makeCard());
    expect(overlay.stylePresetId).toBeUndefined();
  });
});

import {
  resolveStylePresetId,
  getStylePresetById,
  getStyleFacetBlock,
} from '../src/lib/card-style';
import { DEFAULT_STYLE_PRESET_ID } from '../src/types/ai';

describe('resolveStylePresetId 优先级', () => {
  it('单卡 > 项目 > 全局 > 默认', () => {
    expect(resolveStylePresetId({ card: 'a', project: 'b', global: 'c' })).toBe('a');
    expect(resolveStylePresetId({ project: 'b', global: 'c' })).toBe('b');
    expect(resolveStylePresetId({ global: 'c' })).toBe('c');
    expect(resolveStylePresetId({})).toBe(DEFAULT_STYLE_PRESET_ID);
  });
  it('空白字符串视为未设置', () => {
    expect(resolveStylePresetId({ card: '  ', project: 'editorial-eink' })).toBe('editorial-eink');
  });
  it('项目缺 stylePresetId 时解析回退默认', () => {
    expect(resolveStylePresetId({ project: undefined })).toBe(DEFAULT_STYLE_PRESET_ID);
  });
});

describe('getStylePresetById / getStyleFacetBlock 回退', () => {
  it('未知 id 回退默认 preset', () => {
    expect(getStylePresetById('does-not-exist').id).toBe(DEFAULT_STYLE_PRESET_ID);
  });
  it('缺失 facet 回退到默认风格同 facet（motion 非空）', () => {
    expect(getStyleFacetBlock('editorial-eink', 'motion').length).toBeGreaterThan(0);
  });
  it('未知 id 取默认风格的 facet', () => {
    expect(getStyleFacetBlock('nope', 'motion')).toBe(getStyleFacetBlock('editorial-eink', 'motion'));
  });
});

import { buildDefaultAISettings } from '../src/store/ai';

describe('AISettings 默认风格', () => {
  it('buildDefaultAISettings 给出默认风格 id', () => {
    expect(buildDefaultAISettings().defaultStylePresetId).toBe(DEFAULT_STYLE_PRESET_ID);
  });
});

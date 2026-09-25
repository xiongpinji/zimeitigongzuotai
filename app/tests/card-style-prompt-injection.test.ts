import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_YAML } from '../src/lib/prompts/defaults';
import { getStyleFacetBlock } from '../src/lib/card-style';
import {
  buildSegmentCardPrompt,
  buildCoverPromptRegenerationPrompt,
} from '../src/lib/ai-analysis';
import type { AISegment } from '../src/types/ai';

describe('提示词 styleSystemBlock 占位符', () => {
  it('cards.segment 含占位符', () => {
    expect(DEFAULT_PROMPT_YAML['cards.segment']).toContain('{{styleSystemBlock}}');
  });
  it('cover.regeneration 含占位符', () => {
    expect(DEFAULT_PROMPT_YAML['cover.regeneration']).toContain('{{styleSystemBlock}}');
  });
  it('card.image 含占位符', () => {
    expect(DEFAULT_PROMPT_YAML['card.image']).toContain('{{styleSystemBlock}}');
  });
});

describe('editorial-eink facet 非空（motion/cover）', () => {
  it('motion facet 含「电子杂志」锚点', () => {
    expect(getStyleFacetBlock('editorial-eink', 'motion')).toContain('电子杂志');
  });
  it('cover facet 含「缩略图」锚点', () => {
    expect(getStyleFacetBlock('editorial-eink', 'cover')).toContain('缩略图');
  });
  // 默认预设 editorial-eink 的 image facet 故意留空：card.image 用裸 {{styleSystemBlock}} 占位符，
  // 空 facet 渲染为空字符串，不会产生悬挂的 ===== 风格锚点 ===== 标题（非疏漏）。
  it('image facet 默认为空（非疏漏）', () => {
    expect(getStyleFacetBlock('editorial-eink', 'image')).toBe('');
  });
});

describe('新增风格预设 facet 锚点', () => {
  it('swiss-grid motion facet 含「网格」/「克莱因」锚点且非空', () => {
    const block = getStyleFacetBlock('swiss-grid', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/网格|克莱因/);
  });

  it('nyt-data motion facet 含「社论」/「SVG」锚点且非空', () => {
    const block = getStyleFacetBlock('nyt-data', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/社论|SVG/);
  });

  it('cyber-glitch motion facet 含「故障」/「扫描线」锚点且非空', () => {
    const block = getStyleFacetBlock('cyber-glitch', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/故障|扫描线/);
  });

  it('film-leak motion facet 含「胶片」/「信箱」锚点且非空', () => {
    const block = getStyleFacetBlock('film-leak', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/胶片|信箱/);
  });

  it('hand-sketch motion facet 含「便签」/「方格」/「手绘」锚点且非空', () => {
    const block = getStyleFacetBlock('hand-sketch', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/便签|方格|手绘/);
  });

  it('soft-apple motion facet 含「squircle」/「圆角」/「柔」锚点且非空', () => {
    const block = getStyleFacetBlock('soft-apple', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/squircle|圆角|柔/);
  });

  it('dark-graph motion facet 含「图谱」/「玻璃」/「光球」锚点且非空', () => {
    const block = getStyleFacetBlock('dark-graph', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/图谱|玻璃|光球/);
  });

  it('xhs-pastel motion facet 含「马卡龙」/「柔彩」/「圆角」锚点且非空', () => {
    const block = getStyleFacetBlock('xhs-pastel', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/马卡龙|柔彩|圆角/);
  });

  it('mono-bold motion facet 含「大字」/「满版」/「色条」锚点且非空', () => {
    const block = getStyleFacetBlock('mono-bold', 'motion');
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/大字|满版|色条/);
  });
});

describe('提示词移除 projectStylePrompt 注入', () => {
  const kinds = ['planning.segment', 'cover.regeneration', 'cards.segment', 'card.image', 'card.video'] as const;
  it('5 个业务提示词不再含 projectStylePrompt 占位符', () => {
    for (const k of kinds) {
      expect(DEFAULT_PROMPT_YAML[k]).not.toContain('{{projectStylePrompt}}');
      expect(DEFAULT_PROMPT_YAML[k]).not.toContain('{{projectStylePromptBlock}}');
    }
  });
  it('卡片提示词仍含 styleSystemBlock', () => {
    expect(DEFAULT_PROMPT_YAML['cards.segment']).toContain('{{styleSystemBlock}}');
    expect(DEFAULT_PROMPT_YAML['cover.regeneration']).toContain('{{styleSystemBlock}}');
    expect(DEFAULT_PROMPT_YAML['card.image']).toContain('{{styleSystemBlock}}');
  });
});

describe('build 函数注入 styleSystemBlock', () => {
  const segment: AISegment = {
    id: 'seg-1',
    title: '示例段落',
    summary: '示例段落摘要',
    startMs: 0,
    endMs: 3_000,
    transcriptExcerpt: '示例逐字稿',
  };

  it('cards.segment 默认（无 stylePresetId）注入 editorial-eink motion 块', () => {
    const prompt = buildSegmentCardPrompt({
      programContext: '节目摘要：测试',
      segment,
    });
    expect(prompt).toContain('电子杂志');
  });

  it('cover.regeneration 默认（无 stylePresetId）注入 editorial-eink cover 块', () => {
    const prompt = buildCoverPromptRegenerationPrompt({});
    expect(prompt).toContain('缩略图');
  });
});

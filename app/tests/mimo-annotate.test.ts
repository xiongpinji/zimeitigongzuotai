import { describe, expect, it, vi } from 'vitest';
import {
  MIMO_TAG_WHITELIST,
  isAnnotationFaithful,
  sanitizeAnnotation,
  buildAnnotateSystemPrompt,
} from '../src/lib/tts/mimo-annotate';

describe('isAnnotationFaithful', () => {
  const clean = ['第一句。', '第二句。'];
  it('字词顺序一致 → true', () => {
    expect(isAnnotationFaithful([{ sentence: '第一句。', tag: '强调' }, { sentence: '第二句。', tag: null }], clean)).toBe(true);
  });
  it('改了字 → false', () => {
    expect(isAnnotationFaithful([{ sentence: '第一句！', tag: null }, { sentence: '第二句。', tag: null }], clean)).toBe(false);
  });
  it('句数不符 → false', () => {
    expect(isAnnotationFaithful([{ sentence: '第一句。', tag: null }], clean)).toBe(false);
  });
});

describe('sanitizeAnnotation', () => {
  it('非白名单标签置 null', () => {
    const out = sanitizeAnnotation([{ sentence: 'a', tag: '咆哮' }, { sentence: 'b', tag: '强调' }]);
    expect(out).toEqual([{ sentence: 'a', tag: null }, { sentence: 'b', tag: '强调' }]);
  });
});

describe('buildAnnotateSystemPrompt', () => {
  it('包含白名单且在有 hint 时注入', () => {
    const p = buildAnnotateSystemPrompt('偏深度，多停顿');
    for (const tag of MIMO_TAG_WHITELIST) expect(p).toContain(tag);
    expect(p).toContain('偏深度，多停顿');
  });
});

import { annotateForMimo } from '../src/lib/tts/mimo-annotate';

const settings = { ttsMimoAutoAnnotate: true } as unknown as import('../src/types/ai').AISettings;

describe('annotateForMimo', () => {
  const clean = ['第一句。', '第二句。'];

  it('LLM 合法返回 → 产出每句标签', async () => {
    const gen = vi.fn().mockResolvedValue({ items: [{ sentence: '第一句。', tag: '强调' }, { sentence: '第二句。', tag: null }] });
    const tags = await annotateForMimo(clean, '', settings, { generate: gen });
    expect(tags).toEqual(['强调', null]);
  });

  it('LLM 改写文本 → 整体回退全 null', async () => {
    const gen = vi.fn().mockResolvedValue({ items: [{ sentence: '改写了。', tag: '强调' }, { sentence: '第二句。', tag: null }] });
    const tags = await annotateForMimo(clean, '', settings, { generate: gen });
    expect(tags).toEqual([null, null]);
  });

  it('LLM 抛错 → 回退全 null', async () => {
    const gen = vi.fn().mockRejectedValue(new Error('boom'));
    const tags = await annotateForMimo(clean, '', settings, { generate: gen });
    expect(tags).toEqual([null, null]);
  });

  it('开关关闭 → 跳过、全 null、不调用 LLM', async () => {
    const gen = vi.fn();
    const off = { ttsMimoAutoAnnotate: false } as unknown as import('../src/types/ai').AISettings;
    const tags = await annotateForMimo(clean, '', off, { generate: gen });
    expect(tags).toEqual([null, null]);
    expect(gen).not.toHaveBeenCalled();
  });
});

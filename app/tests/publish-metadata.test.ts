import { describe, expect, it, vi } from 'vitest';
import {
  buildPublishMetadataMessages,
  generatePublishMetadata,
  parsePublishMetadata,
} from '../src/lib/publish-metadata';
import { getBuiltinPromptTemplate } from '../src/lib/prompts';
import type { AISettings } from '../src/types/ai';

const FAKE_SETTINGS = {} as AISettings;
const TEMPLATE = getBuiltinPromptTemplate('publish.metadata');

describe('parsePublishMetadata', () => {
  it('解析标准结构', () => {
    expect(
      parsePublishMetadata({ title: '标题', desc: '描述', tags: ['a', 'b'] }),
    ).toEqual({ title: '标题', desc: '描述', tags: ['a', 'b'] });
  });

  it('剥离标签的 # 前缀并去重', () => {
    const md = parsePublishMetadata({ title: 't', desc: 'd', tags: ['#科技', '科技', '#AI'] });
    expect(md.tags).toEqual(['科技', 'AI']);
  });

  it('tags 为字符串时按分隔符拆分', () => {
    const md = parsePublishMetadata({ title: 't', desc: 'd', tags: '科技, AI 数码' });
    expect(md.tags).toEqual(['科技', 'AI', '数码']);
  });

  it('兼容 description / keywords 别名', () => {
    const md = parsePublishMetadata({ title: 't', description: 'dd', keywords: ['k'] });
    expect(md.desc).toBe('dd');
    expect(md.tags).toEqual(['k']);
  });

  it('全空时抛错', () => {
    expect(() => parsePublishMetadata({ title: '', desc: '', tags: [] })).toThrow();
  });
});

describe('buildPublishMetadataMessages', () => {
  it('约束规则与 JSON 契约进 systemPrompt，节目内容进 userMessage', () => {
    const { systemPrompt, userMessage } = buildPublishMetadataMessages(TEMPLATE, {
      sourceText: '内容X',
    });
    // 约束（含标题 ≤25 字硬限）+ 锁定 JSON 契约都在 system 位
    expect(systemPrompt).toContain('标题要求');
    expect(systemPrompt).toContain('不得超过 25 个字');
    expect(systemPrompt).toContain('【系统契约 · 不可修改】');
    // 数据在 user 位
    expect(userMessage).toContain('内容X');
    expect(userMessage).toContain('【节目内容】');
    expect(userMessage).not.toContain('【系统契约 · 不可修改】');
  });

  it('有已有标题时把参考块注入 userMessage', () => {
    const { userMessage } = buildPublishMetadataMessages(TEMPLATE, {
      sourceText: '内容',
      currentTitle: '旧标题',
    });
    expect(userMessage).toContain('旧标题');
    expect(userMessage).toContain('内容');
  });
});

describe('generatePublishMetadata', () => {
  it('调用注入的 generate 并解析结果', async () => {
    const fake = vi.fn().mockResolvedValue({ title: 'T', desc: 'D', tags: ['x'] });
    const md = await generatePublishMetadata(
      FAKE_SETTINGS,
      { sourceText: '节目内容' },
      { template: TEMPLATE, generateStructuredData: fake },
    );
    expect(md).toEqual({ title: 'T', desc: 'D', tags: ['x'] });
    expect(fake).toHaveBeenCalledOnce();
  });

  it('把 system / user 两段消息传给 generate', async () => {
    const fake = vi.fn().mockResolvedValue({ title: 'T', desc: 'D', tags: ['x'] });
    await generatePublishMetadata(
      FAKE_SETTINGS,
      { sourceText: '节目内容' },
      { template: TEMPLATE, generateStructuredData: fake },
    );
    const [, systemPrompt, userMessage] = fake.mock.calls[0];
    expect(systemPrompt).toContain('标题要求');
    expect(userMessage).toContain('节目内容');
  });

  it('sourceText 为空时抛错且不调用 LLM', async () => {
    const fake = vi.fn();
    await expect(
      generatePublishMetadata(
        FAKE_SETTINGS,
        { sourceText: '   ' },
        { template: TEMPLATE, generateStructuredData: fake },
      ),
    ).rejects.toThrow();
    expect(fake).not.toHaveBeenCalled();
  });
});

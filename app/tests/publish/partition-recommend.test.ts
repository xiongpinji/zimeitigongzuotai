import { describe, expect, it, vi } from 'vitest';
import {
  buildPartitionRecommendMessages,
  parsePartitionRecommend,
  recommendBilibiliPartition,
} from '../../src/lib/publish-partition-recommend';
import { getBuiltinPromptTemplate } from '../../src/lib/prompts';
import type { AISettings } from '../../src/types/ai';

const FAKE_SETTINGS = {} as AISettings;
const TEMPLATE = getBuiltinPromptTemplate('publish.partition');

describe('parsePartitionRecommend', () => {
  it('数字 tid 命中清单时返回', () => {
    expect(parsePartitionRecommend({ tid: 21 })).toBe(21);
  });

  it('字符串数字也能解析', () => {
    expect(parsePartitionRecommend({ tid: '171' })).toBe(171);
  });

  it('清单外 tid 抛错', () => {
    expect(() => parsePartitionRecommend({ tid: 999999 })).toThrow();
  });

  it('主分区 id（非可投稿子分区）抛错', () => {
    expect(() => parsePartitionRecommend({ tid: 4 })).toThrow();
  });

  it('缺字段 / 非数字抛错', () => {
    expect(() => parsePartitionRecommend({})).toThrow();
    expect(() => parsePartitionRecommend({ tid: 'abc' })).toThrow();
  });
});

describe('buildPartitionRecommendMessages', () => {
  it('选择规则与 JSON 契约进 systemPrompt，标题/描述/分区清单进 userMessage', () => {
    const { systemPrompt, userMessage } = buildPartitionRecommendMessages(TEMPLATE, {
      title: 'GPT-5 发布',
      desc: '聊聊新模型',
    });
    expect(systemPrompt).toContain('【系统契约 · 不可修改】');
    expect(userMessage).toContain('GPT-5 发布');
    expect(userMessage).toContain('聊聊新模型');
    // 全量分区清单注入 user 位（抽样校验）
    expect(userMessage).toContain('可选分区清单');
    expect(userMessage).toContain('科技 / 软件应用');
    expect(userMessage).not.toContain('【系统契约 · 不可修改】');
  });

  it('标题描述均空时用 fallbackSource', () => {
    const { userMessage } = buildPartitionRecommendMessages(TEMPLATE, {
      title: '',
      desc: '',
      fallbackSource: '一期关于健身的播客',
    });
    expect(userMessage).toContain('一期关于健身的播客');
  });
});

describe('recommendBilibiliPartition', () => {
  it('调用注入的 generate 并返回校验后的 tid', async () => {
    const fake = vi.fn().mockResolvedValue({ tid: 95 });
    const res = await recommendBilibiliPartition(
      FAKE_SETTINGS,
      { title: '数码评测', desc: '' },
      { template: TEMPLATE, generateStructuredData: fake },
    );
    expect(res).toEqual({ tid: 95 });
    expect(fake).toHaveBeenCalledOnce();
  });

  it('LLM 返回越界 tid 时抛错', async () => {
    const fake = vi.fn().mockResolvedValue({ tid: 888888 });
    await expect(
      recommendBilibiliPartition(
        FAKE_SETTINGS,
        { title: '数码评测', desc: '' },
        { template: TEMPLATE, generateStructuredData: fake },
      ),
    ).rejects.toThrow();
  });

  it('标题/描述/兜底全空时抛错且不调用 LLM', async () => {
    const fake = vi.fn();
    await expect(
      recommendBilibiliPartition(
        FAKE_SETTINGS,
        { title: '  ', desc: '' },
        { template: TEMPLATE, generateStructuredData: fake },
      ),
    ).rejects.toThrow();
    expect(fake).not.toHaveBeenCalled();
  });
});

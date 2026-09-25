import { describe, it, expect } from 'vitest';
import {
  sanitizeProjectName,
  deriveProjectName,
  inboxItemToOriginalMarkdown,
  insightToReferenceMarkdown,
  canDraftInboxItem,
  type SonarInboxItem,
} from '../src/lib/sonar-inbox';

function item(over: Partial<SonarInboxItem> = {}): SonarInboxItem {
  return {
    id: 'i1',
    source: 'douyin',
    awemeId: 'a1',
    creatorId: 'c1',
    creatorName: '老王',
    title: '如何高效学习',
    url: 'https://www.douyin.com/video/a1',
    publishedAt: 1,
    transcript: { fullText: '  转录全文  ', srtText: 's', segments: [] },
    status: 'pending',
    receivedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('sonar-inbox helpers', () => {
  it('sanitizeProjectName 去非法字符并限长', () => {
    expect(sanitizeProjectName('a/b:c*?"<>|')).toBe('a b c');
    expect(sanitizeProjectName('   ')).toBe('未命名');
    expect(sanitizeProjectName('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });

  it('deriveProjectName 组合博主与标题（连字符分隔）', () => {
    expect(deriveProjectName({ creatorName: '老王', title: '如何高效学习' })).toBe('老王-如何高效学习');
    expect(deriveProjectName({ creatorName: '', title: '' })).toBe('未命名作品');
    expect(deriveProjectName({ creatorName: '老王', title: '' })).toBe('老王');
  });

  it('inboxItemToOriginalMarkdown 无 insight 时取转录全文并 trim', () => {
    expect(inboxItemToOriginalMarkdown(item())).toBe('转录全文');
  });

  it('inboxItemToOriginalMarkdown 有 insight 时前置创作参考再接转录', () => {
    const out = inboxItemToOriginalMarkdown(
      item({
        insight: {
          angle: '反常识',
          hook: '开头钩子',
          structure: ['先抛结论', '再给案例'],
          highlights: [],
          dataPoints: [],
          remixSuggestions: ['换成自己的领域'],
        },
      }),
    );
    expect(out).toContain('# 创作参考（爆款拆解）');
    expect(out).toContain('选题角度：反常识');
    expect(out).toContain('1. 先抛结论');
    expect(out).toContain('换成自己的领域');
    // 转录在分隔线之后。
    expect(out.indexOf('---')).toBeLessThan(out.indexOf('转录全文'));
  });

  it('insightToReferenceMarkdown 无有效内容返回空串', () => {
    expect(insightToReferenceMarkdown(undefined)).toBe('');
    expect(
      insightToReferenceMarkdown({ angle: '', hook: '', structure: [], highlights: [], dataPoints: [], remixSuggestions: [] }),
    ).toBe('');
  });

  it('canDraftInboxItem 依据转录是否非空', () => {
    expect(canDraftInboxItem(item())).toBe(true);
    expect(canDraftInboxItem(item({ transcript: { fullText: '   ', srtText: '', segments: [] } }))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { parseReviewPayload, type ReviewPayload } from '../src/lib/script-review-payload';

/** 构造一个合法的 ReviewPayload 对象 */
function makePayload(overrides?: Partial<ReviewPayload>): ReviewPayload {
  return {
    version: 1,
    filePath: 'script.md',
    docVersion: 3,
    summary: { total: 1, error: 0, warning: 1, info: 0 },
    findings: [
      {
        id: 'f1',
        startOffset: 0,
        endOffset: 10,
        quotedText: '测试文本',
        issue: '用词不当',
        suggestion: '建议修改为更准确的表述',
        severity: 'warning',
      },
    ],
    ...overrides,
  };
}

/** 将 payload 包裹在 fenced block 中 */
function wrap(payload: unknown): string {
  return `一些前置文字\n\`\`\`script-review\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n后续文字`;
}

describe('parseReviewPayload', () => {
  it('正常提取 fenced block 并解析', () => {
    const payload = makePayload();
    const result = parseReviewPayload(wrap(payload));
    expect(result).toEqual(payload);
  });

  it('支持空 findings 数组', () => {
    const payload = makePayload({
      findings: [],
      summary: { total: 0, error: 0, warning: 0, info: 0 },
    });
    const result = parseReviewPayload(wrap(payload));
    expect(result).toEqual(payload);
  });

  it('仅提取第一个 fenced block', () => {
    const first = makePayload({ docVersion: 1 });
    const second = makePayload({ docVersion: 2 });
    const text = `\`\`\`script-review\n${JSON.stringify(first)}\n\`\`\`\n\`\`\`script-review\n${JSON.stringify(second)}\n\`\`\``;
    const result = parseReviewPayload(text);
    expect(result?.docVersion).toBe(1);
  });

  it('无 fenced block 返回 null', () => {
    expect(parseReviewPayload('普通文本，没有代码块')).toBeNull();
  });

  it('fenced block 语言标识不匹配返回 null', () => {
    const text = '```json\n{"version":1}\n```';
    expect(parseReviewPayload(text)).toBeNull();
  });

  it('非法 JSON 返回 null', () => {
    const text = '```script-review\n{ bad json }\n```';
    expect(parseReviewPayload(text)).toBeNull();
  });

  it('version 不为 1 返回 null', () => {
    const payload = makePayload();
    (payload as Record<string, unknown>).version = 2;
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });

  it('filePath 不为 script.md 返回 null', () => {
    const payload = makePayload();
    (payload as Record<string, unknown>).filePath = 'other.md';
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });

  it('docVersion 不为数字返回 null', () => {
    const payload = makePayload();
    (payload as Record<string, unknown>).docVersion = '3';
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });

  it('缺少 summary 返回 null', () => {
    const payload = makePayload();
    delete (payload as Record<string, unknown>).summary;
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });

  it('summary 缺少必填字段返回 null', () => {
    const payload = makePayload();
    (payload as Record<string, unknown>).summary = { total: 1 };
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });

  it('findings 不为数组返回 null', () => {
    const payload = makePayload();
    (payload as Record<string, unknown>).findings = 'not-array';
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });

  it('finding 缺少必填字段返回 null', () => {
    const payload = makePayload();
    payload.findings = [{ id: 'f1' } as never];
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });

  it('finding severity 不合法返回 null', () => {
    const payload = makePayload();
    (payload.findings[0] as Record<string, unknown>).severity = 'critical';
    expect(parseReviewPayload(wrap(payload))).toBeNull();
  });
});

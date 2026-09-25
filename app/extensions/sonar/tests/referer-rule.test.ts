import { describe, it, expect } from 'vitest';
import { buildDouyinDownloadHeaderRules } from '@/background/download/referer-rule';

describe('buildDouyinDownloadHeaderRules', () => {
  const rules = buildDouyinDownloadHeaderRules() as unknown as Array<{
    id: number;
    action: { type: string; requestHeaders: Array<{ header: string; operation: string; value?: string }> };
    condition: { requestDomains?: string[]; resourceTypes?: string[]; urlFilter?: string };
  }>;

  it('produces a modifyHeaders rule that sets Referer to douyin', () => {
    const rule = rules[0];
    expect(rule.action.type).toBe('modifyHeaders');
    const referer = rule.action.requestHeaders.find((h) => h.header.toLowerCase() === 'referer');
    expect(referer?.operation).toBe('set');
    expect(referer?.value).toContain('douyin.com');
  });

  it('targets the douyin video CDN domains', () => {
    expect(rules[0].condition.requestDomains).toEqual(
      expect.arrayContaining(['douyinvod.com', 'snssdk.com', 'amemv.com']),
    );
  });

  it('covers media and other resource types (chrome.downloads requests)', () => {
    expect(rules[0].condition.resourceTypes).toEqual(
      expect.arrayContaining(['media', 'other']),
    );
  });

  it('sets the bcut client user agent for member.bilibili.com requests', () => {
    const rule = rules.find((candidate) => candidate.condition.requestDomains?.includes('member.bilibili.com'));
    const userAgent = rule?.action.requestHeaders.find(
      (header) => header.header.toLowerCase() === 'user-agent',
    );
    const origin = rule?.action.requestHeaders.find(
      (header) => header.header.toLowerCase() === 'origin',
    );

    expect(userAgent?.operation).toBe('set');
    expect(userAgent?.value).toBe('Bilibili/1.0.0 (https://www.bilibili.com)');
    expect(origin?.operation).toBe('remove');
  });

});

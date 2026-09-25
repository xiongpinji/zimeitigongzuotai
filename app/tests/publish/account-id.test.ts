import { describe, it, expect } from 'vitest';
import { buildAccountId, parseAccountId } from '../../electron/publish/account-id';

describe('account-id', () => {
  it('builds `${platform}_${accountName}`', () => {
    expect(buildAccountId('douyin', '一叶知秋')).toBe('douyin_一叶知秋');
  });
  it('round-trips through parse', () => {
    expect(parseAccountId('bilibili_一叶知秋')).toEqual({
      platform: 'bilibili',
      accountName: '一叶知秋',
    });
  });
  it('parses account names containing underscores', () => {
    expect(parseAccountId('douyin_a_b_c')).toEqual({ platform: 'douyin', accountName: 'a_b_c' });
  });
});

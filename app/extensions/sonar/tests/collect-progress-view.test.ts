import { describe, expect, it } from 'vitest';
import { describeCollectProgress } from '@/workbench/use-data';

describe('describeCollectProgress', () => {
  it('shows determinate progress while collecting', () => {
    expect(describeCollectProgress({ collected: 321, total: 607, done: false })).toBe('采集中 321/607');
  });

  it('explains an accessible-total mismatch at completion', () => {
    expect(describeCollectProgress({ collected: 606, total: 607, done: true })).toBe('已采集 606/607（公开可见）');
  });

  it('supports pages whose total cannot be read', () => {
    expect(describeCollectProgress({ collected: 88, done: true })).toBe('已采集 88 条');
  });
});

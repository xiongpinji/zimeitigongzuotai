import { describe, expect, it } from 'vitest';
import {
  BILIBILI_PARTITIONS,
  flattenPartitions,
  findPartition,
  isValidTid,
} from '../../src/lib/publish/bilibili-partitions';

describe('BILIBILI_PARTITIONS 数据完整性', () => {
  it('17 个可投稿主分区，每个都有子分区', () => {
    expect(BILIBILI_PARTITIONS).toHaveLength(17);
    for (const p of BILIBILI_PARTITIONS) {
      expect(p.children.length).toBeGreaterThan(0);
    }
  });

  it('全部 tid（主+子）为正整数且全局唯一', () => {
    const ids: number[] = [];
    for (const p of BILIBILI_PARTITIONS) {
      ids.push(p.id);
      for (const c of p.children) {
        expect(Number.isInteger(c.id)).toBe(true);
        expect(c.id).toBeGreaterThan(0);
        ids.push(c.id);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('不收录 PGC 区（番剧/电视剧/电影 主分区 13/11/23）', () => {
    const parentIds = BILIBILI_PARTITIONS.map((p) => p.id);
    expect(parentIds).not.toContain(13);
    expect(parentIds).not.toContain(11);
    expect(parentIds).not.toContain(23);
  });
});

describe('flattenPartitions', () => {
  it('拍平条目数 = 所有子分区数之和，label 为「主 / 子」', () => {
    const flat = flattenPartitions();
    const total = BILIBILI_PARTITIONS.reduce((n, p) => n + p.children.length, 0);
    expect(flat).toHaveLength(total);
    const sample = flat.find((f) => f.tid === 21);
    expect(sample).toEqual({ tid: 21, name: '日常', parent: '生活', label: '生活 / 日常' });
  });
});

describe('findPartition', () => {
  it('命中已知 tid 返回主/子分区', () => {
    expect(findPartition(21)?.parent.name).toBe('生活');
    expect(findPartition(21)?.sub.name).toBe('日常');
    expect(findPartition(171)?.parent.name).toBe('游戏');
    expect(findPartition(171)?.sub.name).toBe('电子竞技');
  });

  it('未知 tid 返回 null', () => {
    expect(findPartition(999999)).toBeNull();
    // 主分区 id 本身不是可投稿子分区
    expect(findPartition(4)).toBeNull();
  });
});

describe('isValidTid', () => {
  it('已知子分区 tid 为 true', () => {
    expect(isValidTid(21)).toBe(true);
    expect(isValidTid(171)).toBe(true);
    expect(isValidTid(95)).toBe(true);
  });

  it('清单外 / 主分区 / 非整数为 false', () => {
    expect(isValidTid(999999)).toBe(false);
    expect(isValidTid(4)).toBe(false); // 主分区
    expect(isValidTid(21.5)).toBe(false);
    expect(isValidTid(NaN)).toBe(false);
  });
});

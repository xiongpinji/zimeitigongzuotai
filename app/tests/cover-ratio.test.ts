import { describe, expect, it } from 'vitest';
import {
  autoFillCovers,
  classifyRatio,
  groupCoverCandidatesByRatio,
} from '../src/components/publish/useCoverStudio';

describe('classifyRatio', () => {
  it('归类标准 16:9 / 4:3 / 3:4', () => {
    expect(classifyRatio(1920, 1080)).toBe('16:9');
    expect(classifyRatio(1280, 720)).toBe('16:9');
    expect(classifyRatio(1024, 768)).toBe('4:3');
    expect(classifyRatio(768, 1024)).toBe('3:4');
    expect(classifyRatio(900, 1200)).toBe('3:4');
  });

  it('容差内的近似比例仍归类', () => {
    // 1600x896 ≈ 1.786，接近 16:9
    expect(classifyRatio(1600, 896)).toBe('16:9');
  });

  it('非目标比例（1:1 / 9:16）返回 null', () => {
    expect(classifyRatio(1000, 1000)).toBeNull();
    expect(classifyRatio(1080, 1920)).toBeNull();
  });

  it('非法尺寸返回 null', () => {
    expect(classifyRatio(0, 720)).toBeNull();
    expect(classifyRatio(1920, 0)).toBeNull();
  });
});

describe('groupCoverCandidatesByRatio', () => {
  it('旧候选缺少比例时使用同路径磁盘图片的真实比例', () => {
    const groups = groupCoverCandidatesByRatio(
      [
        {
          id: 'cover-scan:covers/cover-3x4.png',
          prompt: '竖版封面',
          imageUrl: '/project/covers/cover-3x4.png',
          selected: true,
        },
        {
          id: 'cover-scan:covers/cover-4x3.png',
          prompt: '横版封面',
          imageUrl: '/project/covers/cover-4x3.png',
          selected: false,
        },
      ],
      [
        { path: '/project/covers/cover-3x4.png', ratio: '3:4', mtimeMs: 2 },
        { path: '/project/covers/cover-4x3.png', ratio: '4:3', mtimeMs: 1 },
      ],
      '默认提示词',
    );

    expect(groups['3:4'].map((candidate) => candidate.id)).toEqual([
      'cover-scan:covers/cover-3x4.png',
    ]);
    expect(groups['4:3'].map((candidate) => candidate.id)).toEqual([
      'cover-scan:covers/cover-4x3.png',
    ]);
    expect(groups['16:9']).toEqual([]);
  });
});

describe('autoFillCovers', () => {
  const g = (paths: Partial<Record<'16:9' | '4:3' | '3:4', string>>) => ({
    '16:9': paths['16:9'] ? [{ id: 'a', imageUrl: paths['16:9'], prompt: '', selected: false }] : [],
    '4:3': paths['4:3'] ? [{ id: 'b', imageUrl: paths['4:3'], prompt: '', selected: false }] : [],
    '3:4': paths['3:4'] ? [{ id: 'c', imageUrl: paths['3:4'], prompt: '', selected: false }] : [],
  });

  it('自动填补空缺的 4:3 / 3:4 槽', () => {
    const out = autoFillCovers(g({ '4:3': '/h.png', '3:4': '/v.png' }), {});
    expect(out['4:3']).toBe('/h.png');
    expect(out['3:4']).toBe('/v.png');
  });

  it('不覆盖已选比例', () => {
    const out = autoFillCovers(g({ '4:3': '/new.png' }), { '4:3': '/picked.png' });
    expect(out['4:3']).toBe('/picked.png');
  });

  it('不触碰 16:9（由编辑器整期封面专属逻辑维护）', () => {
    const out = autoFillCovers(g({ '16:9': '/wide.png' }), {});
    expect(out['16:9']).toBeUndefined();
  });

  it('无可填补时返回原引用（避免无谓 setState）', () => {
    const current = { '4:3': '/h.png', '3:4': '/v.png' };
    expect(autoFillCovers(g({ '4:3': '/x.png' }), current)).toBe(current);
    expect(autoFillCovers({ '16:9': [], '4:3': [], '3:4': [] }, {})).toEqual({});
  });
});

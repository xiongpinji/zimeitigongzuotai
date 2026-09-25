import { describe, it, expect } from 'vitest';
import {
  ASPECT_RATIO_PRESETS,
  resolveAspectRatio,
  computeClipSize,
} from '../src/lib/cover-editor/aspect-ratios';

describe('aspect-ratios', () => {
  it('预设列表包含必要项', () => {
    const names = ASPECT_RATIO_PRESETS.map((p) => p.id);
    expect(names).toEqual(['timeline', '16:9', '9:16', '1:1', '4:3', '4:5', 'free']);
  });

  it('timeline 预设返回时间线宽高比', () => {
    const ratio = resolveAspectRatio('timeline', { width: 1920, height: 1080 });
    expect(ratio).toBeCloseTo(16 / 9, 4);
  });

  it('自由裁剪返回 null', () => {
    expect(resolveAspectRatio('free', { width: 1920, height: 1080 })).toBeNull();
  });

  it('computeClipSize 在 1000x1000 容器内按 16:9 计算', () => {
    const size = computeClipSize(16 / 9, 1000, 1000);
    expect(size.width).toBe(1000);
    expect(size.height).toBeCloseTo(562.5, 1);
  });
});

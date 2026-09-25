import { describe, expect, it } from 'vitest';
import {
  insertOutputScaleFilter,
  planRemotionRenderDimensions,
} from '../electron/remotion/render-dimensions';

describe('Remotion export dimensions', () => {
  it('1920×1080 的 480p 导出先生成偶数整数栅格，再精确缩至 854×480', () => {
    const plan = planRemotionRenderDimensions(1920, 1080, 854, 480);
    expect(plan).toMatchObject({
      rasterWidth: 864,
      rasterHeight: 486,
      outputWidth: 854,
      outputHeight: 480,
      needsFinalScale: true,
    });
    expect(1920 * plan.scale).toBe(864);
    expect(1080 * plan.scale).toBe(486);
    expect(insertOutputScaleFilter(['-i', 'frames', 'out.mp4'], plan)).toEqual([
      '-i', 'frames', '-vf', 'scale=854:480:flags=lanczos', 'out.mp4',
    ]);
  });

  it('精确比例的 720p 保持原有编码参数，不增加缩放滤镜', () => {
    const plan = planRemotionRenderDimensions(1920, 1080, 1280, 720);
    expect(plan.needsFinalScale).toBe(false);
    expect(plan.rasterWidth).toBe(1280);
    expect(plan.rasterHeight).toBe(720);
    expect(insertOutputScaleFilter(['-i', 'frames', 'out.mp4'], plan)).toEqual([
      '-i', 'frames', 'out.mp4',
    ]);
  });

  it('竖屏 480p 同样输出 480×854，不能产生小数高度或奇数编码尺寸', () => {
    const plan = planRemotionRenderDimensions(1080, 1920, 480, 854);
    expect(plan).toMatchObject({
      rasterWidth: 486,
      rasterHeight: 864,
      needsFinalScale: true,
    });
    expect(1080 * plan.scale).toBe(486);
    expect(1920 * plan.scale).toBe(864);
  });

  it('无法形成偶数整数栅格的尺寸显式失败', () => {
    expect(() => planRemotionRenderDimensions(1919, 1079, 854, 480)).toThrow(/even integer/);
  });
});

import { describe, it, expect } from 'vitest';
import { validateTimeline } from '../src/lib/external-edit-validate';

const ok = {
  width: 1080,
  height: 1920,
  overlays: [
    {
      id: 'a',
      startMs: 0,
      durationMs: 1000,
      position: { x: 0, y: 0, width: 100, height: 100 },
    },
  ],
};

describe('validateTimeline', () => {
  it('合法 timeline 无错误', () => {
    expect(validateTimeline(ok as never).length).toBe(0);
  });

  it('负时长报错', () => {
    const bad = { ...ok, overlays: [{ id: 'a', startMs: 0, durationMs: -5 }] };
    const errs = validateTimeline(bad as never);
    expect(errs.some((e) => e.field.includes('durationMs'))).toBe(true);
  });

  it('零时长报错', () => {
    const bad = { ...ok, overlays: [{ id: 'a', startMs: 0, durationMs: 0 }] };
    const errs = validateTimeline(bad as never);
    expect(errs.some((e) => e.field.includes('durationMs'))).toBe(true);
  });

  it('负 startMs 报错', () => {
    const bad = { ...ok, overlays: [{ id: 'a', startMs: -1, durationMs: 10 }] };
    expect(validateTimeline(bad as never).some((e) => e.field.includes('startMs'))).toBe(true);
  });

  it('非法 enter 动画值报错', () => {
    const bad = {
      ...ok,
      overlays: [
        {
          id: 'a',
          startMs: 0,
          durationMs: 1000,
          motion: { enter: '__nope__', enterDurationMs: 300, exit: 'fadeOut', exitDurationMs: 300, loop: 'none' },
        },
      ],
    };
    const errs = validateTimeline(bad as never);
    expect(errs.some((e) => e.field.includes('enter'))).toBe(true);
  });

  it('非法 exit 动画值报错', () => {
    const bad = {
      ...ok,
      overlays: [
        {
          id: 'a',
          startMs: 0,
          durationMs: 1000,
          motion: { enter: 'fadeIn', enterDurationMs: 300, exit: '__bad_exit__', exitDurationMs: 300, loop: 'none' },
        },
      ],
    };
    const errs = validateTimeline(bad as never);
    expect(errs.some((e) => e.field.includes('exit'))).toBe(true);
  });

  it("合法 enter='none' 不报错", () => {
    const good = {
      ...ok,
      overlays: [
        {
          id: 'a',
          startMs: 0,
          durationMs: 1000,
          motion: { enter: 'none', enterDurationMs: 0, exit: 'none', exitDurationMs: 0, loop: 'none' },
        },
      ],
    };
    expect(validateTimeline(good as never).length).toBe(0);
  });

  it("合法 enter='fadeIn' exit='slideOutUp' 不报错", () => {
    const good = {
      ...ok,
      overlays: [
        {
          id: 'a',
          startMs: 0,
          durationMs: 1000,
          motion: { enter: 'fadeIn', enterDurationMs: 300, exit: 'slideOutUp', exitDurationMs: 300, loop: 'none' },
        },
      ],
    };
    expect(validateTimeline(good as never).length).toBe(0);
  });

  it('overlays 缺失时视为空数组，不报错', () => {
    expect(validateTimeline({} as never).length).toBe(0);
  });

  it('多个 overlays 都有问题时收集所有错误', () => {
    const bad = {
      ...ok,
      overlays: [
        { id: 'a', startMs: -1, durationMs: -5 },
        { id: 'b', startMs: 0, durationMs: 100 },
      ],
    };
    const errs = validateTimeline(bad as never);
    expect(errs.some((e) => e.field.includes('overlays[0].startMs'))).toBe(true);
    expect(errs.some((e) => e.field.includes('overlays[0].durationMs'))).toBe(true);
  });
});

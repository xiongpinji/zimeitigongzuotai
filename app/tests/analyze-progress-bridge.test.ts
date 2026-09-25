import { describe, it, expect, vi } from 'vitest';
import {
  describeAnalyzeProgress,
  mapAnalyzeProgressToPatch,
  createAnalyzeProgressBridge,
  type AnalyzeProgressLike,
  type AnalyzeProgressPatch,
} from '../src/lib/analyze-progress-bridge';

describe('describeAnalyzeProgress', () => {
  it('planning 阶段附带已用时', () => {
    expect(describeAnalyzeProgress({ phase: 'planning', percent: 0 })).toBe(
      '规划分段与封面提示词…',
    );
    expect(describeAnalyzeProgress({ phase: 'planning', percent: 0 }, 12)).toBe(
      '规划分段与封面提示词…（已用 12s）',
    );
  });

  it('cards 阶段优先用 message，否则用 cardIndex/cardTotal 兜底', () => {
    expect(
      describeAnalyzeProgress({ phase: 'cards', percent: 50, message: '生成内容卡片 3/8' }),
    ).toBe('生成内容卡片 3/8');
    expect(
      describeAnalyzeProgress({ phase: 'cards', percent: 50, cardIndex: 2, cardTotal: 6 }),
    ).toBe('生成内容卡片 2/6');
    expect(describeAnalyzeProgress({ phase: 'cards', percent: 50 })).toBe('生成内容卡片…');
  });

  it('done 阶段回退到完成文案', () => {
    expect(describeAnalyzeProgress({ phase: 'done', percent: 100 })).toBe('内容分析完成');
  });
});

describe('mapAnalyzeProgressToPatch', () => {
  it('planning → streaming，cards/done → determinate', () => {
    expect(mapAnalyzeProgressToPatch({ phase: 'planning', percent: 0 }).mode).toBe('streaming');
    expect(mapAnalyzeProgressToPatch({ phase: 'cards', percent: 40 }).mode).toBe('determinate');
    expect(mapAnalyzeProgressToPatch({ phase: 'done', percent: 100 }).mode).toBe('determinate');
  });

  it('百分比被夹紧到 0..100 且取整', () => {
    expect(mapAnalyzeProgressToPatch({ phase: 'cards', percent: 40.6 }).progress).toBe(41);
    expect(mapAnalyzeProgressToPatch({ phase: 'cards', percent: -5 }).progress).toBe(0);
    expect(mapAnalyzeProgressToPatch({ phase: 'cards', percent: 250 }).progress).toBe(100);
  });
});

describe('createAnalyzeProgressBridge', () => {
  interface Harness {
    patches: Array<{ id: string; patch: AnalyzeProgressPatch }>;
    emit: (progress: AnalyzeProgressLike) => void;
    tick: () => void;
    clockMs: { value: number };
    intervalCleared: () => boolean;
    unsubscribed: () => boolean;
  }

  function makeHarness(): { deps: Parameters<typeof createAnalyzeProgressBridge>[1]; h: Harness } {
    const patches: Harness['patches'] = [];
    let subscriber: ((p: AnalyzeProgressLike) => void) | null = null;
    let intervalHandler: (() => void) | null = null;
    let cleared = false;
    let unsub = false;
    const clockMs = { value: 0 };

    const deps: Parameters<typeof createAnalyzeProgressBridge>[1] = {
      subscribe: (cb) => {
        subscriber = cb;
        return () => {
          unsub = true;
          subscriber = null;
        };
      },
      updateTask: (id, patch) => {
        patches.push({ id, patch });
      },
      now: () => clockMs.value,
      setIntervalFn: (handler) => {
        intervalHandler = handler;
        // 返回一个占位句柄
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {
        cleared = true;
        intervalHandler = null;
      },
      heartbeatMs: 1000,
    };

    const h: Harness = {
      patches,
      emit: (progress) => subscriber?.(progress),
      tick: () => intervalHandler?.(),
      clockMs,
      intervalCleared: () => cleared,
      unsubscribed: () => unsub,
    };
    return { deps, h };
  }

  it('创建时立即推送 planning 心跳并随时间更新已用时', () => {
    const { deps, h } = makeHarness();
    const bridge = createAnalyzeProgressBridge('task-1', deps);

    // 立即一条 planning（已用 0s，streaming）
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0].id).toBe('task-1');
    expect(h.patches[0].patch.mode).toBe('streaming');
    expect(h.patches[0].patch.phase).toBe('规划分段与封面提示词…');

    // 时间推进 3s 后心跳触发，已用时更新
    h.clockMs.value = 3000;
    h.tick();
    expect(h.patches[1].patch.phase).toBe('规划分段与封面提示词…（已用 3s）');
    expect(h.patches[1].patch.mode).toBe('streaming');

    bridge.dispose();
  });

  it('收到 cards 事件后停止心跳并切换为 determinate', () => {
    const { deps, h } = makeHarness();
    const bridge = createAnalyzeProgressBridge('task-1', deps);

    h.emit({ phase: 'cards', percent: 30, cardIndex: 0, cardTotal: 5 });
    const last = h.patches[h.patches.length - 1];
    expect(last.patch.mode).toBe('determinate');
    expect(last.patch.progress).toBe(30);
    expect(h.intervalCleared()).toBe(true);

    // 心跳已停：再 tick 不应新增 planning 补丁
    const before = h.patches.length;
    h.tick();
    expect(h.patches.length).toBe(before);

    bridge.dispose();
  });

  it('dispose 后停止心跳、解除订阅并忽略后续事件', () => {
    const { deps, h } = makeHarness();
    const bridge = createAnalyzeProgressBridge('task-1', deps);
    bridge.dispose();

    expect(h.intervalCleared()).toBe(true);
    expect(h.unsubscribed()).toBe(true);

    const before = h.patches.length;
    h.emit({ phase: 'cards', percent: 80 });
    h.tick();
    expect(h.patches.length).toBe(before);
  });
});

import { applyCardEvent, cardChildTaskId } from '../src/lib/analyze-progress-bridge';

describe('applyCardEvent 卡片→子任务映射', () => {
  function makeDeps() {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        startTask: (input: { id: string }) => calls.push(`start:${input.id}`),
        updateTask: (id: string) => calls.push(`update:${id}`),
        completeTask: (id: string) => calls.push(`complete:${id}`),
        failTask: (id: string, e: string) => calls.push(`fail:${id}:${e}`),
        hasTask: (id: string) => calls.some((c) => c.startsWith(`start:${id}`)),
      },
    };
  }

  it('start 创建子任务', () => {
    const { calls, deps } = makeDeps();
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', title: 'A', status: 'start' }, deps);
    expect(calls).toContain(`start:${cardChildTaskId('P', 0)}`);
  });

  it('generating-image 在已存在时走 update', () => {
    const { calls, deps } = makeDeps();
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'start' }, deps);
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'generating-image' }, deps);
    expect(calls).toContain(`update:${cardChildTaskId('P', 0)}`);
  });

  it('done → completeTask；failed → failTask', () => {
    const { calls, deps } = makeDeps();
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'start' }, deps);
    applyCardEvent('P', { segmentIndex: 0, segmentId: 's0', status: 'done' }, deps);
    applyCardEvent('P', { segmentIndex: 1, segmentId: 's1', status: 'failed', error: 'x' }, deps);
    expect(calls).toContain(`complete:${cardChildTaskId('P', 0)}`);
    expect(calls).toContain(`fail:${cardChildTaskId('P', 1)}:x`);
  });
});

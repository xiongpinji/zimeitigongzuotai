# Timeline 基础剪辑能力升级 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 timeline 从"能放 clip"升级到"能剪":尾部留白、通用碰撞、锁定 UI、缩放按钮、trim、split、snap、ruler seek、autoscroll、undo/redo 按钮,全部落地。

**Architecture:** 先打纯函数地基(timeline-placement 通用化 + timeline-view 扩展 + 新 timeline-snap/timeline-autoscroll),再扩 store API(trim/split/lock/拒绝式碰撞),最后接入 Timeline.tsx / OverlayBlock.tsx / 新组件(TimelineToolbar、ZoomControls、TrackDropZone、SnapGuides)。全程 TDD,小步提交。

**Tech Stack:** TypeScript + React 19 + Zustand + Vitest + Tailwind CSS 4 + 项目 macOS 设计系统(`DESIGN.md`)

**Spec:** `docs/superpowers/specs/2026-04-13-timeline-basic-editing-upgrade-design.md`

---

## 约定

- 每个任务自成一体,可独立提交。
- 测试使用 Vitest:`npx vitest run tests/<file>.test.ts`。
- 提交信息格式:`<type>(timeline): <中文>`。
- 所有纯函数放 `src/lib/`,组件放 `src/components/timeline/`(若目录不存在则新建)。
- CSS 变量引用全部来自 `src/styles/design-tokens.css`(已存在)。

---

## 文件结构(决策固化)

**新建:**
- `src/lib/timeline-snap.ts` — 磁性对齐计算
- `src/lib/timeline-autoscroll.ts` — 边缘自动滚动 rAF 调度
- `src/components/timeline/TimelineToolbar.tsx` — 顶部工具栏抽出
- `src/components/timeline/ZoomControls.tsx` — 缩放按钮组
- `src/components/timeline/TrackDropZone.tsx` — 新建轨道 drop zone
- `src/components/timeline/SnapGuides.tsx` — 吸附辅助线覆盖层
- `tests/timeline-placement-universal.test.ts`
- `tests/timeline-snap.test.ts`
- `tests/timeline-view-scroll-width.test.ts`
- `tests/timeline-view-zoom-helpers.test.ts`
- `tests/timeline-autoscroll.test.ts`
- `tests/timeline-store-trim.test.ts`
- `tests/timeline-store-split.test.ts`
- `tests/timeline-store-lock.test.ts`
- `tests/timeline-store-reject-collision.test.ts`

**修改:**
- `src/lib/timeline-placement.ts` — 去类型白名单,按 trackId 分组
- `src/lib/timeline-view.ts` — 新增 `getTimelineVisualEndMs` / `zoomIn` / `zoomOut` / `zoomToFit` / `zoomToPercent` / `getTimelineContentWidthPx`
- `src/store/timeline.ts` — 新增 `trimOverlayClip` / `splitOverlayClipsAt` / `createTrackAt` / `toggleTrackLocked`;重写 `updateOverlay` 的碰撞分支为拒绝式;所有写操作前置锁检查
- `src/types.ts` — 无字段变更,仅可能扩展工具函数
- `src/components/Timeline.tsx` — 尾部留白渲染、ruler 扩展、drop zone 挂载、ruler seek、autoscroll 接入、工具栏替换为 TimelineToolbar、SnapGuides 挂载、锁图标
- `src/components/OverlayBlock.tsx` — trim handle、碰撞红遮罩、锁定态视觉

---

# Phase 1 — 纯函数地基

## Task 1: 通用化 timeline-placement(去类型白名单)

**Files:**
- Modify: `src/lib/timeline-placement.ts`
- Test: `tests/timeline-placement-universal.test.ts`

**要点:** 当前 `isOverlayTrackManaged` 把 `ai-card` 和非 video/image/text 类型排除。改为只排除 `default-background`,其他一律参与碰撞检测。新增显式 `canPlaceAt` / `findCollidingItems` API 给 UI 层用。

- [ ] **Step 1.1: Write failing test**

```ts
// tests/timeline-placement-universal.test.ts
import { describe, it, expect } from 'vitest';
import {
  isOverlayTrackManaged,
  canPlaceAt,
  findCollidingItems,
  overlaysOverlap,
} from '../src/lib/timeline-placement';
import type { OverlayItem } from '../src/types';

function makeOverlay(partial: Partial<OverlayItem>): OverlayItem {
  return {
    id: 'o1',
    type: 'image',
    assetPath: '',
    trackId: 'visual-1',
    startMs: 0,
    durationMs: 1000,
    position: { x: 0, y: 0, width: 100, height: 100 },
    ...partial,
  } as OverlayItem;
}

describe('isOverlayTrackManaged (universal)', () => {
  it('treats ai-card as managed', () => {
    const overlay = makeOverlay({ overlayType: 'ai-card' });
    expect(isOverlayTrackManaged(overlay)).toBe(true);
  });

  it('excludes default-background', () => {
    const overlay = makeOverlay({ overlayRole: 'default-background' });
    expect(isOverlayTrackManaged(overlay)).toBe(false);
  });

  it('treats text overlay as managed', () => {
    const overlay = makeOverlay({ type: 'text' });
    expect(isOverlayTrackManaged(overlay)).toBe(true);
  });
});

describe('canPlaceAt', () => {
  const existing: OverlayItem[] = [
    makeOverlay({ id: 'a', trackId: 'visual-1', startMs: 1000, durationMs: 2000 }),
    makeOverlay({ id: 'b', trackId: 'visual-1', startMs: 5000, durationMs: 1000, overlayType: 'ai-card' }),
  ];

  it('returns ok=true when slot is empty', () => {
    const result = canPlaceAt({
      trackId: 'visual-1',
      startMs: 3500,
      durationMs: 1000,
      overlays: existing,
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with reason=overlap when colliding with ai-card', () => {
    const result = canPlaceAt({
      trackId: 'visual-1',
      startMs: 5500,
      durationMs: 500,
      overlays: existing,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('overlap');
  });

  it('respects excludeOverlayId', () => {
    const result = canPlaceAt({
      trackId: 'visual-1',
      startMs: 1000,
      durationMs: 2000,
      excludeOverlayId: 'a',
      overlays: existing,
    });
    expect(result.ok).toBe(true);
  });
});

describe('findCollidingItems', () => {
  it('returns all overlapping ids regardless of type', () => {
    const overlays: OverlayItem[] = [
      makeOverlay({ id: 'x1', trackId: 'visual-1', startMs: 0, durationMs: 2000 }),
      makeOverlay({ id: 'x2', trackId: 'visual-1', startMs: 1500, durationMs: 1000, overlayType: 'ai-card' }),
      makeOverlay({ id: 'x3', trackId: 'visual-1', startMs: 3000, durationMs: 1000 }),
    ];
    const collisions = findCollidingItems({
      trackId: 'visual-1',
      startMs: 1000,
      durationMs: 1200,
      overlays,
    });
    expect(collisions.map((o) => o.id).sort()).toEqual(['x1', 'x2']);
  });
});
```

- [ ] **Step 1.2: Run test, expect fail**

```
npx vitest run tests/timeline-placement-universal.test.ts
```
Expected: FAIL — `canPlaceAt` / `findCollidingItems` undefined, `isOverlayTrackManaged` still excludes ai-card.

- [ ] **Step 1.3: Update `src/lib/timeline-placement.ts`**

Replace the `isOverlayTrackManaged` body and append new exports:

```ts
export function isOverlayTrackManaged(overlay: OverlayItem): boolean {
  return overlay.overlayRole !== 'default-background';
}

export interface CanPlaceAtArgs {
  trackId: string;
  startMs: number;
  durationMs: number;
  excludeOverlayId?: string;
  overlays: OverlayItem[];
}

export interface CanPlaceAtResult {
  ok: boolean;
  reason?: 'overlap';
}

export function canPlaceAt(args: CanPlaceAtArgs): CanPlaceAtResult {
  const { trackId, startMs, durationMs, excludeOverlayId, overlays } = args;
  const candidate = { startMs, durationMs };
  for (const other of overlays) {
    if (other.trackId !== trackId) continue;
    if (other.id === excludeOverlayId) continue;
    if (!isOverlayTrackManaged(other)) continue;
    if (overlaysOverlap(candidate, other)) {
      return { ok: false, reason: 'overlap' };
    }
  }
  return { ok: true };
}

export function findCollidingItems(args: CanPlaceAtArgs): OverlayItem[] {
  const { trackId, startMs, durationMs, excludeOverlayId, overlays } = args;
  const candidate = { startMs, durationMs };
  return overlays.filter(
    (o) =>
      o.trackId === trackId
      && o.id !== excludeOverlayId
      && isOverlayTrackManaged(o)
      && overlaysOverlap(candidate, o),
  );
}
```

Also update `getManagedOverlaysOnTrack` to use the new predicate (it already does; just verify after the `isOverlayTrackManaged` change).

- [ ] **Step 1.4: Run all timeline-placement tests**

```
npx vitest run tests/timeline-placement
```
Expected: PASS. If any existing test relied on `ai-card` being excluded, update that test to match the new universal semantics (new expected behavior: AI 卡片参与碰撞)。

- [ ] **Step 1.5: Run full suite to catch regressions**

```
npm test
```
Any failure should be triaged: expected failures are tests that assumed AI 卡片 不参与碰撞——update them to assert the new reject-on-collision semantics. Do not catch failures here; raise them in the subagent report.

- [ ] **Step 1.6: Commit**

```
git add src/lib/timeline-placement.ts tests/timeline-placement-universal.test.ts
git commit -m "refactor(timeline): 碰撞检测通用化并新增 canPlaceAt/findCollidingItems"
```

---

## Task 2: timeline-view 增加滚动宽度与 zoom 辅助函数

**Files:**
- Modify: `src/lib/timeline-view.ts`
- Test: `tests/timeline-view-scroll-width.test.ts`, `tests/timeline-view-zoom-helpers.test.ts`

- [ ] **Step 2.1: Write failing tests**

```ts
// tests/timeline-view-scroll-width.test.ts
import { describe, it, expect } from 'vitest';
import {
  getTimelineVisualEndMs,
  getTimelineContentWidthPx,
} from '../src/lib/timeline-view';
import type { TimelineData } from '../src/types';
import { createDefaultTimeline } from '../src/types';

function makeTimeline(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    ...createDefaultTimeline(),
    ...overrides,
  };
}

describe('getTimelineVisualEndMs', () => {
  it('returns last overlay end when overlays exist', () => {
    const timeline = makeTimeline({
      overlays: [
        {
          id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
          startMs: 2000, durationMs: 3000,
          position: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    });
    expect(getTimelineVisualEndMs(timeline)).toBe(5000);
  });

  it('falls back to podcast durationMs when no overlays', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 60_000 },
    });
    expect(getTimelineVisualEndMs(timeline)).toBe(60_000);
  });

  it('returns max of overlay end and podcast duration', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 60_000 },
      overlays: [
        {
          id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
          startMs: 50_000, durationMs: 20_000,
          position: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    });
    expect(getTimelineVisualEndMs(timeline)).toBe(70_000);
  });
});

describe('getTimelineContentWidthPx', () => {
  it('adds one viewport of trailing padding to the scroll width', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 10_000 },
    });
    const viewportWidth = 800;
    const zoomLevel = 1;
    const width = getTimelineContentWidthPx(timeline, zoomLevel, viewportWidth);

    // base = getBaseTimelineWidth(10_000) * 1; plus viewport
    // base ceil(max(1000,10000)/1000) * 96 = 10 * 96 = 960 (< MIN 960, stays 960)
    // Actually MIN_TIMELINE_TRACK_WIDTH = 960, so base = 960
    expect(width).toBe(960 + viewportWidth);
  });

  it('never returns less than viewport width', () => {
    const timeline = makeTimeline({
      podcast: { audioPath: '', srtPath: '', durationMs: 0 },
    });
    const width = getTimelineContentWidthPx(timeline, 0.02, 600);
    expect(width).toBeGreaterThanOrEqual(600);
  });
});
```

```ts
// tests/timeline-view-zoom-helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToPercent,
  clampTimelineZoom,
} from '../src/lib/timeline-view';

describe('zoomIn / zoomOut', () => {
  it('zoomIn multiplies by step', () => {
    expect(zoomIn(1)).toBeCloseTo(1.25, 2);
  });
  it('zoomOut divides by step', () => {
    expect(zoomOut(1)).toBeCloseTo(0.8, 2);
  });
  it('clamps to upper bound', () => {
    expect(zoomIn(4)).toBe(4);
  });
  it('clamps to lower bound', () => {
    expect(zoomOut(0.02)).toBe(0.02);
  });
});

describe('zoomToPercent', () => {
  it('returns the decimal value clamped', () => {
    expect(zoomToPercent(200)).toBe(2);
    expect(zoomToPercent(10000)).toBe(4);
    expect(zoomToPercent(1)).toBe(0.02);
  });
});

describe('zoomToFit', () => {
  it('equals getFitTimelineZoom', () => {
    const fit = zoomToFit(60_000, 1200);
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2.2: Run tests, expect fail**

```
npx vitest run tests/timeline-view-scroll-width.test.ts tests/timeline-view-zoom-helpers.test.ts
```

- [ ] **Step 2.3: Add helpers to `src/lib/timeline-view.ts`**

At the end of the file, append:

```ts
import type { TimelineData } from '../types';

export function getTimelineVisualEndMs(timeline: TimelineData): number {
  const podcastEnd = timeline.podcast?.durationMs ?? 0;
  const overlayEnd = timeline.overlays.reduce((max, o) => {
    const end = o.startMs + o.durationMs;
    return end > max ? end : max;
  }, 0);
  return Math.max(podcastEnd, overlayEnd);
}

export function getTimelineContentWidthPx(
  timeline: TimelineData,
  zoomLevel: number,
  viewportWidth: number,
): number {
  const end = getTimelineVisualEndMs(timeline);
  const base = Math.round(getBaseTimelineWidth(end) * clampTimelineZoom(zoomLevel));
  const safeViewport = Math.max(320, viewportWidth);
  return Math.max(safeViewport, base + safeViewport);
}

export function zoomIn(zoomLevel: number): number {
  return getNextTimelineZoom(zoomLevel, 'in');
}

export function zoomOut(zoomLevel: number): number {
  return getNextTimelineZoom(zoomLevel, 'out');
}

export function zoomToFit(durationMs: number, viewportWidth: number): number {
  return getFitTimelineZoom(durationMs, viewportWidth);
}

export function zoomToPercent(percent: number): number {
  return clampTimelineZoom(percent / 100);
}
```

Note: `getBaseTimelineWidth` and `getNextTimelineZoom` are already in this file — don't re-declare them.

- [ ] **Step 2.4: Run new tests, expect pass**

```
npx vitest run tests/timeline-view-scroll-width.test.ts tests/timeline-view-zoom-helpers.test.ts
```

- [ ] **Step 2.5: Commit**

```
git add src/lib/timeline-view.ts tests/timeline-view-scroll-width.test.ts tests/timeline-view-zoom-helpers.test.ts
git commit -m "feat(timeline): 新增 getTimelineVisualEndMs / 缩放辅助函数"
```

---

## Task 3: timeline-snap 磁性对齐模块

**Files:**
- Create: `src/lib/timeline-snap.ts`
- Test: `tests/timeline-snap.test.ts`

- [ ] **Step 3.1: Write failing test**

```ts
// tests/timeline-snap.test.ts
import { describe, it, expect } from 'vitest';
import { computeSnap } from '../src/lib/timeline-snap';
import type { OverlayItem } from '../src/types';

function o(partial: Partial<OverlayItem>): OverlayItem {
  return {
    id: partial.id ?? 'x',
    type: 'image', assetPath: '', trackId: partial.trackId ?? 'visual-1',
    startMs: partial.startMs ?? 0, durationMs: partial.durationMs ?? 1000,
    position: { x: 0, y: 0, width: 100, height: 100 },
  } as OverlayItem;
}

describe('computeSnap', () => {
  const overlays: OverlayItem[] = [
    o({ id: 'a', trackId: 'visual-1', startMs: 1000, durationMs: 2000 }),
    o({ id: 'b', trackId: 'visual-2', startMs: 5000, durationMs: 1000 }),
  ];

  it('snaps to playhead within threshold', () => {
    const result = computeSnap({
      candidateMs: 4980,
      playheadMs: 5000,
      overlays,
      excludeOverlayId: 'a',
      pxPerMs: 0.1,          // 10ms == 1px; threshold 8px == 80ms
      thresholdPx: 8,
      enabled: true,
    });
    expect(result.snappedMs).toBe(5000);
    expect(result.targets.some((t) => t.kind === 'playhead')).toBe(true);
  });

  it('snaps to clip edge across tracks', () => {
    const result = computeSnap({
      candidateMs: 3010,
      playheadMs: 0,
      overlays,
      excludeOverlayId: 'a',
      pxPerMs: 0.1,
      thresholdPx: 8,
      enabled: true,
    });
    // clip a 的 end = 3000 在阈值内
    expect(result.snappedMs).toBe(3000);
    expect(result.targets[0].kind).toBe('clip-edge');
  });

  it('returns candidate unchanged when disabled', () => {
    const result = computeSnap({
      candidateMs: 4980,
      playheadMs: 5000,
      overlays,
      pxPerMs: 0.1,
      thresholdPx: 8,
      enabled: false,
    });
    expect(result.snappedMs).toBe(4980);
    expect(result.targets).toEqual([]);
  });

  it('picks the closest target when multiple are within threshold', () => {
    const result = computeSnap({
      candidateMs: 3020,
      playheadMs: 3010,
      overlays,
      excludeOverlayId: 'a',
      pxPerMs: 0.1,
      thresholdPx: 8,
      enabled: true,
    });
    expect(result.snappedMs).toBe(3010); // playhead 更近
  });
});
```

- [ ] **Step 3.2: Run test, expect fail**

```
npx vitest run tests/timeline-snap.test.ts
```

- [ ] **Step 3.3: Create `src/lib/timeline-snap.ts`**

```ts
import type { OverlayItem } from '../types';
import { isOverlayTrackManaged } from './timeline-placement';

export type SnapTargetKind = 'playhead' | 'clip-edge';

export interface SnapTarget {
  ms: number;
  kind: SnapTargetKind;
}

export interface ComputeSnapArgs {
  candidateMs: number;
  playheadMs: number;
  overlays: OverlayItem[];
  excludeOverlayId?: string;
  pxPerMs: number;
  thresholdPx: number;
  enabled: boolean;
}

export interface ComputeSnapResult {
  snappedMs: number;
  targets: SnapTarget[];
}

export function computeSnap(args: ComputeSnapArgs): ComputeSnapResult {
  const {
    candidateMs,
    playheadMs,
    overlays,
    excludeOverlayId,
    pxPerMs,
    thresholdPx,
    enabled,
  } = args;

  if (!enabled) {
    return { snappedMs: candidateMs, targets: [] };
  }

  const thresholdMs = thresholdPx / Math.max(pxPerMs, 1e-6);

  const candidates: SnapTarget[] = [];

  // Playhead target
  if (Math.abs(candidateMs - playheadMs) <= thresholdMs) {
    candidates.push({ ms: playheadMs, kind: 'playhead' });
  }

  // Clip edge targets (both starts and ends), across all tracks
  for (const overlay of overlays) {
    if (overlay.id === excludeOverlayId) continue;
    if (!isOverlayTrackManaged(overlay)) continue;
    const start = overlay.startMs;
    const end = overlay.startMs + overlay.durationMs;
    if (Math.abs(candidateMs - start) <= thresholdMs) {
      candidates.push({ ms: start, kind: 'clip-edge' });
    }
    if (Math.abs(candidateMs - end) <= thresholdMs) {
      candidates.push({ ms: end, kind: 'clip-edge' });
    }
  }

  if (candidates.length === 0) {
    return { snappedMs: candidateMs, targets: [] };
  }

  // Pick closest
  candidates.sort(
    (a, b) => Math.abs(a.ms - candidateMs) - Math.abs(b.ms - candidateMs),
  );
  const chosen = candidates[0];
  const sameMsTargets = candidates.filter((t) => t.ms === chosen.ms);

  return { snappedMs: chosen.ms, targets: sameMsTargets };
}
```

- [ ] **Step 3.4: Run test, expect pass**

```
npx vitest run tests/timeline-snap.test.ts
```

- [ ] **Step 3.5: Commit**

```
git add src/lib/timeline-snap.ts tests/timeline-snap.test.ts
git commit -m "feat(timeline): 新增磁性对齐计算模块 timeline-snap"
```

---

## Task 4: timeline-autoscroll 边缘自动滚动调度器

**Files:**
- Create: `src/lib/timeline-autoscroll.ts`
- Test: `tests/timeline-autoscroll.test.ts`

- [ ] **Step 4.1: Write failing test**

```ts
// tests/timeline-autoscroll.test.ts
import { describe, it, expect } from 'vitest';
import { computeAutoScrollDelta } from '../src/lib/timeline-autoscroll';

describe('computeAutoScrollDelta', () => {
  const viewport = { left: 100, right: 900, top: 0, bottom: 400 };
  const hotzone = 40;
  const maxSpeed = 800;
  const dtMs = 16;

  it('returns 0 when pointer is inside safe area', () => {
    expect(
      computeAutoScrollDelta({ x: 500, y: 200, viewport, hotzone, maxSpeed, dtMs }),
    ).toEqual({ dx: 0, dy: 0 });
  });

  it('scrolls left when pointer enters left hotzone', () => {
    const { dx } = computeAutoScrollDelta({
      x: 110, y: 200, viewport, hotzone, maxSpeed, dtMs,
    });
    expect(dx).toBeLessThan(0);
  });

  it('scrolls right when pointer enters right hotzone', () => {
    const { dx } = computeAutoScrollDelta({
      x: 890, y: 200, viewport, hotzone, maxSpeed, dtMs,
    });
    expect(dx).toBeGreaterThan(0);
  });

  it('accelerates linearly with depth', () => {
    const shallow = computeAutoScrollDelta({
      x: 880, y: 200, viewport, hotzone, maxSpeed, dtMs,
    }).dx;
    const deep = computeAutoScrollDelta({
      x: 899, y: 200, viewport, hotzone, maxSpeed, dtMs,
    }).dx;
    expect(deep).toBeGreaterThan(shallow);
  });

  it('caps at maxSpeed', () => {
    const { dx } = computeAutoScrollDelta({
      x: 900, y: 200, viewport, hotzone, maxSpeed, dtMs,
    });
    const expectedCap = (maxSpeed * dtMs) / 1000;
    expect(dx).toBeLessThanOrEqual(expectedCap + 1e-6);
  });
});
```

- [ ] **Step 4.2: Run test, expect fail**

- [ ] **Step 4.3: Create `src/lib/timeline-autoscroll.ts`**

```ts
export interface Viewport {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AutoScrollArgs {
  x: number;
  y: number;
  viewport: Viewport;
  hotzone: number;
  maxSpeed: number;
  dtMs: number;
}

export interface AutoScrollDelta {
  dx: number;
  dy: number;
}

function axisDelta(
  pointer: number,
  near: number,
  far: number,
  hotzone: number,
  maxSpeed: number,
  dtMs: number,
): number {
  if (pointer < near) return 0;
  if (pointer > far) return 0;

  const distFromNear = pointer - near;
  const distFromFar = far - pointer;

  let dir = 0;
  let depth = 0;

  if (distFromNear < hotzone) {
    dir = -1;
    depth = hotzone - distFromNear;
  } else if (distFromFar < hotzone) {
    dir = 1;
    depth = hotzone - distFromFar;
  } else {
    return 0;
  }

  const ratio = Math.min(1, Math.max(0, depth / hotzone));
  const speed = maxSpeed * ratio;
  return (dir * speed * dtMs) / 1000;
}

export function computeAutoScrollDelta(args: AutoScrollArgs): AutoScrollDelta {
  const { x, y, viewport, hotzone, maxSpeed, dtMs } = args;
  return {
    dx: axisDelta(x, viewport.left, viewport.right, hotzone, maxSpeed, dtMs),
    dy: axisDelta(y, viewport.top, viewport.bottom, hotzone, maxSpeed, dtMs),
  };
}

// Scheduler — 暴露给组件层使用
export interface AutoScrollScheduler {
  update(pointer: { x: number; y: number }): void;
  stop(): void;
}

export interface StartAutoScrollArgs {
  container: HTMLElement;
  hotzone?: number;
  maxSpeed?: number;
}

export function startAutoScroll({
  container,
  hotzone = 40,
  maxSpeed = 800,
}: StartAutoScrollArgs): AutoScrollScheduler {
  let pointer: { x: number; y: number } | null = null;
  let rafId: number | null = null;
  let lastTs = performance.now();

  const tick = (ts: number) => {
    const dt = Math.min(64, ts - lastTs);
    lastTs = ts;

    if (pointer) {
      const rect = container.getBoundingClientRect();
      const delta = computeAutoScrollDelta({
        x: pointer.x,
        y: pointer.y,
        viewport: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
        hotzone,
        maxSpeed,
        dtMs: dt,
      });
      if (delta.dx !== 0) container.scrollLeft += delta.dx;
      if (delta.dy !== 0) container.scrollTop += delta.dy;
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    update(next) {
      pointer = next;
    },
    stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pointer = null;
    },
  };
}
```

- [ ] **Step 4.4: Run test, expect pass**

- [ ] **Step 4.5: Commit**

```
git add src/lib/timeline-autoscroll.ts tests/timeline-autoscroll.test.ts
git commit -m "feat(timeline): 新增边缘自动滚动调度器"
```

---

# Phase 2 — Store API 升级

## Task 5: 重写 updateOverlay 为拒绝式碰撞

**Files:**
- Modify: `src/store/timeline.ts:666-757`
- Test: `tests/timeline-store-reject-collision.test.ts`

**要点:** 当前 `updateOverlay` 的碰撞分支(见 `src/store/timeline.ts:708-746`)会自动找空位甚至新建轨道。改为:若 `canPlaceAt` 返回 false → **不更新位置字段**,原值保留(UI 层已做回弹,store 是第二道防线)。

- [ ] **Step 5.1: Write failing tests**

```ts
// tests/timeline-store-reject-collision.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('updateOverlay reject-on-collision', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 0, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            id: 'b', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 3000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
      historyPast: [],
      historyFuture: [],
      canUndo: false,
      canRedo: false,
    });
  });

  it('rejects move that would overlap an existing clip', () => {
    const { updateOverlay } = useTimelineStore.getState();
    updateOverlay('a', { startMs: 2500 }); // 会和 b 相撞
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(0); // 保留原值
  });

  it('accepts move into free slot', () => {
    const { updateOverlay } = useTimelineStore.getState();
    updateOverlay('a', { startMs: 5000 }); // 空区
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(5000);
  });

  it('rejects cross-track move into occupied slot', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: [
          ...s.timeline.tracks,
          { id: 'visual-9', kind: 'visual', label: '轨道9', order: 9 },
        ],
        overlays: [
          ...s.timeline.overlays,
          {
            id: 'c', type: 'image', assetPath: '', trackId: 'visual-9',
            startMs: 0, durationMs: 10_000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
    }));
    useTimelineStore.getState().updateOverlay('a', { trackId: 'visual-9', startMs: 0 });
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.trackId).toBe('visual-1');
    expect(a.startMs).toBe(0);
  });

  it('ai-card now participates in collision rejection', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        overlays: [
          {
            id: 'card', type: 'image', assetPath: '', trackId: 'visual-2',
            startMs: 1000, durationMs: 3000,
            position: { x: 0, y: 0, width: 100, height: 100 },
            overlayType: 'ai-card',
          },
          {
            id: 'media', type: 'image', assetPath: '', trackId: 'visual-2',
            startMs: 6000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
    }));
    useTimelineStore.getState().updateOverlay('media', { startMs: 2000 });
    const media = useTimelineStore
      .getState()
      .timeline.overlays.find((o) => o.id === 'media')!;
    expect(media.startMs).toBe(6000);
  });
});
```

- [ ] **Step 5.2: Run tests, expect fail**

- [ ] **Step 5.3: Replace `updateOverlay` implementation in `src/store/timeline.ts`**

Locate the `updateOverlay` entry (around line 666) and replace its body with:

```ts
  updateOverlay: (id, updates) =>
    set((state) => {
      const current = state.timeline.overlays.find((o) => o.id === id);
      if (!current) {
        return {};
      }

      // 检查目标轨道是否锁定(包含来源和目标)
      const sourceTrack = state.timeline.tracks.find((t) => t.id === current.trackId);
      if (sourceTrack?.locked) {
        return {};
      }
      const targetTrackId = (updates.trackId ?? current.trackId) as string;
      const targetTrack = state.timeline.tracks.find((t) => t.id === targetTrackId);
      if (targetTrack?.locked) {
        return {};
      }

      let merged = { ...current, ...updates, id };
      const affectsPlacement =
        'startMs' in updates || 'durationMs' in updates || 'trackId' in updates;

      if (affectsPlacement && isOverlayTrackManaged(merged)) {
        // 时长变化仍允许邻居 clamp(避免拉伸覆盖右邻)
        if ('durationMs' in updates) {
          merged = {
            ...merged,
            durationMs: clampOverlayDurationByNeighbors({
              overlayId: id,
              startMs: merged.startMs,
              requestedDurationMs: merged.durationMs,
              trackId: merged.trackId,
              overlays: state.timeline.overlays,
            }),
          };
        }

        // 位置 / 跨轨变化:使用 canPlaceAt,碰撞则拒绝
        const placement = canPlaceAt({
          trackId: merged.trackId,
          startMs: merged.startMs,
          durationMs: merged.durationMs,
          excludeOverlayId: id,
          overlays: state.timeline.overlays,
        });

        if (!placement.ok) {
          // 放弃本次位置更新,保留原始位置和轨道
          merged = {
            ...merged,
            startMs: current.startMs,
            trackId: current.trackId,
          };
        }
      }

      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        overlays: state.timeline.overlays.map((o) =>
          o.id === id ? merged : o,
        ),
      });
      return buildCommittedTimelineState(state, nextTimeline);
    }),
```

Also update the import at the top of the file:

```ts
import {
  clampOverlayDurationByNeighbors,
  canPlaceAt,
  isOverlayTrackManaged,
} from '../lib/timeline-placement';
```

Remove `findAvailableTrack` and `findNearestAvailablePlacement` from the import if no longer used anywhere in the file. Verify: `pasteOverlay` also uses `resolveOverlayInsert` (see Step 5.4).

- [ ] **Step 5.4: Align `pasteOverlay` with reject semantics**

Find `resolveOverlayInsert` helper (search in the file). If it uses `findAvailableTrack` / `findNearestAvailablePlacement` to auto-relocate pasted clips, update it:

```ts
function resolveOverlayInsert(
  state: { timeline: TimelineData },
  overlay: OverlayItem,
): { overlay: OverlayItem; createdTrack: TimelineTrack | null } {
  if (!isOverlayTrackManaged(overlay)) {
    return { overlay, createdTrack: null };
  }
  const placement = canPlaceAt({
    trackId: overlay.trackId,
    startMs: overlay.startMs,
    durationMs: overlay.durationMs,
    overlays: state.timeline.overlays,
  });
  if (placement.ok) {
    return { overlay, createdTrack: null };
  }
  // 不能落位时,自动新建 visual 轨道作为退路(仅 paste/addOverlay 链路保留此能力,拖拽链路不走这里)
  const newTrack = getNextVisualTrack(state.timeline.tracks);
  return {
    overlay: { ...overlay, trackId: newTrack.id },
    createdTrack: newTrack,
  };
}
```

**Rationale:** Drag/move goes through `updateOverlay` and must reject. Paste/addOverlay (keyboard paste, AI-generated cards) still benefits from the "auto new track" fallback because there's no UI drag target.

- [ ] **Step 5.5: Run targeted + full tests**

```
npx vitest run tests/timeline-store-reject-collision.test.ts
npm test
```

Fix pre-existing timeline tests that assumed auto-relocate on drag. Each fix should assert the new reject semantics. Keep paste-path tests as-is.

- [ ] **Step 5.6: Commit**

```
git add src/store/timeline.ts tests/timeline-store-reject-collision.test.ts
git commit -m "refactor(timeline): updateOverlay 碰撞改为拒绝式,paste 保留新轨退路"
```

---

## Task 6: trimOverlayClip store API

**Files:**
- Modify: `src/store/timeline.ts`
- Test: `tests/timeline-store-trim.test.ts`

- [ ] **Step 6.1: Write failing test**

```ts
// tests/timeline-store-trim.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('trimOverlayClip', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 2000, durationMs: 3000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            id: 'b', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 6000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
      historyPast: [], historyFuture: [],
      canUndo: false, canRedo: false,
    });
  });

  it('trims the start edge', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'start', 2500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(2500);
    expect(a.durationMs).toBe(2500); // (2000+3000) - 2500
  });

  it('trims the end edge', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'end', 4500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(2000);
    expect(a.durationMs).toBe(2500);
  });

  it('enforces minimum duration of 100ms', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'end', 2050);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.durationMs).toBe(100);
  });

  it('stops at adjacent clip on end trim', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'end', 7000);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs + a.durationMs).toBeLessThanOrEqual(6000);
  });

  it('does not allow negative start', () => {
    useTimelineStore.getState().trimOverlayClip('a', 'start', -500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.startMs).toBe(0);
  });

  it('rejects trim on locked track', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: s.timeline.tracks.map((t) =>
          t.id === 'visual-1' ? { ...t, locked: true } : t,
        ),
      },
    }));
    useTimelineStore.getState().trimOverlayClip('a', 'end', 4500);
    const a = useTimelineStore.getState().timeline.overlays.find((o) => o.id === 'a')!;
    expect(a.durationMs).toBe(3000);
  });
});
```

- [ ] **Step 6.2: Run test, expect fail**

- [ ] **Step 6.3: Add `trimOverlayClip` to store**

Add to `TimelineStore` interface (near line 57):

```ts
  trimOverlayClip: (id: string, edge: 'start' | 'end', newEdgeMs: number) => void;
```

Add implementation near `updateOverlay`:

```ts
  trimOverlayClip: (id, edge, newEdgeMs) =>
    set((state) => {
      const current = state.timeline.overlays.find((o) => o.id === id);
      if (!current) return {};

      const track = state.timeline.tracks.find((t) => t.id === current.trackId);
      if (track?.locked) return {};

      const MIN_DURATION = 100;
      let nextStart = current.startMs;
      let nextDuration = current.durationMs;

      if (edge === 'start') {
        const currentEnd = current.startMs + current.durationMs;
        // 钳制到 [0, currentEnd - MIN_DURATION]
        const clamped = Math.max(0, Math.min(newEdgeMs, currentEnd - MIN_DURATION));
        nextStart = clamped;
        nextDuration = currentEnd - clamped;
      } else {
        // end edge
        const minEnd = current.startMs + MIN_DURATION;
        const clampedEnd = Math.max(minEnd, newEdgeMs);
        nextStart = current.startMs;
        nextDuration = clampedEnd - current.startMs;
      }

      // 碰撞约束:使用 clampOverlayDurationByNeighbors 做右侧 clamp
      if (edge === 'end' && isOverlayTrackManaged(current)) {
        nextDuration = clampOverlayDurationByNeighbors({
          overlayId: id,
          startMs: nextStart,
          requestedDurationMs: nextDuration,
          trackId: current.trackId,
          overlays: state.timeline.overlays,
        });
        nextDuration = Math.max(MIN_DURATION, nextDuration);
      }

      // 左 trim 的碰撞约束:不得越过左邻 clip 的 end
      if (edge === 'start' && isOverlayTrackManaged(current)) {
        const leftNeighborEnd = state.timeline.overlays
          .filter(
            (o) =>
              o.trackId === current.trackId
              && o.id !== id
              && isOverlayTrackManaged(o)
              && o.startMs + o.durationMs <= current.startMs,
          )
          .reduce((max, o) => Math.max(max, o.startMs + o.durationMs), 0);
        if (nextStart < leftNeighborEnd) {
          const delta = leftNeighborEnd - nextStart;
          nextStart = leftNeighborEnd;
          nextDuration = Math.max(MIN_DURATION, nextDuration - delta);
        }
      }

      const nextOverlay: OverlayItem = {
        ...current,
        startMs: nextStart,
        durationMs: nextDuration,
      };

      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        overlays: state.timeline.overlays.map((o) =>
          o.id === id ? nextOverlay : o,
        ),
      });

      return buildCommittedTimelineState(state, nextTimeline);
    }),
```

- [ ] **Step 6.4: Run tests, expect pass**

```
npx vitest run tests/timeline-store-trim.test.ts
```

- [ ] **Step 6.5: Commit**

```
git add src/store/timeline.ts tests/timeline-store-trim.test.ts
git commit -m "feat(timeline): 新增 trimOverlayClip 支持左右 trim"
```

---

## Task 7: splitOverlayClipsAt store API

**Files:**
- Modify: `src/store/timeline.ts`
- Test: `tests/timeline-store-split.test.ts`

- [ ] **Step 7.1: Write failing test**

```ts
// tests/timeline-store-split.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('splitOverlayClipsAt', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a', type: 'image', assetPath: '/foo.png', trackId: 'visual-1',
            startMs: 1000, durationMs: 4000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            id: 'b', type: 'image', assetPath: '/bar.png', trackId: 'visual-1',
            startMs: 6000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
      historyPast: [], historyFuture: [],
      canUndo: false, canRedo: false,
    });
  });

  it('splits the clip intersecting playhead', () => {
    useTimelineStore.getState().splitOverlayClipsAt(3000);
    const overlays = useTimelineStore.getState().timeline.overlays;
    const left = overlays.find((o) => o.id === 'a')!;
    expect(left.startMs).toBe(1000);
    expect(left.durationMs).toBe(2000);
    const right = overlays.find(
      (o) => o.id !== 'a' && o.id !== 'b' && o.assetPath === '/foo.png',
    );
    expect(right).toBeDefined();
    expect(right!.startMs).toBe(3000);
    expect(right!.durationMs).toBe(2000);
  });

  it('does nothing when playhead does not intersect any clip', () => {
    const before = useTimelineStore.getState().timeline.overlays.length;
    useTimelineStore.getState().splitOverlayClipsAt(5500);
    expect(useTimelineStore.getState().timeline.overlays.length).toBe(before);
  });

  it('only splits targetIds when provided', () => {
    useTimelineStore.getState().splitOverlayClipsAt(3000, ['b']);
    const overlays = useTimelineStore.getState().timeline.overlays;
    expect(overlays.filter((o) => o.assetPath === '/foo.png').length).toBe(1);
  });

  it('skips locked tracks', () => {
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: s.timeline.tracks.map((t) =>
          t.id === 'visual-1' ? { ...t, locked: true } : t,
        ),
      },
    }));
    useTimelineStore.getState().splitOverlayClipsAt(3000);
    const overlays = useTimelineStore.getState().timeline.overlays;
    expect(overlays.filter((o) => o.assetPath === '/foo.png').length).toBe(1);
  });

  it('rejects split within 50ms of a clip edge', () => {
    useTimelineStore.getState().splitOverlayClipsAt(1020);
    const overlays = useTimelineStore.getState().timeline.overlays;
    expect(overlays.filter((o) => o.assetPath === '/foo.png').length).toBe(1);
  });
});
```

- [ ] **Step 7.2: Run test, expect fail**

- [ ] **Step 7.3: Add `splitOverlayClipsAt` to store**

Add to `TimelineStore` interface:

```ts
  splitOverlayClipsAt: (playheadMs: number, targetIds?: string[]) => void;
```

Add implementation:

```ts
  splitOverlayClipsAt: (playheadMs, targetIds) =>
    set((state) => {
      const EDGE_TOLERANCE = 50;

      const eligibleIds = new Set(targetIds ?? state.timeline.overlays.map((o) => o.id));
      const newOverlays: OverlayItem[] = [];
      let didSplit = false;

      for (const overlay of state.timeline.overlays) {
        if (!eligibleIds.has(overlay.id)) {
          newOverlays.push(overlay);
          continue;
        }

        const track = state.timeline.tracks.find((t) => t.id === overlay.trackId);
        if (track?.locked) {
          newOverlays.push(overlay);
          continue;
        }

        const leftDuration = playheadMs - overlay.startMs;
        const rightDuration = overlay.durationMs - leftDuration;

        if (
          leftDuration < EDGE_TOLERANCE
          || rightDuration < EDGE_TOLERANCE
        ) {
          newOverlays.push(overlay);
          continue;
        }

        didSplit = true;
        const leftClip: OverlayItem = {
          ...overlay,
          durationMs: leftDuration,
        };
        const rightClip: OverlayItem = {
          ...overlay,
          id: uuid(),
          startMs: playheadMs,
          durationMs: rightDuration,
        };
        newOverlays.push(leftClip, rightClip);
      }

      if (!didSplit) {
        return {};
      }

      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        overlays: newOverlays,
      });

      return buildCommittedTimelineState(state, nextTimeline);
    }),
```

- [ ] **Step 7.4: Run tests, expect pass**

- [ ] **Step 7.5: Commit**

```
git add src/store/timeline.ts tests/timeline-store-split.test.ts
git commit -m "feat(timeline): 新增 splitOverlayClipsAt 支持 playhead 切分"
```

---

## Task 8: createTrackAt + toggleTrackLocked + 锁检查下沉

**Files:**
- Modify: `src/store/timeline.ts`
- Test: `tests/timeline-store-lock.test.ts`

- [ ] **Step 8.1: Write failing test**

```ts
// tests/timeline-store-lock.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('track lock & createTrackAt', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      timeline: {
        ...createDefaultTimeline(),
        overlays: [
          {
            id: 'a', type: 'image', assetPath: '', trackId: 'visual-1',
            startMs: 1000, durationMs: 2000,
            position: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
      historyPast: [], historyFuture: [],
      canUndo: false, canRedo: false,
    });
  });

  it('toggleTrackLocked toggles locked flag', () => {
    useTimelineStore.getState().toggleTrackLocked('visual-1');
    expect(
      useTimelineStore.getState().timeline.tracks.find((t) => t.id === 'visual-1')?.locked,
    ).toBe(true);
    useTimelineStore.getState().toggleTrackLocked('visual-1');
    expect(
      useTimelineStore.getState().timeline.tracks.find((t) => t.id === 'visual-1')?.locked,
    ).toBe(false);
  });

  it('removeOverlay is blocked on locked track', () => {
    useTimelineStore.getState().toggleTrackLocked('visual-1');
    useTimelineStore.getState().removeOverlay('a');
    expect(
      useTimelineStore.getState().timeline.overlays.some((o) => o.id === 'a'),
    ).toBe(true);
  });

  it('audio track is unlockable (no hardcoded block)', () => {
    useTimelineStore.getState().toggleTrackLocked('audio');
    expect(
      useTimelineStore.getState().timeline.tracks.find((t) => t.id === 'audio')?.locked,
    ).toBe(false);
  });

  it('createTrackAt top inserts a track with lowest order', () => {
    const id = useTimelineStore.getState().createTrackAt('top');
    const tracks = useTimelineStore.getState().timeline.tracks;
    const visualTracks = tracks.filter((t) => t.kind === 'visual').sort((a, b) => a.order - b.order);
    expect(visualTracks[0].id).toBe(id);
  });

  it('createTrackAt bottom inserts a track with highest order', () => {
    const id = useTimelineStore.getState().createTrackAt('bottom');
    const tracks = useTimelineStore.getState().timeline.tracks;
    const visualTracks = tracks.filter((t) => t.kind === 'visual').sort((a, b) => a.order - b.order);
    expect(visualTracks[visualTracks.length - 1].id).toBe(id);
  });
});
```

- [ ] **Step 8.2: Run test, expect fail**

- [ ] **Step 8.3: Add APIs and enforce lock**

Add to `TimelineStore` interface:

```ts
  createTrackAt: (position: 'top' | 'bottom') => string;
  toggleTrackLocked: (trackId: string) => void;
```

Add implementations:

```ts
  createTrackAt: (position) => {
    const tracks = useTimelineStore.getState().timeline.tracks;
    const visualTracks = tracks.filter((t) => t.kind === 'visual');
    const existingIds = new Set(visualTracks.map((t) => t.id));
    let nextIndex = 1;
    while (existingIds.has(`visual-${nextIndex}`)) nextIndex += 1;

    const orders = visualTracks.map((t) => t.order);
    const nextOrder =
      position === 'top'
        ? (orders.length ? Math.min(...orders) - 1 : 0)
        : (orders.length ? Math.max(...orders) + 1 : 0);

    const newTrack = {
      id: `visual-${nextIndex}`,
      kind: 'visual' as const,
      label: `轨道 ${nextIndex}`,
      order: nextOrder,
    };

    set((state) => {
      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        tracks: [...state.timeline.tracks, newTrack],
      });
      return buildCommittedTimelineState(state, nextTimeline);
    });

    return newTrack.id;
  },

  toggleTrackLocked: (trackId) =>
    set((state) => {
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      if (!track) return {};
      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        tracks: state.timeline.tracks.map((t) =>
          t.id === trackId ? { ...t, locked: !t.locked } : t,
        ),
      });
      return buildCommittedTimelineState(state, nextTimeline);
    }),
```

Enforce lock on `removeOverlay`:

```ts
  removeOverlay: (id) =>
    set((state) => {
      const target = state.timeline.overlays.find((o) => o.id === id);
      if (target) {
        const track = state.timeline.tracks.find((t) => t.id === target.trackId);
        if (track?.locked) return {};
      }
      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        overlays: state.timeline.overlays.filter((overlay) => overlay.id !== id),
      });
      return buildCommittedTimelineState(state, nextTimeline);
    }),
```

Enforce lock on `removeTrack` (remove the `kind === 'audio' || kind === 'subtitle'` hardcoded rejection — only the `locked` flag should decide now):

```ts
  removeTrack: (id) =>
    set((state) => {
      const target = state.timeline.tracks.find((track) => track.id === id);
      if (!target || target.locked) {
        return {};
      }
      const nextTimeline = normalizeTimeline({
        ...state.timeline,
        tracks: state.timeline.tracks.filter((track) => track.id !== id),
        overlays: state.timeline.overlays.filter((overlay) => overlay.trackId !== id),
      });
      return buildCommittedTimelineState(state, nextTimeline);
    }),
```

(Lock on `updateOverlay` / `trimOverlayClip` / `splitOverlayClipsAt` was already added in Tasks 5/6/7.)

- [ ] **Step 8.4: Run tests**

```
npx vitest run tests/timeline-store-lock.test.ts
npm test
```

- [ ] **Step 8.5: Commit**

```
git add src/store/timeline.ts tests/timeline-store-lock.test.ts
git commit -m "feat(timeline): 新增 createTrackAt/toggleTrackLocked 并下沉锁检查"
```

---

# Phase 3 — UI 渲染

## Task 9: Timeline.tsx 尾部留白 + ruler 扩展

**Files:**
- Modify: `src/components/Timeline.tsx`

**要点:** 将内容区 `width` 从现有算法改为 `getTimelineContentWidthPx(timeline, zoom, viewportWidth)`。Ruler tick 循环也用同一个宽度,并根据 `getTimelineVisualEndMs(timeline) + trailingMs` 生成刻度。

- [ ] **Step 9.1: Locate the content width计算**

打开 `src/components/Timeline.tsx`,找到 `getTimelineTrackWidth` 的调用(大约第 150-200 行附近,确切位置由 agent 查找)。记录原调用形式:

```ts
const trackWidth = getTimelineTrackWidth(durationMs, zoomLevel, containerWidth);
```

- [ ] **Step 9.2: Replace with content width helper**

Import:

```ts
import {
  getTimelineContentWidthPx,
  getTimelineVisualEndMs,
} from '../lib/timeline-view';
```

Replace the width computation:

```ts
const contentWidth = getTimelineContentWidthPx(timeline, zoomLevel, containerWidth);
// trackWidth 的其余引用统一改为 contentWidth
```

Replace all subsequent references to `trackWidth` in this component with `contentWidth`. Verify via search: there should be no remaining `getTimelineTrackWidth` calls if not needed.

- [ ] **Step 9.3: Update ruler tick generation**

Find the ruler ticks 生成循环(variables like `majorTickInterval`, `durationMs`)。将 `durationMs` 改为从 `getTimelineVisualEndMs(timeline)` 开始并结合 trailing padding:

```ts
const visualEndMs = getTimelineVisualEndMs(timeline);
const pxPerMs = contentWidth / Math.max(1, visualEndMs + /* trailing ms */);
// 注意:ruler 应该延伸到 contentWidth 对应的总 ms
const totalRulerMs = contentWidth / pxPerMs;
```

Iterate ticks from `0` to `totalRulerMs`,保持现有 `majorTickInterval` 策略不变。

- [ ] **Step 9.4: Manual check**

```
npm run dev
```

Verify in browser:
- Timeline 在任何 zoom level 下,滚动到最右边有至少一屏宽度的空白 + 对应的刻度。
- Clip 拖拽能拖到"最后一个 clip 之后"仍然合法。

- [ ] **Step 9.5: Commit**

```
git add src/components/Timeline.tsx
git commit -m "feat(timeline): 内容区增加尾部留白并扩展 ruler 刻度"
```

---

## Task 10: TimelineToolbar 组件 + undo/redo/split/snap/zoom 按钮

**Files:**
- Create: `src/components/timeline/TimelineToolbar.tsx`
- Create: `src/components/timeline/ZoomControls.tsx`
- Modify: `src/components/Timeline.tsx`(替换旧工具栏)

- [ ] **Step 10.1: Create ZoomControls**

```tsx
// src/components/timeline/ZoomControls.tsx
import { useState } from 'react';
import {
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToPercent,
  clampTimelineZoom,
} from '../../lib/timeline-view';

export interface ZoomControlsProps {
  zoomLevel: number;
  onZoomChange: (zoom: number) => void;
  timelineDurationMs: number;
  viewportWidth: number;
}

const PRESETS = [25, 50, 100, 200, 400];

export function ZoomControls({
  zoomLevel,
  onZoomChange,
  timelineDurationMs,
  viewportWidth,
}: ZoomControlsProps) {
  const [open, setOpen] = useState(false);
  const percent = Math.round(zoomLevel * 100);

  return (
    <div className="timeline-zoom-controls">
      <button
        type="button"
        className="timeline-toolbar-btn"
        title="缩小"
        onClick={() => onZoomChange(zoomOut(zoomLevel))}
      >
        −
      </button>
      <div className="timeline-zoom-percent">
        <button
          type="button"
          className="timeline-toolbar-btn"
          onClick={() => setOpen((prev) => !prev)}
        >
          {percent}%
        </button>
        {open && (
          <div className="timeline-zoom-menu">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  onZoomChange(zoomToPercent(p));
                  setOpen(false);
                }}
              >
                {p}%
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="timeline-toolbar-btn"
        title="放大"
        onClick={() => onZoomChange(zoomIn(zoomLevel))}
      >
        +
      </button>
      <button
        type="button"
        className="timeline-toolbar-btn"
        title="适应窗口"
        onClick={() => onZoomChange(zoomToFit(timelineDurationMs, viewportWidth))}
      >
        ⇱⇲
      </button>
      <button
        type="button"
        className="timeline-toolbar-btn"
        title="恢复 100%"
        onClick={() => onZoomChange(clampTimelineZoom(1))}
      >
        1:1
      </button>
    </div>
  );
}
```

- [ ] **Step 10.2: Create TimelineToolbar**

```tsx
// src/components/timeline/TimelineToolbar.tsx
import type { MouseEvent } from 'react';
import { useTimelineStore } from '../../store/timeline';
import { ZoomControls } from './ZoomControls';

export interface TimelineToolbarProps {
  zoomLevel: number;
  onZoomChange: (zoom: number) => void;
  timelineDurationMs: number;
  viewportWidth: number;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  onAddTrack: () => void;
  onSplit: () => void;
}

export function TimelineToolbar({
  zoomLevel,
  onZoomChange,
  timelineDurationMs,
  viewportWidth,
  snapEnabled,
  onToggleSnap,
  onAddTrack,
  onSplit,
}: TimelineToolbarProps) {
  const canUndo = useTimelineStore((s) => s.canUndo);
  const canRedo = useTimelineStore((s) => s.canRedo);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);

  const handle = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    fn();
  };

  return (
    <div className="timeline-toolbar">
      <div className="timeline-toolbar-group">
        <button
          type="button"
          className="timeline-toolbar-btn"
          title="撤销 ⌘Z"
          disabled={!canUndo}
          onClick={handle(undo)}
        >
          ↶
        </button>
        <button
          type="button"
          className="timeline-toolbar-btn"
          title="重做 ⌘⇧Z"
          disabled={!canRedo}
          onClick={handle(redo)}
        >
          ↷
        </button>
        <button
          type="button"
          className="timeline-toolbar-btn"
          title="添加轨道"
          onClick={handle(onAddTrack)}
        >
          ＋
        </button>
        <button
          type="button"
          className="timeline-toolbar-btn"
          title="分割 S"
          onClick={handle(onSplit)}
        >
          ✂
        </button>
      </div>
      <div className="timeline-toolbar-spacer" />
      <div className="timeline-toolbar-group">
        <button
          type="button"
          className={`timeline-toolbar-btn${snapEnabled ? ' is-active' : ''}`}
          title="磁性对齐"
          onClick={handle(onToggleSnap)}
        >
          🧲
        </button>
        <ZoomControls
          zoomLevel={zoomLevel}
          onZoomChange={onZoomChange}
          timelineDurationMs={timelineDurationMs}
          viewportWidth={viewportWidth}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 10.3: Add minimal styles (in `src/components/Timeline.css` or inline via Tailwind)**

Follow `DESIGN.md`:

```css
.timeline-toolbar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: var(--color-panel-bg);
  border-bottom: 1px solid var(--color-separator);
}
.timeline-toolbar-group { display: flex; gap: 4px; }
.timeline-toolbar-spacer { flex: 1; }
.timeline-toolbar-btn {
  height: 24px;
  min-width: 24px;
  padding: 0 8px;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.timeline-toolbar-btn:hover {
  background: var(--color-panel-elevated);
}
.timeline-toolbar-btn.is-active {
  background: var(--color-system-blue);
  color: #fff;
}
.timeline-toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.timeline-zoom-controls { display: flex; gap: 4px; align-items: center; }
.timeline-zoom-percent { position: relative; }
.timeline-zoom-menu {
  position: absolute;
  top: 28px;
  right: 0;
  min-width: 80px;
  padding: 4px;
  background: var(--color-panel-elevated);
  border: 1px solid var(--color-separator);
  border-radius: var(--radius-md);
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.timeline-zoom-menu button {
  padding: 4px 8px;
  text-align: left;
  background: transparent;
  color: var(--color-text-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.timeline-zoom-menu button:hover {
  background: var(--color-panel-bg);
}
```

Place this in the most relevant existing stylesheet — likely the existing Timeline CSS file(check with `Glob "src/**/Timeline*.css"`)。

- [ ] **Step 10.4: Wire into Timeline.tsx**

Find the existing toolbar block in `Timeline.tsx`(contains "添加轨道"和 zoom 显示,around line 607-626)并整体替换为:

```tsx
<TimelineToolbar
  zoomLevel={zoomLevel}
  onZoomChange={setZoomLevel}
  timelineDurationMs={getTimelineVisualEndMs(timeline)}
  viewportWidth={containerWidth}
  snapEnabled={snapEnabled}
  onToggleSnap={() => setSnapEnabled((v) => !v)}
  onAddTrack={() => addTrack()}
  onSplit={() =>
    useTimelineStore.getState().splitOverlayClipsAt(
      currentTimeMs,
      selectedOverlayId ? [selectedOverlayId] : undefined,
    )
  }
/>
```

Add local state for snap toggle: `const [snapEnabled, setSnapEnabled] = useState(true);`

Add keyboard handler (or extend existing global listener): press `S` → call the same split handler; `⌘Z` / `⌘⇧Z` → undo/redo. Use whatever shortcut registration mechanism already exists in `Timeline.tsx`. If none, wrap in a `useEffect` that binds `window.addEventListener('keydown', ...)` and ignore when `e.target` is a text input.

- [ ] **Step 10.5: Manual check**

```
npm run dev
```

Verify: toolbar 显示、缩放按钮可用、undo/redo 禁用态正确、split 在 playhead 处工作、`S` 快捷键生效、`⌘Z` / `⌘⇧Z` 生效。

- [ ] **Step 10.6: Commit**

```
git add src/components/timeline/TimelineToolbar.tsx src/components/timeline/ZoomControls.tsx src/components/Timeline.tsx src/components/Timeline.css
git commit -m "feat(timeline): 新增 TimelineToolbar 与 ZoomControls"
```

---

## Task 11: 轨道 header 锁图标 + 锁定态视觉

**Files:**
- Modify: `src/components/Timeline.tsx`(track header 渲染段)
- Modify: `src/components/Timeline.css` 或同层样式表

- [ ] **Step 11.1: Locate track header render**

在 `Timeline.tsx` 中找到 track header(渲染轨道 label 和"删除轨道"按钮的 JSX)。

- [ ] **Step 11.2: Add lock toggle button**

在 header 右侧(删除按钮旁)新增:

```tsx
<button
  type="button"
  className={`timeline-track-lock-btn${track.locked ? ' is-locked' : ''}`}
  title={track.locked ? '解锁轨道' : '锁定轨道'}
  onClick={(e) => {
    e.stopPropagation();
    useTimelineStore.getState().toggleTrackLocked(track.id);
  }}
>
  {track.locked ? '🔒' : '🔓'}
</button>
```

- [ ] **Step 11.3: Locked track visual styles**

Add to the existing stylesheet:

```css
.timeline-track {
  position: relative;
}
.timeline-track[data-locked='true']::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 1px dashed var(--color-separator);
  border-radius: var(--radius-sm);
}
.timeline-track[data-locked='true'] .overlay-block {
  opacity: 0.7;
}
.timeline-track-lock-btn {
  width: 20px;
  height: 20px;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
}
.timeline-track-lock-btn.is-locked {
  color: var(--color-system-blue);
}
```

- [ ] **Step 11.4: Apply data-locked attr on track row**

Find the `<div>` rendering each track's track-lane region, add:

```tsx
<div className="timeline-track" data-locked={track.locked ? 'true' : 'false'}>
```

- [ ] **Step 11.5: Manual check**

- Click lock on audio track → `locked` toggles, clips 半透明 + 虚线外框,不能拖动/删除。
- Click 解锁 → 恢复。

- [ ] **Step 11.6: Commit**

```
git add src/components/Timeline.tsx src/components/Timeline.css
git commit -m "feat(timeline): 轨道 header 锁图标与锁定态视觉"
```

---

## Task 12: OverlayBlock trim handles + 碰撞红遮罩 + 锁定态交互守卫

**Files:**
- Modify: `src/components/OverlayBlock.tsx`

- [ ] **Step 12.1: Inspect current OverlayBlock**

Read the entire `src/components/OverlayBlock.tsx`(~313 行)to understand where mouse-down handling lives and where to inject trim logic.

- [ ] **Step 12.2: Add trim handle hit-test**

Insert into the `onMouseDown` handler (before the existing move-drag path):

```ts
const HANDLE_WIDTH = 6;
const rect = blockRef.current!.getBoundingClientRect();
const offsetX = e.clientX - rect.left;
const fromStartEdge = offsetX <= HANDLE_WIDTH;
const fromEndEdge = offsetX >= rect.width - HANDLE_WIDTH;

if (track?.locked) {
  return; // 锁定轨道不响应
}

if (fromStartEdge || fromEndEdge) {
  beginTrim(fromStartEdge ? 'start' : 'end', e);
  return;
}
// 否则走原有 move-drag 路径
```

- [ ] **Step 12.3: Implement beginTrim**

```ts
function beginTrim(edge: 'start' | 'end', startEvent: ReactMouseEvent) {
  startEvent.preventDefault();
  const pxPerMs = props.pxPerMs;
  const originalStart = overlay.startMs;
  const originalDuration = overlay.durationMs;
  const originalEnd = originalStart + originalDuration;
  const startMouseX = startEvent.clientX;

  const onMove = (ev: MouseEvent) => {
    const deltaMs = (ev.clientX - startMouseX) / pxPerMs;
    let newEdgeMs: number;
    if (edge === 'start') {
      newEdgeMs = originalStart + deltaMs;
    } else {
      newEdgeMs = originalEnd + deltaMs;
    }
    // Snap 接入(如果 props 提供)
    if (props.computeSnapForTrim) {
      newEdgeMs = props.computeSnapForTrim(newEdgeMs, overlay.id);
    }
    useTimelineStore.getState().trimOverlayClip(overlay.id, edge, newEdgeMs);
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
```

- [ ] **Step 12.4: Add hover cursor style**

Wrap the block with inline style or Tailwind class:

```tsx
<div
  ref={blockRef}
  className="overlay-block"
  style={{
    cursor:
      hoverEdge === 'start' || hoverEdge === 'end'
        ? 'col-resize'
        : 'grab',
  }}
  onMouseMove={(e) => {
    const rect = blockRef.current!.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    if (ox <= 6) setHoverEdge('start');
    else if (ox >= rect.width - 6) setHoverEdge('end');
    else setHoverEdge(null);
  }}
  onMouseLeave={() => setHoverEdge(null)}
>
```

`const [hoverEdge, setHoverEdge] = useState<'start' | 'end' | null>(null);`

- [ ] **Step 12.5: Add collision red overlay support**

Accept a new prop `collisionState?: 'none' | 'invalid'`:

```tsx
{props.collisionState === 'invalid' && (
  <div className="overlay-block-collision" />
)}
```

CSS:

```css
.overlay-block-collision {
  position: absolute;
  inset: 0;
  background: rgba(255, 69, 58, 0.24);
  border: 1.5px solid var(--color-danger);
  border-radius: inherit;
  pointer-events: none;
}
```

(Collision state will be driven from Timeline.tsx drag handler in Task 13.)

- [ ] **Step 12.6: Manual check**

- Hover clip 左右 6px → col-resize 光标。
- 拖拽调节 start/end;撞到相邻 clip 自动硬停。
- 锁定轨道的 clip 完全不响应。

- [ ] **Step 12.7: Commit**

```
git add src/components/OverlayBlock.tsx src/components/Timeline.css
git commit -m "feat(timeline): OverlayBlock 加入 trim handle 与碰撞红遮罩"
```

---

## Task 13: Timeline.tsx 拖拽集成(碰撞反馈 + drop zone + snap + autoscroll)

**Files:**
- Modify: `src/components/Timeline.tsx`
- Create: `src/components/timeline/TrackDropZone.tsx`
- Create: `src/components/timeline/SnapGuides.tsx`

这是最集中的 UI 改造任务,建议分步完成并在每一步手工验证。

- [ ] **Step 13.1: Create TrackDropZone component**

```tsx
// src/components/timeline/TrackDropZone.tsx
import type { CSSProperties } from 'react';

export interface TrackDropZoneProps {
  position: 'top' | 'bottom';
  active: boolean;
  highlighted: boolean;
  width: number;
  left: number;
}

export function TrackDropZone({
  position,
  active,
  highlighted,
  width,
  left,
}: TrackDropZoneProps) {
  if (!active) return null;
  const style: CSSProperties = {
    width,
    left,
    opacity: highlighted ? 1 : 0.5,
  };
  return (
    <div
      className={`timeline-track-dropzone is-${position}${highlighted ? ' is-highlighted' : ''}`}
      style={style}
      data-drop-position={position}
    >
      <span>释放以新建轨道</span>
    </div>
  );
}
```

CSS:

```css
.timeline-track-dropzone {
  position: absolute;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  color: var(--color-system-blue);
  background: rgba(10, 132, 255, 0.08);
  border: 1px dashed var(--color-system-blue);
  border-radius: var(--radius-sm);
  pointer-events: none;
  transition: opacity 0.12s;
}
.timeline-track-dropzone.is-top { top: -36px; }
.timeline-track-dropzone.is-bottom { bottom: -36px; }
.timeline-track-dropzone.is-highlighted {
  background: rgba(10, 132, 255, 0.18);
}
```

- [ ] **Step 13.2: Create SnapGuides component**

```tsx
// src/components/timeline/SnapGuides.tsx
import type { SnapTarget } from '../../lib/timeline-snap';

export interface SnapGuidesProps {
  targets: SnapTarget[];
  pxPerMs: number;
  sidebarWidth: number;
  height: number;
}

export function SnapGuides({ targets, pxPerMs, sidebarWidth, height }: SnapGuidesProps) {
  return (
    <>
      {targets.map((t, idx) => (
        <div
          key={`${t.ms}-${idx}`}
          className="timeline-snap-guide"
          style={{
            left: sidebarWidth + t.ms * pxPerMs,
            height,
          }}
        />
      ))}
    </>
  );
}
```

CSS:

```css
.timeline-snap-guide {
  position: absolute;
  top: 0;
  width: 0;
  border-left: 1px dashed var(--color-system-blue);
  pointer-events: none;
  z-index: 5;
}
```

- [ ] **Step 13.3: Extend Timeline.tsx drag state**

Add React state for drag overlay:

```ts
const [dragState, setDragState] = useState<{
  overlayId: string;
  collision: boolean;
  snapTargets: SnapTarget[];
  dropZoneHover: 'top' | 'bottom' | null;
} | null>(null);
```

When a drag starts (intercept the existing overlay-drag entry point) store the overlay id; on `mousemove`, compute:
1. Prospective new `startMs` and `trackId` (using existing logic in `resolveTrackIdByClientY`).
2. If mouse is inside top/bottom drop zone rect → `dropZoneHover` = that position, skip collision.
3. Else call `canPlaceAt({ trackId, startMs, durationMs, excludeOverlayId, overlays })`.
4. Call `computeSnap(...)` with `enabled: snapEnabled && !e.altKey`.
5. Update `dragState`.

On `mouseup`:
- If `dropZoneHover` set:
  - `const newTrackId = useTimelineStore.getState().createTrackAt(dropZoneHover);`
  - `useTimelineStore.getState().updateOverlay(overlayId, { trackId: newTrackId, startMs });`
- Else if `collision` → do nothing (clip stays at original position because `updateOverlay` already rejects).
- Else → dispatch `updateOverlay` normally.
- Clear `dragState`.

- [ ] **Step 13.4: Pass collisionState to OverlayBlock**

```tsx
<OverlayBlock
  overlay={overlay}
  collisionState={dragState?.overlayId === overlay.id && dragState.collision ? 'invalid' : 'none'}
  ...
/>
```

- [ ] **Step 13.5: Mount TrackDropZone and SnapGuides**

In the timeline track column render:

```tsx
<TrackDropZone
  position="top"
  active={!!dragState}
  highlighted={dragState?.dropZoneHover === 'top'}
  width={contentWidth}
  left={sidebarWidth}
/>
{visualTracks.map(renderTrack)}
<TrackDropZone
  position="bottom"
  active={!!dragState}
  highlighted={dragState?.dropZoneHover === 'bottom'}
  width={contentWidth}
  left={sidebarWidth}
/>
<SnapGuides
  targets={dragState?.snapTargets ?? []}
  pxPerMs={pxPerMs}
  sidebarWidth={sidebarWidth}
  height={totalTrackAreaHeight}
/>
```

- [ ] **Step 13.6: Integrate timeline-autoscroll during drag**

At drag start:

```ts
const scheduler = startAutoScroll({ container: scrollContainerRef.current! });
scheduler.update({ x: e.clientX, y: e.clientY });
```

On each `mousemove`: `scheduler.update({ x: e.clientX, y: e.clientY });`

On `mouseup`: `scheduler.stop();`

Store the scheduler ref via `useRef`.

- [ ] **Step 13.7: Manual check**

```
npm run dev
```

Verify:
1. 拖拽 clip 撞到其他 clip → 红遮罩显示,松开后回到原位。
2. 拖到顶部/底部 drop zone → 高亮 + 松开后新轨道出现并落位。
3. 拖拽时靠近相邻 clip 边缘或 playhead → 蓝色虚线 snap guide 出现;按住 `⌥` 关掉。
4. 拖到 timeline 右边缘 → 自动水平滚动。
5. 工具栏磁铁按钮可以切换 snap 全局开关。

- [ ] **Step 13.8: Commit**

```
git add src/components/timeline/TrackDropZone.tsx src/components/timeline/SnapGuides.tsx src/components/Timeline.tsx src/components/Timeline.css
git commit -m "feat(timeline): 拖拽集成 drop zone / snap / autoscroll / 碰撞反馈"
```

---

## Task 14: Ruler 拖拽 seek

**Files:**
- Modify: `src/components/Timeline.tsx`

- [ ] **Step 14.1: Locate ruler render**

Find the `<div className="timeline-ruler">` or equivalent.

- [ ] **Step 14.2: Add mousedown handler for seek**

```tsx
const handleRulerMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
  const rect = rulerRef.current!.getBoundingClientRect();
  const seek = (clientX: number) => {
    const localX = clientX - rect.left + (scrollContainerRef.current?.scrollLeft ?? 0);
    const ms = Math.max(0, localX / pxPerMs);
    const snapped = snapEnabled
      ? computeSnap({
          candidateMs: ms,
          playheadMs: ms,
          overlays: timeline.overlays,
          pxPerMs,
          thresholdPx: 8,
          enabled: true,
        }).snappedMs
      : ms;
    setCurrentTimeMs(snapped);
  };
  seek(e.clientX);
  const onMove = (ev: MouseEvent) => seek(ev.clientX);
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};
```

Attach via `onMouseDown={handleRulerMouseDown}` on the ruler element.

- [ ] **Step 14.3: Manual check**

```
npm run dev
```

Click/drag on ruler → playhead follows.

- [ ] **Step 14.4: Commit**

```
git add src/components/Timeline.tsx
git commit -m "feat(timeline): ruler 支持点击与拖拽 seek"
```

---

# Phase 4 — 清理与验收

## Task 15: Full test suite + manual QA checklist

- [ ] **Step 15.1: Run all tests**

```
npm test
```

All must pass. If any test fails because of spec changes (e.g., old test expected auto-relocate), update the test to match the new spec semantics. Do not suppress failures.

- [ ] **Step 15.2: TypeScript check**

```
npm run build
```

Must compile cleanly.

- [ ] **Step 15.3: Manual QA (npm run dev)**

Walk through the full list from spec §8:

1. [ ] 缩小到 25% → 右侧一屏空白 → 能拖 clip 到空白区。
2. [ ] AI 卡片 + 视频同轨道拖拽互相碰撞红显。
3. [ ] 拖 clip 到 top/bottom drop zone → 新轨道出现。
4. [ ] 锁定 audio 轨 → 波形半透明、无法拖动;解锁恢复。
5. [ ] 工具栏 −/+/100%/fit 行为正确;下拉选百分比生效。
6. [ ] Clip 左右 6px hover → col-resize;trim 到相邻 clip 硬停。
7. [ ] Playhead 落在 clip 中,按 `S` → clip 一分为二。
8. [ ] 拖/trim 时吸附虚线出现;按 `⌥` 临时禁用。
9. [ ] Ruler 区域点击/拖拽 → playhead 跟随。
10. [ ] 拖 clip 到 timeline 右边缘 → 自动水平滚动。
11. [ ] 工具栏 undo/redo 按钮禁用态正确,点击恢复。

Report any失败项供讨论。

- [ ] **Step 15.4: Final commit**

如有收尾修改:

```
git add <files>
git commit -m "chore(timeline): 修复 QA 发现的细节"
```

---

## 开放问题

实施中若发现 `resolveOverlayInsert` / `Timeline.tsx` 的结构需要更大改动(例如拆分 hook),按"存在的问题"原则就地修复,但范围必须限制在本计划涉及的文件内。其他模块的改动不在本计划范围。

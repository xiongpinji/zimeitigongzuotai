# Timeline Overlay Inspector And Collision Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为图片、视频、文字三类视觉 overlay 建立统一的详情面板与通用动画模型，并让时间轴在新增、拖动、拉伸时禁止同轨重叠。

**Architecture:** 在 `src/types.ts` 与 `src/lib/*` 中新增 overlay 通用 motion 和轨道占用解析器，让 `src/store/timeline.ts` 成为所有时间轴合法性写入的唯一入口；在 UI 层用统一的 `OverlayInspector` 替换现有“只有文字才有详情”的结构，并让 `Timeline` 的 drop / click / drag 统一走 store 约束逻辑。`TextInspector` 从本阶段开始不再作为 `EditorInspector` 的直接入口，如需保留文件，仅保留为迁移期 wrapper，不再承载独立状态和新逻辑。AI 卡片与默认背景暂时不接入新碰撞规则，只保持现状。

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Vitest, Remotion, CSS Modules

---

## Chunk 1: 通用 Overlay 领域模型

### Task 1: 提升 overlay 通用动画模型并兼容旧数据

**Files:**
- Create: `src/lib/overlay-motion.ts`
- Modify: `src/types.ts`
- Modify: `src/lib/text-animations.ts`
- Modify: `src/remotion/TextOverlay.tsx`
- Modify: `src/remotion/MediaOverlay.tsx`
- Modify: `src/lib/timeline-tracks.ts`
- Test: `tests/text-animations.test.ts`
- Test: `tests/timeline-store.test.ts`
- Create: `tests/media-overlay.test.tsx`

- [ ] **Step 1: 在 `src/types.ts` 新增 overlay 通用 motion 类型**

```ts
export type OverlayEnterAnimation =
  | 'none'
  | 'fadeIn'
  | 'slideInLeft'
  | 'slideInRight'
  | 'slideInUp'
  | 'slideInDown'
  | 'scaleIn'
  | 'bounceIn';

export type OverlayExitAnimation =
  | 'none'
  | 'fadeOut'
  | 'slideOutLeft'
  | 'slideOutRight'
  | 'slideOutUp'
  | 'slideOutDown'
  | 'scaleOut'
  | 'bounceOut';

export type OverlayLoopAnimation = 'none' | 'pulse' | 'float' | 'flicker';

export interface OverlayMotion {
  enter: OverlayEnterAnimation;
  enterDurationMs: number;
  exit: OverlayExitAnimation;
  exitDurationMs: number;
  loop: OverlayLoopAnimation;
}
```

- [ ] **Step 2: 给 `OverlayItem` 增加 `motion`，并把 `TextOverlayData.animation` 从类型里移除**

```ts
export interface OverlayItem {
  // ...
  motion: OverlayMotion;
  textData?: TextOverlayData;
}
```

- [ ] **Step 3: 在 `src/lib/overlay-motion.ts` 提供默认 motion 与旧文字动画迁移函数**

```ts
export function createDefaultOverlayMotion(): OverlayMotion {
  return {
    enter: 'none',
    enterDurationMs: 400,
    exit: 'none',
    exitDurationMs: 400,
    loop: 'none',
  };
}
```

- [ ] **Step 4: 先补一个旧文字 overlay 迁移测试，明确覆盖 `textData.animation -> overlay.motion`**

```ts
it('migrates legacy text overlay animation into overlay motion')
```

Run: `npm test -- tests/timeline-store.test.ts -t "migrates legacy text overlay animation into overlay motion" -v`

Expected: 旧文字 overlay 的动画被迁移到 `overlay.motion`，旧文字样式字段保持不丢失

- [ ] **Step 5: 修改 `src/lib/timeline-tracks.ts`，在 `normalizeTimelineData()` 中为旧 overlay 回填 `motion`**

Run: `npm test -- tests/timeline-store.test.ts -t "migrates legacy timelines without tracks and backfills overlay track ids"`

Expected: 旧 timeline 仍可加载，并且 overlay 拥有默认 `motion`

- [ ] **Step 6: 改造 `src/lib/text-animations.ts`，让它接收 overlay 通用 motion**

```ts
interface AnimationParams {
  frame: number;
  fps: number;
  durationFrames: number;
  motion: OverlayMotion;
  content?: string;
}
```

- [ ] **Step 7: 更新 `src/remotion/TextOverlay.tsx` 和 `src/remotion/MediaOverlay.tsx`，让两者都消费 `overlay.motion`**

Run: `npm test -- tests/text-animations.test.ts tests/media-overlay.test.tsx -v`

Expected: 文字和媒体都能读取 motion，媒体渲染测试新增通过


## Chunk 2: 轨道占用解析器与 Store 收口

### Task 2: 新增 timeline placement 纯逻辑模块

**Files:**
- Create: `src/lib/timeline-placement.ts`
- Create: `tests/timeline-placement.test.ts`
- Modify: `src/lib/overlay-drag.ts`
- Test: `tests/overlay-drag.test.ts`

- [ ] **Step 1: 在 `src/lib/timeline-placement.ts` 定义轨道占用过滤与 overlap 判断**

```ts
export function isOverlayTrackManaged(overlay: OverlayItem): boolean {
  return (
    overlay.overlayRole !== 'default-background' &&
    overlay.overlayType !== 'ai-card' &&
    (overlay.type === 'video' || overlay.type === 'image' || overlay.type === 'text')
  );
}

export function overlaysOverlap(left: { startMs: number; durationMs: number }, right: { startMs: number; durationMs: number }): boolean {
  return left.startMs < right.startMs + right.durationMs &&
    right.startMs < left.startMs + left.durationMs;
}
```

- [ ] **Step 2: 实现“同轨最近合法区间”“跨轨搜索”“resize 边界 clamp”三个核心函数**

```ts
export function findNearestAvailablePlacement(/* ... */): PlacementResult
export function findAvailableTrack(/* ... */): PlacementTrackResult
export function clampOverlayDurationByNeighbors(/* ... */): number
```

- [ ] **Step 3: 为 placement 模块写纯逻辑测试，覆盖 overlap、同轨避让、跨轨搜索、自动落到新轨**

Run: `npm test -- tests/timeline-placement.test.ts -v`

Expected: 新增解析器的核心分支全部通过

- [ ] **Step 4: 保持 `src/lib/overlay-drag.ts` 只负责“候选意图计算”，不要在这里写业务碰撞规则**

Run: `npm test -- tests/overlay-drag.test.ts -v`

Expected: 现有拖拽 draft 测试继续通过


### Task 3: 把新增 / 拖动 / 拉伸的合法性统一收口到 store

**Files:**
- Modify: `src/store/timeline.ts`
- Modify: `tests/timeline-store.test.ts`

- [ ] **Step 1: 在 `src/store/timeline.ts` 内部新增“创建 overlay 合法落位”辅助函数**

```ts
function resolveOverlayInsert(state: TimelineCommitState, draft: OverlayDraft): { overlay: OverlayItem; createdTrackId?: string }
```

- [ ] **Step 2: 让 `addOverlay()` 在写入前调用 placement resolver，并在必要时自动创建新视觉轨道**

Run: `npm test -- tests/timeline-store.test.ts -t "stores imported assets and uses their durations for overlays" -v`

Expected: 现有新增 overlay 行为保持通过

- [ ] **Step 3: 让 `updateOverlay()` 在 `startMs / durationMs / trackId` 更新时调用 placement resolver**

```ts
const affectsTrackPlacement =
  'startMs' in updates || 'durationMs' in updates || 'trackId' in updates;
```

- [ ] **Step 4: 为 store 增加新测试，覆盖以下场景**

```ts
it('repositions a new overlay when the requested track slot overlaps')
it('moves an overlay to another available track when the current track is occupied')
it('creates a new visual track when all existing visual tracks are occupied')
it('clamps resize duration to the next overlay boundary')
it('keeps ai-card and default background out of managed collision rules')
```

- [ ] **Step 5: 运行 timeline store 全量测试**

Run: `npm test -- tests/timeline-store.test.ts -v`

Expected: store 新旧用例全部通过


## Chunk 3: 统一 Overlay Inspector

### Task 4: 新建统一 OverlayInspector，并拆出通用 motion 区块

**Files:**
- Create: `src/components/OverlayInspector.tsx`
- Create: `src/components/OverlayInspector.module.css`
- Create: `src/components/overlay-inspector/OverlayMotionSection.tsx`
- Create: `src/components/overlay-inspector/OverlayTimingSection.tsx`
- Create: `src/components/overlay-inspector/TextOverlayFields.tsx`
- Create: `src/components/overlay-inspector/MediaOverlayFields.tsx`
- Modify: `src/components/EditorInspector.tsx`
- Modify: `tests/editor-inspector.test.tsx`

- [ ] **Step 1: 新建 `OverlayInspector`，按 `overlay.type` 分发通用区块和专属区块**

```tsx
if (overlay.type === 'text') {
  return <TextOverlayFields overlay={overlay} />;
}

return <MediaOverlayFields overlay={overlay} />;
```

- [ ] **Step 2: 把通用 motion UI 从旧 `TextInspector` 中拆到 `OverlayMotionSection`**

- [ ] **Step 3: 让 `EditorInspector` 新增 `selection: { type: 'overlay'; overlayId: string }` 分支**

- [ ] **Step 4: 保留当前 `ai-card` 与 `subtitle-style` 分支，不在这一轮合并它们的编辑模型**

- [ ] **Step 5: 扩展 `tests/editor-inspector.test.tsx`，覆盖媒体 overlay 和文字 overlay 的新头部 / 渲染路径**

Run: `npm test -- tests/editor-inspector.test.tsx -v`

Expected: `EditorInspector` 能渲染统一 overlay 详情，不影响现有 AI 卡片测试


### Task 5: 冻结旧 TextInspector 为迁移期 wrapper，并把文字专属字段迁入统一 Inspector

**Files:**
- Modify: `src/components/TextInspector.tsx`
- Modify: `tests/editor-inspector.test.tsx`

- [ ] **Step 1: 让 `TextInspector` 不再被 `EditorInspector` 直接引用；如果保留文件，只保留成调用 `TextOverlayFields` 的迁移期 wrapper**

- [ ] **Step 2: 把文字专属基础样式、模板能力迁移到 `TextOverlayFields`**

- [ ] **Step 3: 确保删除动作和文字专属更新继续可用，但不再维护独立 animation Tab 状态**

Run: `npm test -- tests/editor-inspector.test.tsx tests/text-overlay.test.tsx -v`

Expected: 文字详情继续可编辑，动画入口只存在于 overlay 通用面板，`TextInspector` 不再是主入口


## Chunk 4: Timeline 交互接线

### Task 6: 让时间轴点击图片 / 视频也能打开详情，并在新增后自动选中

**Files:**
- Modify: `src/pages/Editor.tsx`
- Modify: `src/components/Timeline.tsx`
- Modify: `tests/timeline.test.tsx`
- Modify: `tests/editor.test.tsx`

- [ ] **Step 1: 将 `Editor.tsx` 的 Inspector 选择逻辑从 `text-overlay` 扩展为通用 `overlay`**

```ts
const handleOpenOverlayInspector = (overlayId: string) => {
  setInspectorSelection({ type: 'overlay', overlayId });
};
```

- [ ] **Step 2: 让 `handleAddTextOverlay()` 通过新 placement 逻辑新增文字，并自动打开 `overlay` Inspector**

- [ ] **Step 3: 让 `Timeline` 中任意可管理视觉 overlay 点击后都调用 `onOpenOverlayInspector`**

- [ ] **Step 4: drop 新素材成功后，把新 overlay id 回传给页面层并设置为当前选中项**

- [ ] **Step 5: 扩展时间轴组件测试，验证图片 / 视频区块拥有详情入口，并覆盖“冲突后自动新建轨道并显示新轨”的 UI 闭环**

Run: `npm test -- tests/timeline.test.tsx tests/editor.test.tsx -v`

Expected: timeline 点击媒体块可以打开 Inspector，手动新增文字仍自动选中，冲突时新增轨道能在界面中被看见


### Task 7: 在拖动与拉伸交互中接入 store 约束

**Files:**
- Modify: `src/components/OverlayBlock.tsx`
- Modify: `src/components/Timeline.tsx`
- Modify: `tests/overlay-block.test.tsx`

- [ ] **Step 1: 让拖动只产生“候选 startMs / trackId”，真正提交交给 `updateOverlay()` 的约束逻辑**

- [ ] **Step 2: 让右侧 resize 在 store 内部被邻居边界 clamp，而不是只 clamp 总时长**

- [ ] **Step 3: 冲突回退采用“保持最后合法状态”策略，不在组件层做复杂补偿**

- [ ] **Step 4: 扩展 `tests/overlay-block.test.tsx`，覆盖拖动更新调用与 resize 调用不破坏现有交互**

Run: `npm test -- tests/overlay-block.test.tsx -v`

Expected: 组件测试继续稳定，交互层不承担业务规则


## Chunk 5: 回归验证与收尾

### Task 8: 执行针对性测试和全量验证

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/*`
- Modify: `src/store/timeline.ts`
- Modify: `src/components/*`
- Test: `tests/*.test.ts`
- Test: `tests/*.test.tsx`

- [ ] **Step 1: 运行本次新增和修改的关键测试集**

Run: `npm test -- tests/timeline-placement.test.ts tests/timeline-store.test.ts tests/editor-inspector.test.tsx tests/timeline.test.tsx tests/overlay-block.test.tsx tests/text-animations.test.ts tests/media-overlay.test.tsx -v`

Expected: 关键链路全部通过

- [ ] **Step 2: 运行全量测试**

Run: `npm test`

Expected: `vitest run` 全部通过

- [ ] **Step 3: 执行构建验证**

Run: `npm run build`

Expected: Electron Vite 构建通过，无新的 TypeScript 错误

- [ ] **Step 4: 记录仍未覆盖的后续能力**

```text
1. AI 卡片是否也纳入同轨防碰撞
2. 预览区是否支持图片 / 视频框选拖拽
3. 媒体裁剪 / object-fit / 滤镜等高级配置
```

Plan complete and saved to `docs/superpowers/plans/2026-04-06-timeline-overlay-inspector-and-collision.md`. Ready to execute?

# Timeline 基础剪辑能力升级 · 设计文档

**日期**:2026-04-13
**范围**:P0 + P1(11 项)
**目标**:把 timeline 从"能放 clip"升到"能剪"的基础水位,对齐剪映 / Final Cut Pro 的基础剪辑体验。

---

## 1. 背景与现状

灵机剪影当前 timeline 的主要短板:

1. **总时长 = 最后一个 clip 末端**,缩小后右侧顶边,无法把 clip 拖到"结尾之后"。
2. **碰撞防重叠只覆盖 video/image/text**,AI 卡片等其他 overlay 可能互相叠放。
3. **跨轨拖拽只能落到已有轨道**,没有"拖到空白区新建轨道"的能力。
4. **`locked` 字段已存在但完全没有 UI**,audio / subtitle 默认锁定对用户不可见。
5. **缩放仅支持 ⌘/Ctrl + 滚轮**,无按钮入口,非鼠标用户不友好。
6. **无磁性对齐、无 trim、无 split、无 ripple、无框选、无标尺拖拽 seek、无边缘自动滚动**——这些在剪映/FCP 都是默认能力。

关键源文件:

| 文件 | 职责 |
| --- | --- |
| `src/components/Timeline.tsx` | 时间线主组件(~600 行) |
| `src/store/timeline.ts` | Zustand store(~867 行,含 undo/redo) |
| `src/lib/timeline-tracks.ts` | 轨道工具函数 |
| `src/lib/timeline-placement.ts` | 碰撞检测(目前只服务 video/image/text) |
| `src/lib/timeline-view.ts` | 缩放/视图工具 |
| `src/lib/overlay-drag.ts` | 拖拽 delta 计算 |
| `src/types.ts` | `OverlayItem` / `Track` 数据结构 |

---

## 2. 目标

**P0(硬伤修复)**
1. 尾部留白区
2. 通用碰撞防重叠
3. 拖到空白处新建轨道
4. 锁定轨道 UI
5. 缩放按钮组

**P1(基础剪辑)**
6. Clip 边缘 trim
7. Split(刀片)
8. 磁性对齐 Snap
9. 标尺拖拽 seek
10. 拖到边缘自动滚动
11. Undo/Redo 工具栏按钮

---

## 3. 非目标

以下明确不做,留待后续迭代:

- Ripple 删除 / Ripple trim
- 框选多 clip(P2)
- Markers / 章节标记
- Group / ungroup
- Track reordering(轨道顺序拖拽)
- Compound / nested clips
- Clip 级 lock(只做轨道级)
- 波形图 / 缩略图升级

---

## 4. 设计

### 4.1 尾部留白区(P0-1)

**策略**:滚动内容宽度 = `max(末尾 clip 结束位置, currentTimeMs) + 视口宽度`。

**实现要点**:
- 新增 `getTimelineScrollWidthPx(timeline, pxPerMs, viewportWidth)` 工具函数,放在 `src/lib/timeline-view.ts`。
- `Timeline.tsx` 的内容区 `width` 从"单纯乘以 durationMs"改为上述公式。
- Ruler ticks 也延伸到这个宽度,保持"空白区仍有刻度"的直觉。
- Scrollbar 的最大滚动范围随之变大,缩小(pxPerSecond 变小)时留白会自动等比变宽。
- `store.getEffectiveTimelineDurationMs` 保持"真实末端"语义不变,新增 `getTimelineVisualEndMs` 给渲染层用。

**验收**:任意 zoom level 下,滚动到最右边必定能看到至少一屏宽度的空白刻度区。

---

### 4.2 通用碰撞防重叠(P0-2)

**现状**:`src/lib/timeline-placement.ts:45-48` 白名单只含 `video/image/text`,AI 卡片及其他 overlay 跳过检测。

**改造**:
- 移除类型白名单,改为**按 `trackId` 分组检测所有 overlay**。
- 例外:背景默认层(`overlayRole: 'background'` 或类似标记)仍不参与,避免和 visual 层互撞。
- `timeline-placement.ts` 输出一致的 API:`canPlaceAt(trackId, startMs, durationMs, excludeId?) → { ok: boolean, reason?: 'overlap' }`。
- 新增 `findCollidingItems(trackId, startMs, endMs, excludeId?)` 供 UI 层标红使用。

**碰撞策略(决策 3)**:
- **拖拽过程中**:命中碰撞时,被拖 clip 显示红色半透明遮罩 + 红色外描边(`--color-danger` 1.5px),光标变 `not-allowed`。
- **松开鼠标**:若最终位置非法 → 回弹到拖拽起始位置,不落位。
- **Trim 过程中**:左右边缘撞到相邻 clip 时硬停(继续拖拽也不再变长),光标变红。

**注意**:
- 原来"找最近空位 + 找不到就新建轨道"的自动落位能力完全移除,其功能由 4.3(drop zone 新建轨道)替代。
- 影响调用点需梳理:`store.addOverlayClip` / `moveOverlayClip` / `pasteOverlay` 等,全部统一走新 API。

---

### 4.3 拖到空白处新建轨道(P0-3)

**UI**:
- 拖拽启动时,在 visual 轨道列表的**最上方**和**最下方**各渲染一条高 `32px` 的 drop zone。
- Drop zone 默认不可见(`opacity: 0`);拖拽进入时显示:虚线边框(`--color-system-blue` 1px dashed)+ 浅蓝填充(`rgba(10,132,255,0.08)`)+ 中央文案 "释放以新建轨道"。
- Drop zone 宽度与 timeline 内容区一致。

**落位逻辑**:
- 释放时若目标 = drop zone:
  - 调用 `store.createTrack({ kind: 'visual', position: 'top' | 'bottom' })`,返回新 `trackId`。
  - 被拖 clip 的 `trackId` 更新为新轨道,`startMs` 保留(以鼠标释放位置为准)。
- 默认轨道命名:`visual-{n}`,`n` 为当前 visual 轨道计数 +1。

**边界**:
- 若该次拖拽被判为碰撞非法 → drop zone 不可落(因为新轨道天然空,不会碰撞,实际上总能落)。
- 锁定态拖拽不进入此分支(锁定轨道的 clip 不可拖)。

---

### 4.4 锁定轨道 UI(P0-4)

**数据**:`Track.locked: boolean` 已存在。

**Header UI**:
- 左侧轨道 header 右端固定显示一枚锁图标按钮(20×20px)。
- 未锁:`lock-open` 轮廓、灰色(`--color-text-secondary`)。
- 已锁:`lock-closed` 实心、蓝色(`--color-system-blue`)。
- 点击切换;audio / subtitle 默认 `locked: true`,但**允许解锁**(不再硬编码拒绝)。

**锁定态视觉**:
- 轨道内容区叠加 1px dashed `--color-separator` 外描边。
- 所有 clip `opacity: 0.7`,不响应拖拽/trim/split/删除/右键编辑。
- 选中仍可用(只读高亮,inspector 属性字段禁用)。

**受影响操作**:
- `moveOverlayClip` / `resizeOverlayClip` / `splitOverlayClip` / `deleteOverlayClip` / `pasteOverlay` 在 store 层统一检查目标轨道的 `locked`,违反则 no-op 并 `console.warn`。
- 锁定态 track 的 clip 依旧参与 playhead 播放渲染。

---

### 4.5 缩放按钮组(P0-5)

**位置**:timeline 顶部工具栏右侧区域。

**按钮**(从左到右):
1. `−` Zoom out(按当前步长 1.25 的倒数)
2. 数字文本:当前百分比(基于 `pxPerSecond / BASE_TIMELINE_PX_PER_SECOND`),点击展开下拉,预设 [25%, 50%, 100%, 200%, 400%]
3. `+` Zoom in
4. `fit-to-window` 图标:缩放到"整段 timeline 刚好塞满视口"
5. `1:1` 小字:恢复 100%

**实现**:
- 抽 `src/lib/timeline-view.ts` 新增 `zoomIn / zoomOut / zoomToFit(contentMs, viewportWidth) / zoomToPercent` 纯函数。
- 快捷键保持:`⌘ =` / `⌘ -` / `⌘ 0`(适应窗口)与按钮逻辑同源。

---

### 4.6 Clip 边缘 Trim(P1-6)

**触发**:
- 鼠标 hover clip 左右 `6px` 边缘区 → 光标变 `col-resize`。
- 按下进入 trim 模式,拖拽时实时更新 `startMs`(左边)或 `durationMs`(右边)。

**约束**:
- 最小 duration = `100ms`(保护零宽 clip)。
- 左 trim 不得使 `startMs < 0`。
- 对于承载媒体资源的 clip(audio/video),右 trim 不得超过原始媒体时长;其他类型(text / AI 卡片)无上限。
- 命中碰撞硬停(见 4.2)。
- 锁定轨道禁用。
- Snap 参与(见 4.8)。

**store API**:
- 新增 `trimOverlayClip(id, edge: 'start' | 'end', newMs: number)`,内部做校验 + undo 快照。
- Trim 结束时提交一次 undo,拖拽过程不产生历史。

**视觉**:
- Trim handle hover 时左右边出现 2px 高亮条(系统蓝)。
- Trim 中,顶部 tooltip 显示 `00:00:05.250 / 00:03.120`(新开始 / 新时长)。

---

### 4.7 Split 刀片(P1-7)

**触发**:
- 快捷键 `S`(与剪映一致)或工具栏刀片按钮。
- 作用目标:有选中 clip → 切中选中的;无选中 → 切所有与当前 playhead 相交且**非锁定**的 clip。

**算法**:
- 对每个命中 clip:
  - 记原 clip `A = { start, duration }`,playhead 时刻 `t`。
  - 保留 `A.duration = t - A.start`。
  - 新建 clip `B`,拷贝 A 的所有属性,`B.start = t`,`B.duration = 原duration - (t - A.start)`,`B.id = uuid()`。
  - 若是 `text` 类型且承载 SRT 片段,**按时间比例拆分** text 内容。
  - 若是 AI 卡片类型,保留相同 aiCardData(用户可后续编辑)。
- 单次 split 提交一次 undo 快照。

**store API**:`splitOverlayClipsAt(playheadMs, targetIds?)`。

**边界**:
- 若 `t` 不在任何命中 clip 内部(落在边缘 <= 50ms)→ no-op。
- 锁定轨道跳过。

---

### 4.8 磁性对齐 Snap(P1-8)

**磁吸目标**:
1. Playhead
2. 同轨道相邻 clip 的 `start` / `end`
3. 其他轨道中与当前时刻点相同的 clip 边缘

**阈值**:屏幕 `8px`(按 `pxPerMs` 换算为 ms)。

**API**:
- 新增 `src/lib/timeline-snap.ts`,导出 `snap(candidateMs, context) → { snappedMs, snapTargets: SnapLine[] }`。
- `context = { timeline, pxPerMs, excludeOverlayId?, currentTrackId? }`。
- `SnapLine = { ms: number, kind: 'playhead' | 'clip-edge' }`。

**视觉**:
- 吸附命中时,在 timeline 内容区覆盖一条 1px 垂直虚线(系统蓝),延伸全高。
- 工具栏新增磁铁 toggle 按钮,关闭时整个 snap 机制跳过。
- 按住 `⌥` 临时禁用 snap(拖拽过程检查 `Alt` 键)。

**接入**:
- `moveOverlayClip` / `trimOverlayClip` / ruler 拖拽 seek 都接入 snap。

---

### 4.9 标尺拖拽 Seek(P1-9)

- Ruler 区域 `mousedown` 进入 seek 模式,`mousemove` 持续更新 `currentTimeMs`。
- 点击 ruler 空白处:立即 seek 到点击位置。
- 支持 snap(开启 magnet 时)。
- 拖拽过程中时间标签紧随鼠标(小气泡 tooltip)。
- 播放中 seek 不中断播放,但会跳到新位置。

---

### 4.10 拖到边缘自动滚动(P1-10)

- 拖拽 clip / trim / ruler seek 过程中,鼠标进入 timeline 可视区**左右 40px** 的"热区"时触发水平自动滚动。
- 滚动速度随距离边缘的深度线性加速,最大 `800px/s`。
- 使用 `requestAnimationFrame` 驱动,拖拽结束清理。
- 顶部 drop zone / 底部 drop zone 同理触发垂直滚动(若未来轨道列表高度超过视口)。

---

### 4.11 Undo/Redo 工具栏按钮(P1-11)

- Timeline 顶部工具栏**左侧**(紧邻"添加轨道"按钮)加两颗 icon 按钮。
- 绑定已有的 `store.undo / store.redo / store.canUndo / store.canRedo`。
- 禁用态显示为灰色。
- Tooltip 显示 `撤销 ⌘Z` / `重做 ⌘⇧Z`。
- 全局快捷键 `⌘Z` / `⌘⇧Z` 触发(如果已有就不重复注册)。

---

## 5. 数据结构与 API 变更

### 5.1 `Track` 类型

无新字段,`locked` 原有字段语义扩展(现在所有操作都会检查)。

### 5.2 `OverlayItem` 类型

无新字段。

### 5.3 Store 新增 / 修改方法

```ts
// src/store/timeline.ts
trimOverlayClip(id: string, edge: 'start' | 'end', newMs: number): void
splitOverlayClipsAt(playheadMs: number, targetIds?: string[]): void
createTrackAt(position: 'top' | 'bottom', kind?: TrackKind): string
toggleTrackLocked(trackId: string): void
```

修改:

- `moveOverlayClip`:移除"自动找空位"与"自动新建轨道"逻辑,改为"碰撞即拒绝"。
- `pasteOverlay`:同上策略。
- `deleteOverlayClip` / `moveOverlayClip` / 等所有变更类方法:前置检查目标 `track.locked`。

### 5.4 新增工具文件

- `src/lib/timeline-snap.ts`:磁性对齐计算。
- `src/lib/timeline-autoscroll.ts`:边缘自动滚动 rAF 调度。

### 5.5 修改工具文件

- `src/lib/timeline-placement.ts`:去白名单,按 trackId 分组。
- `src/lib/timeline-view.ts`:新增 `getTimelineVisualEndMs` / `zoomIn` / `zoomOut` / `zoomToFit` / `zoomToPercent`。

---

## 6. 组件变更

| 组件 | 变更 |
| --- | --- |
| `Timeline.tsx` | 尾部留白宽度计算;drop zone 渲染;工具栏按钮;ruler seek;autoscroll |
| `OverlayBlock.tsx` | Trim handle;碰撞红遮罩;锁定态视觉 |
| 新 `TimelineToolbar.tsx`(可选抽出) | 统一工具栏布局 |
| 新 `TrackDropZone.tsx` | Top/Bottom 两个 drop zone |
| 新 `SnapGuides.tsx` | 吸附辅助线覆盖层 |
| 新 `ZoomControls.tsx` | 缩放按钮组 |

---

## 7. 视觉规范

严格遵循项目 `DESIGN.md`:

- 主色:`--color-system-blue` (#0A84FF)
- 危险:`--color-danger` (#FF453A)
- 分隔线:`--color-separator`
- 字号:工具栏按钮文字 `--font-size-sm` (11px)
- 圆角:按钮 `--radius-md` (6px),clip `--radius-sm`
- 间距:工具栏内部 8px,按钮组内 4px
- 无第二彩色 accent,不引入新主题色

---

## 8. 测试策略

**单元测试**(新增 `tests/timeline-*.test.ts`):
- `timeline-placement.test.ts`:覆盖 AI 卡片 / 文本 / 视频的跨类型碰撞。
- `timeline-snap.test.ts`:吸附阈值边界、多目标优先级。
- `timeline-view.test.ts`:`zoomToFit` / `getTimelineVisualEndMs` 纯函数。
- `timeline.split.test.ts`:split 在 clip 中间 / 边缘 / 锁定轨道的行为。
- `timeline.trim.test.ts`:trim 碰撞停止、最小 duration、undo 单次提交。
- `timeline.lock.test.ts`:锁定轨道拒绝变更。
- `timeline.dropzone.test.ts`:drop zone 触发新建轨道。

**手工验收清单**(在 `npm run dev` 下):
1. 缩小到 25% → 右侧能看到一屏空白 → 拖 clip 到空白区仍合法。
2. AI 卡片和视频在同一 visual 轨道上拖拽会互相碰撞红显。
3. 从 visual 轨道拖 clip 到顶部/底部 drop zone → 新轨道出现并落位。
4. 锁定 audio 轨 → 波形半透明、无法拖动;点击解锁后恢复可编辑。
5. 工具栏 `−` / `+` / `100%` / `fit` 按钮行为正确;下拉选百分比生效。
6. Clip 左右 6px hover → col-resize 光标;拖动边缘调节时长;trim 到相邻 clip 硬停。
7. Playhead 落在 clip 中,按 `S` → clip 一分为二;text 类 clip 字幕按比例拆分。
8. 拖拽/trim 时靠近 playhead / 相邻 clip 边缘出现吸附虚线;按 `⌥` 临时禁用。
9. Ruler 区域点击/拖拽 → playhead 跟随。
10. 拖拽 clip 到 timeline 右边缘 → 视图自动水平滚动。
11. 工具栏 undo/redo 按钮禁用态正确,点击恢复状态。

---

## 9. 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 通用碰撞改为"拒绝+回弹"后,老用户流程被打断(原本自动找位) | drop zone 新建轨道正好接住此诉求;上线后在 release notes 说明 |
| 碰撞策略变更可能破坏现有测试 | 全量跑 `npm test`,修复受影响用例;新增碰撞语义的显式测试 |
| Trim + snap + autoscroll 三者同时作用于拖拽事件循环,复杂度高 | 事件处理集中到一个 `useTimelineDrag` hook,状态机式管理 `idle → dragging → trimming` |
| 尾部留白会让 ruler ticks 一直延伸,低 zoom 下 DOM 节点变多 | 配合 `timeline-view` 的 tick interval 动态缩放,单视口刻度总数仍可控 |
| 锁定 UI 和现有 `locked` 语义"只在删除时检查"冲突 | 一次性迁移:所有写操作统一 go through store,集中处理锁检查 |
| AI 卡片参与碰撞后,AI 生成时落位可能失败 | AI 写入走"找空位+必要时新建轨道"的专用路径,不走通用拖拽路径 |

---

## 10. 实施顺序建议

为便于分步验证,建议按如下顺序落地(实现计划会细化):

1. **数据/工具层**:`timeline-placement.ts` 通用化 + `timeline-view.ts` 扩展 + `timeline-snap.ts` 新建
2. **Store**:`trimOverlayClip` / `splitOverlayClipsAt` / `createTrackAt` / `toggleTrackLocked` + 锁检查下沉
3. **渲染基础**:尾部留白 + ruler 延伸
4. **工具栏**:缩放按钮组 + undo/redo 按钮 + snap toggle + split 按钮
5. **交互升级**:锁定 UI → ruler seek → trim handle → snap guides → drop zone → autoscroll
6. **测试补齐 + 手工走查**

---

## 11. 开放问题

目前无。若实现阶段发现数据结构需要扩展(例如 snap 开关要不要持久化到项目文件),在对应 PR 内再议。

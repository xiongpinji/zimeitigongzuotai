# Timeline Pinch Zoom Design

**目标**

为时间线增加 Mac 触控板 pinch 缩放支持，同时保留现有 `Command + 滚轮` 的离散缩放行为。

**现状**

- 时间线缩放入口在 `src/components/Timeline.tsx`
- 缩放算法在 `src/lib/timeline-view.ts`
- 当前仅支持 `metaKey + wheel`
- 缩放值按固定步进 `1.25 / 0.8` 变化

**设计决策**

1. 保留现有 `metaKey && !ctrlKey` 的离散缩放逻辑
2. 新增 `ctrlKey + wheel` 作为 pinch 缩放模式
3. pinch 模式使用连续缩放倍率，不复用固定步进
4. 继续复用现有锚点滚动补偿逻辑，保持缩放中心稳定
5. 不引入 Electron 原生事件或主进程改动，兼容逻辑仅在 renderer 层完成

**缩放模式**

- `metaKey && !ctrlKey`：传统缩放，保持现状
- `ctrlKey`：pinch 缩放，使用连续倍率
- 其他 wheel：不拦截，保持正常滚动

**连续缩放公式**

pinch 缩放使用指数映射：

```ts
nextZoom = clampTimelineZoom(currentZoom * Math.exp(-normalizedDeltaY / sensitivity))
```

说明：

- `normalizedDeltaY` 先按 `deltaMode` 归一化到 pixel 语义
- `sensitivity` 初始取值为 320，用于控制缩放灵敏度
- 微小抖动将被忽略，避免停手时轻微抖动

**锚点策略**

- 优先使用当前事件的 `clientX`
- 如果 `clientX` 不可用，则回退到时间线可视区域中心点
- `pendingScrollLeftRef + useLayoutEffect` 保持不变

**影响文件**

- `src/lib/timeline-view.ts`
  - 新增 wheel 模式识别
  - 新增 delta 归一化
  - 新增连续 pinch 缩放计算
- `src/components/Timeline.tsx`
  - 调整 wheel 事件分流
  - 仅在缩放模式下 `preventDefault`
  - 增加锚点位置兜底
- `tests/timeline-view.test.ts`
  - 补充缩放模式识别
  - 补充连续 pinch 缩放行为

**测试策略**

1. 先为 `timeline-view.ts` 写失败测试
2. 验证 pinch 缩放能连续放大缩小
3. 验证微小抖动被忽略
4. 验证 `metaKey` 与 `ctrlKey` 模式识别正确
5. 保证现有离散缩放测试继续通过

**非目标**

- 不修改时间线视觉样式
- 不修改 Electron 主进程或 preload
- 不处理 Safari 专有 `gesture*` 事件

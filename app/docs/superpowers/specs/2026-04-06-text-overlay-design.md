# 文字叠加功能设计

## 概述

为播客视频编辑器新增文字叠加（Text Overlay）功能，允许用户在素材库中添加文字素材，拖拽到时间轴后在预览区自由定位，通过 Inspector 面板编辑文字属性和动画效果。设计参考剪映等主流视频编辑软件。

## 目标

- 文字作为独立的一等 overlay 类型，与 video/image 平级
- 支持完整的文字样式属性（字体、颜色、描边、阴影等）
- 预览区可拖拽移动和缩放手柄调整大小
- 支持入场、出场、循环三种动画维度
- 素材库提供预设文字模板，降低使用门槛

## 非目标

- 画布上直接编辑文字内容（富文本编辑）——内容在 Inspector 中编辑
- 画布上旋转手柄——旋转在 Inspector 数值控制
- 关键帧动画系统
- 圆角背景
- 富文本（同一文字块内不同部分使用不同样式）

---

## 1. 数据模型

### 1.1 OverlayItem 扩展

`src/types.ts` 中 `OverlayItem.type` 新增 `'text'` 值，新增可选字段 `textData`：

```typescript
interface OverlayItem {
  id: string;
  type: 'video' | 'image' | 'text';  // 新增 'text'
  assetPath: string;                   // text 类型时为空字符串
  trackId: string;
  startMs: number;
  durationMs: number;
  position: OverlayPosition;
  overlayType?: 'media' | 'ai-card';
  overlayRole?: OverlayRole;
  aiCardData?: AICardOverlayData;
  textData?: TextOverlayData;          // 新增
}
```

text overlay 的 `assetPath` 为空字符串。现有的 `isMediaOverlay()` 通过 `Boolean(overlay.assetPath)` 判断，天然排除 text overlay，无需修改。

注意：`OverlayPosition` 的 x/y/width/height 是画布像素坐标（基于 timeline.width × timeline.height，如 1920×1080），不是百分比。Remotion 在一个 `width: timeline.width, height: timeline.height` 的容器内渲染，position 值直接用作 CSS left/top/width/height（px）。

### 1.2 TextOverlayData

```typescript
interface TextOverlayData {
  // 内容
  content: string;

  // 字体
  fontFamily: string;       // 如 'PingFang SC'
  fontSize: number;         // px，基于 1920×1080 画布
  fontColor: string;        // '#FFFFFF'
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textAlign: 'left' | 'center' | 'right';

  // 背景
  backgroundColor: string;  // 'rgba(0,0,0,0.5)' 或 'transparent'

  // 描边
  strokeColor: string;
  strokeWidth: number;      // 0 = 无描边

  // 阴影
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;       // 0 = 无阴影

  // 间距
  letterSpacing: number;    // px
  lineHeight: number;       // 倍数，如 1.5

  // 变换
  opacity: number;          // 0~1
  rotation: number;         // 角度，0~360

  // 动画
  animation: TextAnimation;
}
```

### 1.3 TextAnimation

```typescript
type TextEnterAnimation =
  | 'none' | 'fadeIn' | 'slideInLeft' | 'slideInRight'
  | 'slideInUp' | 'slideInDown' | 'scaleIn' | 'bounceIn';

type TextExitAnimation =
  | 'none' | 'fadeOut' | 'slideOutLeft' | 'slideOutRight'
  | 'slideOutUp' | 'slideOutDown' | 'scaleOut' | 'bounceOut';

type TextLoopAnimation =
  | 'none' | 'pulse' | 'float' | 'flicker' | 'typewriter';

interface TextAnimation {
  enter: TextEnterAnimation;
  enterDurationMs: number;    // 默认 500
  exit: TextExitAnimation;
  exitDurationMs: number;     // 默认 500
  loop: TextLoopAnimation;
}
```

### 1.4 AssetType 扩展

```typescript
type AssetType = 'video' | 'image' | 'audio' | 'srt' | 'text';
```

文字模板的 AssetItem 使用 `path` 作为模板标识（如 `'text-template:heading'`），`type: 'text'`，`durationMs: 5000`。

---

## 2. 组件架构

### 2.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/remotion/TextOverlay.tsx` | Remotion 文字渲染组件，处理样式映射和动画帧计算 |
| `src/components/TextInspector.tsx` | 文字属性编辑面板 |
| `src/components/CanvasInteractionLayer.tsx` | 预览区拖拽/缩放交互覆盖层 |
| `src/lib/text-templates.ts` | 预设模板定义 + `createDefaultTextData()` |
| `src/lib/text-animations.ts` | 动画计算函数（供 TextOverlay.tsx 使用） |
| `src/hooks/useCanvasInteraction.ts` | 拖拽/缩放状态管理与鼠标事件处理 |

### 2.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/types.ts` | OverlayItem.type 新增 'text'、新增 TextOverlayData / TextAnimation 类型、AssetType 新增 'text' |
| `src/components/AssetPanel.tsx` | filter 新增 'text' 分类、渲染文字模板卡片、支持文字模板拖拽 |
| `src/components/PreviewPanel.tsx` | 集成 CanvasInteractionLayer 覆盖在 Player 上方 |
| `src/remotion/PodcastComposition.tsx` | 过滤 text overlays 并用 TextOverlay 组件渲染 |
| `src/components/Timeline.tsx` | 渲染 text overlay blocks（复用现有 OverlayBlock 逻辑） |
| `src/components/EditorInspector.tsx` | InspectorSelection 新增 'text-overlay' 类型，路由到 TextInspector |
| `src/store/timeline.ts` | addOverlay 支持 text 类型、addAsset 支持 text 类型 |

### 2.3 渲染层序（PodcastComposition 内，从底到顶）

1. **Media Overlays** (video / image) — 背景/画面
2. **AI Card Overlays** — 信息卡片
3. **Text Overlays** — 文字叠加（新增）
4. **Subtitle Track** — 字幕（始终最顶层）

### 2.4 Inspector 路由扩展

```typescript
type InspectorSelection =
  | { type: 'empty' }
  | { type: 'ai-card'; cardId: string }
  | { type: 'subtitle-style' }
  | { type: 'text-overlay'; overlayId: string };  // 新增
```

---

## 3. 预览区交互层

### 3.1 方案

在 Remotion Player 上方叠加一个透明的 HTML div（CanvasInteractionLayer），用纯 React/CSS 实现选中框、拖拽和缩放手柄。不引入外部拖拽库。

### 3.2 交互状态机

| 状态 | 触发 | 行为 |
|------|------|------|
| idle | 初始 | 交互层透明，hover overlay 时显示虚线框 + cursor:move |
| selected | 点击 overlay | 蓝色边框 + 8 个缩放手柄，更新 InspectorSelection |
| dragging | mousedown 在框内 | 实时更新 position.x/y（画布像素坐标） |
| resizing | mousedown 在手柄上 | 实时更新 position.width/height + x/y（画布像素坐标） |
| → selected | mouseup | store.updateOverlay() 提交变更 |
| → idle | 点击空白 | 取消选中，清空 InspectorSelection |

### 3.3 缩放手柄

8 个手柄：四角（nw/ne/sw/se）+ 四边中点（n/s/w/e）。视觉样式：白色填充、蓝色描边、10×10px 方块。

### 3.4 坐标换算

```
canvasX = (mouseX - stageFrameRect.left) / stageFrameRect.width * timeline.width
canvasY = (mouseY - stageFrameRect.top) / stageFrameRect.height * timeline.height
```

将屏幕鼠标坐标转换为画布像素坐标（0~1920 / 0~1080 空间）。依赖 PreviewPanel 已有的 `stageSize`（fitPreviewStage 计算结果）和 `.stageFrame` 的 DOM rect。CanvasInteractionLayer 通过 props 接收这些信息。

### 3.5 拖拽约束

- 拖拽和缩放时，文字框不允许完全移出画布边界（至少保留 10% 可见）
- 最小尺寸限制：width 和 height 不小于画布尺寸的 5%

---

## 4. 素材库

### 4.1 入口

AssetPanel 的 filter pill 新增「文字」分类，与现有的「全部/视频/音频/图片」并列。

### 4.2 预设模板

5 个预设模板，每个模板是一组预定义的 TextOverlayData 默认值：

| 模板 | ID | fontSize | fontColor | bold | 特殊属性 |
|------|----|----------|-----------|------|----------|
| 大标题 | `text-template:heading` | 80 | #FFFFFF | true | — |
| 小标题 | `text-template:subheading` | 56 | #FFFFFF | true | — |
| 正文文字 | `text-template:body` | 40 | #E0E0E0 | false | — |
| 字幕条 | `text-template:caption` | 36 | #FFFFFF | false | backgroundColor: rgba(0,0,0,0.6) |
| 花字效果 | `text-template:fancy` | 64 | #FFFFFF | true | strokeColor: #EF4444, strokeWidth: 2 |

### 4.3 文字模板卡片

模板在 AssetPanel 中以 2 列网格展示，每个卡片显示模板名称的视觉预览效果。支持拖拽（draggable），拖拽到时间轴 visual 轨道上创建 text overlay。

### 4.4 拖放创建流程

1. 用户从素材库拖拽文字模板卡片
2. 放到 Timeline 的 visual 轨道上
3. 调用 `store.addOverlay()` 创建 OverlayItem：
   - `type: 'text'`
   - `assetPath: ''`
   - `startMs`: 当前播放位置
   - `durationMs`: 5000（默认 5 秒）
   - `position`: 画布居中
   - `textData`: 模板预设属性值（content 为模板名称占位文字）

---

## 5. TextInspector 面板

### 5.1 布局分区（从上到下）

1. **内容区** — textarea 输入文字内容
2. **字体区** — 字体选择器（系统字体下拉）、字体大小（数值输入）、字体颜色（颜色选择器）、B/I/U 按钮组（toggle）、文字对齐按钮组（左/中/右）
3. **背景区** — 背景颜色选择器（支持透明度）
4. **描边与阴影区** — 描边颜色 + 粗细、阴影颜色 + 偏移X/Y + 模糊
5. **间距区** — 字间距滑块、行间距滑块
6. **变换区** — 透明度滑块（0~100%）、旋转角度滑块（0~360°）
7. **动画区** — 入场动画下拉 + 持续时间、循环动画下拉、出场动画下拉 + 持续时间
8. **操作区** — 删除按钮

### 5.2 数据流

所有属性变更通过 `store.updateOverlay(overlayId, { textData: { ...updates } })` 实时更新。Remotion Player 响应 store 变化自动重渲染，实现即时预览。

---

## 6. 动画系统

### 6.1 时间分配

overlay 的总时长（durationMs）分为三段：

```
|←── enterDurationMs ──→|←── 循环播放区间 ──→|←── exitDurationMs ──→|
startMs                                                    startMs + durationMs
```

### 6.2 入场动画明细

| 动画 | 属性变化 |
|------|----------|
| none | 无动画，直接显示 |
| fadeIn | opacity: 0 → 1 |
| slideInLeft | translateX: -100% → 0, opacity: 0 → 1 |
| slideInRight | translateX: 100% → 0, opacity: 0 → 1 |
| slideInUp | translateY: 100% → 0, opacity: 0 → 1 |
| slideInDown | translateY: -100% → 0, opacity: 0 → 1 |
| scaleIn | scale: 0 → 1, opacity: 0 → 1 |
| bounceIn | spring 弹性缩放 scale: 0 → 1（使用 Remotion spring()） |

### 6.3 出场动画明细

与入场对称的反向动画（fadeOut: opacity 1→0，slideOutLeft: translateX 0→-100% 等）。

### 6.4 循环动画明细

| 动画 | 属性变化 |
|------|----------|
| none | 无循环效果 |
| pulse | opacity 在 0.6~1.0 之间正弦波动 |
| float | translateY 在 -8px~8px 之间正弦浮动 |
| flicker | opacity 在 0.3~1.0 之间快速随机切换 |
| typewriter | 逐字显示，content.slice(0, visibleChars)，循环周期 = 字数 × 100ms |

### 6.5 Remotion 实现

`src/lib/text-animations.ts` 导出核心函数：

```typescript
function getTextAnimationStyle(params: {
  frame: number;
  fps: number;
  durationFrames: number;
  animation: TextAnimation;
}): { style: React.CSSProperties; visibleText?: string }
```

- 入场/出场：使用 Remotion `interpolate()` 线性插值计算 opacity/transform
- bounceIn/Out：使用 Remotion `spring()` 弹性函数
- 循环动画：使用 `Math.sin(frame / fps * Math.PI * 2 / period)` 周期函数
- typewriter：使用 `Math.floor(frame / charsPerFrame)` 计算可见字符数，返回 `visibleText`

---

## 7. Remotion 渲染

### 7.1 TextOverlay 组件

`src/remotion/TextOverlay.tsx`：

```typescript
function TextOverlay({ overlay, fps }: { overlay: OverlayItem; fps: number }) {
  const frame = useCurrentFrame();
  const { textData } = overlay;
  if (!textData) return null;
  const durationFrames = msToFrame(overlay.durationMs, fps);

  // 1. 计算动画状态
  const { style: animStyle, visibleText } = getTextAnimationStyle({
    frame, fps, durationFrames, animation: textData.animation,
  });

  // 2. 映射 textData 到 CSS
  const textStyle: CSSProperties = {
    position: 'absolute',
    left: overlay.position.x,
    top: overlay.position.y,
    width: overlay.position.width,
    height: overlay.position.height,
    fontFamily: textData.fontFamily,
    fontSize: textData.fontSize,
    color: textData.fontColor,
    fontWeight: textData.bold ? 'bold' : 'normal',
    fontStyle: textData.italic ? 'italic' : 'normal',
    textDecoration: textData.underline ? 'underline' : 'none',
    textAlign: textData.textAlign,
    backgroundColor: textData.backgroundColor,
    WebkitTextStroke: textData.strokeWidth > 0
      ? `${textData.strokeWidth}px ${textData.strokeColor}` : undefined,
    textShadow: textData.shadowBlur > 0
      ? `${textData.shadowOffsetX}px ${textData.shadowOffsetY}px ${textData.shadowBlur}px ${textData.shadowColor}` : undefined,
    letterSpacing: textData.letterSpacing,
    lineHeight: textData.lineHeight,
    opacity: textData.opacity,
    transform: `rotate(${textData.rotation}deg)`,
    ...animStyle,  // 动画覆盖 opacity/transform
  };

  // 3. 渲染
  return (
    <Sequence from={msToFrame(overlay.startMs, fps)} durationInFrames={durationFrames}>
      <div style={textStyle}>
        {visibleText ?? textData.content}
      </div>
    </Sequence>
  );
}
```

### 7.2 PodcastComposition 集成

在 PodcastComposition 中新增 text overlays 的过滤和渲染，位于 AI Card 之后、Subtitle 之前：

```typescript
const textOverlays = renderableOverlays.filter((o) => o.type === 'text');

// 渲染顺序：media → aiCard → text → subtitle
{textOverlays.map((overlay) => (
  <TextOverlay key={overlay.id} overlay={overlay} fps={timeline.fps} />
))}
```

---

## 8. Store 改动

### 8.1 TimelineStore

- `addOverlay()`: 已支持任意 OverlayDraft，text overlay 通过传入 `type: 'text'` + `textData` 即可，无需特殊逻辑
- `updateOverlay()`: 已支持 `Partial<OverlayItem>`，更新 textData 时传入 `{ textData: newTextData }` 即可
- `addAsset()`: 需要扩展支持 `type: 'text'`，text 类型无需路径去重（模板是虚拟资产）

### 8.2 素材同步

`syncAssetsWithTimeline()` 需要排除 text overlay（text overlay 不依赖文件资产，不参与 asset 同步）。

---

## 9. 时间轴集成

### 9.1 text overlay block

text overlay 在时间轴上复用现有 OverlayBlock 的渲染逻辑（位置、拖拽、缩放时长），视觉上通过不同的颜色或图标与 video/image block 区分。

### 9.2 选中联动

点击时间轴上的 text overlay block 时，设置 `InspectorSelection` 为 `{ type: 'text-overlay', overlayId }`，打开 TextInspector。同时在预览区的 CanvasInteractionLayer 中显示对应的选中框。

---

## 10. 导出兼容性

text overlay 通过 Remotion 渲染，与现有的 video/image overlay 和 AI card 共用同一个渲染管线。导出时 Remotion 的 `renderMedia()` 会自动包含所有可见的 text overlay，无需额外处理。

---

## 11. 边界情况

- **空内容**：content 为空时，TextOverlay 仍然渲染（显示空白区域），用户可在 Inspector 中输入
- **超长文本**：文字超出 position 定义的区域时，overflow hidden 截断
- **字体缺失**：fontFamily 指定的字体不存在时，浏览器自动 fallback 到默认字体
- **动画时长 > overlay 时长**：enterDurationMs + exitDurationMs 之和不应超过 durationMs，UI 层做校验限制
- **undo/redo**：所有 text overlay 的操作（创建、修改属性、删除、移动）都通过 store 的 history 机制支持撤销/重做

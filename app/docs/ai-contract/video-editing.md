# 视频编辑契约

先读 [README.md](./README.md)（目录结构、会话锁、结果协议、边界）。本域的锁 `scope` 用 `"video"`。

## 改哪两类文件

| 文件 | 改什么 |
| --- | --- |
| `<projectDir>/project.json` → `timeline` 段 | overlay 的时间 / 位置 / 进出场动画、文字图层样式、字幕全局样式 |
| `<projectDir>/ai-cards/<overlayId>/motionCard.tsx` | Motion Card 卡片源码（**不要在 project.json 里改 tsx**） |

所有单位：时间一律**毫秒（ms）**；坐标见 `position` 说明。

`project.json` 顶层结构（见 `src/lib/project-persistence.ts` 的 `ProjectData`）：

```jsonc
{
  "version": 1,
  "createdAt": "...",
  "updatedAt": "...",
  "timeline": { /* TimelineData，本域改这里 */ },
  "aiAnalysis": { /* 勿手改 */ },
  "script": { /* 文稿状态，勿在视频域改 */ }
}
```

`timeline`（`TimelineData`，见 `src/types.ts`）里你会用到的字段：

```jsonc
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "podcast": { "audioPath": "...", "srtPath": "...", "durationMs": 0 }, // 勿手改
  "tracks": [ /* 轨道，勿手改 */ ],
  "overlays": [ /* 见下 */ ],
  "subtitle": { /* 字幕全局样式，见下 */ }
}
```

## overlays[]：每个叠加项可改字段

`timeline.overlays` 是一个数组，每项是一个 `OverlayItem`（`src/types.ts`）。可改字段：

| 字段 | 类型 / 单位 | 可改 | 约束 |
| --- | --- | --- | --- |
| `id` | string | **勿改** | overlay 唯一标识；也是 `ai-cards/<id>/` 目录名 |
| `type` | `"video"` \| `"image"` \| `"text"` \| `"audio"` | 慎改 | overlay 的素材类型，一般不动 |
| `assetPath` | string | 慎改 | 素材路径（相对 projectDir），一般不动 |
| `trackId` | string | 慎改 | 所在轨道 id，移动轨道才改 |
| `startMs` | number, ms | 是 | `>= 0`（负值会被拒） |
| `durationMs` | number, ms | 是 | `> 0`（0 或负会被拒） |
| `position` | object | 是 | 见下 `position` |
| `motion` | object \| 缺省 | 是 | 见下 `motion` |
| `overlayType` | `"media"` \| `"ai-card"` | 勿改 | `"ai-card"` 表示这是 Motion/信息卡 |
| `textData` | object（仅 `type:"text"`） | 是 | 见下 `textData` |
| `audioData` | object（仅 `type:"audio"`） | 是 | 见下 `audioData` |
| `aiCardData` | object（仅 ai-card） | 慎改 | 卡片数据；Motion 卡源码请改 `.tsx` 文件，不要在这里改 |

### position（`OverlayPosition`）

```jsonc
"position": { "x": 0, "y": 0, "width": 1920, "height": 1080 }
```

`x` / `y` / `width` / `height` 单位是画布像素（画布尺寸即 `timeline.width` × `timeline.height`，默认 1920×1080）。`x`/`y` 是左上角坐标。

### motion（`OverlayMotion`）—— overlay 进出场动画

```jsonc
"motion": {
  "enter": "fadeIn",
  "enterDurationMs": 800,
  "exit": "fadeOut",
  "exitDurationMs": 600,
  "loop": "none"
}
```

`enter` / `exit` / `loop` 是**枚举**，必须取下表合法值之一（来源：`src/lib/external-edit-validate.ts` + `src/types.ts`）。非法 `enter` / `exit` 会被校验拒绝（`edit-result.json` 里 `ok:false`）。

- **enter（进场）**：`none` · `fadeIn` · `slideInLeft` · `slideInRight` · `slideInUp` · `slideInDown` · `scaleIn` · `bounceIn`
- **exit（出场）**：`none` · `fadeOut` · `slideOutLeft` · `slideOutRight` · `slideOutUp` · `slideOutDown` · `scaleOut` · `bounceOut`
- **loop（循环强调，`OverlayLoopAnimation`）**：`none` · `pulse` · `float` · `flicker`（注意：overlay 的 loop 不含 `typewriter`）
- `enterDurationMs` / `exitDurationMs`：number，毫秒。

> `motion` 字段可整体缺省（无进出场动画）。若存在，校验只检查 `enter` / `exit` 的枚举合法性；时长不做枚举校验，但请填非负毫秒值。

### textData（`TextOverlayData`，仅 `type:"text"`）

文字图层样式字段（`src/types.ts`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content` | string | 文字内容 |
| `fontFamily` | string | 字体族 |
| `fontSize` | number | 字号（px） |
| `fontColor` | string | 文字颜色，如 `"#FFFFFF"` |
| `bold` / `italic` / `underline` | boolean | 粗体 / 斜体 / 下划线 |
| `textAlign` | `"left"` \| `"center"` \| `"right"` | 对齐 |
| `backgroundColor` | string | 文字框背景色 |
| `strokeColor` / `strokeWidth` | string / number | 描边色 / 宽度 |
| `shadowColor` / `shadowOffsetX` / `shadowOffsetY` / `shadowBlur` | string / number | 阴影 |
| `letterSpacing` / `lineHeight` | number | 字距 / 行高 |
| `opacity` | number | 不透明度 0..1 |
| `rotation` | number | 旋转角度（度） |
| `animation` | object（`TextAnimation`） | 文字自身动画，见下 |

`textData.animation`（`TextAnimation`）字段与 `motion` 同构，但**进出场枚举集相同、loop 多一个 `typewriter`**：

```jsonc
"animation": {
  "enter": "fadeIn",        // 同 enter 枚举集
  "enterDurationMs": 600,
  "exit": "none",           // 同 exit 枚举集
  "exitDurationMs": 0,
  "loop": "typewriter"      // none | pulse | float | flicker | typewriter
}
```

### audioData（`AudioOverlayData`，仅 `type:"audio"`）

| 字段 | 类型 / 单位 | 说明 |
| --- | --- | --- |
| `volume` | number | 线性音量 `0..1.5`，1 为原始响度 |
| `fadeInMs` / `fadeOutMs` | number, ms | 淡入 / 淡出时长 |
| `trimStartMs` | number, ms | 源音频裁剪起点 |
| `sourceDurationMs` | number, ms | 源音频总时长（UI 上限用），勿乱改 |
| `muted` | boolean（可选） | 静音 |

## 字幕全局样式：timeline.subtitle（`SubtitleStyle`）

口播字幕是全局统一样式，改 `timeline.subtitle`（`src/types.ts`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `fontSize` | number | 字号（px），默认 48 |
| `color` | string | 文字颜色，默认 `"#FFFFFF"` |
| `position` | `"top"` \| `"bottom"` \| `"center"` | 屏幕位置，默认 `"bottom"` |
| `highlightEnabled` | boolean | 是否启用关键词高亮 |
| `highlightBackgroundColor` | string | 高亮底色 |
| `highlightTextColor` | string | 高亮文字色 |
| `highlightPaddingX` / `highlightPaddingY` | number | 高亮内边距 |
| `highlightRadius` | number | 高亮圆角 |
| `highlightAnimation` | `"pop"` \| `"wipe"` \| `"none"` | 高亮动画 |
| `maxCharsPerEntry` | number | 单条字幕最大字符数，超出自动切分，默认 35（范围 20~60） |
| `autoResegment` | boolean | 是否自动切分，默认 true |

## Motion Card：改独立的 `.tsx` 文件

Motion Card 是 LLM 生成的**自由 Remotion TSX 组件**。源码**外置**到独立文件，`project.json` 里只存引用，不存源码：

- `project.json` → 该 overlay 的 `aiCardData.motionCard.tsxPath`（形如 `"ai-cards/<overlayId>/motionCard.tsx"`）只是**指针**，不要在 json 里写 tsx 源码。
- 真正改：编辑 `<projectDir>/ai-cards/<overlayId>/motionCard.tsx` 这个文件。
- 改完编辑器会**只重编译这一张卡**并刷新预览（不影响其它卡）。

### motionCard.tsx 硬约束

来源：`src/remotion/compile-card.ts` 的 `validateCardTsx` / `stripCodeFences`，以及 Remotion 运行上下文。

1. **不要包 code fence**：文件首尾不要写 \`\`\`tsx … \`\`\`。文件就是纯 TSX 源码。
2. **必须有 `export default`** 一个 React / Remotion 函数组件（校验只认 `export default`，命名 default export 也可，但必须是会渲染出 JSX 的组件）。
3. 组件须真的**渲染 JSX**（要有 `<.../>` 标签），不能只 `return null` 或只搭骨架——否则预览会回退到占位卡。
4. **可用的 Remotion API**：组件在 Remotion 渲染上下文内求值，可用 `remotion` 的 hooks/组件，如 `useCurrentFrame()`、`useVideoConfig()`、`interpolate`、`spring`、`<AbsoluteFill>`、`<Sequence>` 等。优先用 `useCurrentFrame()` 驱动动画（帧驱动，而非真实时间/`setInterval`）。
5. 预览与导出用**同一份编译产物**；保持组件纯函数、无副作用、无外部网络请求。

示例骨架（仅示意结构，不是要你照抄内容）：

```tsx
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

export default function Card() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity }}>
      <div style={{ fontSize: 96, color: '#fff' }}>示例标题</div>
    </AbsoluteFill>
  );
}
```

## 两个具体示例

**示例 A：把某 overlay 的进场动画改成淡入、时长 800ms。**
在 `project.json` 找到目标 `timeline.overlays[i]`，改它的 `motion`：

```jsonc
"motion": {
  "enter": "fadeIn",
  "enterDurationMs": 800,
  "exit": "fadeOut",
  "exitDurationMs": 600,
  "loop": "none"
}
```

若该 overlay 原本没有 `motion` 字段，可新增整段。改完读 `.lingji/edit-result.json` 确认 `ok:true`。

**示例 B：调整某张 Motion Card 的动画。**
不要动 `project.json`。打开 `<projectDir>/ai-cards/<overlayId>/motionCard.tsx`，修改组件里用 `useCurrentFrame()` 计算的动画逻辑（例如改 `interpolate` 的输入帧区间让进场更快），保存即可。编辑器只重编译这张卡并刷新预览。

> 改完务必按 README 的会话锁协议：编辑前写锁、超时续心跳、编辑后删锁；改 `project.json` 后查 `edit-result.json`。

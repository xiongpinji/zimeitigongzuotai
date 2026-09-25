# 渲染引擎迁移设计：HyperFrames → Remotion

- 日期：2026-06-03
- 状态：草案（待用户复核）
- 作者：协作设计（用户 + Claude）

## 1. 背景与动机

当前 `灵机剪影` 的视频预览与导出由 HyperFrames 0.6 驱动：`TimelineData` 在导出前被编译为 HyperFrames 的 `index.html`（HTML + 内联 GSAP），预览通过 `@hyperframes/player` web component 加载同一套 HTML，导出通过 HyperFrames CLI + 无头 Chrome + ffmpeg 渲染为 H.264 MP4。AI Motion Card 是由 LLM 生成的任意 HTML + CSS + GSAP 片段（`motionCard.html`），在 composition 中被脚本隔离后注入主 GSAP 时间线。

用户判断 HyperFrames 不好用，决定切换回 Remotion（React / 帧驱动渲染）。

> 注意：项目根 `CLAUDE.md` 现有铁律「不允许重新引入 Remotion 作为 fallback」。本设计**显式推翻**该历史决策，迁移完成后必须改写 CLAUDE.md 对应章节。这是有意为之的方向反转，不是疏漏。

## 2. 决策基线（已与用户确认）

| 决策点 | 选择 |
| --- | --- |
| 推进方式 | **一次性硬切换**：完成后移除 `hyperframes` / `@hyperframes/player` 及相关代码，不保留双引擎或 feature flag |
| AI 卡片形态 | **AI 生成自由 TSX**：LLM 产出任意 Remotion/React 函数组件，运行时用 esbuild 编译；预览与导出共用同一编译产物 |
| 预览 | `@remotion/player` |
| 导出 | `@remotion/bundler` + `@remotion/renderer`（自带 Chrome Headless Shell + ffmpeg） |
| 许可证 | 用户已知晓 Remotion 商业 Company License 要求并接受，自行处理授权 |
| 旧 HTML+GSAP 卡片 | 加载旧 `project.json` 时降级为「需重新生成」占位，不崩溃（默认决策，可override） |
| 自由 TSX eval 隔离 | 卡片渲染隔离到独立 sandbox `<iframe>`，主渲染进程 CSP 保持严格（默认决策，可override） |

`TimelineData` 仍是唯一编辑器数据源，导出前编译为 Remotion 组件树。

## 3. 架构总览

```text
TimelineData (src/types.ts, 不变)
  → src/remotion/MainComposition.tsx  (取代 src/hyperframes/composition.ts 的 HTML 生成)
      → timeline-to-sequences: overlay → <Sequence> 映射
      → overlays/*: Video/Image/Text/Audio/Subtitle/AICard 组件
      → AI 卡片: esbuild(TSX) → 动态加载组件
  → 预览: @remotion/player <Player lazyComponent={...}>
  → 导出: @remotion/bundler bundle() → @remotion/renderer renderMedia() → H.264 MP4
```

预览与导出共用同一套 `src/remotion/` 组件与同一份编译后的卡片产物，保证「所见即所得」。

## 4. 新增模块（renderer 侧 Remotion 工程）

```text
src/remotion/
  Root.tsx                      // registerRoot + <Composition id="lingji-composition">
  MainComposition.tsx           // TimelineData → 组件树根（取代 composition.ts）
  timeline-to-sequences.tsx     // overlay → <Sequence from durationInFrames> 映射
  overlays/
    VideoOverlay.tsx            // <OffthreadVideo>（导出）/<Video>（预览），object-fit cover
    ImageOverlay.tsx            // <Img>
    TextOverlay.tsx             // 样式 div + interpolate() 淡入淡出、描边、阴影、旋转
    AudioOverlay.tsx            // <Audio volume startFrom>，含 trim/volume 映射
    SubtitleLayer.tsx           // SRT → 关键词高亮（移植现有逻辑）
    AICardOverlay.tsx           // 动态加载编译后的卡片组件，sandbox iframe 隔离
  compile-card.ts               // esbuild: TSX → JS 模块（react/remotion 作 external）
  load-card-component.ts        // 预览侧：编译产物 → 组件（sandbox iframe + postMessage 桥）
  frames.ts                     // ms ↔ frame 工具（依据 fps）
```

### 4.1 Timeline → Remotion 映射要点

| Overlay 类型 | Remotion 原语 | 关键处理 |
| --- | --- | --- |
| `video` | `<OffthreadVideo>`/`<Video>` in `<Sequence>` | 导出用 OffthreadVideo；trim、muted、object-fit cover |
| `image` | `<Img>` in `<Sequence>` | object-fit cover |
| `text` | 样式 `<div>` in `<Sequence>` | 字体/描边/阴影/旋转/letter-spacing/line-height；fade 用 interpolate(frame) |
| `audio` | `<Audio>` in `<Sequence>` | volume(0–1.5)、startFrom（trim）、muted |
| `ai-card` | `<AICardOverlay>` in `<Sequence>` | 动态加载编译组件；fullscreen/pip 定位 |
| subtitle | `<SubtitleLayer>` | SRT 切分、关键词高亮、位置/样式；z-index 最高 |

- z-index：背景 1 → 视觉轨 10+order → 字幕 1000（移植现有 `getTrackZIndex`）。
- fade-in/out：现有 0.18–0.45s 基于时长 → 转成帧区间 `interpolate(frame, [in], [0,1])`。
- 资源路径：预览用 `file://`/`staticFile`；导出用 bundle 可达路径（见 §6）。

## 5. AI 卡片编译/加载链路（最高风险）

1. **生成**：改写 `motion.system`/`motion.generate`/`motion.modify`/`motion.autofix` 提示词，要求 LLM 输出 **default export 的 Remotion 函数组件**，约定可用 `import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill, Sequence } from 'remotion'`，通过 `props` 接收数据/资源。
2. **编译**：`compile-card.ts` 用 esbuild 将 TSX → ESM/IIFE，`react` 与 `remotion` 设为 external（运行时注入）；捕获语法/编译错误 → 喂给 `motion.autofix` 重试。`src/lib/motion-compiler.ts` 由「GSAP 校验」改为「TSX 编译校验」（保留对外 `MotionCompileResult` 形态以减少调用方改动）。
3. **预览加载**：编译产物在**独立 sandbox `<iframe>`** 内求值（注入 React/Remotion），通过 `postMessage`/共享时间码与外层 `<Player>` 同步当前帧；主渲染进程 CSP 不放宽。
4. **导出加载**：卡片 TSX 作为源文件写入 Remotion bundle 源目录，随 `bundle()` 一起打包，`MainComposition` 引用之。
5. **错误/降级**：编译失败 → autofix 重试 N 次仍失败则渲染占位卡片并记录 `compileError`。

### 5.1 旧卡片迁移

加载旧 `project.json`（`motionCard.html` 为 HTML+GSAP）时：检测到旧格式 → 标记 `needsRegeneration` → 渲染「需重新生成」占位，不崩溃；Inspector 提供「重新生成为 Remotion 卡片」入口。

## 6. 导出链路（取代 prepareHyperframesProject + render-video）

```text
electron/remotion/
  bundle.ts     // @remotion/bundler 打包 src/remotion，注入卡片 TSX → serveUrl（带缓存）
  render.ts     // @remotion/renderer renderMedia(): H.264 MP4，onProgress 回传统一进度系统
```

- IPC `render-video`（`electron/main.ts:2399`）重写：**入参与返回值尽量不变**（timeline + srtEntries），内部改走 bundle → renderMedia。三件套（main/preload/electron-api）同步。
- 资源：移植 `src/hyperframes/assets.ts` 的相对/绝对路径解析与 materialize 逻辑，输出 Remotion 可达路径（`staticFile`/`public/`）。
- 进度：`renderMedia` 的 `onProgress` + bundle 阶段接入 `src/store/task-progress.ts`（遵循 PROGRESS-SPEC，避免冷启动「假死」）。
- Remotion 自带 ffmpeg 与 Chrome Headless Shell，**取代** HyperFrames CLI 与 gsap/chrome 运行时预检。

## 7. 删除 / 裁剪 / 改造清单

**删除：**
- `src/hyperframes/{composition,assets,types}.ts`
- `src/components/HyperframesPreviewPlayer.tsx`
- `electron/hyperframes-cli.ts`
- `electron/hyperframes-runtime-preflight.ts` 及 IPC `hyperframes-runtime-preflight`

**裁剪：**
- `electron/runtime-binaries.ts`：删除 gsap/chrome 解析与 hyperframes PATH 构建；**保留 `resolveFfmpegPath`/`resolveFfprobePath`**（`electron/card-media-handlers.ts` 仍依赖）。

**改造：**
- `src/lib/motion-compiler.ts`：GSAP 校验 → TSX 编译校验
- `src/lib/ai-analysis.ts`、`src/lib/single-card-generation.ts`：卡片产物 html → tsx
- `src/components/PreviewPanel.tsx`、`src/lib/playback.ts`：接 `@remotion/player`
- `src/components/AICardInspector.tsx`：motion 表单与重生成入口
- `src/pages/Editor.tsx`：预览与导出调用点
- `src/lib/prompts/defaults.ts`：motion.* 提示词改为产出 Remotion TSX
- `src/lib/electron-api.ts`、`electron/preload.ts`、`electron/main.ts`：IPC 三件套同步

**类型：**
- `src/types/motion.ts`：`MotionCardPayload.html` → `tsx`（+ 可选编译产物缓存与 `needsRegeneration`）
- `src/types/ai.ts`：AICard 中 motion 字段同步
- `src/vite-env.d.ts`：去 hyperframes 声明，加 Remotion 必要声明

**依赖：**
- 移除：`hyperframes`、`@hyperframes/player`
- 新增：`remotion`、`@remotion/player`、`@remotion/bundler`、`@remotion/renderer`、`esbuild`（pin 最新 4.x）

**文档：**
- 改写 `CLAUDE.md`「HyperFrames 导出约束」章节，删除「不允许重新引入 Remotion」铁律，替换为 Remotion 导出约束。
- 按 `release_changelog_rule` 记忆：发版时同步 CHANGELOG.md 与 Release notes。

## 8. 测试策略

- `tests/hyperframes-composition.test.ts` → 重写为 `tests/remotion-composition.test.ts`（TimelineData → Sequence 映射纯函数断言）。
- 新增 `tests/compile-card.test.ts`：TSX 编译成功/失败/autofix 喂回。
- `tests/motion-card-scope.test.ts`（当前未跟踪）：重定向到 sandbox iframe 隔离方案。
- `tests/ai-analysis.test.ts`：随卡片产物字段变更更新。
- 导出链路：跑相关测试 + 一次 `npm run build`；手动验收一次真实 MP4 导出（预览/导出帧一致性抽查）。

## 9. 已知风险

1. **自由 TSX 运行时编译 + eval（最大风险）**：每卡片一次 esbuild 的性能；sandbox iframe 与 `<Player>` 帧同步的正确性；预览/导出两条加载路径必须等价。
2. **旧项目 motion card 失效**：已接受，需降级占位而非崩溃。
3. **Remotion bundle 冷启动慢**：首次导出 bundle 秒级开销，必须接进度系统。
4. **Electron 安全边界**：sandbox iframe 的 CSP/通信桥需谨慎，属 CLAUDE.md 高风险项。
5. **共享类型变更**：`MotionCardPayload` 变更牵动持久化与迁移，需覆盖新工程/旧工程迁移测试。

## 10. 验收标准

- 预览（`@remotion/player`）可播放含 video/image/text/audio/字幕/AI 卡片的时间线。
- 导出产出 H.264 MP4，画面与预览一致。
- AI 生成自由 TSX 卡片在预览与导出中均正确渲染；编译失败有 autofix + 占位降级。
- 旧 HTML+GSAP 卡片项目可加载（占位降级），不崩溃。
- `hyperframes` / `@hyperframes/player` 依赖与代码已移除。
- `npm test` 与 `npm run build` 通过。

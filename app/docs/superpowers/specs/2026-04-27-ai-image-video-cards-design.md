# AI 图片卡 / 视频卡 设计文档

- 起草日期：2026-04-27
- 状态：草案待评审
- 作者：yoqu + Claude
- 关联：`2026-04-13-ai-analysis-segment-pipeline-design.md`、`2026-04-18-image-generation-providers-design.md`、`2026-04-21-ai-cover-image-editor-design.md`、`2026-04-12-motion-card-dynamic-remotion-design.md`

## 1. 目标

在不破坏现有 6 种 AI 内容卡片（`summary / data / insight / chapter / quote / motion`）的前提下，向编辑器的 AI 内容卡体系新增两种类型：

- **图片卡（`image`）**：通过 AI 图像生成（Vidu 之外的现有 image-gen 注册表，第一期主用 apimart）产出一张静态图，作为时间线 overlay 显示。
- **视频卡（`video`）**：通过 AI 文生视频模型（第一期接入 Vidu，留位 Kling / Runway / MiniMax video）产出 4-8s 的短视频，作为时间线 overlay 播放。

第一期专注**手动触发**（用户在 cards 列表 / 时间线右键创建），不进入 AI Plan 自动决策环节。

## 2. 非目标

- 不做 AI Plan 阶段对图片 / 视频卡的自动编排。
- 不做图生视频（reference image → video），第一期仅文生视频；接口字段保留位。
- 不做视频循环、末帧冻结、倒放、变速等高级播放控制。
- 不做生成产物的多版本快照（image.v1, image.v2）。
- 不为视频卡引入音轨——AI 生成的视频强制 `muted`，podcast 旁白保持唯一音源。
- 不重写现有 6 种文本 / motion 卡的渲染或数据结构。

## 3. 整体架构

```
类型契约 (src/types/ai.ts)
  ├─ AICardType 扩容为 8 种 (+image, +video)
  ├─ AICard.content 联合扩展 MediaCardContent
  ├─ ImageProvider 体系不变；新增 VideoProvider 体系
  └─ AISettings 新增 videoProviders 三件套

提示词 (src/lib/prompts/)
  ├─ defaults.ts: 新增 card.image、card.video 默认模板
  ├─ types.ts: PromptKind 联合扩展
  └─ binding-resolver.ts: 新 kind → image/video provider 解析

生成层
  ├─ src/lib/image-gen/  (现有，不动) — 服务 cover.regeneration + card.image
  └─ src/lib/video-gen/  (新建) — 服务 card.video
       ├─ types.ts / errors.ts / progress.ts / async-poller.ts (镜像 image-gen)
       ├─ registry.ts
       └─ providers/vidu.ts (第一期唯一 adapter)

主进程 IPC (electron/main.ts + preload.ts + electron-api.ts)
  ├─ generate-card-image
  ├─ generate-card-video
  ├─ cancel-card-media-generation
  ├─ delete-card-media-assets
  └─ card-media-progress (推送)

状态层 (src/store/ai.ts)
  ├─ createImageCard / createVideoCard
  ├─ regenerateCardMedia / cancelCardMediaGeneration
  └─ deleteCard 扩展资产清理

UI 层
  ├─ AICardList: image/video 缩略图 + 状态徽章
  ├─ AICardInspector: ImageCardForm / VideoCardForm
  ├─ AICardEditModal: 复用上述 Form
  ├─ cards 列表「转为图片卡 / 视频卡」入口
  ├─ 时间线右键「在此插入图片卡 / 视频卡」入口
  └─ Settings: 新增「视频 Provider」分组 + card.image / card.video 提示词页

时间线 + Remotion
  ├─ overlayType='ai-card' 不变；aiCardData 透传 MediaCardContent
  ├─ AICardOverlay 派发：image → <Img>; video → <OffthreadVideo muted>
  └─ remotion-assets.ts: 新媒体资产沿用 absolute → public 映射

持久化
  ├─ project.json 的 aiAnalysis.cards 自动包含新结构（无 schema 迁移）
  ├─ ai-cards/<cardId>/{image.png,video.mp4,poster.jpg,meta.json}
  └─ 删卡时清理整个目录
```

**关键不变量**：
- `AICardOverlay` 是唯一渲染 dispatcher，只新增分支不破坏既有路径。
- 图像 / 视频 Provider 通过相同的 `binding-resolver` 入口解析。
- 所有耗时操作走 `task-progress` 统一进度系统（项目铁律）。
- 本特性不沾染 `editorAgent.readOnly` / `streamingActive`（仅约束脚本 AI 编辑动画）。

## 4. 数据契约

### 4.1 AICardType 扩展

```ts
// src/types/ai.ts
export type AICardType =
  | 'summary' | 'data' | 'insight' | 'chapter' | 'quote' | 'motion'
  | 'image' | 'video';

export type AICardMediaType = 'image' | 'video';
```

### 4.2 MediaCardContent 与 AICard.content 联合

```ts
export interface MediaCardContent {
  mediaType: AICardMediaType;
  /** 相对 projectDir，例：'ai-cards/<cardId>/image.png' */
  assetPath: string | null;
  /** 仅 video：首帧海报，用于 Inspector / 列表缩略图 */
  posterPath?: string | null;
  /** 仅 video：生成产物的真实时长（ms） */
  mediaDurationMs?: number;
  /** 字段类型为 ImageAspectRatio；video 卡运行时仅接受 '16:9' | '9:16' | '1:1' 子集，由 form 与 IPC handler 双向校验 */
  aspectRatio: ImageAspectRatio;
  /** 当前生效 prompt；可被用户独立编辑 */
  prompt: string;
  negativePrompt?: string;
  /** 生成时绑定的 provider id（image 或 video） */
  providerId: string | null;
  model: string | null;
  generationStatus: 'idle' | 'pending' | 'generating' | 'ready' | 'failed' | 'cancelled';
  errorMessage?: string;
  generatedAt?: number;
  /** provider 特定参数：vidu 的 duration 档位 / style；apimart 的 size 等 */
  extraParams?: Record<string, unknown>;
}

export interface AICard {
  id: string;
  segmentId: string;
  type: AICardType;
  title: string;
  content: string | DataContent | MediaCardContent; // ← 扩展
  startMs: number;
  endMs: number;
  displayDurationMs: number;
  displayMode: AICardDisplayMode;
  template: string;
  enabled: boolean;
  style: CardStyle;
  renderMode?: AICardRenderMode; // image/video 卡固定走 'legacy'
  cardPrompt?: string;
  motionCard?: MotionCardPayload;
}

export function isMediaContent(value: unknown): value is MediaCardContent {
  return !!value && typeof value === 'object'
    && 'mediaType' in value && 'aspectRatio' in value && 'generationStatus' in value;
}

export function isMediaCardType(t: AICardType): t is 'image' | 'video' {
  return t === 'image' || t === 'video';
}
```

### 4.3 AICardOverlayData 透传

```ts
export interface AICardOverlayData {
  sourceCardId?: string;
  cardType: AICardType;
  title: string;
  content: string | DataContent | MediaCardContent; // ← 扩展
  template: string;
  displayMode: AICardDisplayMode;
  style: CardStyle;
  renderMode?: AICardRenderMode;
  cardPrompt?: string;
  motionCard?: MotionCardPayload;
  sourceStartMs?: number;
  sourceEndMs?: number;
}
```

`buildAICardOverlayData` 仅做 content 透传，无须为 media 类型特判。

### 4.4 视频 Provider 契约（`src/lib/video-gen/types.ts`）

```ts
export type VideoProviderType =
  | 'vidu' | 'kling' | 'runway' | 'minimax_video' | 'custom';

export type VideoAspectRatio = '16:9' | '9:16' | '1:1';

export interface VideoProviderCapabilities {
  aspectRatios: VideoAspectRatio[];
  /** 支持的固定时长档位（秒） */
  durationOptions: number[];
  maxResolution: '720p' | '1080p';
  supportsImageToVideo: boolean; // 第一期不接，留位
  isAsync: boolean;
  defaultModels: string[];
}

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number; // 必须 ∈ capabilities.durationOptions
  referenceImageUrl?: string; // 第一期未使用
  extraParams?: Record<string, unknown>;
}

export interface VideoGenerationResult {
  videoUrl: string;
  posterUrl?: string;
  durationMs: number;
  width: number;
  height: number;
  raw?: unknown;
}

export interface VideoProviderConfig {
  baseUrl: string;
  apiKey: string;
  extras?: Record<string, unknown>;
}

export interface VideoGenerationContext {
  taskId: string;
  signal: AbortSignal;
  onProgress: (u: { percent?: number; phase?: string; message?: string }) => void;
}

export interface VideoGenerationProvider {
  readonly type: VideoProviderType;
  readonly capabilities: VideoProviderCapabilities;
  generate(
    req: VideoGenerationRequest,
    config: VideoProviderConfig,
    ctx: VideoGenerationContext,
  ): Promise<VideoGenerationResult>;
}
```

### 4.5 VideoProvider 配置类型与 AISettings 扩展

```ts
// 加入 src/types/ai.ts
export interface VideoProvider {
  id: string;
  name: string;
  type: VideoProviderType;
  baseUrl: string;
  apiKey: string;
  models: string[];
  extras?: Record<string, unknown>;
}

export interface AISettings {
  // ... 现有字段保持不变
  videoProviders: VideoProvider[];
  defaultVideoProviderId: string | null;
  defaultVideoModel: string | null;
}
```

### 4.6 PromptBinding 扩展

```ts
export interface PromptBinding {
  providerId: string | null;
  model: string | null;
  // 仅 cover.regeneration / card.image 写入
  imageProviderId?: string | null;
  imageModel?: string | null;
  // 仅 card.video 写入（新增）
  videoProviderId?: string | null;
  videoModel?: string | null;
}
```

### 4.7 PromptKind 扩展

```ts
// src/lib/prompts/types.ts
export type PromptKind =
  | 'planning.segment'
  | 'cover.regeneration'
  | 'cards.segment'
  | 'script.review'
  | 'motion.system' | 'motion.generate' | 'motion.modify' | 'motion.autofix'
  | 'card.image'  // 新增
  | 'card.video'; // 新增
```

`card.image` 默认模板起点 = `cover.regeneration` 内容 + segment 上下文变量（标题、摘要、关键词、转录摘录、displayMode）。`card.video` 在该基础上加镜头运动 / 转场 / 时长指引。

### 4.8 project.json 兼容性

- `aiAnalysis.cards` 数组结构不变，新卡片的 `type='image'|'video'`、`content` 是 `MediaCardContent`。
- 旧项目无 image/video 卡 → 反序列化无影响。
- 新项目被旧版本应用打开 → `AICardOverlay` 走兜底 placeholder + 一次 warning 提示更新版本，不阻塞。

## 5. 生成链路与 IPC 契约

### 5.1 端到端流程

```
[Renderer]
  AICardInspector → store/ai.ts: regenerateCardMedia(cardId)
    ├─ 解析 binding (card.image / card.video)
    ├─ task-progress.startTask({ id: 'card-media-<cardId>', label: ... })
    ├─ electronAPI.generateCardImage / generateCardVideo → IPC
    └─ 监听 'card-media-progress' → updateTask
                                 ↓
[Main]
  ipcMain.handle('generate-card-image' | 'generate-card-video')
    ├─ 校验 projectDir / cardId / binding
    ├─ 创建 ai-cards/<cardId>/ 目录
    ├─ image: image-gen registry → provider.generate → 下载到 image.png
      video: video-gen registry → provider.generate → 下载到 video.mp4
              + ffmpeg 抽首帧到 poster.jpg + ffprobe 读时长 / 宽高
    ├─ 写 meta.json（prompt / model / provider / generatedAt / extras）
    ├─ webContents.send('card-media-progress', { ... })
    └─ return MediaCardContent
```

### 5.2 IPC 通道

| 通道 | 方向 | 入参 | 返回 |
|---|---|---|---|
| `generate-card-image` | invoke | `{ projectDir, cardId, prompt, negativePrompt?, aspectRatio, providerId?, model?, extraParams? }` | `MediaCardContent` |
| `generate-card-video` | invoke | `{ projectDir, cardId, prompt, negativePrompt?, aspectRatio, durationSeconds, providerId?, model?, extraParams? }` | `MediaCardContent` |
| `cancel-card-media-generation` | invoke | `{ cardId }` | `{ ok: true }` |
| `delete-card-media-assets` | invoke | `{ projectDir, cardId }` | `{ ok: true }` |
| `card-media-progress` | send | `{ cardId, percent, phase, message, taskId }` | — |

`providerId / model` 不传时主进程通过 `binding-resolver` 回退 `card.image` / `card.video` 绑定 → 全局默认。每条通道严格遵守 IPC 三件套（main + preload + electron-api 同步）。

### 5.3 路径与导出映射

- 主进程返回绝对路径，Renderer 写入 store 时立刻转换为相对 projectDir 路径，避免项目移动后失效。
- 时间线预览 + Remotion 导出走 `src/lib/remotion-assets.ts` 的 `resolveProjectAsset`，新增 `mediaContent.assetPath` 解析分支。
- 导出阶段 `prepareRemotionPublicDir` 把 `ai-cards/<id>/{image.png,video.mp4,poster.jpg}` 链入临时 public 目录。

### 5.4 取消 / 错误 / 重试

- 取消：renderer → `cancel-card-media-generation` → 主进程通过 `cardId → AbortController` 表 abort，`generationStatus='cancelled'`，已下载部分清理。
- 错误：provider 抛 `ImageGenerationError` / `VideoGenerationError` → 主进程包成 `{ code, message }` → store 落 `failed` + `errorMessage` → UI 重试按钮。
- 重试：复用同 IPC，覆盖原资产前先清旧 `image.png` / `video.mp4` / `meta.json`。
- 并发：允许多张卡同时生成；同一 cardId 主进程串行（后请求 abort 前请求）。

### 5.5 进度 phase 词表

| phase | 含义 |
|---|---|
| `submitting` | 已发请求，等待 provider 接受 |
| `queued` | provider 排队中 |
| `rendering` | 模型生成中 |
| `downloading` | 远端 URL 拉到本地 |
| `postprocessing` | 仅 video，抽首帧 / 探时长 |

`task-progress` 显示 `${phase} · ${percent}%`，Inspector 内联进度条同步。

### 5.6 成本提示

视频生成单次成本远高于图片。点击「生成视频卡」时弹一次确认（"将调用 vidu 生成 6s 视频，是否继续？"），勾选「不再提示」后用 `localStorage` 记忆。该约束纯前端实现。

## 6. UI 设计

### 6.1 Store actions 扩展

```ts
createImageCard(segmentId: string, opts?: {
  prompt?: string;
  aspectRatio?: ImageAspectRatio;
  displayMode?: AICardDisplayMode;
}): Promise<AICard>;

createVideoCard(segmentId: string, opts?: {
  prompt?: string;
  aspectRatio?: VideoAspectRatio;
  durationSeconds?: number;
  displayMode?: AICardDisplayMode;
}): Promise<AICard>;

regenerateCardMedia(cardId: string, overrides?: Partial<MediaCardContent>): Promise<void>;
cancelCardMediaGeneration(cardId: string): Promise<void>;
deleteCard(cardId: string): Promise<void>; // image/video 多调一次 delete-card-media-assets
```

新增 state：

```ts
cardMediaTasks: Record<string, { taskId: string; phase: string; percent: number }>;
```

`task-progress.startTask` id 用 `card-media-${cardId}`。

### 6.2 AICardInspector 派发

| card.type | 渲染 |
|---|---|
| summary / data / insight / chapter / quote | 现有 TextCardForm |
| motion | 现有 MotionCardForm |
| image | 新建 `ImageCardForm` |
| video | 新建 `VideoCardForm` |

`ImageCardForm` 字段：
- 标题
- 提示词（多行，复用 cover prompt textarea 风格）
- 负面提示词（折叠可选）
- 宽高比（fullscreen 默认 16:9，pip 默认 1:1）
- 显示模式（fullscreen / pip）
- 显示时长（沿用现有控件）
- Provider / Model（默认显示当前 binding，下拉可临时覆盖）
- 预览区：ready 显示生成图，否则占位 + 状态文案
- 主按钮：生成 / 重新生成 / 取消

`VideoCardForm` 在 ImageCardForm 基础上：
- 时长档位（来自 `VideoProviderCapabilities.durationOptions`，默认 6s）
- 显示模式（fullscreen / pip）
- 预览区：`<video poster={posterPath} muted controls />`
- 显示时长强制 = 视频实际时长（生成后回写）
- 主按钮触发成本确认逻辑

两个 Form 共享 `MediaCardPreview` 子组件处理 idle/pending/generating/ready/failed/cancelled 显示。

### 6.3 AICardList

- 列表项左侧缩略图：image 卡显示生成图缩略图；video 卡显示 poster；未生成显示 mediaType 图标占位。
- 状态徽章：generating（脉冲）/ failed（红点）/ ready（隐藏）。
- 排序、删除、启用沿用现有逻辑。

### 6.4 创建入口（第一期都做）

1. **cards 列表「⋯」菜单**：每张 segment 卡片新增「转为图片卡」「转为视频卡」。点击后保留 segmentId / 时间范围，将 `type` 切到 image/video，content 替换为初始 `MediaCardContent`（status=`idle`，prompt 用 `segment.summary` 作为种子文案），打开 Inspector。
2. **时间线右键菜单**：选中字幕区间后右键「在此插入图片卡 / 视频卡」，新建 segment-less 卡片（segmentId 用合成 id）。

### 6.5 Remotion 渲染（`AICardOverlay` 派发）

```tsx
if (data.cardType === 'image' && isMediaContent(data.content)) {
  if (!data.content.assetPath) return <MediaCardPlaceholder type="image" />;
  return (
    <Img
      src={resolveProjectAsset(data.content.assetPath)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

if (data.cardType === 'video' && isMediaContent(data.content)) {
  if (!data.content.assetPath) return <MediaCardPlaceholder type="video" />;
  return (
    <OffthreadVideo
      src={resolveProjectAsset(data.content.assetPath)}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
```

视频卡的时间线 overlay `durationMs = mediaDurationMs`，由 store 在 `regenerateCardMedia` 完成后回写到对应 overlay。

### 6.6 设置页

- `Settings → 视频 Provider`（紧邻图像 Provider）：列表 CRUD（id / name / type / baseUrl / apiKey / models）+ 默认 Provider / Model 选择。第一期内置 Vidu 模板。
- `Settings → 提示词`：列表追加 `card.image` / `card.video`，可编辑模板 + 绑定 Provider/Model。

### 6.7 进度系统接入

- 一张卡片一个 task，id = `card-media-${cardId}`，label = `生成图片卡：<title>` / `生成视频卡：<title>`。
- `AppStatusBar` 自动汇总，`TaskProgressPanel` 列出每张卡片单独进度。
- 取消按钮在 Inspector 内联 + TaskProgressPanel 行尾两处暴露。

### 6.8 编辑器铁律

image/video 生成不触碰脚本编辑器，因此 **不**触发 `editorAgent.readOnly` / `streamingActive`。两条铁律仅约束改 `script.md` 的 AI 操作。

## 7. 测试与验证

### 7.1 类型与纯函数（Vitest）

| 文件 | 测试目标 |
|---|---|
| `tests/ai-card-types.test.ts` | `isMediaContent` / `isMediaCardType` 判别；`AICardType` 联合涵盖 image/video；`buildAICardOverlayData` 对 MediaCardContent 透传不丢字段 |
| `tests/ai-card-persistence.test.ts` | `project.json` 含新卡的序列化 / 反序列化；旧项目（无 mediaContent）加载不报错；assetPath 始终是相对路径 |
| `tests/video-gen-registry.test.ts` | Vidu adapter 注册；未知 type 抛 `VideoGenerationError`；capabilities.durationOptions 包含 4/6/8 |
| `tests/video-gen-vidu.test.ts` | mock fetch；正常生成走轮询 → 下载；失败抛规范化错误；signal abort 正确取消 |
| `tests/prompt-bindings-card-media.test.ts` | `card.image` / `card.video` 解析回退链：项目级 → 全局 → 默认 |
| `tests/store-ai-card-media.test.ts` | `createImageCard` / `createVideoCard` 写入 store；`regenerateCardMedia` 状态机 idle→generating→ready；cancel→cancelled；deleteCard 触发 IPC 清理 |

### 7.2 Remotion 渲染

- `tests/remotion-ai-card-overlay.test.tsx`：image 卡输出 `<Img>`；video 卡输出 `<OffthreadVideo muted>`；assetPath 缺失走 `MediaCardPlaceholder`；displayMode fullscreen / pip 容器尺寸正确。
- `tests/remotion-assets.test.ts` 扩展：新增 `ai-cards/<id>/{image.png,video.mp4,poster.jpg}` 三类资产被 `prepareRemotionPublicDir` 正确链入。

### 7.3 IPC 三件套

- `tests/electron-api.test.ts` 扩展：4 条新通道的类型契约与 preload 暴露面。
- `tests/main-card-media-ipc.test.ts`（新建，mock electron）：handler 入参校验、错误包装、AbortController 表正确性、目录创建 / 清理。

### 7.4 端到端手动验证

`npm run build` 后跑完整链路：

1. 新建项目 → AI Plan 出 6 种文本卡。
2. cards 列表把 quote 卡「转为图片卡」→ Inspector → 改 prompt → 生成 → 底栏进度 → 缩略图刷新。
3. 同上「转为视频卡」→ 触发成本确认 → 选 6s → 生成 → 视频卡时长自动 = 6000ms → 时间线 overlay 同步。
4. 时间线右键「在此插入图片卡 / 视频卡」→ 走完整生成流程。
5. 删除一张视频卡 → 检查 `ai-cards/<id>/` 目录被清理。
6. 关闭重开项目 → 卡片状态、资产路径、提示词全部恢复。
7. 项目目录整体复制到另一路径打开 → image/video 卡仍能预览（验证相对路径）。
8. Remotion 导出 → MP4 内 image/video 卡正确出现，时间线长度匹配。
9. 取消正在生成的视频卡 → 进度条消失，资产文件不残留。
10. Settings 新增视频 Provider → 提示词页绑定 `card.video` → 重新生成走新 provider。

### 7.5 兼容性回归

- 旧 `project.json` 加载 / 保存 / 导出。
- 旧版本应用打开新版本项目 → 不崩溃，AICardOverlay 走兜底分支。
- `cover.regeneration` 不被 `card.image` 影响。
- `motion-card` 体验不变。

## 8. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| Vidu API 形态变化 | adapter 失效 | 集中维护；adapter 内部对响应做 schema 校验 + 友好错误信息 |
| 视频生成耗时长（30s-3min） | 用户重复点击 | 同 cardId 主进程串行 + UI 按钮在 generating 期间禁用 |
| 视频生成成本高 | 误操作 | 触发前弹一次确认 + 不再提示 |
| `assetPath` 漂移（用户手动移动 ai-cards/） | 渲染失败 | UI 检测 ready 但文件不存在时降级 failed + 提示重新生成 |
| 旧版本应用打开新项目 | 兜底渲染可能错乱 | 加载时检测 mediaContent 字段，旧版本走 placeholder 兜底 |
| 多张视频卡并发挤爆底栏 | UX 退化 | TaskProgressPanel 已支持折叠多任务；底栏单条 progress line 显示总进度 |
| ffprobe / ffmpeg 打包路径问题 | poster 抽帧失败 | 复用 `@remotion/renderer` 已绑定的 ffmpeg；通过 `getFfmpegPath` 解析 |
| 不做图生视频 | 期望落差 | 文档明确"图生视频留给第二期"；接口字段已留位 |

## 9. 第一期范围 / 不在范围

**第一期做（Phase 1）**：
- 新增 `image / video` 两个 `AICardType` 与 `MediaCardContent`
- 新建 `src/lib/video-gen` 注册表 + Vidu adapter
- 新增 `card.image` / `card.video` 两个 PromptKind + 默认模板
- 设置页「视频 Provider」分组
- Inspector / 列表 / 创建入口（cards 列表 + 时间线右键）
- Remotion 渲染分支
- 项目持久化、IPC 三件套、task-progress 接入
- §7 测试覆盖

**第二期或之后**：
- AI Plan 自动决策图片 / 视频卡
- 图生视频（reference image）
- 视频卡循环 / 末帧冻结模式
- Kling / Runway / MiniMax video adapter
- 视频卡 trim / 速度 / 倒放高级控制
- 历史版本快照（image.v1.png, image.v2.png）

## 10. 参考资料

- `src/types/ai.ts`
- `src/lib/image-gen/`（注册表 / 异步轮询 / 进度词表参照样板）
- `src/lib/prompts/`（PromptKind 与 binding-resolver 现有体系）
- `src/store/ai.ts`、`src/store/task-progress.ts`
- `src/remotion/AICardOverlay.tsx`、`src/remotion/PodcastComposition.tsx`
- `electron/main.ts`、`electron/preload.ts`、`src/lib/electron-api.ts`
- `PROGRESS-SPEC.md`（统一进度系统铁律）
- `CLAUDE.md`（AI 操作界面视觉反馈体系铁律）

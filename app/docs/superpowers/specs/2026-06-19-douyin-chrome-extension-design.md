# 声呐 Sonar：抖音博主监听 Chrome 扩展设计

## 1. 背景

用户希望开发一款个人使用、无需上架 Chrome Web Store 的 Manifest V3 扩展「声呐 Sonar」。扩展需要利用用户在抖音网页中的正常登录态，采集喜欢的博主及其公开视频数据，主动发现新作品，优先解析无水印视频后直接下载到 Chrome 默认下载目录，并完成字幕转录、AI 摘要、Markdown 导出与本地工作流管理。

本扩展独立运行，不依赖现有「灵机剪影」Electron 应用。现有 Electron 抖音导入能力可以作为行为参考，但不作为运行时依赖。

## 2. 目标

第一期必须实现：

- 识别当前抖音单视频页面、博主主页、作品弹层和分享短链。
- 采集博主资料及公开视频元数据。
- 用稳定、类型化的 API 向 Popup 或管理页面提供能力。
- 优先解析无水印候选，并验证候选地址的可下载性。
- 使用 Chrome 原生下载能力保存到默认下载目录。
- 展示下载进度，并支持取消和失败重试。
- 收藏博主，低频检查新作品并发送本地通知。
- 使用 Offscreen Web Audio 在扩展本地下混、重采样并编码 16kHz 单声道 WAV。
- 通过用户配置的云端 ASR Provider 生成全文、时间轴片段和 SRT。
- 通过用户配置的 OpenAI-compatible LLM 生成摘要、关键点、标签和内容分类。
- 导出单条或多条视频摘要为 Markdown。
- 把视频加入本地工作流队列并管理处理状态。
- 交付 Popup、Side Panel、抖音页面注入和完整工作台四个产品表面。
- 业务数据、配置和结果默认只保存在本机；音频与字幕仅在执行 AI 任务时发送给用户明确配置的 Provider。不保存或导出抖音 Cookie、Token。

## 3. 非目标

第一期不实现：

- Chrome Web Store 上架及多人账号体系。
- 私密、好友可见、付费或其他受访问控制的内容。
- 绕过验证码、登录限制或平台访问控制。
- 直播、直播回放和图文作品批量下载。
- HLS/DASH 分片合并和通用视频格式转码；首期仅处理 Chrome 可解码的 MP4 音轨。
- 云端同步、服务端爬虫和远程下载代理。
- 保证所有作品均存在无水印可下载源。
- 自动发布、自动剪辑或与第三方任务系统同步。

## 4. 核心决策

### 4.1 采用网页响应捕获作为主链路

扩展在抖音页面的 MAIN world 中包装 `fetch` 和 `XMLHttpRequest`，观察页面自身成功返回的目标响应。它复用抖音网页已完成的登录、签名和风控流程，不主动读取或导出认证数据。

页面初始化数据、结构化脚本和 DOM 解析仅作为备用解析器。第一期不自行实现抖音私有签名算法。

### 4.2 用领域 API 隔离抖音原始结构

抖音响应字段不直接暴露给 UI。`DouyinAdapter` 把原始响应转换为稳定的 `Creator`、`Video`、`VideoSource` 和 `DownloadTask` 模型。UI 只通过 `DouyinClient` 调用能力。

### 4.3 无水印采用证据分级与候选验证

解析器收集页面响应中所有可用视频源，基于来源字段语义、URL 特征、容器格式、码率、尺寸和编码排序，并以实际 HTTP 响应验证 MIME、状态码和文件大小。

HTTP 探测只能验证地址是否可下载，不能证明画面中绝对没有水印。因此 API 必须同时返回水印判断、判断证据和置信度，UI 不得把低置信度候选展示为“已确认无水印”。第一期不做逐帧视觉水印检测。

不能仅通过字符串替换 `/playwm/` 为 `/play/` 判断无水印。字符串替换只可作为低优先级兼容候选，且必须重新验证。

### 4.4 自动监控使用临时 inactive 标签页

Manifest V3 Service Worker 不能长期驻留，也不能可靠复用页面运行环境。定时检查时，扩展顺序创建一个非激活抖音标签页，等待页面响应捕获完成，比较作品数据后关闭标签页。

出现验证码、登录失效或访问限制时立即暂停自动监控，不进行连续重试。

### 4.5 媒体与 AI 任务在 Offscreen Document 中运行

Service Worker 不能承担 DOM/Web Audio 音频处理。扩展按需创建 Offscreen Document，视频先暂存到 OPFS，再用 Web Audio 解码、下混和重采样为 WAV；Service Worker 负责上传音频、轮询 bcut 任务和调用摘要 Provider。

首期采用单任务队列，避免多个视频同时占用大量内存。媒体任务结束后清理临时视频与音频；只有用户下载的视频、字幕、摘要和结构化元数据作为结果保留。

### 4.6 AI Provider 可配置但契约统一

ASR 与摘要生成分别通过 `AsrProvider`、`SummaryProvider` 契约接入。第一期实际交付 OpenAI-compatible Audio Transcriptions 协议和 Chat Completions 协议，支持配置 Base URL、API Key、模型、超时和必要的额外参数。其他供应商通过后续适配器接入，不在第一期承诺范围内。API Key 仅保存到 `chrome.storage.local`，不会使用 Chrome Sync，也不会写入导出文件或诊断日志。

ASR Provider 接收压缩音频并返回时间轴片段；Summary Provider 接收转录文本并返回严格校验的结构化结果。Provider 原始响应不直接进入 UI。用户首次启用 AI 处理前必须看到数据发送说明并主动确认。

### 4.7 扩展工程与 Electron 应用隔离

Sonar 放在仓库的独立 `extensions/sonar/` 工程中，拥有自己的 Manifest、构建配置、测试和依赖边界。它不直接导入 `electron/` 下的 Node 模块，也不修改现有 Electron IPC 或 `project.json` schema。

可以复用现有抖音导入测试中的脱敏响应思路和纯算法设计，但浏览器版本必须重新实现适合 Web API 的解析、存储和媒体管线。构建产物输出为可通过 Chrome「加载已解压的扩展程序」安装的目录。

## 5. 总体架构

```text
Popup / 管理页面
  -> DouyinClient
  -> Runtime Message Protocol
  -> Extension Service Worker
       -> Content Script
            -> MAIN World PageBridge
                 -> 抖音网页 fetch / XHR
       -> DouyinAdapter
       -> IndexedDB Repository
       -> VideoSourceResolver
       -> DownloadManager -> chrome.downloads
       -> CreatorMonitor -> chrome.alarms / chrome.notifications
       -> ProcessingQueue
            -> Offscreen Document
                 -> OPFS Media Cache
                 -> Web Audio WAV AudioExtractor
                 -> AsrProvider
                 -> SummaryProvider
       -> MarkdownExporter -> chrome.downloads
       -> WorkflowRepository
```

### 5.1 PageBridge

职责：

- 在 MAIN world 中安装最小化的 `fetch`/XHR 观察器。
- 只处理白名单 URL 和 JSON 响应。
- 克隆响应并限制允许传输的字段及最大负载。
- 使用带随机会话标识的 `window.postMessage` 发送给 Content Script。
- 支持卸载包装，避免重复注入。

PageBridge 不负责持久化、下载或业务判断。

### 5.2 Content Script

职责：

- 注入并初始化 PageBridge。
- 校验消息来源、会话标识和数据结构。
- 把解析事件转交 Service Worker。
- 提供当前页面 URL、页面类型和可见作品 ID。

### 5.3 DouyinAdapter

职责：

- 识别博主资料、作品列表和作品详情响应。
- 兼容已知的 snake_case/camelCase 字段差异。
- 把原始数据转换为稳定领域模型。
- 从作品对象提取全部视频源候选。
- 记录解析器版本和有限诊断信息。

适配器按响应类别拆分，避免形成单个大型解析文件。

### 5.4 Extension Service Worker

职责：

- 处理 UI 发来的类型化请求。
- 协调页面探测、解析、存储、下载和监控。
- 管理待处理请求和超时。
- 在 Service Worker 被回收后从 IndexedDB 恢复任务状态。

### 5.5 Repository

使用 IndexedDB 保存：

- 收藏博主及监控设置。
- 标准化视频元数据。
- 最新作品游标或最新作品 ID。
- 下载任务和结果。
- 限量、短期的解析诊断记录。

不保存 Cookie、访问令牌、完整请求头或长期有效的原始认证信息。带签名视频地址可能快速过期，只允许作为短期缓存。

### 5.6 VideoSourceResolver

职责：

- 识别分享链接、视频链接、博主主页和作品弹层。
- 从捕获缓存或页面响应获取目标 `awemeId`。
- 收集、去重和排序视频源。
- 验证候选地址是否为可下载视频。
- 在地址过期时触发一次重新解析。

### 5.7 DownloadManager

职责：

- 调用 `chrome.downloads.download()`。
- 监听 `chrome.downloads.onChanged` 更新进度。
- 生成安全且可读的文件名。
- 支持取消、失败重试和重复文件处理。
- 重新启动 Service Worker 后恢复 Chrome 下载任务映射。

### 5.8 CreatorMonitor

职责：

- 通过 `chrome.alarms` 安排检查。
- 顺序调度博主，不并发打开多个抖音页面。
- 创建、复用或关闭 inactive 监控标签页。
- 对比新旧作品 ID 并生成通知。
- 对登录失效、验证码、限流实施熔断。

### 5.9 ProcessingQueue 与 Offscreen Document

职责：

- 同一时刻只执行一个媒体处理任务，其余任务排队。
- 把视频流写入 OPFS，避免全部媒体常驻 JavaScript 堆内存。
- 使用 Web Audio 提取并编码 16kHz 单声道 PCM WAV，交给 bcut 转录。
- 调用 ASR、生成 SRT，再调用摘要 Provider。
- 持久化阶段进度，Service Worker 重启后可查询或恢复。
- 在成功、取消或失败后清理临时媒体。

处理阶段统一为：

```text
queued -> resolving -> fetching_media -> extracting_audio
  -> transcribing -> summarizing -> completed
```

### 5.10 MarkdownExporter

职责：

- 把视频元数据、指标、摘要、关键点、标签和字幕按固定模板生成 Markdown。
- 支持单条导出和视频库批量导出。
- 通过 Blob URL 与 `chrome.downloads` 保存到 `声呐/导出/`。
- 对标题、文件名和 Markdown 内容进行转义与长度限制。

### 5.11 WorkflowRepository

第一期工作流是扩展内部的轻量队列，不对接外部系统。每条视频可以加入工作流，填写备注，并在 `待处理`、`处理中`、`已完成` 三个状态间移动。工作流记录引用 `videoId`，不复制视频和转录正文。

## 6. 上层 API

```ts
interface DouyinClient {
  detectCurrentPage(): Promise<PageDetectionResult>;

  getCreator(creatorId: string): Promise<Creator>;
  listCreatorVideos(
    creatorId: string,
    options?: ListVideoOptions,
  ): Promise<VideoPage>;

  resolveVideo(input: ResolveVideoInput): Promise<ResolvedVideo>;
  downloadVideo(
    videoId: string,
    options?: DownloadOptions,
  ): Promise<DownloadTask>;

  followCreator(creator: Creator): Promise<void>;
  unfollowCreator(creatorId: string): Promise<void>;
  listFollowedCreators(): Promise<CreatorSubscription[]>;

  runMonitorOnce(creatorId?: string): Promise<MonitorResult>;
  getDownloadTask(taskId: string): Promise<DownloadTask>;
  cancelDownload(taskId: string): Promise<void>;

  processVideo(
    videoId: string,
    options?: ProcessVideoOptions,
  ): Promise<ProcessingTask>;
  getProcessingTask(taskId: string): Promise<ProcessingTask>;
  cancelProcessingTask(taskId: string): Promise<void>;

  getTranscript(videoId: string): Promise<TranscriptDocument | null>;
  regenerateTranscript(videoId: string): Promise<ProcessingTask>;
  getAnalysis(videoId: string): Promise<VideoAnalysis | null>;
  regenerateAnalysis(videoId: string): Promise<ProcessingTask>;

  exportMarkdown(input: MarkdownExportInput): Promise<ExportTask>;
  addToWorkflow(input: AddWorkflowItemInput): Promise<WorkflowItem>;
  listWorkflowItems(): Promise<WorkflowItem[]>;
  updateWorkflowItem(input: UpdateWorkflowItemInput): Promise<WorkflowItem>;

  getAiSettings(): Promise<AiSettingsView>;
  updateAiSettings(input: UpdateAiSettingsInput): Promise<void>;
  testAiProvider(input: TestAiProviderInput): Promise<ProviderTestResult>;
}
```

跨上下文通信采用可判别联合类型，并包含：

- `protocolVersion`
- `requestId`
- `method`
- `params`
- 标准成功结果或标准错误

未知协议版本和未知方法必须明确失败，不能静默忽略。

## 7. 核心数据模型

```ts
interface Creator {
  id: string;
  secUid: string;
  nickname: string;
  avatarUrl?: string;
  profileUrl: string;
  signature?: string;
  followerCount?: number;
  videoCount?: number;
  updatedAt: number;
}

interface Video {
  id: string;
  creatorId: string;
  description: string;
  coverUrl?: string;
  publishedAt: number;
  durationMs?: number;
  statistics?: VideoStatistics;
  sourcePageUrl: string;
}

interface VideoSource {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
  watermark: 'none' | 'present' | 'unknown';
  watermarkConfidence: 'high' | 'medium' | 'low';
  watermarkEvidence: string[];
  expiresAt?: number;
}

interface DownloadTask {
  id: string;
  videoId: string;
  status:
    | 'queued'
    | 'resolving'
    | 'downloading'
    | 'completed'
    | 'failed'
    | 'cancelled';
  chromeDownloadId?: number;
  filename?: string;
  receivedBytes?: number;
  totalBytes?: number;
  error?: SonarError;
}

interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

interface TranscriptDocument {
  videoId: string;
  provider: string;
  language: string;
  fullText: string;
  srtText: string;
  segments: TranscriptSegment[];
  createdAt: number;
}

interface VideoAnalysis {
  videoId: string;
  category:
    | '深度分析'
    | '数据解读'
    | '观点评论'
    | '科普讲解'
    | '资讯快讯'
    | '复盘总结';
  summary: string;
  keyPoints: string[];
  tags: string[];
  model: string;
  createdAt: number;
}

interface ProcessingTask {
  id: string;
  videoId: string;
  stage:
    | 'queued'
    | 'resolving'
    | 'fetching_media'
    | 'extracting_audio'
    | 'transcribing'
    | 'summarizing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  progress: number;
  error?: SonarError;
}

interface WorkflowItem {
  id: string;
  videoId: string;
  status: 'todo' | 'in_progress' | 'done';
  note: string;
  createdAt: number;
  updatedAt: number;
}
```

## 8. 视频识别与下载流程

1. `detectCurrentPage` 判断当前标签页是视频页、博主页、作品弹层还是不支持页面。
2. 从 URL、当前页面状态或最近捕获响应中确定 `awemeId`。
3. 若没有目标作品数据，触发页面正常加载或刷新并等待目标响应。
4. 适配器提取所有视频源候选。
5. 解析器按以下优先级排序：
   - 经来源字段语义判定为高置信度无水印的直接视频源。
   - 无明显水印迹象、可直接播放的最高质量源。
   - 水印状态未知但验证通过的普通播放源。
   - 带水印源仅在用户明确允许时作为回退。
6. 使用轻量探测验证状态码、Content-Type、Content-Length 和重定向结果。
7. 调用 `chrome.downloads.download()`，默认保存到：
   `灵机剪影/抖音/{博主昵称}/{日期}_{标题}_{awemeId}.{媒体扩展名}`。
8. 下载地址若过期，只自动重新解析一次；仍失败则返回明确错误。

媒体扩展名由已验证的 Content-Type、容器信息和最终 URL 共同决定，不能固定假设为 MP4。文件名需要移除操作系统不支持字符、控制字符和尾部空格，并设置合理长度上限。

`DownloadOptions.allowWatermarkFallback` 默认是 `false`。当无水印地址不可用时返回 `NO_WATERMARK_SOURCE`，只有用户在 UI 中明确允许，才能尝试带水印候选。

## 8.1 转录与摘要流程

新视频入库后，如果对应博主启用了自动分析，则进入处理队列；用户也可以从详情页手动处理或重新提取：

1. 解析并验证当前可用视频源。
2. Offscreen Document 把媒体流暂存到 OPFS。
3. Offscreen Web Audio 解码媒体音轨，下混并重采样为 16kHz 单声道 WAV。
4. 上传音频并轮询转录结果，标准化为全文、片段和 SRT。
5. 将长字幕按时间轴分块，分块摘要后再生成最终结构化摘要。
6. 使用运行时 schema 校验 `category`、`summary`、`keyPoints` 和 `tags`。
7. 保存转录与摘要，清理 OPFS 临时媒体。

分析临时媒体与 Chrome 已保存到 Downloads 的文件相互独立。扩展不能直接读取 Downloads 中的任意文件，因此用户同时执行“下载”和“分析”时，分析链路可能对同一视频源进行一次额外读取。第一期不申请本机文件系统访问权限来规避这一点。

默认音频策略以 ASR 可懂度和上传体积为目标，不追求音乐保真。超出 Provider 单文件限制时按时间分片转录，合并时重新计算时间戳。转录成功但摘要失败时保留字幕，并允许只重试摘要。

## 8.2 AI 设置

设置页分别配置 ASR 与摘要 Provider：

- Provider 名称与协议类型。
- Base URL。
- API Key，默认遮罩显示。
- ASR 模型、语言和文件限制。
- 摘要模型、Temperature 和最大输出长度。
- 请求超时与最大重试次数。
- 是否自动分析新视频，以及单次同步最多自动分析数量。

自动分析在用户完成 Provider 配置与数据发送确认前默认关闭，避免意外上传与费用。保存前可执行最小连通性测试。测试请求不得上传用户视频；ASR 使用内置的短静音或测试音频，摘要使用固定短文本。

## 9. 自动监控流程

默认每 30 分钟触发一次调度，允许用户选择 15、30 或 60 分钟。

1. Alarm 唤醒 Service Worker。
2. 从收藏博主中选出最久未检查的一位。
3. 创建 inactive 抖音标签页并加载博主主页。
4. 等待作品列表响应，最大等待时间由统一配置控制。
5. 把最新作品与本地记录比较。
6. 保存新增作品并发送本地通知。
7. 关闭监控标签页。
8. 在下一个博主前加入 10 至 30 秒随机间隔。

同一时刻最多存在一个监控任务。Chrome 关闭期间不执行；Chrome 再次启动后补偿检查一次。

## 10. 错误模型

错误必须标准化为以下类别：

- `NOT_LOGGED_IN`
- `CAPTCHA_REQUIRED`
- `ACCESS_RESTRICTED`
- `UNSUPPORTED_PAGE`
- `VIDEO_NOT_FOUND`
- `NO_DOWNLOADABLE_SOURCE`
- `NO_WATERMARK_SOURCE`
- `SOURCE_EXPIRED`
- `DOWNLOAD_FAILED`
- `MEDIA_FETCH_FAILED`
- `MEDIA_TOO_LARGE`
- `AUDIO_EXTRACTION_FAILED`
- `ASR_NOT_CONFIGURED`
- `ASR_UPLOAD_FAILED`
- `ASR_FAILED`
- `SUMMARY_NOT_CONFIGURED`
- `SUMMARY_FAILED`
- `SUMMARY_INVALID_RESPONSE`
- `EXPORT_FAILED`
- `NETWORK_ERROR`
- `PARSE_ERROR`
- `TIMEOUT`

验证码、访问限制和登录失效属于监控熔断错误；网络错误可以指数退避；解析错误需要保留脱敏诊断信息，但不能无限重试。ASR 与摘要错误按阶段隔离：字幕成功后摘要失败不得回滚字幕；Provider 未配置时视频仍可正常监听、入库和下载。

## 11. 权限

第一期预计需要：

```json
{
  "manifest_version": 3,
  "permissions": [
    "alarms",
    "downloads",
    "notifications",
    "offscreen",
    "sidePanel",
    "scripting",
    "storage",
    "tabs",
    "unlimitedStorage"
  ],
  "host_permissions": [
    "https://www.douyin.com/*",
    "https://v.douyin.com/*",
    "https://*.douyinvod.com/*",
    "https://*.douyinpic.com/*"
  ]
}
```

开发时根据实际捕获到的 CDN 域名调整权限，不使用 `<all_urls>`。若下载 CDN 不需要扩展发起探测，则不应仅为了下载而扩大 Host Permission。

首期音频提取不依赖 WebAssembly，使用 Chrome 内置 Web Audio，避免引入大型 `ffmpeg.wasm` 资源和 SharedArrayBuffer 跨域隔离要求。所有 UI 与处理脚本随扩展本地打包，不从 CDN 加载可执行代码。

## 12. UI 范围

第一期按照用户提供的 Sonar 原型交付四个表面：

- Popup：当前页面识别、一键监听、新视频速览、下载与分析快捷动作。
- Side Panel：动态流、视频库、链接入库和任务状态。
- 抖音页面注入：加入监听、视频入库和下载原片。
- 完整工作台：动态流、视频库、博主管理、工作流和设置。

详细信息架构、交互状态与原型适配规则见 [Sonar UI 设计](./2026-06-19-sonar-ui-design.md)。

UI 不直接访问 `chrome.runtime`，而是统一依赖 `DouyinClient`，便于测试和后续替换实现。四个表面共享 Repository 与任务状态，不能在各自页面保留相互冲突的业务副本。

## 13. 测试策略

### 13.1 单元测试

- URL 和分享文案识别。
- 多种响应结构向领域模型的转换。
- 视频源去重、排序和无水印判断。
- 文件名清理。
- 错误归类和重试决策。
- 新作品差异计算。
- 消息协议的请求、响应与版本校验。
- ASR 响应向全文、片段和 SRT 的转换。
- 长字幕分块、时间戳合并和摘要 schema 校验。
- Markdown 导出模板与转义。
- 工作流状态迁移。

测试夹具必须脱敏，不包含真实 Cookie、Token 或短期签名参数。

### 13.2 集成测试

- MAIN world 消息到 Content Script 的校验与转发。
- UI 到 Service Worker 的类型化调用。
- Service Worker 回收后的下载任务恢复。
- Alarm 调度、单任务互斥和熔断。
- Offscreen Document 创建、任务通信、取消和清理。
- OPFS 临时媒体生命周期。
- Web Audio 音频提取适配层，测试中使用小型固定媒体夹具。
- ASR 成功后摘要失败时的部分结果保留与单阶段重试。
- Popup、Side Panel、注入 UI 和完整工作台的共享状态一致性。

### 13.3 手工冒烟测试

- 单视频标准 URL。
- 分享短链和包含文案的分享内容。
- 博主主页作品。
- 当前页面作品弹层。
- 未登录、登录过期和验证码页面。
- 地址过期后的单次重新解析。
- 重名文件和下载取消。
- 下载原片后完成转录、摘要、Markdown 导出和工作流流转。
- ASR/摘要 Provider 未配置、鉴权失败和超时。
- 长视频、媒体缓存不足和任务取消后的临时文件清理。

## 14. 第一期验收标准

- UI 仅通过 `DouyinClient` 使用抖音能力。
- 能识别支持范围内的单视频和博主页面。
- 能解析视频 ID、标题、作者、封面和可用视频源。
- 优先选择可下载验证通过且具有高置信度无水印证据的候选。
- UI 明确展示水印判断的置信度，不把推测结果描述为绝对保证。
- 没有无水印源时不默认静默下载带水印版本。
- 能保存到 Chrome 下载目录并持续报告任务状态。
- 能收藏博主并低频发现新公开视频。
- 能在 Offscreen Document 中提取 WAV 音频并通过内置 bcut 生成全文、时间轴片段和 SRT。
- 能从字幕生成通过 schema 校验的分类、摘要、关键点和标签。
- 能导出单条或批量 Markdown，并下载 SRT。
- 能把视频加入本地工作流并在三个状态间流转。
- Popup、Side Panel、页面注入和完整工作台能完成各自定义的首期功能。
- 能正确处理登录失效、验证码、地址过期和解析失败。
- 不保存或导出 Cookie、Token 和完整认证请求头。
- 核心解析与排序逻辑有固定夹具回归测试。

## 15. 实施阶段

1. 扩展骨架、消息协议和领域模型。
2. MAIN world PageBridge 与响应捕获。
3. 抖音响应适配器与固定夹具测试。
4. 单视频识别、视频源解析和无水印候选排序。
5. Chrome DownloadManager 与下载任务状态。
6. Offscreen Document、OPFS 和 Web Audio WAV 音频提取。
7. ASR Provider、字幕持久化和 SRT。
8. Summary Provider、结构化摘要和失败恢复。
9. 博主收藏、作品列表和本地持久化。
10. Alarm 监控、新作品差异和通知。
11. Markdown 导出与本地工作流。
12. Popup、Side Panel 和页面注入。
13. 完整工作台、设置、诊断和整体冒烟验证。

## 16. 风险与应对

- 抖音字段变化：使用独立适配器和回归夹具，领域模型不随原始字段变化。
- 视频地址短期过期：下载前验证，失败后只重新解析一次。
- 无水印源不可用：返回 `NO_WATERMARK_SOURCE`，由用户决定是否允许水印回退。
- Service Worker 回收：任务状态持久化，启动后与 Chrome 下载记录重新关联。
- 自动检查触发风控：单任务、低频、随机间隔、验证码熔断。
- CDN 编码或容器不兼容：第一期只下载直接可用视频流，不在扩展中转码。
- 页面注入影响抖音运行：包装保持透明、保留原函数语义，并支持重复注入保护与卸载。
- WASM 体积与性能：所有资源本地打包、使用单线程构建、单任务执行，并展示可取消的阶段进度。
- 长视频内存与存储压力：媒体流写入 OPFS、音频压缩后上传、任务结束清理临时文件，并在开始前检查可用空间。
- 云端 AI 隐私与成本：首次启用时明确提示音频和字幕会发送给用户配置的 Provider，显示模型配置，不自动启用未配置服务。
- Provider 返回不稳定：适配器、超时、有限重试、schema 校验和分阶段持久化。

## 17. 后续扩展点

第一期稳定后可考虑：

- 批量选择博主作品下载。
- 图文作品图片下载。
- 导出博主和作品数据为 JSON/CSV。
- 在用户主动授权时与「灵机剪影」进行本地通信。
- 支持需要合并的分片媒体，但应作为独立阶段评估体积和性能成本。

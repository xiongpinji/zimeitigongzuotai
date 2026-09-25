# Sonar 音频提取改用 ffmpeg.wasm 设计

日期：2026-06-22
范围：`extensions/sonar/`（独立 npm 工程）

## 背景与问题

声呐 Sonar 的视频分析流水线阶段为
`resolving → fetching_media → extracting_audio → transcribing → summarizing`。
用户在分析某条抖音视频时收到「AI 摘要 / 分析失败：浏览器音频提取失败」。

根因排查结论：

- 失败精确发生在 `extracting_audio` 阶段（`AUDIO_EXTRACTION_FAILED`），即 offscreen
  document 内的 `AudioContext.decodeAudioData(...)`（`src/offscreen/main.ts:82`）抛错。
- 现有实现用 Web Audio：`decodeAudioData` 一次性把整条音轨按原始采样率解为 Float32
  PCM 全部驻留内存，再手工下混 / 重采样到 16k 单声道。两个固有弱点：
  1. **格式 / 容错弱**：抖音 CDN 在签名过期或反爬时会返回 `200 + text/html`，HTML
     字节被喂给 `decodeAudioData` 直接抛 `EncodingError`。下载路径
     （`fetchDownloadBlob`）早已加 content-type 拦截，但分析路径 `fetchMedia`
     （`build-services.ts:60`）从未同步该护栏。
  2. **长音频 OOM**：长播客场景整轨 PCM 可达数百 MB，offscreen 内易失败；当前
     `createChromeOffscreenAudioExtractor` 无体积 / 时长上限。
- **诊断盲区**：UI 只渲染 `error.error.message`（`inject-ui.ts:17`），真正的 `detail`
  被吞掉，用户与开发者都看不到真因。

决策（已与用户确认）：**用 ffmpeg.wasm 完全替换 Web Audio 解码路径**，并顺带补齐
`fetchMedia` 护栏与 `detail` 透出。

## 目标

- offscreen document 用 ffmpeg.wasm 把任意视频 Blob 解码 / 重采样为 16kHz 单声道
  WAV，供 bcut ASR 转录。
- 行为对短视频与长视频一致，消除整轨 PCM 驻留内存导致的失败。
- 所有可执行资源（core js / wasm / worker）本地打包，不从 CDN 加载。
- 取流阶段尽早拦截非媒体响应；失败时把真实 `detail` 透到 UI。

## 非目标

- 不改 SW ↔ offscreen 的消息协议（`OFFSCREEN_EXTRACT_AUDIO` 请求 / 响应不变）。
- 不改 OPFS 临时文件读写编排（`createOffscreenAudioExtractor` SW 侧逻辑不变）。
- 不引入多线程 ffmpeg（见「关键约束」）。
- 不改 bcut ASR、摘要、桥推送等下游链路。

## 关键约束（MV3 现实）

1. **无 SharedArrayBuffer**：MV3 offscreen document 非 cross-origin isolated，
   `@ffmpeg/core-mt`（多线程）不可用。**只能用单线程 `@ffmpeg/core`**（较慢，但唯一可行）。
2. **远程代码禁令 + CSP**：core js / wasm / worker 必须随扩展本地打包，经 `chrome.runtime.getURL`
   + `toBlobURL` 加载。`extension_pages` CSP 增加 `'wasm-unsafe-eval'`。
3. **包体增长**：单线程 core wasm 约 +30MB。可接受（用户已确认）。

## 依赖

新增到 `extensions/sonar/package.json`：

- `@ffmpeg/ffmpeg@0.12.15`（wrapper）
- `@ffmpeg/core@0.12.10`（单线程 core：`ffmpeg-core.js` + `ffmpeg-core.wasm`）
- `@ffmpeg/util@0.12.2`（`toBlobURL`）

## 架构

执行家仍是 offscreen document（已有 `BLOBS` reason + OPFS）。替换其内部解码实现。

```
SW: fetchMedia(url) → Blob ──(OPFS input-<id>.mp4)──▶ offscreen
offscreen.extractAudio(inputName, outputName):
  bytes ← OPFS read(inputName)
  wav   ← ffmpegRunner.transcodeToWav16kMono(bytes)
  OPFS write(outputName, wav)
SW: OPFS read(outputName) → bcut ASR
```

ffmpeg 命令：

```
-i input.mp4 -vn -ac 1 -ar 16000 -f wav output.wav
```

（`-vn` 去视频流，`-ac 1` 单声道，`-ar 16000` 16kHz，输出 WAV。）

## 组件

### 1. `src/offscreen/ffmpeg-runner.ts`（新增）

职责：拥有单个惰性创建、跨调用复用的 `FFmpeg` 实例（避免每条视频重新实例化 30MB）。

接口：

```ts
export interface FfmpegLike {
  loaded: boolean;
  load(opts: { coreURL: string; wasmURL: string; classWorkerURL: string }): Promise<void>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  exec(args: string[]): Promise<number>;
}

/** 纯函数：构造 ffmpeg argv，可单测。 */
export function buildWav16kMonoArgs(input: string, output: string): string[];

export interface FfmpegRunnerDeps {
  ffmpeg: FfmpegLike;                 // 测试注入 fake
  resolveAssetUrls: () => {           // 默认用 chrome.runtime.getURL
    coreURL: string; wasmURL: string; workerURL: string;
  };
  toBlobURL: (url: string, mime: string) => Promise<string>;
}

export function createFfmpegRunner(deps: FfmpegRunnerDeps): {
  transcodeToWav16kMono(input: Uint8Array): Promise<Uint8Array>;
};
```

- `transcodeToWav16kMono`：首次调用时 `load()`（仅一次）；写入临时输入名、`exec(buildWav16kMonoArgs(...))`、读出输出、清理 ffmpeg FS 内的临时项、返回字节。
- 默认工厂 `createChromeFfmpegRunner()` 注入真实 `new FFmpeg()`、`chrome.runtime.getURL`、`@ffmpeg/util` 的 `toBlobURL`。

### 2. `src/offscreen/main.ts`（重写 `extractAudio`）

- 删除 `AudioContext` / `decodeAudioData` / `createMonoBuffer` / `resample` 逻辑。
- `extractAudio(inputName, outputName)` 改为：读 OPFS 输入 → `runner.transcodeToWav16kMono` → 写 OPFS 输出。
- 其余消息监听（download blob 等）不动。

### 3. 删除文件

- `src/offscreen/audio-codec.ts`（`downmixChannels` / `encodePcm16Wav`）及其测试（若仅服务于此路径）。先 grep 确认无其它引用再删。

### 4. 本地打包资源

- 将 `@ffmpeg/core` 的 `ffmpeg-core.js`、`ffmpeg-core.wasm` 与 `@ffmpeg/ffmpeg` 的 `worker.js`
  复制进构建输出（Vite 资源 import 或 `public/` 静态目录 / 小型 copy 步骤，三选一，实现期定）。
- 在 `manifest.config.ts` 的 `web_accessible_resources` 注册这三个文件。
- `FFmpeg.load({ coreURL, wasmURL, classWorkerURL })` 用 `toBlobURL` 从本地 `getURL` 路径加载。

### 5. `manifest.config.ts` CSP

```
content_security_policy: {
  extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
}
```

并修正顶部注释「不加载远程脚本或 WASM」→「WASM 与 worker 本地打包，不从 CDN 加载」。

### 6. `fetchMedia` 护栏（`build-services.ts`）

- 把 `fetchDownloadBlob`（`src/offscreen/download-blob.ts`）重构为共享 helper（如
  `fetchMediaBlob(url, fetchImpl)`），两条路径复用，杜绝再次漂移。
- `fetchMedia` 因此获得：`res.ok` 校验、`content-type` 为 `text/html`/`application/json` 时抛
  `MEDIA_FETCH_FAILED`、`Range: bytes=0-` + `credentials:'omit'`。

### 7. `detail` 透出（`inject-ui.ts`）

- `injectedUiErrorMessage`：当 `error instanceof SonarException` 且 `error.error.detail`
  存在时，消息追加 detail（如 `${message}（${detail}）`），让真实底层报错可见。

## 数据流与错误处理

- ffmpeg `exec` 返回非 0 或抛错 → `transcodeToWav16kMono` 抛 Error →
  `createOffscreenAudioExtractor` 包成 `AUDIO_EXTRACTION_FAILED`，`detail` 带 ffmpeg 报错 →
  经 detail 透出在 UI 可见。
- `fetchMedia` 拿到 HTML → `MEDIA_FETCH_FAILED`（在 `fetching_media` 阶段，早于解码）。
- offscreen FS 临时文件在 `finally` 清理；OPFS 临时项沿用现有 `finally` 清理。

## 测试

- `buildWav16kMonoArgs`：纯函数单测（argv 正确）。
- `createFfmpegRunner`：注入 fake `FfmpegLike`，验证 load 仅一次、写 / exec / 读 / 清理顺序、返回字节。
- `fetchMediaBlob` / `fetchMedia`：content-type 拦截 + header 传递（对齐现有 download-blob 测试）。
- `injectedUiErrorMessage`：detail 追加。
- **真实 ffmpeg 解码 = 手动验证检查点**：在真实 offscreen document 内对用户失败的那条视频
  （`https://www.douyin.com/video/7651998025816050959`）跑通分析。

## 风险与验证检查点

**主要风险**：MV3 worker CSP。单线程 core 经 classic worker `importScripts` blob core，在
`script-src 'self'` 下能否加载，仅靠静态阅读无法 100% 保证。

缓解：实现计划把「`ffmpeg.load()` 在真实 offscreen document 内成功」列为显式验证检查点；
若默认 worker 被 CSP 拦截，用 `classWorkerURL`（本地打包 worker）作为回退杠杆。其它候选回退：
调整 `web_accessible_resources` 匹配、必要时为 worker 单独处理。

## 提交前检查

- 仅改 `extensions/sonar/` 范围；不误改根 Electron 工程产物。
- 包体 +30MB 进入 dist 属预期。
- 不引入 CDN / 远程脚本。
- ffmpeg 资源进 `web_accessible_resources`，CSP 加 `wasm-unsafe-eval`。

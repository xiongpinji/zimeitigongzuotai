# 抖音视频导入原稿 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 写稿工作台新增抖音视频导入原稿能力，完成“下载视频 → `bcut` ASR → 落盘导入产物 → 同步 `original.md` → MCP 暴露”闭环。

**Architecture:** 复用现有 `ScriptWorkbench` 与 `lingji_*` MCP 架构，在 Electron 主进程新增统一的视频导入服务。导入服务按“平台适配器 + 媒体处理 + ASR + 文本同步”分层组织；第一期只实现 `douyin + bcut`，但接口与目录结构按多平台扩展设计。

**Tech Stack:** Electron 41 IPC, React 19, Zustand 5, TypeScript 6, Node child_process, ffmpeg, Python worker（迁移 `BcutASR`）

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `src/lib/video-import-types.ts` | 新增 — 导入任务/结果/状态类型 |
| `electron/video-import/types.ts` | 新增 — 主进程导入服务类型 |
| `electron/video-import/douyin-downloader.ts` | 新增 — 抖音链接解析与视频下载 |
| `electron/video-import/media-extractor.ts` | 新增 — `ffmpeg` 音频提取 |
| `electron/video-import/transcript-writer.ts` | 新增 — `transcript.md` / 元数据写入 |
| `electron/video-import/import-service.ts` | 新增 — 导入编排服务 |
| `electron/video-import/python/asr_worker.py` | 新增 — 项目内 Python ASR worker |
| `electron/video-import/python/bcut_asr.py` | 新增 — 从旧脚本迁移的 `BcutASR` |
| `electron/video-import/python/common.py` | 新增 — ASR 数据结构与 SRT 生成 |
| `electron/main.ts` | 修改 — 新增导入 IPC 处理器 |
| `electron/preload.ts` | 修改 — 暴露视频导入 API |
| `src/lib/electron-api.ts` | 修改 — 新增导入 API 类型 |
| `src/store/script.ts` | 修改 — 新增导入状态 |
| `src/pages/ScriptWorkbench.tsx` | 修改 — 接入导入状态和工作流 |
| `src/components/script/DouyinImportDialog.tsx` | 新增 — 抖音链接导入 UI |
| `electron/mcp/tools.ts` | 修改 — 新增 `lingji_import_video_source` / `lingji_get_video_import_status` |
| `tests/video-import-service.test.ts` | 新增 — 导入服务测试 |
| `tests/electron-api.test.ts` | 修改 — 导入 API 类型测试 |
| `tests/script-store.test.ts` | 修改 — 导入状态测试 |
| `tests/mcp-tools.test.ts` | 新增或修改 — MCP 工具测试 |

---

## Chunk 1: 类型与目录约定

### Task 1: 定义渲染层与主进程共享类型

**Files:**
- Create: `src/lib/video-import-types.ts`
- Create: `electron/video-import/types.ts`
- Test: `tests/video-import-types.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/video-import-types.test.ts` 新建类型运行时断言辅助测试，覆盖：
- `sourceType` 固定为 `douyin`
- 状态枚举包含 `downloading / extracting_audio / transcribing / syncing / done / error`
- 结果结构包含 `videoPath / transcriptPath / originalPath`

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/video-import-types.test.ts`
Expected: FAIL，文件不存在

- [ ] **Step 3: 创建渲染层类型文件**

在 `src/lib/video-import-types.ts` 定义：
- `VideoImportSourceType`
- `VideoImportStatus`
- `VideoImportRequest`
- `VideoImportResult`
- `VideoImportProgress`

- [ ] **Step 4: 创建主进程类型文件**

在 `electron/video-import/types.ts` 定义：
- 平台元数据
- 导入任务上下文
- 下载结果
- 转录结果
- 最终导入结果

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/video-import-types.test.ts`
Expected: PASS

---

### Task 2: 固化项目目录落盘规则

**Files:**
- Create: `electron/video-import/transcript-writer.ts`
- Test: `tests/video-import-service.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/video-import-service.test.ts` 先加目录路径构造断言：
- 输入 `projectDir=/tmp/demo, videoId=123`
- 输出目录为 `imports/douyin/123`
- 文件名固定为 `video.mp4 / audio.mp3 / transcript.srt / transcript.md / source.json / import-result.json`

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/video-import-service.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现路径构造辅助**

在 `transcript-writer.ts` 里实现：
- `buildDouyinImportPaths(projectDir, videoId)`
- `writeSourceMetadata(...)`
- `writeTranscriptMarkdown(...)`
- `writeImportResult(...)`

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/video-import-service.test.ts`
Expected: PASS

---

## Chunk 2: 下载与媒体处理

### Task 3: 迁移抖音下载器

**Files:**
- Create: `electron/video-import/douyin-downloader.ts`
- Test: `tests/video-import-service.test.ts`

- [ ] **Step 1: 写失败测试**

新增 downloader 单测，mock 页面 HTML / JSON，覆盖：
- 可从分享链接解析 `videoId`
- 可从页面数据提取标题与下载 URL
- 输出路径固定为项目目录下的 `video.mp4`

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/video-import-service.test.ts -t douyin`
Expected: FAIL

- [ ] **Step 3: 从现有脚本迁移最小下载逻辑**

将参考实现中的：
- URL 提取
- `videoId` 解析
- 页面数据提取
- 下载链接解析

迁移到 `douyin-downloader.ts`，但移除与分析无关逻辑，只保留下载所需最小实现。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/video-import-service.test.ts -t douyin`
Expected: PASS

---

### Task 4: 实现音频提取器

**Files:**
- Create: `electron/video-import/media-extractor.ts`
- Test: `tests/video-import-service.test.ts`

- [ ] **Step 1: 写失败测试**

为 `extractAudioToMp3` 写单测：
- 成功时返回 `audio.mp3`
- `ffmpeg` 不存在时抛出明确错误

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/video-import-service.test.ts -t ffmpeg`
Expected: FAIL

- [ ] **Step 3: 实现最小主进程封装**

在 `media-extractor.ts` 中：
- 使用 `spawn` 或 `execFile` 调用 `ffmpeg`
- 统一转换错误信息
- 输出固定落到导入目录中的 `audio.mp3`

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/video-import-service.test.ts -t ffmpeg`
Expected: PASS

---

## Chunk 3: Python ASR Worker 迁移

### Task 5: 拆出 Python ASR 公共结构

**Files:**
- Create: `electron/video-import/python/common.py`
- Create: `electron/video-import/python/bcut_asr.py`
- Test: `tests/video-import-service.test.ts`

- [ ] **Step 1: 写失败测试**

准备主进程侧 worker 输出 contract 测试，要求 Python worker 输出：
- `segments`
- `full_text`
- `srt_text`
- `engine=bcut`

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/video-import-service.test.ts -t worker`
Expected: FAIL

- [ ] **Step 3: 迁移 `BcutASR`**

从旧脚本迁移：
- `ASRDataSeg`
- `ASRData`
- `BcutASR`
- SRT 组装逻辑

删除：
- `jianying`
- LLM 校正
- CLI 无关参数
- 旧性能日志与无关入口

- [ ] **Step 4: 运行测试确认结构通过**

Run: `npx vitest run tests/video-import-service.test.ts -t worker`
Expected: PASS

---

### Task 6: 实现项目内 Python worker 入口

**Files:**
- Create: `electron/video-import/python/asr_worker.py`
- Test: `tests/video-import-service.test.ts`

- [ ] **Step 1: 写失败测试**

增加主进程对 worker 的 contract 测试：
- 输入 `audio.mp3`
- 输出 `transcript.srt` 与 `transcript.md` 内容

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/video-import-service.test.ts -t contract`
Expected: FAIL

- [ ] **Step 3: 实现 worker CLI**

`asr_worker.py` 负责：
- 接收 `audioPath`
- 固定使用 `bcut`
- 输出 JSON 到 stdout
- 错误输出统一格式到 stderr / 非 0 退出码

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/video-import-service.test.ts -t contract`
Expected: PASS

---

## Chunk 4: 主进程导入服务与 IPC

### Task 7: 编排导入服务

**Files:**
- Create: `electron/video-import/import-service.ts`
- Test: `tests/video-import-service.test.ts`

- [ ] **Step 1: 写失败测试**

编写导入成功路径测试，mock：
- downloader
- extractor
- python worker
- 文件写入

断言最终结果：
- `transcript.md` 已生成
- `original.md` 已同步
- `import-result.json` 已生成

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/video-import-service.test.ts -t import-service`
Expected: FAIL

- [ ] **Step 3: 实现导入编排**

`import-service.ts` 负责串行执行：
1. 下载视频
2. 提取音频
3. 调用 worker 做 `bcut` ASR
4. 写入字幕和转录文本
5. 将 `transcript.md` 同步到 `original.md`
6. 返回最终导入结果

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/video-import-service.test.ts -t import-service`
Expected: PASS

---

### Task 8: 暴露 Electron API

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/lib/electron-api.ts`
- Test: `tests/electron-api.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/electron-api.test.ts` 中新增类型与方法断言：
- `importVideoSource`
- `getVideoImportStatus`

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/electron-api.test.ts`
Expected: FAIL

- [ ] **Step 3: 增加 IPC handler**

在 `electron/main.ts` 中新增：
- `import-video-source`
- `get-video-import-status`

在 `preload.ts` 与 `electron-api.ts` 中同步暴露类型与方法。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/electron-api.test.ts`
Expected: PASS

---

## Chunk 5: 工作台 UI 与状态

### Task 9: 扩展 Script Store 导入状态

**Files:**
- Modify: `src/store/script.ts`
- Test: `tests/script-store.test.ts`

- [ ] **Step 1: 写失败测试**

增加 store 测试，覆盖：
- 初始状态为 `idle`
- 可更新进度与最后一次导入结果
- 错误状态不会清空已有原稿

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/script-store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现最小状态**

新增：
- `videoImportStatus`
- `videoImportProgress`
- `lastVideoImport`
- 对应 actions

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/script-store.test.ts`
Expected: PASS

---

### Task 10: 新增抖音导入弹层与工作台入口

**Files:**
- Create: `src/components/script/DouyinImportDialog.tsx`
- Modify: `src/pages/ScriptWorkbench.tsx`
- Test: `tests/script-workbench-video-import.test.tsx`

- [ ] **Step 1: 写失败测试**

为工作台渲染测试增加断言：
- 空状态显示“从抖音链接导入”
- 导入中显示进度文案

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/script-workbench-video-import.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 UI**

新增导入弹层：
- 链接输入框
- 开始导入按钮
- 进度显示

在 `ScriptWorkbench.tsx` 接入：
- 调用 `window.electronAPI.importVideoSource`
- 导入成功后刷新 `original.md`

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/script-workbench-video-import.test.tsx`
Expected: PASS

---

## Chunk 6: MCP 工具接入

### Task 11: 新增 MCP 导入工具

**Files:**
- Modify: `electron/mcp/tools.ts`
- Test: `tests/mcp-tools.test.ts`

- [ ] **Step 1: 写失败测试**

新增工具测试，断言：
- 存在 `lingji_import_video_source`
- 存在 `lingji_get_video_import_status`
- 参数校验 `sourceType=douyin`

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/mcp-tools.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现工具注册**

在 `electron/mcp/tools.ts` 中新增：
- `lingji_import_video_source`
- `lingji_get_video_import_status`

要求：
- 与现有 `lingji_*` 风格一致
- 统一使用主进程导入服务
- 返回 JSON 文本结果

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/mcp-tools.test.ts`
Expected: PASS

---

## Chunk 7: 验证与文档

### Task 12: 端到端验证与 README 更新

**Files:**
- Modify: `README.md`
- Test: `tests/video-import-service.test.ts`

- [ ] **Step 1: 跑核心测试集**

Run:
```bash
npx vitest run tests/video-import-types.test.ts tests/video-import-service.test.ts tests/electron-api.test.ts tests/script-store.test.ts tests/mcp-tools.test.ts
```
Expected: PASS

- [ ] **Step 2: 更新 README**

补充：
- 工作台支持从抖音链接导入原稿
- 视频与转录文件落到 `imports/douyin/`
- 第一期开启 `bcut` ASR

- [ ] **Step 3: 全量回归**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: 提交实现**

```bash
git add README.md electron/main.ts electron/preload.ts electron/mcp/tools.ts src/lib/electron-api.ts src/store/script.ts src/pages/ScriptWorkbench.tsx src/components/script/DouyinImportDialog.tsx src/lib/video-import-types.ts electron/video-import tests
git commit -m "feat: add douyin video import for script workbench"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-10-douyin-video-import-plan.md`. Ready to execute?

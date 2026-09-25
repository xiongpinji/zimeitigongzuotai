# 欢迎页「本地视频文件」新建工程 — 设计文档

日期：2026-06-19
分支：feat/lingji-cli

## 1. 背景与目标

欢迎页（`Setup`）目前可以用「抖音链接」新建一个工程：解析链接拿到标题 → 建同名工程目录 → 下载抖音视频 → 提取音频 → bcut 转录 → 生成 `original.md`，并可选「一键成稿」。

**缺口**：无法用「本地视频文件」新建工程。用户已有视频文件时，只能先建空工程再进脚本工作台导入，无法在欢迎页一步到位。

**目标**：在欢迎页追加「本地视频」新建工程入口，流程与抖音导入对齐，但**跳过下载步骤**——直接复制用户选中的本地视频文件，其余（提取音频 → 转录 → 同步 `original.md` → 可选一键成稿）完全复用现有链路。

## 2. 关键前提：后端/IPC 已就绪

本次改动**仅在 Renderer/UI 层**，不动 `main.ts` / `preload.ts` / `electron-api.ts` / IPC / 后端服务：

- `selectMediaFile('video')` IPC：弹系统文件选择器，返回视频文件路径。已存在。
- `importVideoSource({ sourceType: 'local_video', filePath, projectDir, syncToOriginal })`：后端 `import-service.ts` 对 `local_video` 已实现「复制文件 → 提取音频 → 转录 → 同步 original.md」，**本身就跳过下载**。已存在。
- `video-import-progress` 是**所有来源共用**的进度事件通道；preload 里的 `onDouyinImportProgress` 只是命名误导，实际对 `local_video` 同样触发。已存在。
- `getVideoImportStatus(importId)` 轮询。已存在。
- MCP 工具 `lingji_import_video_source` 已支持 `local_video`（与本设计无关，仅佐证后端就绪）。

## 3. 现有抖音新建工程流程（被平行的对象）

```
Setup.tsx「抖音导入」quick item
  → 抖音弹窗：resolveDouyinUrl→title｜选父目录｜可选 AutoModeSection
  → onDouyinImport(parentDir, title, url, autoMode, autoParams, modelBinding)
  → App.handleDouyinImport：建空工程({parentDir}/{title}) + setPendingDouyinUrl(url) + 导航
      → autoMode 时去 'auto-run'，否则去 'script-workbench'
  → 消费方（二选一）：
      · ScriptWorkbench effect：consume pendingDouyinUrl → handleImportMediaSource({sourceType:'douyin',url})
      · AutoRunController effect：importVideoSource({sourceType:'douyin',url}) → 订阅进度 → done 后跑 useAIVideoWorkflow
```

## 4. 选定方案：泛化 pending 态 + 全套 AutoMode 对齐

把「从欢迎页带入待导入源」的载体从 `pendingDouyinUrl: string` **泛化**为已存在的联合类型 `VideoImportSourceInput`（`{sourceType:'douyin',url} | {sourceType:'local_video'|'local_audio',filePath}`）。两个消费方按 `sourceType` 分支，本地视频因此自动获得「一键成稿」能力，与抖音完全对齐。无重复 plumbing。

代价：会改到现有抖音路径（store 字段、App handler、两个消费方），但全部是机械等价替换；实现后需回归验证抖音手动 + 一键两条路径仍工作。

## 5. 改动清单（全部 Renderer）

### 5.1 `src/store/script.ts`
- `pendingDouyinUrl: string | null` → `pendingMediaImport: VideoImportSourceInput | null`
- `setPendingDouyinUrl` → `setPendingMediaImport`
- 默认值 `null`，setter 同形。
- 引入 `VideoImportSourceInput` 类型。

### 5.2 `src/App.tsx`
- 将 `handleDouyinImport` 泛化/合并为单一 `handleMediaImport(parentDir, title, source: VideoImportSourceInput, autoMode, autoParams, modelBinding)`：
  - 逻辑与现 `handleDouyinImport` 一致（clearCurrentProject / restoreState(createBlankScriptProjectState) / setTimeline / setProjectDir / addRecentProject …），仅把 `setPendingDouyinUrl(url)` 换成 `setPendingMediaImport(source)`。
  - autoMode 分支保持不变（绑定模型 → setPendingAutoParams → 'auto-run'），否则 'script-workbench'。
- 传给 `Setup` 的 prop 由 `onDouyinImport` 统一为 `onMediaImport`（两个弹窗都用它，传不同 source）。

### 5.3 `src/pages/Setup.tsx`
- 快捷功能行追加「本地视频」quick item（图标 `FileVideo`），打开新弹窗 `localVideoDialogOpen`。
- 新增本地视频弹窗（与抖音弹窗结构平行）：
  - **选文件**：`selectMediaFile('video')` → 设 `localVideoPath`，并由文件名（去扩展名）推导默认工程名 `localVideoTitle`。
  - **工程名**：用一个可编辑 `Input` 预填文件名 stem（本地文件名常不适合直接做目录名，允许编辑；这是相对抖音的小增强）。
  - **选父目录**：`selectProjectDirectory()` → `localVideoParentDir`，预览 `{parentDir}/{title}`。
  - **一键成稿**：复用 `AutoModeSection` + `autoModeOptions`，平行新增 `localVideoAutoMode/Params/ModelBinding` 状态（沿用抖音弹窗的状态模式）。
  - **确认**：校验 title/parentDir/path → `onMediaImport(parentDir, title, {sourceType:'local_video', filePath: localVideoPath}, autoMode, autoParams, autoMode?modelBinding:null)` → 关闭弹窗。
  - 无「解析」步骤（本地文件无需联网解析）。
- 弹窗关闭时重置本地视频相关状态（含 AutoMode），与抖音弹窗一致。

### 5.4 `src/pages/ScriptWorkbench.tsx`
- 第 ~1426 行 effect：消费 `pendingMediaImport`（替换 `pendingDouyinUrl`）：
  - `setPendingMediaImport(null)` → `setDouyinImportOpen(true)` → `handleImportMediaSource(pendingMediaImport)`。
- `handleImportMediaSource(source: VideoImportSourceInput)` 已支持全部来源类型，无需改动其内部逻辑。

### 5.5 `src/components/AutoRunController.tsx`
- 读取 `pendingMediaImport`（替换 `pendingDouyinUrl`）。
- `source: 'text' | 'douyin'` → `'text' | 'media'`；判定 `pendingMediaImport || mediaKickedRef.current ? 'media' : 'text'`。
- 触发导入：`importVideoSource({ ...pendingMediaImport, projectDir, syncToOriginal: true })`。
- 进度订阅（`onDouyinImportProgress` 共享通道）保持不变。
- refs 重命名以去抖音味：`douyinKickedRef→mediaKickedRef`、`douyinTaskIdRef→mediaTaskIdRef`（内部名，纯清晰度）。
- 任务条 label 由 sourceType 推导：抖音「步骤 1/6 · 导入抖音视频」、本地视频「步骤 1/6 · 导入本地视频」（小 helper）。
- 错误兜底 `failedStep: 'douyin_importing'` 保留该 step key（见 5.6），仅文案泛化。

### 5.6 `src/components/AutoRunOverlay.tsx`
- 保留 `WorkflowStep` 的 `douyin_importing` **键名不变**（避免动 `ai.ts` 联合类型及全部用点，降低风险），仅把其展示文案泛化为对两种来源都准确：
  - `STEP_LABELS.douyin_importing`：`'导入抖音'` → `'导入素材'`
  - `STEP_SHORT_LABELS.douyin_importing`：保持 `'导入'`
- 记一笔技术债：`douyin_importing` 键名后续可重命名为 `media_importing`，本次不做。

## 6. 数据流（本地视频新建工程）

```
Setup「本地视频」→ 选视频文件(selectMediaFile) + 编辑工程名 + 选目录 + 可选一键成稿
  → onMediaImport(parentDir, title, {sourceType:'local_video', filePath}, …)
  → App.handleMediaImport：建空工程 + setPendingMediaImport(source) + 导航
  → 手动：ScriptWorkbench effect → handleImportMediaSource(source)
       → importVideoSource(local_video) → 轮询 → done → finalizeVideoImport
  → 一键：AutoRunController → importVideoSource(local_video) → 订阅进度 → done → useAIVideoWorkflow
        （复制视频 → 提取音频 → 转录 → 同步 original.md，无下载）
```

## 7. 边界与错误处理

- 文件类型：`selectMediaFile('video')` 的系统选择器已限制视频类型；确认前校验 path 非空。
- 工程名为空 / 父目录未选 → 禁用「创建」按钮（与抖音一致）。
- 目录重名：沿用现有抖音行为（不在本次扩展），如已存在同名目录由下游写入逻辑决定，不在此特判。
- 导入失败 / 超时：复用 ScriptWorkbench `waitForVideoImport` 与 AutoRunController 既有错误兜底，无新增路径。
- 取消 / 离开：AutoRunController 既有清理逻辑改为清 `pendingMediaImport`。

## 8. 测试与验证

- 类型与构建：`npm run build`（共享 store 字段重命名需全量编译通过）。
- 相关单测：`npx vitest run`（涉及 video-import / setup / script store 的现有用例必须仍绿；如有引用 `pendingDouyinUrl` 的测试需同步改名）。
- 手动回归（关键，因改到抖音路径）：
  1. 抖音手动新建工程 → 正常下载转录。
  2. 抖音一键成稿 → AutoRunController 正常跑完。
  3. 本地视频手动新建工程 → 复制+转录+生成 original.md，无下载步骤。
  4. 本地视频一键成稿 → 导入后自动跑写稿/TTS/卡片/封面。
  5. 脚本工作台内「导入媒体」弹窗本地视频模式仍工作（未被波及）。

## 9. 明确不做（YAGNI）

- 不动 main/preload/electron-api/IPC/后端服务。
- 不加 lingji CLI 的 `import` 命令（另一独立缺口，本次不涉及）。
- 不重命名 `douyin_importing` step key（仅泛化文案）。
- 不处理本地音频新建工程入口（脚本工作台弹窗已有 local_audio；欢迎页本次只加视频，保持范围聚焦）。
- 不做目录重名特殊处理。
```

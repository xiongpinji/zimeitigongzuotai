# 项目数据持久化与配置整合设计

## 背景与问题

AI 一键剪辑完成后，重新打开项目时所有数据丢失：口播稿资源设置、时间轴配置、AI 助手内容/设置/封面。根因分析：

1. **AI Store 无自动保存**：Timeline store 有 subscribe + 300ms 防抖自动写磁盘；AI store 完全没有，`toggleCardEnabled`、`updateCard`、`selectCover` 等操作只改内存不写磁盘
2. **AI 设置只存 localStorage**：LLM/TTS/即梦配置通过 `saveAISettings()` 写入浏览器 localStorage，清缓存即丢失
3. **三套配置文件完全隔离**：`timeline.json` / `ai-analysis.json` / `script-state.json` 各自独立，加载时不互通，无统一入口

## 设计方案

### 模块 1：AI Store 自动保存

**变更文件**：`src/store/ai.ts`

在 AI store 底部添加与 timeline store 相同模式的 subscribe 机制：

- 监听 `analysisResult` 和 `coverCandidates` 变化
- 300ms 防抖写入 `project.json` 的 `aiAnalysis` 段（通过 `save-project-section` IPC）
- 复用 `createPersistedAIState()` 序列化
- 新增 `aiSaveStatus` 事件系统，类型与 timeline 共用 `SaveStatus`（`idle | saving | saved | error`）
- 暴露 `subscribeToAISaveStatus()` 和 `getCurrentAISaveStatus()` 供 UI 消费
- `projectDir` 从 `getCurrentProjectDir()` 获取（与 timeline 共用同一个 localStorage key），无 projectDir 时跳过保存

### 模块 2：Toolbar 聚合保存状态

**变更文件**：`src/App.tsx`、`src/components/Toolbar.tsx`

将 Toolbar 的 `saveStatus` 升级为 timeline + AI 两个 store 保存状态的聚合：

- `App.tsx` 中新增 `aiSaveStatus` 状态，通过 `subscribeToAISaveStatus()` 订阅
- 聚合逻辑（优先级从高到低）：
  - 任一为 `error` → 显示 `error`（"保存失败"）
  - 任一为 `saving` → 显示 `saving`（"保存中…"）
  - 两者都为 `saved` → 显示 `saved`（"已保存"）
  - 否则 → 保持原有逻辑
- 传给 Toolbar 的仍是单个 `SaveStatus`，Toolbar 组件无需修改
- 不额外加 icon 或动画，保持当前 Toolbar 简洁风格

### 模块 3：AI 设置迁移到 Electron 全局存储

**变更文件**：`electron/main.ts`、`electron/preload.ts`、`src/lib/electron-api.ts`、`src/store/ai.ts`、`src/components/AISettingsModal.tsx`、`src/components/settings/AIConfigTab.tsx`、`src/components/settings/TTSConfigTab.tsx`、`src/hooks/useAIVideoWorkflow.ts`

使用 `app.getPath('userData')` 下的 `settings.json` 作全局设置存储：

**Main 进程**：
- 文件路径：`~/Library/Application Support/video-web-master/settings.json`
- 直接 `fs.readFileSync` / `fs.writeFileSync`，不引入第三方依赖
- 新增 IPC handler：
  - `load-global-settings` → 读取并返回 `AISettings` 对象
  - `save-global-settings` → 写入 `AISettings` 对象

**Preload / Renderer**：
- `preload.ts` 暴露 `loadGlobalSettings()` / `saveGlobalSettings()`
- `electron-api.ts` 加对应类型声明
- `ai.ts` 中 `loadAISettings()` / `saveAISettings()` 改为调用 IPC（异步化）

**自动迁移**：
- 首次启动检测 localStorage 中 `podcast-editor-ai-settings` 有旧数据 → 调 `saveGlobalSettings` 写入 → 清除 localStorage 旧 key

**影响范围**：
- `AISettingsModal.tsx`、`AIConfigTab.tsx`、`TTSConfigTab.tsx` 中的 load/save 调用改为 async
- `useAIVideoWorkflow.ts` 中 `loadAISettings()` 改为 async

### 模块 4：统一项目配置文件 + 文稿直读

**变更文件**：`electron/main.ts`、`electron/preload.ts`、`src/lib/electron-api.ts`、`src/lib/ai-persistence.ts`、`src/lib/script-persistence.ts`、`src/store/timeline.ts`、`src/store/ai.ts`、`src/store/script.ts`、`src/App.tsx`、`src/hooks/useAIVideoWorkflow.ts`

#### 统一 project.json

将 `timeline.json`、`ai-analysis.json`、`script-state.json` 合并为 `project.json`：

```
projectDir/
├── project.json          ← 唯一项目配置文件
├── original.md           ← 原始素材文本
├── script.md             ← 生成的文稿
├── ai-cards/             ← web card HTML 文件
├── covers/               ← 封面图片
└── *.mp3 / *.srt         ← 音频和字幕文件
```

**project.json 结构**：

```json
{
  "version": 1,
  "createdAt": "2026-04-10T00:00:00.000Z",
  "updatedAt": "2026-04-10T00:00:00.000Z",
  "timeline": {
    "podcast": { "audioPath": "", "srtPath": "", "durationMs": 0 },
    "subtitleConfig": {},
    "overlays": [],
    "globalBackground": ""
  },
  "aiAnalysis": {
    "analysisResult": null,
    "coverCandidates": []
  },
  "script": {
    "templateId": "news-broadcast",
    "annotations": [],
    "reviewState": "idle",
    "lastReviewedDocVersion": 0
  }
}
```

#### IPC 变更

新增：
- `load-project(projectDir)` → 读取 `project.json`，返回完整对象；不存在时尝试迁移旧文件
- `save-project-section(projectDir, section, data)` → Main 进程内 read-modify-write + 写锁序列化

`save-project-section` 的 `section` 参数为 `'timeline' | 'aiAnalysis' | 'script'`，Main 进程内部流程：
1. 获取写锁（per-projectDir 的 Promise 链序列化）
2. 读取当前 `project.json`
3. 合并目标 section
4. 更新 `updatedAt`
5. 写回磁盘
6. 释放锁

废弃（兼容期保留读取能力用于迁移）：`save-timeline` / `load-timeline` / `save-ai-analysis` / `load-ai-analysis` / `save-script-state` / `load-script-state`

#### 向下兼容迁移

`load-project` 中若 `project.json` 不存在：
1. 尝试读取 `timeline.json` / `ai-analysis.json` / `script-state.json`
2. 合并为 `project.json` 格式
3. 写入 `project.json`
4. 删除旧文件

#### 加载流程

`App.tsx` 的 `openProject()`：
1. 调用 `loadProject(projectDir)` 获取完整 project 数据
2. timeline 段 → `setTimeline()`
3. aiAnalysis 段 → `setAnalysisResult()` + `setCoverCandidates()`
4. script 段 → script store hydrate
5. SRT 文件解析（从 timeline.podcast.srtPath）
6. 路由到对应页面

#### 保存流程

三个 store 各自独立 subscribe：
- Timeline subscribe → `saveProjectSection(projectDir, 'timeline', data)`
- AI subscribe → `saveProjectSection(projectDir, 'aiAnalysis', data)`
- Script subscribe → `saveProjectSection(projectDir, 'script', data)`

均使用 300ms 防抖，Main 进程写锁保证并发安全。

#### AI 一键剪辑文稿来源

`useAIVideoWorkflow` 中直接从磁盘读取：
```typescript
const scriptText = await window.electronAPI.loadScriptFile(projectDir, 'script.md');
```
不缓存到任何 store，用完即丢。Store 各管各的 domain。

## 不做的事

- 不新增 per-project AI 设置覆写——全局设置统一管理
- 不合并多个 Zustand store——保持 timeline / ai / script 三个 store 按 domain 分离
- 不修改 `script.md` / `original.md` 的存储方式——文本文件保持独立
- 不修改 web card HTML 的存储方式
- 不修改 Toolbar 组件的 UI 结构或样式

## 验证策略

- 单元测试：`project.json` 的序列化/反序列化/迁移逻辑
- 集成验证：AI 工作流完成 → 关闭应用 → 重新打开 → 验证所有数据恢复
- 迁移验证：旧格式项目（含 `timeline.json` + `ai-analysis.json`）→ 打开后自动迁移为 `project.json`
- 并发安全验证：快速连续修改 timeline + AI card → 确认 `project.json` 不损坏

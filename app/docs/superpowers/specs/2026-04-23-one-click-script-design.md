# 欢迎页一键成稿设计

- 创建时间：2026-04-23
- 状态：Design（待 review）
- 主负责：yoqu

## 背景

当前欢迎页有两个主要项目创建入口：「导入文稿」（`ImportScriptDialog`）和「抖音导入」（`DouyinImportDialog`）。两者都把用户带到 `script-workbench`，再依次：

1. AI 写稿（`generateScriptDraftStream` 驱动虚拟光标）
2. AI 审稿（`runScriptReview`）
3. 进入编辑器
4. 在编辑器里手动跑「AI 一键剪辑」（`useAIVideoWorkflow.runFromStep('tts_generating', ...)`）

对一部分用户来说，从原始素材到「可导出 MP4」需要 4 段交互、来回切两次页面，而其中每一步几乎都是确认默认值。我们希望提供一个 **自动模式**：在欢迎页勾选「一键成稿」后，整个界面冻住，自动跑完 **写稿 → TTS → 字幕 → AI 分析 → 字幕高亮 → 封面 → 卡片 + 时间轴排布**，跳过审稿，结束后直接落到编辑器（或失败时回退到对应页继续手工处理）。

抖音入口在自动模式下还要把「下载 + 转写」也并入同一条进度条，作为前置「第 0 步」。

## 目标与非目标

### 目标

- 在 `ImportScriptDialog` 与 `DouyinImportDialog` 上各加一个「☑️ 一键成稿（自动模式）」复选框。
- 勾选后展开 3 个参数下拉（写稿模板 / 写稿角色 / TTS 音色），默认值取自现有全局设置 / 上次使用值。
- 勾选后提交，App 切换到新增的 `auto-run` 顶层页面，`AutoRunOverlay` 全屏显示进度，禁用其他交互（仅 ESC / 取消按钮可用）。
- 复用 `useAIVideoWorkflow` 编排 5 步 AI 工作流，前置加 1 步 `script_generating`，外加抖音入口的「第 0 步」`douyin_importing`。
- 任意步失败：保留已生成产物，按失败步骤跳转到 `script-workbench` 或 `editor`，不弹强制阻断。
- 取消：停在当前步之后，跳 `script-workbench`，已生成产物保留。
- 把 `electron/video-import/import-service.ts` 的内部任务 snapshot 桥接到 `useTaskProgressStore`，让抖音下载/转写也走统一进度条。

### 非目标（YAGNI）

- 不修改现有"手动一键剪辑"路径（`runFromStep` + Editor 内 `TimelineAIOverlay`）。
- 不引入"暂停/继续"机制，只支持取消。
- 不为自动模式新增"重试当前步骤"按钮；用户跳到对应页后用现有手动入口重试。
- 不在自动模式下自动导出 MP4（编辑器里仍是手动点导出）。
- 不在自动模式 Dialog 里支持新建模板 / 新建角色 / 新建音色（只能选已有的）。
- 不持久化"上次自动模式参数"为独立字段，复用 ScriptStore / AISettings 已有的 last\* / default\* 字段即可。

## 用户旅程

### 文本入口

```
欢迎页 → 「导入文稿」按钮
  → ImportScriptDialog
      [粘贴/上传 original 内容]
      [项目目录、项目名]
      ☑️ 一键成稿（自动模式）   ← 新增
        ├ 写稿模板：[news-broadcast ▼]
        ├ 写稿角色：[默认 ▼]
        └ TTS 音色：[female-shaonv ▼]
      [取消]  [确认]
  → App.handleImportScript({ ..., autoMode, autoParams })
      ├ autoMode=false：原行为（跳 script-workbench）
      └ autoMode=true：跳 page='auto-run'
            → AutoRunOverlay mount
                → runAutoWorkflow({ originalText, projectDir, autoParams })
                → 7 步进度
                → 成功：跳 page='editor'
                → 失败：按 §错误处理 跳页
                → 取消：跳 page='script-workbench'
```

### 抖音入口

```
欢迎页 → 「抖音导入」按钮
  → DouyinImportDialog
      [URL] [项目目录]
      ☑️ 一键成稿（自动模式）   ← 新增
        ├ 写稿模板 / 角色 / TTS 音色（同上）
      [取消]  [确认]
  → App.handleDouyinImport({ ..., autoMode, autoParams })
      ├ autoMode=false：原行为（跳 script-workbench，等抖音下载完成弹出 AI 写稿）
      └ autoMode=true：
            ├ 创建项目骨架
            ├ ScriptStore.setPendingDouyinUrl(...)
            ├ 跳 page='auto-run'
            └ AutoRunOverlay mount
                → 监听 ScriptStore.douyinImportStatus
                → 第 0 步：douyin_importing（下载 + 转写）
                → 完成后 original.md 已存在 → 自动续 runAutoWorkflow
                → 后续与文本入口一致
```

## 步骤与状态机

```
WorkflowStep（自动模式）
  idle
    → douyin_importing       ← 仅抖音入口
    → script_generating      ← 新增
    → tts_generating         ← 现有
    → analyzing              ← 现有
    → highlighting           ← 现有
    → cover_generating       ← 现有
    → card_layouting         ← 现有
    → done | error
```

| 步骤 | 复用函数 / IPC | 持久化目标 | 失败跳转 |
|---|---|---|---|
| `douyin_importing` | `electron/video-import/import-service.ts`（已有） + 新桥到 `useTaskProgressStore` | `original.md` | `script-workbench` |
| `script_generating` | `generateScriptDraft(originalText, templateId, roleId)` (`src/lib/script-utils.ts:148`) + `electronAPI.writeScriptFile(projectDir, content)` | `script.md` | `script-workbench` |
| `tts_generating` | `electronAPI.generateTTS(...)` | `podcast-audio.mp3`、`podcast-subtitles.srt`、`timeline.podcast` | `script-workbench` |
| `analyzing` | `electronAPI.analyzeSrt(...)` + `useAIStore.setAnalysisResult(...)` | `aiAnalysis.analysisResult` | `editor` |
| `highlighting` | `generateSubtitleHighlights(...)` (`src/lib/subtitle-highlight-runner.ts`) | `aiAnalysis.highlights` / `timeline.subtitles` | `editor` |
| `cover_generating` | `generateCoverCandidates(...)` (`src/lib/cover-generation.ts`) | `aiAnalysis.coverCandidates` | `editor` |
| `card_layouting` | `buildAICardTimelineDraft(...)` + `useAIStore.setMotionCards(...)` | `aiAnalysis.motionCards`、`timeline.tracks` | `editor` |

`script_generating` 实现要点：
- 使用 **非流式** 版本 `generateScriptDraft`（自动模式下 `auto-run` 页面可见，`script-workbench` 没挂载，没必要驱动虚拟光标动画）。
- 写盘走 IPC `writeScriptFile`（preload 现状待 plan 阶段确认；若没有就补一个，签名 `(projectDir, content) => Promise<void>`）。
- 同步更新 `useScriptStore` 的内存态（即便 ScriptWorkbench 当前没挂载，等用户取消/失败回到 ScriptWorkbench 时也能立刻看到内容）。

## 架构设计

### 模块关系

```
Setup.tsx (欢迎页)
  ├─ ImportScriptDialog   ── (autoMode, autoParams) → onImportScript
  └─ DouyinImportDialog   ── (autoMode, autoParams) → onDouyinImport
        │
        ▼
App.tsx
  ├─ handleImportScript / handleDouyinImport
  │   ├ autoMode=false：原行为
  │   └ autoMode=true：setPage('auto-run') + 缓存 autoParams 到内存态
  │
  └─ AppPage='auto-run'
        └─ AutoRunOverlay (新增)
              ├─ 读取 autoParams + 入口类型
              ├─ 文本入口：runAutoWorkflow({...})
              ├─ 抖音入口：监听 ScriptStore.douyinImportStatus → runAutoWorkflow({...})
              ├─ 订阅 useAIVideoWorkflow.workflow & useTaskProgressStore
              ├─ 取消按钮 → cancelAutoWorkflow()
              └─ 失败/完成 → setPage(...)

useAIVideoWorkflow (升级)
  ├─ WorkflowStep 增加 'script_generating' / 'douyin_importing'
  ├─ runAutoWorkflow(input)：内部串 script_generating → 现有 5 步
  ├─ runFromStep(...)：保持不变（手动模式仍走原路径）
  ├─ cancelAutoWorkflow()：标记中断点 + 在下一个 await 边界停下
  └─ 在 store 上保留 autoMode flag（用于 UI 判定）

electron/video-import/import-service.ts
  └─ 新增 progress hook：每次 task snapshot 变化时 emit 到 main → preload → renderer
        ↓
useTaskProgressStore (复用)
  └─ 新 category 'douyin-import'（颜色按 PROGRESS-SPEC.md 的 'import' 归类）
```

### 类型定义草案

```ts
// src/store/ai.ts 或独立文件
export type WorkflowStep =
  | 'idle'
  | 'douyin_importing'    // 新增
  | 'script_generating'   // 新增
  | 'tts_generating'
  | 'analyzing'
  | 'highlighting'
  | 'cover_generating'
  | 'card_layouting'
  | 'done'
  | 'error'

export interface AutoWorkflowParams {
  templateId: string
  roleId?: string
  voiceId: string
  // TTS 其他参数（speed/vol/pitch/emotion）走 AISettings 默认
}

export interface AutoWorkflowInput {
  source: 'text' | 'douyin'
  projectDir: string
  originalText?: string         // text 入口必传；douyin 入口由抖音转写产出
  pendingDouyinUrl?: string     // douyin 入口必传
  params: AutoWorkflowParams
}

export interface WorkflowState {
  step: WorkflowStep
  autoMode: boolean             // 新增
  failedStep?: WorkflowStep     // 新增
  errorMessage?: string
  // ...原有字段
}
```

### Dialog UI 增量

`ImportScriptDialog` / `DouyinImportDialog` 各引入一个共享的小组件 `<AutoModeSection>`：

```tsx
<AutoModeSection
  enabled={autoMode}
  onToggle={setAutoMode}
  params={autoParams}
  onChangeParams={setAutoParams}
  templateOptions={...}     // 来自 useScriptStore
  roleOptions={...}         // 来自 useScriptStore
  voiceOptions={...}        // 来自 useAISettings.tts
  defaults={...}            // 上次使用 / 全局默认
/>
```

这样 Dialog 里只多 ~10 行 wiring，控件复用既有 macOS 风格 select。

### AutoRunOverlay 结构

```
全屏遮罩（z-index 1200，覆盖 AppStatusBar 之上的弹窗层之外，但保留底部进度条可见）
  ├─ 顶部品牌（灵机剪影 logo + 灰字"自动成稿"）
  ├─ 中央卡片
  │    ├─ 当前步骤大标题（如"正在合成语音..."）
  │    ├─ 副文案（"已完成 3 / 7 步"）
  │    ├─ 7 段进度条（每段独立，已完成 = 实色，进行中 = 动画，未开始 = 灰）
  │    ├─ 整体百分比（来自 useTaskProgressStore 单一 task 的 progress）
  │    └─ 子步骤详情区（TTS 时显示 MiniMax 进度，封面时显示已生成 N 张）
  └─ 右下角操作
       ├─ 运行中：[取消]
       ├─ 失败：[查看 ScriptWorkbench] 或 [查看 Editor] + [复制错误]
       └─ 成功：自动跳，无按钮
```

视觉直接抽 `TimelineAIOverlay` 的样式 token；不复用整个组件，因为后者的容器假设是 Editor 内嵌。

## 数据流详解

### 文本入口（autoMode=true）

```
1. Dialog 提交：
     onImportScript({
       parentDir, projectName, content,
       autoMode: true,
       autoParams: { templateId, roleId, voiceId }
     })

2. App.handleImportScript：
     - 创建项目目录（复用现有逻辑）
     - 写 original.md（复用现有逻辑）
     - useScriptStore.setProjectDir(...)
     - 把 autoParams 暂存到 useAIStore（新增 ephemeral 字段 pendingAutoParams）
     - setPage('auto-run')

3. AutoRunOverlay mount（useEffect 一次性）：
     - 读 useAIStore.pendingAutoParams 与 useScriptStore.projectDir
     - 调用 useAIVideoWorkflow.runAutoWorkflow({ source:'text', ... })
     - 清空 pendingAutoParams（防止重新进入时再跑一次）

4. workflow 推进：每步开始时 useTaskProgressStore.updateTask（同一个 taskId 横跨 7 步）

5. 完成：workflow.step='done' → AutoRunOverlay 监听 → setPage('editor')
```

### 抖音入口（autoMode=true）

```
1. Dialog 提交：
     onDouyinImport({ url, projectDir, autoMode:true, autoParams })

2. App.handleDouyinImport：
     - 创建项目骨架
     - useScriptStore.setPendingDouyinUrl(url)
     - useAIStore.setPendingAutoParams(autoParams)
     - setPage('auto-run')

3. AutoRunOverlay mount：
     - 读到 pendingDouyinUrl → 触发抖音下载（复用 ScriptWorkbench 当前的 handleImportDouyin 逻辑，但要把它从 ScriptWorkbench 抽到一个 hook 共享）
     - 进入 douyin_importing 步骤
     - 桥接 import-service 的 progress 到 useTaskProgressStore
     - 抖音转写完成 → original.md 已存在 → 自动续 runAutoWorkflow（从 script_generating 起跑）

4. 之后与文本入口一致
```

### 进度条桥接

`electron/video-import/import-service.ts` 当前内部维护 `tasks: Map<importId, snapshot>`，但只在主进程内部用。改造：

```ts
// import-service.ts
private notifyProgress(snapshot: ImportTaskSnapshot) {
  this.emit('progress', snapshot)  // 已有
  // 新增：转发到 BrowserWindow
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('douyin-import-progress', snapshot)
  )
}
```

```ts
// preload.ts
onDouyinImportProgress(cb) { ipcRenderer.on('douyin-import-progress', (_, s) => cb(s)) }
```

```ts
// useAIVideoWorkflow / AutoRunOverlay
electronAPI.onDouyinImportProgress(snapshot => {
  useTaskProgressStore.updateTask(taskId, {
    progress: mapToOverallPercent(snapshot),
    label: snapshot.stepLabel,
    category: 'import',
  })
})
```

## 错误处理

| 失败步骤 | 跳转 | 原因 |
|---|---|---|
| `douyin_importing` | `script-workbench` | 用户需要换 URL 或切到文本入口 |
| `script_generating` | `script-workbench` | 用户需要改 original.md 或重试写稿 |
| `tts_generating` | `script-workbench` | 用户需要改 script.md 或重试 TTS（ScriptWorkbench 有 TTS 重试入口） |
| `analyzing` / `highlighting` / `cover_generating` / `card_layouting` | `editor` | audio + srt 已生成，编辑器有手动重跑入口 |

失败时 `AutoRunOverlay` 不自动跳，先在中央卡片展示错误 + 一个 `[继续到 XXX]` 按钮，由用户点。这避免突兀的 loading→错误页瞬切。

`useTaskProgressStore` 上对应 task 走 `failTask(taskId, errorMessage)`。

取消行为：
- 点击 `[取消]` → `useAIVideoWorkflow.cancelAutoWorkflow()` 设置 `cancelled=true`
- 当前步完成（不再续步） → `workflow.step='cancelled'`
- 已完成步骤的产物全部保留
- AutoRunOverlay 监听到 → setPage('script-workbench')
- ESC 等价于点击取消

## UI 冻结策略

- `AutoRunOverlay` 是顶层全屏组件（不嵌在任何具体页面），覆盖整个 App 视口（包括左/右侧栏 if any）。
- 唯一例外：底部 `AppStatusBar` 仍可见（保持统一进度条心智，避免「双进度条」）。Overlay 中央卡片的进度只是更醒目的可视化，与底部进度条共享同一个 task。
- 屏蔽全局快捷键：在 `auto-run` 页激活时，禁用 Editor / ScriptWorkbench 的全局键盘 hook。
- 禁用菜单项：`setMenuContext({ activePage: 'auto-run', hasProject: true, isAutoRunning: true })` → main 进程禁用 File/Edit 菜单中所有可能触发副作用的项。

## 持久化

每步完成后已经走现有 store → debounced `saveProjectSection`，无需额外改造：

- `script_generating` 后：`script.md` 已落盘 + ScriptStore 状态变更 → script section 自动保存
- `tts_generating` 后：TimelineStore.setPodcast(...) → timeline section 自动保存
- `analyzing` / `highlighting` / `cover_generating` / `card_layouting` 后：AIStore 各 setter → aiAnalysis section 自动保存

`AutoRunOverlay` 不直接写 project.json。

## 测试策略

| 层级 | 用例 |
|---|---|
| 单测 - workflow | `useAIVideoWorkflow.runAutoWorkflow` 串联各步成功；`script_generating` 单步 mock；TTS 失败时 `failedStep='tts_generating'` 设置正确 |
| 单测 - workflow | `cancelAutoWorkflow` 设置中断标志，下一步不再启动 |
| 单测 - 进度桥 | `import-service` emit progress → `useTaskProgressStore` 收到对应 update（mock IPC） |
| 单测 - Dialog | `ImportScriptDialog` / `DouyinImportDialog` 勾选/取消勾选 `autoMode` 时回传字段正确 |
| 组件测 - Overlay | 按 step 变化渲染对应文案；失败渲染按钮；取消触发回调 |
| 集成测 - App | autoMode=true 时 `handleImportScript` 跳到 `page='auto-run'`（mock 工作流让它不真跑） |
| 集成测 - App | 完成后跳 `editor`；失败后停在 overlay |
| 手动 E2E | 文本入口完整跑通；抖音入口完整跑通；中间网络拔线模拟失败 |

测试文件命名约定（沿用现有）：`tests/auto-run-workflow.test.ts`、`tests/auto-run-overlay.test.tsx`、`tests/dialog-auto-mode.test.tsx`。

## 高风险改动清单

- 修改 `WorkflowState` / `WorkflowStep` 类型（共享类型，影响 `useAIVideoWorkflow` 所有调用方）
- 修改 `electron/video-import/import-service.ts` 增加 IPC 通道（IPC 三件套同步：main / preload / electron-api）
- 新增 `writeScriptFile` IPC（如果 preload 当前不存在）
- 新增 `AppPage = 'auto-run'`（影响 App 路由与菜单上下文）
- `useAIStore.pendingAutoParams` 是新增 ephemeral 字段，不进 project.json，需要确保不被持久化序列化误抓

## 待 plan 阶段确认的细节

1. preload 是否已有 `writeScriptFile` IPC？没有则补。
2. `ScriptWorkbench` 当前的抖音下载触发逻辑能否轻松抽出到一个共享 hook（`useDouyinImport`）供 `AutoRunOverlay` 复用？预计要做小重构。
3. `useAIVideoWorkflow` 现在依赖的 store 切片是否便于 mock，决定测试方式。
4. `AISettings.tts.voiceId` 字段路径与可选语音列表的取数源。
5. 模板/角色下拉是否需要"自定义模板"分组（目前 ScriptWorkbench 走的同一套 UI 即可）。

## 落地顺序建议（提示 plan 阶段拆 step）

1. Workflow 类型与 `runAutoWorkflow` 骨架（不实现 douyin_importing），先让文本入口跑通
2. AutoRunOverlay 视觉 + 文本入口接线
3. Dialog 加 AutoModeSection
4. App.handleImportScript 接入 autoMode 分支 + 测试
5. import-service 进度桥接 IPC 三件套
6. 抖音入口接线 + AutoRunOverlay 第 0 步
7. 错误处理与跳转
8. 菜单上下文与全局快捷键屏蔽
9. 测试补全 + 手动 E2E

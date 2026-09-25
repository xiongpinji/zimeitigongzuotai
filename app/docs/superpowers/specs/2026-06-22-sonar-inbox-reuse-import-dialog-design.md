# 待创作箱「生成初稿」复用一键创作弹窗 — 设计

- 日期：2026-06-22
- 状态：已确认，待实现
- 范围：Renderer（`Setup` 页、`SonarInboxPanel`、`ImportScriptDialog`）

## 背景与问题

桌面端欢迎页的「待创作箱」（`SonarInboxPanel`）列出声呐扩展经本地桥推入的二创素材（转录稿 + 元数据）。
当前点「生成初稿」时：

- 面板顶部有一个**自带的**「选择父目录」按钮（一个目录管所有条目）。
- 点击后直接 `Setup.handleDraftFromInbox` **静默起飞**流水线：硬编码 `autoMode=true`、
  `templateId='rewrite-remix'`、写稿模型固定取**全局默认**（`autoModeOptions.defaultModelBinding`）。
- 用户**没有机会**为这一条素材选择生成目录、写稿模型、角色、音色。

而「一键创作弹窗」——即「导入文稿」`ImportScriptDialog`（以及抖音/本地视频两个同构弹窗）——
恰好提供：存放目录选择器 + `AutoModeSection`（写稿模型 / 角色 / TTS 音色 + 一键开关），
确认后进入同一个 `onImportScript` 流水线。

两条路径其实早已**汇流到同一个 `onImportScript`**，待创作箱只是跳过了配置弹窗、硬编码了参数。
目标：让「生成初稿」**复用现有弹窗**，而不是新起一条 UI 线路。

## 目标

- 点「生成初稿」打开现有 `ImportScriptDialog`，预填该条目的转录稿与项目名。
- 用户在弹窗里选择：存放目录 / 写稿模型 / 角色 / TTS 音色，确认后走**完全相同**的 `onImportScript`。
- 不新增第二个弹窗、不新增第二条流水线。

## 非目标

- 不修改 `onImportScript` / `useAIVideoWorkflow` 流水线本身。
- 不修改抖音 / 本地视频导入弹窗（它们已自带 `AutoModeSection`）。
- 不修改声呐桥（bridge）或 inbox 存储结构（`electron/sonar/inbox-store.ts`、`~/.lingji/sonar-inbox.json`）。

## 数据流（改造后）

```text
待创作箱「生成初稿」
  → SonarInboxPanel.onRequestDraft(item)          // 只上报，不再直接起飞
  → Setup：记住 inboxDraftItem + 计算预填，打开 ImportScriptDialog
       预填：content = 转录稿(inboxItemToOriginalMarkdown)
            projectName = 「博主-标题」(deriveProjectName)
            autoMode = ON
            templateId = rewrite-remix（二创转述）
  → 用户在弹窗选择：存放目录 / 写稿模型 / 角色 / 音色 → 确认
  → handleConfirmImportScript → onImportScript(...)   // 现有流水线，零改动
  → 确认成功后：sonarInboxMarkStatus(item.id, 'drafted', { projectPath })
```

## 改动点

### 1. `src/components/script/ImportScriptDialog.tsx` — 增加可选预填 / 覆盖 props

新增可选 props（全部缺省时行为与现状完全一致）：

- `initialContent?: string` — 打开时预填文稿内容（textarea）。
- `initialProjectName?: string` — 打开时预填项目名。
- `initialParentDir?: string | null` — 打开时预填存放目录。
- `initialAutoMode?: boolean` — 一键模式开关初值（默认 `false`；inbox 传 `true`）。
- `templateIdOverride?: string` — 写稿模板覆盖（inbox 传 `'rewrite-remix'`）。
  因为 `templateId` 在 UI 上不暴露（`AutoModeSection` 隐藏），需要在 `autoParams.templateId`
  上以该覆盖值播种，并保证它进入 `onConfirm` 回传的 `autoParams`。

实现要点：

- 把现有「关闭时重置为默认」的 `useEffect` 改为「**打开时按 initial\* 播种**」语义：
  当 `open` 变为 `true` 时，用 `initial*`（缺省回退到 `autoModeOptions.defaults` /
  `defaultModelBinding`）初始化 `content` / `projectName` / `parentDir` / `autoMode` /
  `autoParams`（含 `templateId = templateIdOverride ?? defaults.templateId`）/ `modelBinding`。
- 普通「导入文稿」入口不传任何 `initial*` / `templateIdOverride`，行为不变。

### 2. `src/components/setup/SonarInboxPanel.tsx` — 瘦身为「只请求」

- prop 由 `onDraft(item, parentDir): Promise<void>` 改为 `onRequestDraft(item): void`（同步、不带目录）。
- **移除**面板自带的：`parentDir` state、`pickDir`、顶部「选择父目录 / 更改父目录」整行 UI（`dirRow`）。
  目录改在弹窗里选（单一来源）。
- 「生成初稿」按钮只调用 `onRequestDraft(item)`；**不再**在点击时 `sonarInboxMarkStatus(item.id, 'creating')`
  （用户可能在弹窗里取消）。`canDraftInboxItem(item)` 守卫与 `item.status === 'creating'` 禁用逻辑保留。
- `busyId` 不再需要（按钮不再异步起飞）；删除相关 state。

### 3. `src/pages/Setup.tsx` — 复用同一个 `ImportScriptDialog` 实例

- 新增 `inboxDraftItem: SonarInboxItem | null` state，记住是哪条 inbox 触发的。
- 新增 `handleRequestDraftFromInbox(item)`：
  - `setInboxDraftItem(item)`；
  - 打开 `importScriptOpen`。
  - 预填值在渲染处计算并作为 props 传给 `ImportScriptDialog`：
    `initialContent = inboxItemToOriginalMarkdown(item)`、
    `initialProjectName = deriveProjectName(item)`、
    `initialAutoMode = true`、`templateIdOverride = 'rewrite-remix'`。
- `handleConfirmImportScript` 末尾（`onImportScript` 成功、关闭弹窗之后）：
  - 若 `inboxDraftItem` 非空：调用
    `window.electronAPI.sonarInboxMarkStatus?.(inboxDraftItem.id, 'drafted', { projectPath: \`${parentDir}/${projectName}\` })`，
    随后 `setInboxDraftItem(null)`。
  - 若 `inboxDraftItem` 为空（普通导入路径）：不做任何 inbox 标记。
- 弹窗关闭 / 取消：`onOpenChange(false)` 时清空 `inboxDraftItem`，inbox 项保持 `pending`。
- `SonarInboxPanel` 的 prop 由 `onDraft={handleDraftFromInbox}` 改为 `onRequestDraft={handleRequestDraftFromInbox}`。
- 旧的 `handleDraftFromInbox` 删除（其职责拆入「请求打开弹窗」+「确认后标记」）。

> 注：仍复用 `Setup` 里已有的单个 `ImportScriptDialog`。普通「开始创作 / 导入文稿」入口
> 与 inbox 入口共用它，靠 `inboxDraftItem` 是否为空区分预填与确认后行为。

## 关键行为约定

- **模板默认二创转述**：inbox 默认 `rewrite-remix`；普通导入沿用工作台当前选中模板（`autoModeOptions.defaults.templateId`）。
- **一键模式默认开**：inbox 打开弹窗时 `autoMode = ON`（用户可关）；普通导入默认 `false`（不变）。
- **目录单一来源**：目录只在弹窗里选，消除「面板目录 vs 弹窗目录」双份不一致。
- **标记时机**：仅在 `onImportScript` 成功后标记 `drafted`；不在按钮点击时标记 `creating`（取消弹窗不应改状态）。

## 错误 / 取消路径

- 弹窗内 `onImportScript` 抛错：沿用 `handleConfirmImportScript` 现有 `try/catch`，显示 `importScriptError`，
  **不**标记 inbox（保持 `pending`，用户可重试）。
- 用户取消弹窗：清空 `inboxDraftItem`，inbox 项保持 `pending`。

## 测试

- `ImportScriptDialog`：
  - 传入 `initialContent` / `initialProjectName` / `initialParentDir` / `initialAutoMode` 时打开即预填。
  - `templateIdOverride` 在确认时进入 `onConfirm` 回传的 `autoParams.templateId`。
  - 不传任何 `initial*` 时，打开后状态与现状一致（回归保护）。
- `Setup` ↔ inbox 串联：
  - `onRequestDraft(item)` 打开预填弹窗（内容=转录稿、名=派生名）。
  - 确认后 `onImportScript` 收到（转录稿、派生名、`autoMode=true`、`templateId='rewrite-remix'`、用户所选 modelBinding），
    且 `sonarInboxMarkStatus(item.id, 'drafted', { projectPath })` 被调用。
  - 取消弹窗时不调用 `sonarInboxMarkStatus`。

## 影响面与风险

- 纯 Renderer 改动，不涉及 IPC 三件套、不涉及 `project.json` 迁移、不涉及共享类型。
- `SonarInboxPanel` 的 prop 契约变更（`onDraft` → `onRequestDraft`），需同步唯一调用方 `Setup` 与相关测试。
- `ImportScriptDialog` 仅新增**可选** props，普通导入入口零变更。

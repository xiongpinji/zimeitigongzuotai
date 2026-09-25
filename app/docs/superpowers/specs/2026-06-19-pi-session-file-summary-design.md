# pi 会话改动文件结果集面板 — 设计

- 日期：2026-06-19
- 分支：feat/lingji-cli
- 范围：AI Agent 内置 pi 框架对话结束后，汇总本次会话新增/修改/删除的文件，提供快速预览与「打开方式」。

## 背景

内置 pi agent 的对话经 `tool_result` 事件流转，已在渲染层把连续的工具调用提取为 `file_changed` block（`src/components/agent/tool-call-descriptor.ts` 的 `FileChangeDescriptor`），由 `FileChangedBlock.tsx` 渲染每回合的 diff 与 `+/-` 行数。`turn_complete` 事件已标记会话/回合结束（`src/contexts/acp-connections-context.tsx`）。已有 IPC：`show-item-in-folder`、`open-external`（`electron/main.ts` + `electron/preload.ts`）。

缺口：缺少一张「会话级」结果集卡片，把整次对话触碰的全部文件去重汇总，并为每个文件提供快速预览 / 默认 App 打开 / 在 Finder 中显示。

## 决策（已与用户确认）

1. 统计范围：**整个会话聚合**——一张结果卡片，渲染在会话结束（非 streaming）后的最后一条 assistant message 之后。
2. 文件类型：**全部触碰的文件**——新增、编辑、删除统一进一个列表，每行带操作标签与 `+/-` 行数。
3. 打开方式：**精简版**——macOS：快速预览(Quick Look) / 打开(默认 App) / 在 Finder 中显示；非 macOS：打开 / 在文件管理器中显示。不做完整 LaunchServices App 选择器。
4. 预览方式：**交给系统**——点击即调用 macOS Quick Look 或默认 App，不在应用内内联播放图片/视频。
5. 现有每回合内联 `FileChangedBlock` diff **保留不动**；本面板是会话末尾的额外汇总。

## 架构

采用「**渲染时派生**」：`file_changed` block 已随 turn 持久化，会话结束面板在渲染时扫描该会话所有已完成 turn 的 `file_changed` block 聚合，无需新增 store 状态或持久化字段，重载后自动重现。

放弃「存进 store 累加」方案（需新增状态 + 持久化，重复造轮子）。

## 组件与数据流

### 1. 聚合纯函数 `src/components/agent/session-file-summary.ts`

- 输入：某会话的 `turns[]`（已完成的 assistant turns，含其 `content[]` 中的 `file_changed` block）。
- 遍历所有 `file_changed` block，按绝对路径去重；同一文件多次操作合并：
  - 操作终态规则：先 `create` 后 `edit` → `create`；任意态后 `delete` → `delete`；否则取首个非空操作（默认 `edit`）。
  - `+added / -removed`：沿用 `FileChangedBlock` 现有 `changedLineCount` 逻辑（基于 `structuredPatch`），跨多次操作累加。
  - `kind`：按扩展名分类 `image | video | audio | markdown | document | code | other`，用于图标与副标题（如「图像 · PNG」「文档 · MD」）。
- 输出 `SessionFileSummary { files: SummaryFile[]; totalAdded: number; totalRemoved: number }`，其中 `SummaryFile { path; name; ext; kind; operation; added; removed }`。

### 2. 面板组件 `src/components/agent/SessionFileSummaryPanel.tsx`

渲染条件：会话 `status` 非 streaming **且** 聚合文件数 ≥ 1。位置：最后一条 assistant message 之后。

- 标题行：`本次共改动 N 个文件`，可附 `+totalAdded -totalRemoved`，沿用现有中文风格与 `--color-system-blue` accent。
- 每行：类型图标 + 文件名 + 副标题（`图像 · PNG` / `文档 · MD`）+ 右侧「打开方式 ▾」下拉。
- 下拉（复用 `src/ui` 现有 dropdown primitive）：
  - macOS：`快速预览` / `打开` / `在 Finder 中显示`
  - 非 macOS：`打开` / `在文件管理器中显示`
- 删除态文件：不提供预览/打开（路径已不存在），仅保留「在 Finder 中显示」其父目录可选；标灰。

### 3. IPC 三件套

- `electron/main.ts`：
  - 新增 `quick-look-file` handler：`process.platform === 'darwin'` 时 spawn `qlmanage -p <path>`；否则降级 `shell.openPath(path)`。
  - 新增 `open-path` handler：`shell.openPath(path)`（默认 App 打开）。
  - `show-item-in-folder`、`open-external` 已存在，复用。
- `electron/preload.ts`：`electronAPI` 暴露 `quickLookFile(path)`、`openPath(path)`；暴露 `platform`（若未暴露）供 renderer 判断 macOS。
- `src/lib/electron-api.ts`：同步类型契约，避免与 preload 漂移。

## 错误处理

- `quickLookFile` / `openPath` 对不存在路径：main 侧捕获 `shell.openPath` 返回的错误字符串 / spawn 失败，记录日志，不抛给 renderer（静默或返回 `{ ok:false, error }`）。
- 删除态文件 UI 层提前禁用预览/打开。
- 面板对空集合、streaming 中、缺失 `file_changed` 数据均安全降级为不渲染。

## 测试

- 纯函数 `session-file-summary.ts` 单测：create/edit/delete 聚合、按路径去重、行数累加、操作终态规则、扩展名分类。
- IPC 三件套对齐（main / preload / electron-api 同步）。
- 组件渲染：空集合不渲染、streaming 中不渲染、macOS / 非 macOS 下拉差异、删除态禁用。

## YAGNI（明确不做）

- 不做完整 LaunchServices App 选择器。
- 不做应用内内联图片/视频播放。
- 不新增持久化字段、不新增进度弹窗或顶部条。
- 不改动现有每回合 `FileChangedBlock` 行为。

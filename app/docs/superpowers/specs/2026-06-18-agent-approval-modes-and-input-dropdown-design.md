# Agent 审批模式 + AI 面板输入框扩展 设计

- 日期：2026-06-18
- 分支：feat/lingji-cli
- 范围：AI 面板（pi agent 对话）的审批模式控制（功能落地）+ 输入框 `+` 按钮改为 Dropdown 菜单
- 状态：设计已与用户逐段确认，待用户复核本文档后进入实现计划

## 1. 背景与问题

当前 AI 面板对话**缺少审批模式控制**。底层其实已存在一套权限基础设施，但既没有 UI，也没有真正作用到内置 pi agent：

- 类型 `PermissionPolicy = 'auto_approve' | 'tiered' | 'always_ask'`（`electron/acp/types.ts:283`），默认 `tiered`。
- 持久化在 `~/.lingji/agent-config.json`，全局级（非 per-agent），见 `electron/acp/config.ts:10`。
- IPC 已通：`agent:get-permission-policy` / `agent:set-permission-policy`（`electron/acp/ipc.ts:217`），且 set 时调用 `runtimeRegistry.setPermissionPolicy(policy)` 同步到已连接运行时。
- 前端契约已暴露：`getPermissionPolicy` / `setPermissionPolicy`（`src/lib/agent-api.ts:94`、`electron/preload.ts:472`）。
- **但没有任何渲染层组件调用这两个 API。**

更关键的是，pi 的审批当前被**自动应答**：`electron/agent-runtime/parsers/pi-rpc.ts` 的 `replyExtensionUi` 对每个 `confirm` 直接回 `{confirmed:true}`、对 `select` 取首项。`runtime-registry.respondPermission` 是 `TODO(A10+)` 的 noop。因此 pi 实际运行在「完全访问」状态。

同时输入框的 `+` 按钮目前只是「添加文件」（`src/components/agent/MessageInput.tsx:625`），旁边另有一个独立的图片按钮。

## 2. 目标

1. 在 AI 面板输入框底栏新增 Codex 风格的审批模式控制（三态），并让模式**真正改变 pi 行为**（完整功能落地）。
2. 将输入框 `+` 按钮从「添加文件」改为 Dropdown 菜单：添加文件、添加照片、Skill 二级列表快速引入。

非目标：
- 不改动 ACP（claude/codex）旧路径的权限逻辑；本次只针对 pi 运行时路径。
- 不新增独立权限弹窗；复用既有 `PermissionPrompt` 卡片与统一进度/反馈体系。
- 不改动 attachment 的底层处理（文件/图片/拖拽/粘贴逻辑保持不变，只重组触发入口）。

## 3. 审批模式：语义与映射

| UI 标签 | 描述 | Policy 值 | pi `confirm` 请求处理 |
|---|---|---|---|
| 请求批准 | 编辑外部文件和使用互联网时始终询问 | `always_ask` | 始终路由到授权卡片；从不自动放行 |
| 替我审批 | 仅对检测到的风险操作请求批准 | `tiered`（默认） | 关联到工具调用并分类：风险→询问，良性→自动放行 |
| 完全访问权限 | 不受限制访问互联网和您电脑上的任何文件 | `auto_approve` | 自动放行（即当前行为） |

设计依据：pi 只在它**自己认为需要确认**的操作（写文件 / 跑命令等）时才发 `extension_ui_request{method:'confirm'}`。因此三态自然落在「自动放行 / 全部询问 / 风险子集询问」三档上。

### 3.1 风险分类（host 侧）

pi 的 `confirm` 请求是**不透明的**：`rpc-types.d.ts` 显示 `confirm` 仅携带 `title` / `message` / `timeout?`，不含工具名、路径、风险标记。所以分类必须由 host 侧基于**关联到的工具调用**完成。

pi-rpc 解析器已有可复用能力：
- `tool_execution_start` 事件携带 `toolCallId` / `toolName` / `args` / `input`（`pi-rpc.ts:284`）。
- 工具 kind 归类正则（`event-model.ts:104`）：`execute`（bash/shell/exec/run/command/kill）、`edit`（write/edit/create/delete/remove/rm/...）、`fetch`（fetch/http/web/curl/download）、`read`。
- `isFileEditTool`、文件路径键提取 `FILE_PATH_KEYS`（`pi-rpc.ts:57`）。
- `resolveSnapshotPath`（`pi-rpc.ts:157`）：解析路径是否在 `cwd`（项目目录）内；返回 null 表示项目外或非本地路径。

**风险判定规则**（命中任一即为「风险」）：
- kind === `execute`（跑命令 / shell / kill）。
- 删除类 edit（名字含 delete/remove/rm/unlink）。
- 文件路径解析到**项目目录之外**（`resolveSnapshotPath` 对一个真实路径返回 null）。
- kind === `fetch`（网络访问 / 下载）。

其余（项目内 read/edit）视为「良性」，在 `tiered` 下自动放行。

注：网络访问在 pi 协议中无标准化 URL 字段，只能从工具名（fetch/http/web/curl/download）与参数键（url/href/...）启发式推断；分类器尽力而为，无法识别时**从严**（倾向询问）。

### 3.2 confirm ↔ tool 关联策略

pi 的 `confirm` 与触发它的工具调用是分开的两条消息。解析器需：
1. 维护一个「最近 pending 工具调用」缓存（按 `toolCallId` 缓存 `tool_execution_start` 的 name/args；在 `tool_execution_end` 后保留短暂窗口）。
2. 收到 `confirm` 时，取**最近一个尚未结束 / 刚结束**的工具调用作为关联对象进行分类。
3. 若找不到关联工具（confirm 先于或无对应工具）：按**从严**处理——在 `tiered`/`always_ask` 下都询问。

### 3.3 其它交互方法

`extension_ui_request` 还有 `select` / `input` / `editor`：
- 本次审批门控只作用于 `confirm`（Allow/Deny 语义最匹配授权卡片）。
- `select` / `input` / `editor` 维持现有自动应答行为（select 取首项等），不纳入策略门控，避免阻塞 pi。后续可扩展。

## 4. 审批模式：实现（后端为主）

前端权限管线**已存在且对 pi 路径已接通事件通道**，只是 pi 端从不产生 `permission_request`：

- 运行时事件经 `agent:runtime-event` IPC → `onRuntimeEvent`（`preload.ts:509`）→ `applyRuntimeEvent`（`acp-connections-context.tsx:350`），其中已有 `case 'permission_request'`（约 413 行）写入 `pendingPermission`。
- `PermissionPrompt` 卡片已渲染（`AssistantMessage.tsx:223`），用户点击 → `respondPermission` → `respondConversationPermission`（`preload.ts:502`）→ IPC `agent:respond-permission-runtime`（`ipc.ts:200`）→ `runtimeRegistry.respondPermission`（当前 noop）。

因此需要改的文件：

### 4.1 `electron/agent-runtime/parsers/pi-rpc.ts`
- 新增 pending 工具缓存（见 3.2）。
- 注入「当前 policy」来源（由 runtime-registry 在创建/更新 session 时下发，见 4.3）。
- 改写 `replyExtensionUi` 中 `confirm` 分支：
  - `auto_approve`：维持 `{confirmed:true}` 立即回。
  - `always_ask`：不自动回；将 pi 请求 `id` 存入 pending-permission map；向上 emit 一个 `permission_request` 事件。
  - `tiered`：分类关联工具；风险→走 `always_ask` 分支；良性→立即 `{confirmed:true}`。
- 向上 emit 的事件需携带：`requestId`（pi 请求 id）、`toolCall`（合成 `{title, detail/path, kind}` 供卡片展示）、`options`（如：仅此次允许 / 始终允许 / 拒绝）。
- 新增一个方法/回调，供 runtime-registry 在收到用户响应时按 `requestId` 写回 `extension_ui_response{type:'extension_ui_response', id, confirmed}` 到 pi stdin。

### 4.2 `electron/agent-runtime/event-model.ts`
- 在 `RuntimeEventOut` 联合类型加入 `permission_request`（`{type:'permission_request'; requestId; toolCall; options}`），与 `acp-connections-context` 已处理的 payload 形状对齐。
- 在 parser → runtime 的事件映射中加入 `permission_request` 透传（解析器侧新增对应 AgentStreamEvent 变体，或直接在 registry 层透传）。

### 4.3 `electron/agent-runtime/runtime-registry.ts`
- 保存当前 `permissionPolicy`，并在创建 pi session / parser 时下发；`setPermissionPolicy` 时更新已连接 pi session 的 policy 引用（使运行时切换即时生效）。
- 用真实实现替换 noop `respondPermission(conversationId, requestId, optionId)`：根据 `optionId` 映射为 `confirmed` 布尔（allow→true、deny→false；allow_always 可选地记忆该会话同类操作放行，首版可不持久化），调用 pi parser 的写回方法把 `extension_ui_response` 发回 pi。

### 4.4 `electron/acp/ipc.ts`
- 现有 `agent:set-permission-policy` 已调用 `runtimeRegistry.setPermissionPolicy`；确认该调用能下发到**活跃 pi session**（而非仅记录）。事件转发与 respond IPC 已就绪，无需新增通道。

### 4.5 前端
- 权限卡片、context、respond 链路**零改动**即可工作。

## 5. 审批控制 UI（底栏 pill）

### 5.1 输入框底栏
- 位置：`MessageInput` 底栏左侧（与 `+` 同排），Codex 风格 pill：`[icon] 当前模式 ⌄`。
- 点击向上弹出 popover（复用 `MessageInput.tsx` 既有 `SelectorDropdown` 模式，或 `src/ui/components/` 的 `DropdownMenu`）：
  - 顶部标题行：「应如何批准操作?」+ 可选「了解更多」。
  - 三项，每项 title + 描述；当前项右侧打勾。
- 视觉态：
  - `auto_approve`（完全访问）→ 橙色/警示 accent + 警示图标（最宽松）。
  - `tiered`（替我审批）→ 中性 + 盾牌图标。
  - `always_ask`（请求批准）→ 中性 + 手势图标。
  - 图标取自既有 lucide 图标集（如 `AlertTriangle` / `ShieldCheck` / `Hand`）。

### 5.2 数据流
- 全局策略：pill 读写经既有 `getPermissionPolicy` / `setPermissionPolicy`，切换即时 `runtimeRegistry.setPermissionPolicy` 同步到已连接会话。
- pill 反映全局值，跨会话一致（与 Codex 将其视作会话级设置一致）。
- 需要新增的渲染层 plumbing：`MessageInput`（及父级 `ChatPane`）需拿到当前 policy + setter——以 thin prop 传入或直接从 agent context 读取。

### 5.3 设置页对齐
- 在 `AgentSettingsTab.tsx`（当前只管 skill）补一处同样的三态控制，读写同一 policy，提升可发现性。

## 6. `+` 按钮 → Dropdown 菜单

### 6.1 结构
合并当前的 `+`（文件）与独立图片按钮为**单一 `+` Dropdown**（`src/ui/components/` 的 `DropdownMenu`，向上展开）：

```
+ ┌─────────────────────────────┐
  │  📎  添加文件…                │  → 既有 selectTextFile() → addResourceAttachments
  │  🖼️  添加照片…                │  → 既有 image <input accept="image/*"> → addImageAttachments
  │  ─────────────────────────  │
  │  ✨  Skill                ▸  │  → 二级：已启用 skill 列表
  └─────────────────────────────┘
```

### 6.2 行为
- 「添加文件」「添加照片」复用**既有** handler（`handlePickFiles`、图片 input ref），不新增 attachment 逻辑；拖拽 / 粘贴路径不变。
- Skill 二级列表：数据源为已传入 `MessageInput` 的 `skillItems`（`{id,label,description}`，即当前启用的 skill）。选中某项 → 向 textarea **插入 `$skillId `**，复用既有 `$`/`+` autocomplete 同一机制（发送时进入 `opts.skillIds`）。无需新增 send-path plumbing。
- 空态：「未启用 Skill」+ 引导到设置页启用。

### 6.3 子菜单实现
- 优先使用 `DropdownMenu` 的嵌套子菜单能力。
- 若该组件不支持 flyout 子菜单：Skill 行改为同一菜单内的**内联展开（disclosure）**，对「快速插入」体验等价。

## 7. 默认决策（已与用户确认）

1. 将独立图片按钮**合并进 `+` Dropdown**。
2. 选中 Skill **插入 `$mention`**（而非立即启用/切换该 skill）。
3. 审批策略为**全局**（非 per-conversation），pill 与设置页共享同一值。

## 8. 影响面与风险

- 改动属 CLAUDE.md「高风险清单」中的 Agent 权限策略 / IPC 行为，但本设计**不改 IPC 名称 / 参数 / 返回值**，仅补全 pi 端 respond 实现与事件透传。
- 关键风险：pi 在 `tiered` 下「良性自动放行」依赖工具关联与分类准确性；分类无法判定时**从严询问**，避免误放行风险操作。
- 不阻塞性：`confirm` 之外的交互方法维持自动应答，pi 不会因新逻辑卡死。

## 9. 验证策略

- 单测：
  - 风险分类纯函数（execute / 删除 / 项目外路径 / fetch / 无关联→从严）。
  - confirm↔tool 关联选择逻辑。
  - `respondPermission` 将 optionId 正确映射为 `extension_ui_response`。
  - policy 三态在 parser 层的分支（auto_approve 立即放行 / always_ask 全询问 / tiered 子集）。
- 组件测：
  - 底栏 pill 渲染三态、勾选当前项、切换调用 setPermissionPolicy。
  - `+` Dropdown 渲染文件 / 照片 / Skill 子列表；选 skill 插入 `$id`。
- 手动验收：在 `always_ask` 下让 pi 写文件 / 跑命令，确认弹出 `PermissionPrompt` 并能 Allow/Deny；`auto_approve` 下不弹；`tiered` 下项目内编辑不弹、跑命令/项目外编辑弹。

## 10. 需要触及的文件清单

后端：
- `electron/agent-runtime/parsers/pi-rpc.ts`（分类 + 关联 + confirm 门控 + 写回）
- `electron/agent-runtime/event-model.ts`（`permission_request` 类型与映射）
- `electron/agent-runtime/runtime-registry.ts`（policy 下发 + `respondPermission` 实现）
- `electron/acp/ipc.ts`（确认 set-policy 下发到活跃 pi session）

前端：
- `src/components/agent/MessageInput.tsx`（底栏审批 pill + `+` Dropdown + Skill 子列表）
- `src/components/agent/ChatPane.tsx`（向 MessageInput 传 policy/setter，按需）
- `src/components/settings/AgentSettingsTab.tsx`（设置页三态控制）
- 复用零改动：`src/contexts/acp-connections-context.tsx`、`src/components/agent/AssistantMessage.tsx`、`src/lib/agent-api.ts`、`electron/preload.ts`

测试：
- 新增 pi-rpc 风险分类 / 门控测试、组件测试。

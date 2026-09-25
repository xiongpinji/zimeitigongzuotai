# ACP Conversation Workspace Alignment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前项目的 ACP 单会话侧边栏升级为与 `codeg` 语义一致的会话工作区，完整支持会话列表、切换、显式恢复、fork、重启后列表保留但不隐式续连。

**Architecture:** 以本地 SQLite 会话库作为唯一持久化真源，在 Electron Main 进程内拆出 `conversation db/repository/service/runtime registry` 四层；Renderer 侧从单一 `useAgentStore` 迁移为“会话工作区状态 + 按会话连接状态 + 详情视图”三层结构。ACP 运行时连接和会话持久化彻底解耦，只有用户显式打开某会话时才加载 `external_id=sessionId`。

**Tech Stack:** Electron 41、React 19、Zustand、Vitest、`node:sqlite`、ACP IPC。

---

## 语义澄清（必须统一）

- **应用启动/重启后**：
  - 恢复会话列表、上次打开记录、会话详情缓存。
  - **不允许**在没有用户动作的情况下隐式创建 ACP 连接或隐式恢复旧 `sessionId`。
- **用户显式点击某个会话 / 切换到某个会话标签时**：
  - 这属于“显式 attach/resume”。
  - 若会话已有 `external_id`，允许自动 `connect({ sessionId: external_id })`。
  - 若会话没有 `external_id`，则自动创建新 ACP session。
- **禁止的行为**：
  - 仅凭“当前项目目录”自动恢复旧 ACP session。
  - 应用启动后后台偷偷恢复最近会话连接。

---

## 文件结构

### Main Process

- Create: `electron/conversations/types.ts`
  - 会话领域模型、SQLite 行映射、IPC DTO、状态枚举。
- Create: `electron/conversations/db.ts`
  - 打开数据库、事务、基础执行器、数据库路径解析。
- Create: `electron/conversations/migrations.ts`
  - 初始化 `project_workspace`、`conversation`、`conversation_turn`、`project_opened_conversation` 四张表。
- Create: `electron/conversations/repository.ts`
  - 纯数据访问层，负责 CRUD、列表查询、turn 落库、fork 复制。
- Create: `electron/conversations/service.ts`
  - 业务服务层，负责创建/打开/切换/fork/恢复/会话统计。
- Create: `electron/conversations/ipc.ts`
  - 暴露 conversation IPC：list/detail/create/fork/update/openedConversation。
- Create: `electron/acp/connection-registry.ts`
  - 每个 conversation 一个运行时连接条目，替代全局 `sessionManager`。
- Modify: `electron/acp/ipc.ts`
  - 拆成 runtime IPC 装配层，按 `conversationId`/`sessionId` 路由连接、发消息、取消、断开。
- Modify: `electron/acp/session.ts`
  - 保持“仅显式 sessionId 才 load”的约束，并补齐按 conversation 透传事件所需字段。
- Modify: `electron/preload.ts`
  - 暴露 conversation API 与按会话的 agent runtime API。
- Modify: `electron/main.ts`
  - 注册 conversation IPC、初始化数据库。

### Renderer

- Create: `src/types/conversation.ts`
  - 前端 Conversation/Turn/Workspace DTO。
- Create: `src/lib/conversation-api.ts`
  - conversation IPC 调用封装。
- Create: `src/contexts/conversation-workspace-context.tsx`
  - 会话列表、选中会话、创建/fork/重命名/删除入口。
- Create: `src/contexts/acp-connections-context.tsx`
  - 按会话维护 ACP 运行时状态，映射 live message、permission、usage。
- Create: `src/contexts/conversation-runtime-context.tsx`
  - 合并“已持久化 turns + 当前 live turn”，给详情视图消费。
- Create: `src/hooks/use-conversation-list.ts`
- Create: `src/hooks/use-conversation-detail.ts`
- Create: `src/hooks/use-connection.ts`
- Create: `src/hooks/use-connection-lifecycle.ts`
- Create: `src/components/agent/SessionListPane.tsx`
- Create: `src/components/agent/ConversationDetailPane.tsx`
- Create: `src/components/agent/ConversationToolbar.tsx`
- Create: `src/components/agent/ForkConversationDialog.tsx`
- Modify: `src/components/agent/AgentSidebar.tsx`
  - 从“单侧边栏”升级为“会话工作区壳层”。
- Modify: `src/components/agent/AgentHeader.tsx`
- Modify: `src/components/agent/InputBar.tsx`
- Modify: `src/components/agent/MessageList.tsx`
- Modify: `src/components/agent/StatusBar.tsx`
- Modify: `src/components/agent/GuideCards.tsx`
- Modify: `src/components/agent/AgentQuickActions.tsx`
- Modify: `src/components/script/QuickActionBar.tsx`
- Modify: `src/lib/agent-api.ts`
  - 让事件与方法携带 `conversationId`/`contextKey`。
- Modify: `src/store/agent.ts`
  - 仅保留兼容过渡，逐步退出单实例消息真源角色。

### Tests

- Create: `tests/conversation-db.test.ts`
- Create: `tests/conversation-service.test.ts`
- Create: `tests/acp-connection-registry.test.ts`
- Create: `tests/conversation-workspace.test.tsx`
- Modify: `tests/agent-store.test.ts`
- Modify: `tests/acp-session.test.ts`

---

## Chunk 1: 会话数据库与领域服务

### Task 1: 建立 SQLite 会话库骨架

**Files:**
- Create: `electron/conversations/types.ts`
- Create: `electron/conversations/db.ts`
- Create: `electron/conversations/migrations.ts`
- Test: `tests/conversation-db.test.ts`

- [ ] **Step 1: 写失败测试，定义数据库初始化后的表结构与字段约束**

```ts
it('creates conversation tables with required columns', () => {
  const db = createConversationDb(tempDir)
  const tables = listTables(db)
  expect(tables).toContain('conversation')
  expect(tables).toContain('conversation_turn')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/conversation-db.test.ts`
Expected: FAIL，提示 `createConversationDb` 或表结构不存在。

- [ ] **Step 3: 最小实现数据库打开器与迁移执行器**

```ts
export function createConversationDb(baseDir: string): DatabaseSync {
  const db = new DatabaseSync(resolveDbPath(baseDir))
  runConversationMigrations(db)
  return db
}
```

- [ ] **Step 4: 完成表结构**

```sql
create table if not exists conversation (
  id integer primary key autoincrement,
  project_id text not null,
  title text,
  agent_type text not null,
  status text not null,
  external_id text,
  parent_id integer,
  message_count integer not null default 0,
  session_stats_json text,
  created_at text not null,
  updated_at text not null
);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/conversation-db.test.ts`
Expected: PASS。

### Task 2: 实现 repository 与 service 基础能力

**Files:**
- Create: `electron/conversations/repository.ts`
- Create: `electron/conversations/service.ts`
- Test: `tests/conversation-service.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 create/list/detail/openedConversation**

```ts
it('persists and lists conversations by project', async () => {
  const created = service.createConversation({ projectId: 'p1', agentType: 'claude-acp' })
  const list = service.listConversations('p1')
  expect(list[0]?.id).toBe(created.id)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/conversation-service.test.ts`
Expected: FAIL，提示 service/repository 未实现。

- [ ] **Step 3: 实现最小 repository CRUD**

```ts
createConversation(input) { ... }
listConversations(projectId) { ... }
getConversationDetail(id) { ... }
setOpenedConversation(projectId, conversationId) { ... }
```

- [ ] **Step 4: 实现 service 层规则**

```ts
if (!input.title) title = buildDefaultConversationTitle(now)
status = 'draft_local'
openedConversation = created.id
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/conversation-service.test.ts`
Expected: PASS。

---

## Chunk 2: ACP 多会话运行时与 IPC 对齐

### Task 3: 建立按会话隔离的 connection registry

**Files:**
- Create: `electron/acp/connection-registry.ts`
- Modify: `electron/acp/session.ts`
- Test: `tests/acp-connection-registry.test.ts`

- [ ] **Step 1: 写失败测试，覆盖“不同 conversationId 拥有不同运行时”**

```ts
it('keeps separate runtime entries per conversation', async () => {
  const registry = createRegistry()
  await registry.connect({ conversationId: 1, projectDir: '/tmp/a' })
  await registry.connect({ conversationId: 2, projectDir: '/tmp/a' })
  expect(registry.size()).toBe(2)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/acp-connection-registry.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 registry，封装 connect/send/cancel/disconnect/getState**

```ts
registry.connect({ conversationId, sessionId, projectDir, agentType })
registry.get(conversationId)
registry.disconnect(conversationId)
```

- [ ] **Step 4: 调整 `SessionManager` 事件，保证事件包含 sessionId 并可由 registry 重新包装**

```ts
emitRuntimeEvent(conversationId, { type: 'session_started', sessionId })
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/acp-connection-registry.test.ts tests/acp-session.test.ts`
Expected: PASS。

### Task 4: 迁移 IPC 到“会话 + 运行时分离”模型

**Files:**
- Create: `electron/conversations/ipc.ts`
- Modify: `electron/acp/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/lib/agent-api.ts`

- [ ] **Step 1: 写失败测试，覆盖 conversation IPC 与 agent runtime IPC 的参数约束**

```ts
expect(window.agentAPI.connect).toAccept(projectDir, conversationId, sessionId)
expect(window.conversationAPI.list).toBeDefined()
```

- [ ] **Step 2: 运行相关测试确认失败**

Run: `npm test -- tests/acp-session.test.ts tests/agent-store.test.ts`
Expected: FAIL。

- [ ] **Step 3: 增加 conversation IPC**

```ts
ipcMain.handle('conversation:list', ...)
ipcMain.handle('conversation:create', ...)
ipcMain.handle('conversation:fork', ...)
ipcMain.handle('conversation:detail', ...)
```

- [ ] **Step 4: 重写 agent runtime IPC 签名**

```ts
ipcMain.handle('agent:connect', (_event, args) => {
  return registry.connect(args)
})
```

- [ ] **Step 5: preload 与 renderer API 对齐**

```ts
connect(args: { projectDir: string; conversationId: number; sessionId?: string | null })
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -- tests/acp-session.test.ts tests/agent-store.test.ts`
Expected: PASS。

---

## Chunk 3: Renderer 会话工作区骨架

### Task 5: 引入 conversation workspace/context/runtime 三层状态

**Files:**
- Create: `src/types/conversation.ts`
- Create: `src/lib/conversation-api.ts`
- Create: `src/contexts/conversation-workspace-context.tsx`
- Create: `src/contexts/acp-connections-context.tsx`
- Create: `src/contexts/conversation-runtime-context.tsx`
- Create: `src/hooks/use-conversation-list.ts`
- Create: `src/hooks/use-conversation-detail.ts`
- Create: `src/hooks/use-connection.ts`
- Create: `src/hooks/use-connection-lifecycle.ts`
- Test: `tests/conversation-workspace.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖会话列表加载、选中、切换后详情刷新**

```tsx
it('switches active conversation and loads detail', async () => {
  render(<ConversationWorkspaceProvider>...</ConversationWorkspaceProvider>)
  await user.click(screen.getByText('会话 A'))
  expect(screen.getByText('会话 A 的消息')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/conversation-workspace.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 workspace context**

```ts
state = {
  conversations,
  activeConversationId,
  openedConversationId,
}
```

- [ ] **Step 4: 实现按会话的 runtime context**

```ts
runtimeSessionMap.set(conversationId, {
  liveMessage,
  pendingPermission,
  usage,
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/conversation-workspace.test.tsx`
Expected: PASS。

### Task 6: 保持 turn 持久化与 live turn 分离

**Files:**
- Modify: `src/contexts/conversation-runtime-context.tsx`
- Modify: `electron/conversations/service.ts`
- Modify: `electron/acp/ipc.ts`
- Test: `tests/conversation-service.test.ts`
- Test: `tests/conversation-workspace.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖“live turn 不入库，结束后才落库”**

```ts
expect(detail.turns).toHaveLength(1)
emitStreamingText()
expect(detail.turns).toHaveLength(1)
emitTurnComplete()
expect(detail.turns).toHaveLength(2)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/conversation-service.test.ts tests/conversation-workspace.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 finalize 时持久化 turn**

```ts
onTurnComplete(({ conversationId, blocks }) => {
  service.appendTurn(conversationId, blocks)
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/conversation-service.test.ts tests/conversation-workspace.test.tsx`
Expected: PASS。

---

## Chunk 4: UI 迁移与 fork 一期闭环

### Task 7: 把 AgentSidebar 升级为 Conversation Workspace

**Files:**
- Create: `src/components/agent/SessionListPane.tsx`
- Create: `src/components/agent/ConversationDetailPane.tsx`
- Create: `src/components/agent/ConversationToolbar.tsx`
- Modify: `src/components/agent/AgentSidebar.tsx`
- Modify: `src/components/agent/AgentHeader.tsx`
- Modify: `src/components/agent/MessageList.tsx`
- Modify: `src/components/agent/InputBar.tsx`
- Modify: `src/components/agent/StatusBar.tsx`
- Modify: `src/components/agent/GuideCards.tsx`
- Modify: `src/components/agent/AgentQuickActions.tsx`
- Modify: `src/components/script/QuickActionBar.tsx`
- Test: `tests/conversation-workspace.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖“列表展示 + 切换 + 新建会话 + 发送消息”**

```tsx
expect(screen.getByText('新建会话')).toBeInTheDocument()
expect(screen.getByRole('textbox')).toBeEnabled()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/conversation-workspace.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现工作区壳层布局**

```tsx
<AgentSidebar>
  <SessionListPane />
  <ConversationDetailPane />
</AgentSidebar>
```

- [ ] **Step 4: 接通发送链路**

```ts
handleSend({ conversationId, promptDraft, modeId })
```

- [ ] **Step 5: 把所有快捷入口统一收口到 active conversation runtime**

```ts
sendPromptToActiveConversation(prompt)
cancelActiveConversationTurn()
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test -- tests/conversation-workspace.test.tsx`
Expected: PASS。

### Task 8: 落地 fork 会话与重启恢复语义

**Files:**
- Create: `src/components/agent/ForkConversationDialog.tsx`
- Modify: `electron/conversations/service.ts`
- Modify: `src/contexts/conversation-workspace-context.tsx`
- Modify: `src/hooks/use-connection-lifecycle.ts`
- Test: `tests/conversation-service.test.ts`
- Test: `tests/conversation-workspace.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖 fork 后 parent_id、turn 复制、不会自动重连旧会话**

```ts
expect(forked.parentId).toBe(source.id)
expect(autoConnect).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null }))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/conversation-service.test.ts tests/conversation-workspace.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 fork service**

```ts
forkConversation(sourceId) {
  cloneConversationRow()
  cloneTurns()
  clearExternalId()
  status = 'draft_local'
}
```

- [ ] **Step 4: 实现 UI 入口与切换恢复逻辑**

```ts
if (activeConversation.externalId) {
  connect({ sessionId: activeConversation.externalId })
} else {
  connect({ sessionId: null })
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/conversation-service.test.ts tests/conversation-workspace.test.tsx`
Expected: PASS。

---

## 收尾验证

- [ ] **Step 1: 运行核心单测**

Run:

```bash
npm test -- tests/conversation-db.test.ts tests/conversation-service.test.ts tests/acp-connection-registry.test.ts tests/conversation-workspace.test.tsx tests/acp-session.test.ts tests/agent-store.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行构建验证**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 3: 记录已知非本次范围问题**

Run: `npx tsc --noEmit`
Expected: 若仍因 `tsconfig.json` 中 `baseUrl` 旧配置失败，记录为仓库既有问题，不在本次回归范围内。

- [ ] **Step 4: 提交阶段性变更**

```bash
git add electron/conversations electron/acp src/components/agent src/contexts src/hooks src/lib tests docs/superpowers/plans/2026-04-09-acp-conversation-workspace-alignment.md
git commit -m "feat: align ACP conversation workspace with codeg"
```

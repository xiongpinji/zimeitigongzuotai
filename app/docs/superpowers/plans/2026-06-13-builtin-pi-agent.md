# 内置 Pi Agent（ACP）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 在现有 ACP 层新增一个内置 **Pi coding agent**，通过 `npx -y pi-acp` 零安装启动（内部 spawn `pi --mode rpc`），与现有 Claude Code agent 并存，UI 可在两者间切换/分别配置/连接。

**Architecture:** 现有配置已是多 agent 容器（`agents: Record<string, AgentEntry>`），但 `binary-manager` / `ipc.connectRuntime` / `preflight` / UI 全硬编码 `'claude-acp'`。本方案引入轻量 **AgentProfile 注册表**（区分 managed=claude 走 npm 安装 / unmanaged=pi 走 npx），把硬编码点参数化为按 agentId 选 profile。`RuntimeConnectPayload.agentType` 已存在，作为选择入口。不动 ACP 协议层。

**Tech Stack:** Electron / TS / React / Zustand / Vitest。

**关键决策（已与用户确认）：**
1. Pi 启动 = `npx -y pi-acp`（零安装，不做 npm 版本管理）。
2. UI = 最小：Claude / Pi 两个 agent 卡片切换，按选中 agent 连接。
3. Pi 前置依赖（`pi` 本体在 PATH + Pi 自身 provider 凭证）= **预检提示，不代管**；app 只管 pi-acp 适配器。

参考调研：Pi=[pi.dev](https://pi.dev)；适配器 [`pi-acp`](https://github.com/svkozak/pi-acp)，Zed 配置 `{command:"npx",args:["-y","pi-acp"]}`，前置 Node22+ 与 `pi` on PATH。

---

## 关键约定（共享）

- **AgentProfile**（新 `electron/acp/agent-profiles.ts`）：
  ```ts
  export interface AgentProfile {
    id: string;                 // 'claude-acp' | 'pi-acp'
    displayName: string;        // 'Claude Code' | 'Pi'
    managed: boolean;           // true=app 经 npm 安装并管理版本；false=npx 零安装
    npmPackage?: string;        // managed: '@agentclientprotocol/claude-agent-acp'
    binName?: string;           // managed: 'claude-agent-acp'
    unmanagedSpawn?: { command: string; args: string[] }; // unmanaged: {command:'npx',args:['-y','pi-acp']}
    requiredBinary?: string;    // 预检需在 PATH 上的依赖：pi → 'pi'
    apiKeyEnvVar?: string;      // claude: 'ANTHROPIC_API_KEY'；pi: undefined（不注入凭证）
    baseUrlEnvVar?: string;     // claude: 'ANTHROPIC_BASE_URL'；pi: undefined
    defaultVersion?: string;    // claude: '0.25.0'
    installGuide?: string;      // pi: 指引文案（如何安装 pi 本体）
  }
  ```
- 默认 agentId 一律回退 `'claude-acp'`，保证现有行为不变。
- 每个 Task 末尾 commit；测试 `npx vitest run <file>`。

---

## Task P1: AgentProfile 注册表

**Files:** Create `electron/acp/agent-profiles.ts`; Test `tests/agent-profiles.test.ts`

- [ ] **Step 1: 写失败测试** `tests/agent-profiles.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { getAgentProfile, listAgentProfiles, DEFAULT_AGENT_ID } from '../electron/acp/agent-profiles';

describe('agent-profiles', () => {
  it('claude-acp 是 managed，含 npm 包名与凭证 env 映射', () => {
    const p = getAgentProfile('claude-acp');
    expect(p.managed).toBe(true);
    expect(p.npmPackage).toBe('@agentclientprotocol/claude-agent-acp');
    expect(p.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
  });
  it('pi-acp 是 unmanaged，npx 启动，不注入凭证', () => {
    const p = getAgentProfile('pi-acp');
    expect(p.managed).toBe(false);
    expect(p.unmanagedSpawn).toEqual({ command: 'npx', args: ['-y', 'pi-acp'] });
    expect(p.requiredBinary).toBe('pi');
    expect(p.apiKeyEnvVar).toBeUndefined();
  });
  it('未知 id 回退默认 claude-acp', () => {
    expect(getAgentProfile('nope').id).toBe('claude-acp');
    expect(DEFAULT_AGENT_ID).toBe('claude-acp');
  });
  it('listAgentProfiles 含两个内置 agent', () => {
    expect(listAgentProfiles().map((p) => p.id).sort()).toEqual(['claude-acp', 'pi-acp']);
  });
});
```

- [ ] **Step 2: 运行确认失败** `npx vitest run tests/agent-profiles.test.ts`
- [ ] **Step 3: 实现** `electron/acp/agent-profiles.ts`：

```typescript
export interface AgentProfile {
  id: string;
  displayName: string;
  managed: boolean;
  npmPackage?: string;
  binName?: string;
  unmanagedSpawn?: { command: string; args: string[] };
  requiredBinary?: string;
  apiKeyEnvVar?: string;
  baseUrlEnvVar?: string;
  defaultVersion?: string;
  installGuide?: string;
}

export const DEFAULT_AGENT_ID = 'claude-acp';

const PROFILES: Record<string, AgentProfile> = {
  'claude-acp': {
    id: 'claude-acp',
    displayName: 'Claude Code',
    managed: true,
    npmPackage: '@agentclientprotocol/claude-agent-acp',
    binName: 'claude-agent-acp',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    baseUrlEnvVar: 'ANTHROPIC_BASE_URL',
    defaultVersion: '0.25.0',
  },
  'pi-acp': {
    id: 'pi-acp',
    displayName: 'Pi',
    managed: false,
    unmanagedSpawn: { command: 'npx', args: ['-y', 'pi-acp'] },
    requiredBinary: 'pi',
    installGuide: 'Pi 通过 `npx -y pi-acp` 适配器启动，需先在系统安装 `pi` 命令并配置好模型 provider 凭证（见 https://pi.dev）。本应用不代管 pi 安装与凭证。',
  },
};

export function getAgentProfile(id: string | undefined | null): AgentProfile {
  return (id && PROFILES[id]) || PROFILES[DEFAULT_AGENT_ID];
}

export function listAgentProfiles(): AgentProfile[] {
  return Object.values(PROFILES);
}
```

- [ ] **Step 4: 运行确认通过**（4 用例）
- [ ] **Step 5: Commit** `git add electron/acp/agent-profiles.ts tests/agent-profiles.test.ts && git commit -m "feat(acp): AgentProfile 注册表（claude-acp managed / pi-acp npx）"`

---

## Task P2: BinaryManager 按 profile 解析 spawn + 公开 resolveBinary

**Files:** Modify `electron/acp/binary-manager.ts`; Test 追加 `tests/binary-manager-pi.test.ts`

目标：unmanaged profile（pi）的 spawn 走 `npx -y pi-acp`（npx 路径用现有 `findNpxPath()` 解析）；并暴露一个公开方法供 preflight 查 `pi` 是否在 PATH。保持 claude managed 路径不变。

- [ ] **Step 1: 调研** Read `binary-manager.ts`（已知：`getSpawnCommand(_version)` 走 which/nvm/userPrefix 查 `AGENT_BIN_NAME`；`whichSync`/`findExistingExecutable` 私有；`findBinaryInNodeVersions` 公开；`findNpxPath` 公开）。
- [ ] **Step 2: 写失败测试** `tests/binary-manager-pi.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { BinaryManager } from '../electron/acp/binary-manager';
import { getAgentProfile } from '../electron/acp/agent-profiles';

describe('BinaryManager unmanaged spawn', () => {
  it('pi profile 返回 npx -y pi-acp（npx 解析失败时回退裸 npx）', async () => {
    const bm = new BinaryManager();
    const { command, args } = await bm.getSpawnCommandForProfile(getAgentProfile('pi-acp'), '');
    // command 是解析到的 npx 绝对路径或裸 'npx'
    expect(command === 'npx' || command.endsWith('npx') || command.endsWith('npx.cmd')).toBe(true);
    expect(args).toEqual(['-y', 'pi-acp']);
  });
  it('claude profile 仍返回托管二进制 spawn（args 为空）', async () => {
    const bm = new BinaryManager();
    const { args } = await bm.getSpawnCommandForProfile(getAgentProfile('claude-acp'), '0.25.0');
    expect(args).toEqual([]);
  });
});
```

- [ ] **Step 3: 实现** 在 `BinaryManager` 加：

```typescript
import { getAgentProfile, type AgentProfile } from './agent-profiles';

/** 按 profile 解析 spawn 命令：managed 走托管二进制查找；unmanaged 走 npx 适配器。 */
async getSpawnCommandForProfile(
  profile: AgentProfile,
  version: string,
): Promise<{ command: string; args: string[] }> {
  if (!profile.managed && profile.unmanagedSpawn) {
    const base = profile.unmanagedSpawn;
    if (base.command === 'npx') {
      const npx = await this.findNpxPath();
      return { command: npx ?? 'npx', args: base.args };
    }
    return { command: base.command, args: base.args };
  }
  // managed：复用现有 claude 查找逻辑
  return this.getSpawnCommand(version);
}

/** 公开：在 PATH / nvm 版本目录解析某依赖二进制（供 preflight 查 pi）。 */
async resolveBinary(name: string): Promise<string | null> {
  const direct = this.findBinaryInNodeVersions(name);
  if (direct) return direct;
  return this.findBinaryPath(name); // findBinaryPath 当前私有 → 改为 public
}
```

把现有私有 `findBinaryPath` 改为 `public`（或新增 public wrapper）。`getSpawnCommand`（claude managed）保持原样不动。

> 注意：`getSpawnCommandForProfile` 为 async（npx 解析是 async）；下游 ipc.ts 需 await。

- [ ] **Step 4: 运行确认通过** `npx vitest run tests/binary-manager-pi.test.ts`
- [ ] **Step 5: Commit** `git add electron/acp/binary-manager.ts tests/binary-manager-pi.test.ts && git commit -m "feat(acp): BinaryManager 按 profile 解析 spawn + 公开 resolveBinary"`

---

## Task P3: ipc.connectRuntime 按 agentId 选 profile + 线程 agentId 贯通 IPC

**Files:** Modify `electron/acp/ipc.ts`；可能 `electron/acp/types.ts`（RuntimeConnectPayload 确认有 agentType）；`electron/preload.ts`；`src/lib/agent-api.ts`

- [ ] **Step 1: 调研** Read `electron/acp/ipc.ts:35-149`、`RuntimeConnectPayload` 定义（grep；确认含 `agentType?`/`conversationId`/`projectDir`/`sessionId`）、`electron/preload.ts` 里 `agentAPI.connectRuntime`/`runPreflight`/`installAgent` 的暴露、`src/lib/agent-api.ts` 的对应类型。确认 renderer 调 connect/preflight 时怎么传参。
- [ ] **Step 2: connectRuntime 参数化** 把 `connectRuntime(payload)` 改为按 `const agentId = payload.agentType ?? DEFAULT_AGENT_ID;` 选择：

```typescript
import { getAgentProfile, DEFAULT_AGENT_ID } from './agent-profiles';

async function connectRuntime(payload: RuntimeConnectPayload): Promise<void> {
  const configData = await config.load();
  const agentId = payload.agentType ?? DEFAULT_AGENT_ID;
  const profile = getAgentProfile(agentId);
  const agentEntry = configData.agents[agentId];
  const policy = configData.permissionPolicy ?? 'tiered';

  // 仅 Claude 需要注册 MCP + 写 CLAUDE.md 引导（保持现状）；其余 agent 也写 file-first 契约
  if (agentId === 'claude-acp') {
    const mcpConfigMgr = new McpConfigManager();
    const mcpStatus = getMcpServerStatus();
    if (mcpStatus.running) await mcpConfigMgr.registerToApp('claude_code', mcpStatus.port);
    await ensureProjectClaudeMd(payload.projectDir);
  }
  await ensureProjectAgentContracts(payload.projectDir);

  // env：按 profile 的 env 变量名映射凭证（pi 无 apiKeyEnvVar → 不注入）
  const env: Record<string, string> = {};
  if (agentEntry?.authMode === 'custom_api' && profile.apiKeyEnvVar) {
    const apiKey = await config.getApiKey(agentId);
    if (apiKey) env[profile.apiKeyEnvVar] = apiKey;
    if (profile.baseUrlEnvVar && agentEntry.apiBaseUrl) env[profile.baseUrlEnvVar] = agentEntry.apiBaseUrl;
  }
  if (agentEntry?.envText) {
    for (const line of agentEntry.envText.split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
    }
  }

  const version = agentEntry?.version || profile.defaultVersion || '';
  const { command, args } = await binaryManager.getSpawnCommandForProfile(profile, version);

  await connectionRegistry.connect({
    conversationId: payload.conversationId,
    projectDir: payload.projectDir,
    sessionId: payload.sessionId ?? null,
    agentType: agentId,
    permissionPolicy: policy,
    spawnCommand: command,
    spawnArgs: args,
    env,
  });
}
```

- [ ] **Step 3: preflight / install IPC 参数化** 把
  `ipcMain.handle('agent:run-preflight', () => runPreflight(binaryManager, config, 'claude-acp'));`
  改为接收 agentId：
  `ipcMain.handle('agent:run-preflight', (_e, agentId?: string) => runPreflight(binaryManager, config, agentId ?? DEFAULT_AGENT_ID));`
  `agent:install` / `agent:uninstall` 仅对 managed（claude）有意义——保持现状（pi 无安装），无需改；若 UI 对 pi 不显示安装按钮即可。
- [ ] **Step 4: preload + agent-api 线程 agentId** 在 `electron/preload.ts` 的 `runPreflight` 暴露上加可选 `agentId` 透传；`connectRuntime` 已透传整个 payload（含 agentType），确认 renderer 能在 payload 里带 agentType。`src/lib/agent-api.ts` 同步类型（`runPreflight(agentId?: string)`）。保持 IPC 三件套一致。
- [ ] **Step 5: 验证** `npx tsc --noEmit 2>&1 | head -15` + `npx vitest run 2>&1 | tail -10`（无回归）。
- [ ] **Step 6: Commit** `git add electron/acp/ipc.ts electron/preload.ts src/lib/agent-api.ts && git commit -m "feat(acp): connectRuntime/preflight 按 agentId 选 profile，贯通 agentType"`

---

## Task P4: preflight 按 profile 区分（pi 检测 pi 本体）

**Files:** Modify `electron/acp/preflight.ts`；Test `tests/preflight-pi.test.ts`

- [ ] **Step 1: 写失败测试** `tests/preflight-pi.test.ts`（注入假 BinaryManager/config，验证 pi profile 走 requiredBinary 检测分支、不查 npm 安装版本）：

```typescript
import { describe, it, expect } from 'vitest';
import { runPreflight } from '../electron/acp/preflight';

function fakeBM(over: Partial<Record<string, unknown>> = {}) {
  return {
    getNodeVersion: async () => 'v22.3.0',
    findNpxPath: async () => '/usr/local/bin/npx',
    getInstalledVersion: async () => null,
    getLatestVersion: async () => null,
    resolveBinary: async (n: string) => (n === 'pi' ? '/usr/local/bin/pi' : null),
    ...over,
  } as never;
}
const fakeConfig = { load: async () => ({ agents: { 'pi-acp': { authMode: 'subscription' } }, permissionPolicy: 'tiered' }), getApiKey: async () => '' } as never;

describe('runPreflight pi-acp', () => {
  it('pi 在 PATH → pass，且不含 claude-agent-acp 检查项', async () => {
    const checks = await runPreflight(fakeBM(), fakeConfig, 'pi-acp');
    expect(checks.some((c) => c.label === 'pi' && c.status === 'pass')).toBe(true);
    expect(checks.some((c) => c.label === 'claude-agent-acp')).toBe(false);
  });
  it('pi 不在 PATH → fail 且带指引', async () => {
    const checks = await runPreflight(fakeBM({ resolveBinary: async () => null }), fakeConfig, 'pi-acp');
    const pi = checks.find((c) => c.label === 'pi');
    expect(pi?.status).toBe('fail');
  });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** 把 `runPreflight` 改为按 profile 分支：Node + npx 检查两 profile 共用；managed（claude）保留现有"agent 安装版本 + API Key"检查；unmanaged（pi）改为检查 `profile.requiredBinary`（用 `binaryManager.resolveBinary(name)`）：在 PATH → pass；否则 fail，`message` 用 `profile.installGuide`。pi 不检查 npm 安装版本、不强制 API Key（凭证由 pi 自身管理，最多给一条 info/warn 提示"凭证在 pi 侧配置"）。用 `getAgentProfile(agentId)` 取 profile。保持 claude 分支行为与现状一致。

> 注意：测试注入的 BinaryManager 是鸭子类型对象，`runPreflight` 形参类型是 `BinaryManager`——实现时确保只调用 `getNodeVersion/findNpxPath/getInstalledVersion/getLatestVersion/resolveBinary` 这些方法，便于测试注入。

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** `git add electron/acp/preflight.ts tests/preflight-pi.test.ts && git commit -m "feat(acp): preflight 按 profile 区分，pi 检测 pi 本体在 PATH"`

---

## Task P5: config 默认补 pi-acp 条目

**Files:** Modify `electron/acp/config.ts`（默认 agents 种子）；Test 视现有 config 测试补充

- [ ] **Step 1: 调研** Read `electron/acp/config.ts`，找到 `load()` 如何构造默认 `AgentConfigData`（默认 `agents` 里有没有 `claude-acp` 种子、DEFAULT_AGENT_ENTRY 定义）。
- [ ] **Step 2: 补默认 pi-acp 条目** 让 `load()` 在缺失时种入 `pi-acp` 的默认 `AgentEntry`（`enabled:false, authMode:'subscription', apiKey:'', apiBaseUrl:'', model:'', envText:'', configJson:'', version:'', sortOrder:1`），不破坏现有 `claude-acp`（sortOrder:0）。保证已存在的用户配置不被覆盖（只在缺 key 时补）。
- [ ] **Step 3: 测试** 若有 `tests/` 下 config 测试则追加"load 后含 pi-acp 默认条目且不覆盖已有 claude 配置"；否则加一个最小测试。
- [ ] **Step 4: 验证 + Commit** `npx vitest run 2>&1 | tail -6`；`git add electron/acp/config.ts tests/ && git commit -m "feat(acp): config 默认补 pi-acp agent 条目"`

---

## Task P6: UI — AgentSettingsTab 支持 Claude / Pi 切换

**Files:** Modify `src/components/settings/AgentSettingsTab.tsx`；可能 `src/lib/agent-api.ts`（已在 P3 处理 preflight agentId）

- [ ] **Step 1: 调研** Read `AgentSettingsTab.tsx` 全文，搞清现有：单 agent 取 `config.agents['claude-acp']`、preflight 调用、install/uninstall、connect 入口（connect 在哪触发？grep `connectRuntime`/`agentType` 在 renderer）。确认 `listAgentProfiles` 可否在 renderer import（agent-profiles.ts 无 electron 依赖 → 可直接 import 到 renderer）。
- [ ] **Step 2: 加 agent 选择** 顶部加一个分段控件/下拉在内置 profile（Claude Code / Pi）间切换 `selectedAgentId`；其余配置区改为读写 `config.agents[selectedAgentId]`（替换写死的 `'claude-acp'`）。preflight 调用传 `selectedAgentId`。
- [ ] **Step 3: 按 profile 差异化渲染**：
  - Pi（unmanaged）：隐藏"安装/卸载/版本"区（无 npm 托管），改为显示 `profile.installGuide` 指引 + preflight 的 `pi` 检测结果；凭证区提示"Pi 的模型 provider 凭证在 pi 侧配置，本应用不代管"，可保留 envText（如 `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true`）。
  - Claude（managed）：保持现有安装/版本/API Key/Base URL/Model UI 不变。
  - 复用现有 UI 基元（src/ui），不新增彩色 accent、不新增弹窗（遵守 DESIGN）。
- [ ] **Step 4: 连接入口带 agentType**：找到 renderer 发起 `agent:connect-runtime` 的地方（可能在会话/agent 面板而非设置页），确保 payload 带上用户选定的 `agentType`。若连接入口在 `src/components/agent/`，最小改动：让其读取"当前选定/启用的 agent id"。如果连接 agent 的选择 UI 不在本任务范围且无现成入口，**DONE_WITH_CONCERNS** 说明：设置页已能配置 Pi，但"连接时选哪个 agent"的入口需在 agent 会话面板补一个选择器（标为后续）。
- [ ] **Step 5: 验证** `npx tsc --noEmit 2>&1 | head -15`；`npx vitest run 2>&1 | tail -8`（无回归）；如有 AgentSettingsTab 测试则跑。
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(agent-ui): AgentSettingsTab 支持 Claude/Pi 切换与差异化配置"`

---

## Task P7: 集成验证 + 文档 + CHANGELOG

- [ ] **Step 1: 全量测试** `npx vitest run 2>&1 | tail -8`（全绿）
- [ ] **Step 2: 构建** `npm run build 2>&1 | tail -15`（通过）
- [ ] **Step 3: 手动验收清单**（记入 PR/说明）：
  1. 设置页可在 Claude Code / Pi 间切换；Pi 卡片显示 npx 启动说明与 `pi` 依赖预检（装/未装两态）。
  2. 系统装了 `pi` 时，Pi 预检 pass；未装时 fail 且给指引。
  3. 选 Pi 连接 → 实际 spawn `npx -y pi-acp` 并能建立 ACP 会话（需本机已装并配好 pi）。
  4. Claude Code 连接/安装/预检行为与改动前一致（无回归）。
- [ ] **Step 4: CHANGELOG** `[Unreleased]` 下 Added 记"内置 Pi agent（ACP，npx -y pi-acp）"。
- [ ] **Step 5: Commit** `git add CHANGELOG.md && git commit -m "docs(changelog): 内置 Pi agent（ACP）"`

---

## Self-Review 备注（实现时核对的真实信息）
- `RuntimeConnectPayload` 是否含 `agentType`（P3 Step1，ipc.ts:77 已用 `payload.agentType ?? 'claude-acp'`，应已存在）。
- `findBinaryPath` 当前私有，P2 需改 public（或加 public wrapper）。
- `config.ts` 默认 agents 种子结构与 `DEFAULT_AGENT_ENTRY`（P5 Step1）。
- renderer 发起 connect 的真实位置与是否已传 agentType（P6 Step4）——可能不在设置页，必要时标 concern。
- preload/agent-api 的 runPreflight 签名（P3 Step4）需同步加可选 agentId。

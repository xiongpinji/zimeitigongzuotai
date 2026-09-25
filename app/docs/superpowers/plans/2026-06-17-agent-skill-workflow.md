# Agent Skill Workflow 内置与调用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `lingji-video-workflow` skill 内置进灵机剪影，应用首启动复制到 `~/.lingji/agent-skills/`，配置中心可按 agent 开关并显示加载方式，对话用 `$` 补全并在显式调用时把 `SKILL.md` 注入本轮 prompt，Pi 用 `--skill`、Codex 用 `--add-dir` 原生/目录加载。

**Architecture:** 新增 main 侧 `electron/agent-skills/` 领域模块（种子复制 / frontmatter 解析 / registry / 纯注入函数），把可序列化 skill 类型加进 `electron/acp/types.ts` 供 renderer 复用。连接期 resolved skills 经 `RuntimeConnectInput → RuntimeContextEntry → AgentSessionStartInput → BuildArgsCtx` 流到各 agent `buildArgs`；每轮 `$skill` 注入发生在 `agent:send-prompt-runtime` IPC handler（main 二次校验 enabled 后读 `SKILL.md` 拼到 prompt 前）。Renderer 在 `MessageInput` 加 `$` 补全、`ChatPane.handleSend` 解析 `$token` 生成 `skillIds` 随 opts 透传。

**Tech Stack:** Electron 41 / electron-vite、React 19 / TS、Zustand、`yaml` 包、Vitest（node 环境）、@electron/packager。

---

## File Structure

**新增（main 领域模块）：**
- `resources/agent-skills/lingji-video-workflow/{SKILL.md,agents/openai.yaml,references/*.md}` — 只读内置种子（提交进仓库）。
- `electron/agent-skills/constants.ts` — `BUILTIN_SKILL_ID`、`LOAD_MODES_BY_AGENT`。
- `electron/agent-skills/frontmatter.ts` — `parseFrontmatter()`（纯函数）。
- `electron/agent-skills/bundled.ts` — `ensureBundledAgentSkills()` + 递归复制（asar 安全）。
- `electron/agent-skills/inject.ts` — `parseSkillTokens()` / `buildInjectionText()`（纯函数，renderer 也 import）。
- `electron/agent-skills/registry.ts` — `SkillRegistry` 类。

**修改：**
- `electron/acp/types.ts` — 新增 skill 类型 + `AgentEntry.skills?`。
- `electron/acp/config.ts` — `makeDefaultEntry`/`ensureDefaultAgents` 补默认 skill 配置。
- `electron/agent-runtime/types.ts` — `BuildArgsCtx.skills?`。
- `electron/agent-runtime/agent-defs/{pi,codex}.ts` — buildArgs 追加 `--skill` / `--add-dir`。
- `electron/agent-runtime/session.ts` — `AgentSessionStartInput.skills?` → buildArgs。
- `electron/agent-runtime/runtime-registry.ts` — `RuntimeConnectInput.skills?`、context entry、sendPrompt 透传。
- `electron/acp/ipc.ts` — connect 解析 skills；`agent:list-skills` handler；send handler 注入。
- `electron/acp/contract-sync.ts` — file-first 契约块追加内置工作流引导段落。
- `electron/preload.ts` — `listSkills`；`sendPromptToConversation` opts 加 `skillIds`。
- `src/lib/agent-api.ts` — `AgentAPI.listSkills`、opts `skillIds`、re-export skill 类型。
- `src/contexts/acp-connections-context.tsx` — `sendPrompt` opts 加 `skillIds`。
- `src/components/agent/MessageInput.tsx` — `$` 补全。
- `src/components/agent/ChatPane.tsx` — 解析 `$token` → skillIds。
- `src/components/settings/AgentSettingsTab.tsx` — Skills section。
- `scripts/package-mac-helpers.cjs` — staging 纳入 `resources`。
- `scripts/package-windows.cjs` — 若有独立 staging 列表，同步纳入 `resources`。

**测试新增：**
- `tests/agent-skills-bundled.test.ts`
- `tests/agent-skills-frontmatter.test.ts`
- `tests/agent-skills-registry.test.ts`
- `tests/agent-skills-inject.test.ts`
- `tests/agent-skills-config-defaults.test.ts`
- `tests/agent-skills-buildargs.test.ts`
- `tests/agent-settings-skills.test.tsx`
- `tests/message-input-skill-autocomplete.test.tsx`

---

## Task 1: 提交内置 skill 种子目录

**Files:**
- Create: `resources/agent-skills/lingji-video-workflow/SKILL.md`
- Create: `resources/agent-skills/lingji-video-workflow/agents/openai.yaml`
- Create: `resources/agent-skills/lingji-video-workflow/references/{mcp-workflow.md,script-editing.md,video-editing.md}`

- [ ] **Step 1: 从现有用户级 skill 复制完整目录**

Run:
```bash
mkdir -p /Users/yoqu/Documents/code/self/video-web-master/resources/agent-skills
cp -R "$HOME/.codex/skills/lingji-video-workflow" \
  /Users/yoqu/Documents/code/self/video-web-master/resources/agent-skills/lingji-video-workflow
```

- [ ] **Step 2: 校验目录结构**

Run:
```bash
find /Users/yoqu/Documents/code/self/video-web-master/resources/agent-skills -type f | sort
```
Expected（必须全部出现）:
```
.../lingji-video-workflow/SKILL.md
.../lingji-video-workflow/agents/openai.yaml
.../lingji-video-workflow/references/mcp-workflow.md
.../lingji-video-workflow/references/script-editing.md
.../lingji-video-workflow/references/video-editing.md
```

- [ ] **Step 3: 校验 SKILL.md frontmatter 含 name/description**

Run:
```bash
head -11 /Users/yoqu/Documents/code/self/video-web-master/resources/agent-skills/lingji-video-workflow/SKILL.md
```
Expected: 以 `---` 起始，含 `name: lingji-video-workflow` 与多行 `description:`。

- [ ] **Step 4: Commit**

```bash
git add resources/agent-skills
git commit -m "feat(agent-skills): 内置 lingji-video-workflow skill 种子"
```

---

## Task 2: Skill 共享类型（acp/types.ts）

**Files:**
- Modify: `electron/acp/types.ts`（在 `AgentEntry` 定义附近，约 296–306 行）

- [ ] **Step 1: 在 `AgentEntry` 之前插入 skill 类型**

在 `export interface AgentEntry {` 这一行之前插入：

```ts
// ─── Agent Skills ────────────────────────────────────────────

export type AgentSkillLoadMode =
  | 'native'
  | 'prompt_injection'
  | 'context_file'
  | 'directory_access';

export type AgentSkillStatus = 'available' | 'missing' | 'error';

/** 内置 skill 的静态定义（来自种子目录 frontmatter + openai.yaml）。 */
export interface AgentSkillDefinition {
  id: string;
  displayName: string;
  description: string;
  source: 'builtin';
  /** skill 根目录绝对路径（~/.lingji/agent-skills/<id>）。 */
  rootPath: string;
  /** 主 SKILL.md 绝对路径。 */
  skillFilePath: string;
  defaultEnabled: boolean;
  /** 各 agent 的加载方式（用于配置中心展示）。 */
  loadModesByAgent: Record<string, AgentSkillLoadMode[]>;
}

/** 持久化在 AgentEntry.skills 中的逐 agent 开关。 */
export interface AgentSkillConfig {
  id: string;
  enabled: boolean;
}

/** listSkills 返回：定义 + 当前 agent 的启用态与可用状态。 */
export interface ResolvedAgentSkill extends AgentSkillDefinition {
  enabled: boolean;
  status: AgentSkillStatus;
  /** status 非 available 时的简短原因。 */
  error?: string;
}
```

- [ ] **Step 2: 给 `AgentEntry` 增加 `skills` 字段**

把 `AgentEntry` 的 `sortOrder: number;` 之后加一行：

```ts
  sortOrder: number;
  /** 逐 agent 的内置 skill 开关；旧数据缺省由 ensureDefaultAgents 补默认。 */
  skills?: AgentSkillConfig[];
```

- [ ] **Step 3: 类型编译校验**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: 无新增与本文件相关的错误（其它文件的 skills 字段缺失在后续任务补齐；若仅这些类型本身无报错即通过）。

- [ ] **Step 4: Commit**

```bash
git add electron/acp/types.ts
git commit -m "feat(agent-skills): 新增 skill 共享类型与 AgentEntry.skills"
```

---

## Task 3: 常量与 frontmatter 解析

**Files:**
- Create: `electron/agent-skills/constants.ts`
- Create: `electron/agent-skills/frontmatter.ts`
- Test: `tests/agent-skills-frontmatter.test.ts`

- [ ] **Step 1: 写 constants.ts**

```ts
import type { AgentSkillLoadMode } from '../acp/types';

/** 首期唯一内置 skill 的 id。 */
export const BUILTIN_SKILL_ID = 'lingji-video-workflow';

/** 内置 skill 子目录名（种子目录 / 用户配置目录下一致）。 */
export const AGENT_SKILLS_DIRNAME = 'agent-skills';

/**
 * 各 agent 的加载方式（配置中心展示 + runtime 行为依据）。
 * - pi：原生 --skill + $ 显式注入
 * - codex：--add-dir 目录访问 + $ 显式注入
 * - claude：CLAUDE.md 上下文引导 + $ 显式注入
 */
export const LOAD_MODES_BY_AGENT: Record<string, AgentSkillLoadMode[]> = {
  pi: ['native', 'prompt_injection'],
  codex: ['directory_access', 'prompt_injection'],
  claude: ['context_file', 'prompt_injection'],
};
```

- [ ] **Step 2: 写失败测试 tests/agent-skills-frontmatter.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../electron/agent-skills/frontmatter';

describe('parseFrontmatter', () => {
  it('解析 name 与多行 description', () => {
    const raw = [
      '---',
      'name: lingji-video-workflow',
      'description: >-',
      '  line one',
      '  line two',
      '---',
      '',
      '# Body',
    ].join('\n');
    const fm = parseFrontmatter(raw);
    expect(fm).not.toBeNull();
    expect(fm?.name).toBe('lingji-video-workflow');
    expect(fm?.description).toContain('line one');
    expect(fm?.description).toContain('line two');
  });

  it('无 frontmatter 返回 null', () => {
    expect(parseFrontmatter('# just a title\n')).toBeNull();
  });

  it('frontmatter 不可解析返回 null', () => {
    expect(parseFrontmatter('---\n: : bad yaml :\n---\n')).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/agent-skills-frontmatter.test.ts`
Expected: FAIL（找不到模块 `../electron/agent-skills/frontmatter`）。

- [ ] **Step 4: 写 frontmatter.ts**

```ts
import YAML from 'yaml';

export interface SkillFrontmatter {
  name: string;
  description: string;
}

/**
 * 解析 markdown 顶部的 `--- ... ---` YAML frontmatter。
 * 纯函数（仅依赖 yaml）：无 frontmatter 或解析失败 / 缺 name 时返回 null。
 */
export function parseFrontmatter(raw: string): SkillFrontmatter | null {
  const text = raw.replace(/^﻿/, '');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) return null;
  const description =
    typeof obj.description === 'string' ? obj.description.trim() : '';
  return { name, description };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/agent-skills-frontmatter.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 6: Commit**

```bash
git add electron/agent-skills/constants.ts electron/agent-skills/frontmatter.ts tests/agent-skills-frontmatter.test.ts
git commit -m "feat(agent-skills): 常量与 frontmatter 解析"
```

---

## Task 4: 种子复制 ensureBundledAgentSkills

**Files:**
- Create: `electron/agent-skills/bundled.ts`
- Test: `tests/agent-skills-bundled.test.ts`

- [ ] **Step 1: 写失败测试 tests/agent-skills-bundled.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureBundledAgentSkills } from '../electron/agent-skills/bundled';

let seedRoot = '';
let targetRoot = '';

async function makeSeed(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-'));
  const skill = path.join(dir, 'lingji-video-workflow');
  await fs.mkdir(path.join(skill, 'references'), { recursive: true });
  await fs.writeFile(path.join(skill, 'SKILL.md'), '---\nname: lingji-video-workflow\n---\nbody', 'utf-8');
  await fs.writeFile(path.join(skill, 'references', 'a.md'), 'ref-a', 'utf-8');
  return dir;
}

beforeEach(async () => {
  seedRoot = await makeSeed();
  targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'target-'));
});
afterEach(async () => {
  await fs.rm(seedRoot, { recursive: true, force: true });
  await fs.rm(targetRoot, { recursive: true, force: true });
});

describe('ensureBundledAgentSkills', () => {
  it('目标缺失时递归复制种子（含子目录）', async () => {
    await ensureBundledAgentSkills({ seedRoot, targetRoot });
    const skillMd = await fs.readFile(
      path.join(targetRoot, 'lingji-video-workflow', 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('name: lingji-video-workflow');
    const refA = await fs.readFile(
      path.join(targetRoot, 'lingji-video-workflow', 'references', 'a.md'), 'utf-8');
    expect(refA).toBe('ref-a');
  });

  it('目标已存在 SKILL.md 时不覆盖用户文件', async () => {
    const skillDir = path.join(targetRoot, 'lingji-video-workflow');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'USER EDITED', 'utf-8');
    await ensureBundledAgentSkills({ seedRoot, targetRoot });
    const content = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
    expect(content).toBe('USER EDITED');
  });

  it('种子缺失时安静返回 false（不抛错）', async () => {
    const ok = await ensureBundledAgentSkills({
      seedRoot: path.join(seedRoot, 'does-not-exist'),
      targetRoot,
    });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/agent-skills-bundled.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 bundled.ts**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_SKILL_ID } from './constants';

export interface EnsureBundledOptions {
  /** 内置种子根目录（含 <skillId>/ 子目录）。 */
  seedRoot: string;
  /** 用户配置目录 ~/.lingji/agent-skills。 */
  targetRoot: string;
}

/** 递归复制（用 readdir+readFile+writeFile，兼容 asar 只读源）。 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      const buf = await fs.readFile(s);
      await fs.writeFile(d, buf);
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保内置 skill 已复制到用户配置目录。
 * - 目标已存在 <skillId>/SKILL.md → 不覆盖（首期保护用户本地调整）。
 * - 种子缺失 → 返回 false，不抛错（由上层记录日志 / 设置页展示）。
 * - 成功复制或目标已存在 → 返回 true。
 */
export async function ensureBundledAgentSkills(
  opts: EnsureBundledOptions,
): Promise<boolean> {
  const seedSkill = path.join(opts.seedRoot, BUILTIN_SKILL_ID);
  const seedMd = path.join(seedSkill, 'SKILL.md');
  if (!(await exists(seedMd))) {
    return false;
  }
  const targetSkill = path.join(opts.targetRoot, BUILTIN_SKILL_ID);
  const targetMd = path.join(targetSkill, 'SKILL.md');
  if (await exists(targetMd)) {
    return true; // 已存在，不覆盖
  }
  await copyDir(seedSkill, targetSkill);
  return true;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/agent-skills-bundled.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add electron/agent-skills/bundled.ts tests/agent-skills-bundled.test.ts
git commit -m "feat(agent-skills): ensureBundledAgentSkills 种子复制"
```

---

## Task 5: 纯注入函数 inject.ts

**Files:**
- Create: `electron/agent-skills/inject.ts`
- Test: `tests/agent-skills-inject.test.ts`

- [ ] **Step 1: 写失败测试 tests/agent-skills-inject.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { parseSkillTokens, buildInjectionText } from '../electron/agent-skills/inject';

describe('parseSkillTokens', () => {
  it('提取 $id 并去重保序', () => {
    expect(parseSkillTokens('用 $lingji-video-workflow 再 $lingji-video-workflow 一次'))
      .toEqual(['lingji-video-workflow']);
  });
  it('多个不同 token 保序', () => {
    expect(parseSkillTokens('$a-b then $c')).toEqual(['a-b', 'c']);
  });
  it('无 token 返回空数组', () => {
    expect(parseSkillTokens('普通消息没有美元符号')).toEqual([]);
  });
});

describe('buildInjectionText', () => {
  it('把 SKILL.md 拼到用户消息之前', () => {
    const out = buildInjectionText(
      [{ id: 'lingji-video-workflow', markdown: 'SKILL BODY' }],
      '帮我把稿件做成视频',
    );
    expect(out).toContain('The user explicitly invoked these skills:');
    expect(out).toContain('$lingji-video-workflow');
    expect(out).toContain('--- skill: lingji-video-workflow ---');
    expect(out).toContain('SKILL BODY');
    expect(out).toContain('--- end skill ---');
    expect(out.indexOf('SKILL BODY')).toBeLessThan(out.indexOf('帮我把稿件做成视频'));
    expect(out).toContain('User message:\n帮我把稿件做成视频');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/agent-skills-inject.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 inject.ts**

```ts
/**
 * 纯函数：renderer 与 main 共用（无 Node API 依赖，可安全 import 进 renderer）。
 */

/** 从文本里提取 $skill-id token，去重保序。 */
export function parseSkillTokens(text: string): string[] {
  const matches = String(text ?? '').match(/\$([a-z0-9][a-z0-9-]*)/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const id = raw.slice(1);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface InjectedSkill {
  id: string;
  markdown: string;
}

/** 把若干 SKILL.md 拼到用户消息之前（progressive disclosure：只注入主文件）。 */
export function buildInjectionText(skills: InjectedSkill[], userText: string): string {
  const header = [
    'The user explicitly invoked these skills:',
    ...skills.map((s) => `$${s.id}`),
    '',
    'Follow the SKILL.md instructions below. Load referenced files only when needed.',
  ].join('\n');
  const bodies = skills
    .map((s) => `--- skill: ${s.id} ---\n${s.markdown}\n--- end skill ---`)
    .join('\n\n');
  return `${header}\n\n${bodies}\n\nUser message:\n${userText}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/agent-skills-inject.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add electron/agent-skills/inject.ts tests/agent-skills-inject.test.ts
git commit -m "feat(agent-skills): $token 解析与注入文本构建"
```

---

## Task 6: SkillRegistry

**Files:**
- Create: `electron/agent-skills/registry.ts`
- Test: `tests/agent-skills-registry.test.ts`

- [ ] **Step 1: 写失败测试 tests/agent-skills-registry.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry } from '../electron/agent-skills/registry';

let seedRoot = '';
let targetRoot = '';

async function makeSeed(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-seed-'));
  const skill = path.join(dir, 'lingji-video-workflow');
  await fs.mkdir(path.join(skill, 'agents'), { recursive: true });
  await fs.writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: lingji-video-workflow\ndescription: 测试描述\n---\n# 正文\nHELLO',
    'utf-8',
  );
  await fs.writeFile(
    path.join(skill, 'agents', 'openai.yaml'),
    'interface:\n  display_name: "灵机剪影视频工作流"\n  short_description: "短说明"\n',
    'utf-8',
  );
  return dir;
}

beforeEach(async () => {
  seedRoot = await makeSeed();
  targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-target-'));
});
afterEach(async () => {
  await fs.rm(seedRoot, { recursive: true, force: true });
  await fs.rm(targetRoot, { recursive: true, force: true });
});

describe('SkillRegistry', () => {
  it('list() 复制种子并解析元数据（openai.yaml display_name 优先）', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const defs = await reg.list();
    expect(defs).toHaveLength(1);
    expect(defs[0].id).toBe('lingji-video-workflow');
    expect(defs[0].displayName).toBe('灵机剪影视频工作流');
    expect(defs[0].description).toBe('短说明');
    expect(defs[0].source).toBe('builtin');
    expect(defs[0].rootPath).toBe(path.join(targetRoot, 'lingji-video-workflow'));
    expect(defs[0].loadModesByAgent.pi).toContain('native');
  });

  it('resolveForAgent 合并 enabled，未知 id 忽略', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const resolved = await reg.resolveForAgent('pi', [
      { id: 'lingji-video-workflow', enabled: false },
      { id: 'unknown-skill', enabled: true },
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].enabled).toBe(false);
    expect(resolved[0].status).toBe('available');
  });

  it('无配置时按 defaultEnabled 解析（默认启用）', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const resolved = await reg.resolveForAgent('claude', undefined);
    expect(resolved[0].enabled).toBe(true);
  });

  it('readSkillMarkdown 返回主 SKILL.md 内容', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const md = await reg.readSkillMarkdown('lingji-video-workflow');
    expect(md).toContain('HELLO');
  });

  it('种子缺失时 list() 返回空数组（不抛错）', async () => {
    const reg = new SkillRegistry({
      seedRoot: path.join(seedRoot, 'nope'),
      targetRoot,
    });
    expect(await reg.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/agent-skills-registry.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 registry.ts**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type {
  AgentSkillConfig,
  AgentSkillDefinition,
  AgentSkillStatus,
  ResolvedAgentSkill,
} from '../acp/types';
import { BUILTIN_SKILL_ID, LOAD_MODES_BY_AGENT } from './constants';
import { ensureBundledAgentSkills } from './bundled';
import { parseFrontmatter } from './frontmatter';

export interface SkillRegistryOptions {
  /** 内置种子根目录。 */
  seedRoot: string;
  /** 用户配置目录 ~/.lingji/agent-skills。 */
  targetRoot: string;
}

/** 默认元数据兜底（种子里 frontmatter/openai.yaml 缺字段时用）。 */
const BUILTIN_DEFAULTS: Record<string, { displayName: string; description: string }> = {
  [BUILTIN_SKILL_ID]: {
    displayName: '灵机剪影视频工作流',
    description: '连接稿件输入、灵机剪影项目生成、视频精修与导出协作流程',
  },
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 读 agents/openai.yaml 的 interface.display_name / short_description（可选）。 */
async function readOpenAiInterface(
  skillDir: string,
): Promise<{ displayName?: string; description?: string }> {
  const p = path.join(skillDir, 'agents', 'openai.yaml');
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const parsed = YAML.parse(raw) as { interface?: Record<string, unknown> } | null;
    const iface = parsed?.interface ?? {};
    const displayName =
      typeof iface.display_name === 'string' ? iface.display_name.trim() : undefined;
    const description =
      typeof iface.short_description === 'string'
        ? iface.short_description.trim()
        : undefined;
    return { displayName, description };
  } catch {
    return {};
  }
}

/**
 * 内置 skill registry（main 侧）。
 * 职责单一：确保种子已复制、解析元数据、按 agent + 配置返回 enabled skills、
 * 读取主 SKILL.md 供 $skill 注入。Renderer 不直接读文件，只经 IPC 拿元数据。
 */
export class SkillRegistry {
  private readonly seedRoot: string;
  private readonly targetRoot: string;
  private ensured = false;

  constructor(opts: SkillRegistryOptions) {
    this.seedRoot = opts.seedRoot;
    this.targetRoot = opts.targetRoot;
  }

  /** 幂等确保种子已复制（首次调用真正复制，之后跳过）。 */
  async ensureBundled(): Promise<void> {
    if (this.ensured) return;
    try {
      await ensureBundledAgentSkills({
        seedRoot: this.seedRoot,
        targetRoot: this.targetRoot,
      });
    } catch (err) {
      console.warn('[agent-skills] ensureBundled 失败:', err);
    }
    this.ensured = true;
  }

  /** 返回全部内置 skill 定义；种子/用户目录都缺失时返回空数组。 */
  async list(): Promise<AgentSkillDefinition[]> {
    await this.ensureBundled();
    const def = await this.readDefinition(BUILTIN_SKILL_ID);
    return def ? [def] : [];
  }

  private async readDefinition(id: string): Promise<AgentSkillDefinition | null> {
    const rootPath = path.join(this.targetRoot, id);
    const skillFilePath = path.join(rootPath, 'SKILL.md');
    if (!(await exists(skillFilePath))) return null;

    const fallback = BUILTIN_DEFAULTS[id] ?? { displayName: id, description: '' };
    let displayName = fallback.displayName;
    let description = fallback.description;

    try {
      const raw = await fs.readFile(skillFilePath, 'utf-8');
      const fm = parseFrontmatter(raw);
      if (fm?.description) description = fm.description;
    } catch {
      // 读取失败用兜底
    }
    const iface = await readOpenAiInterface(rootPath);
    if (iface.displayName) displayName = iface.displayName;
    if (iface.description) description = iface.description;

    return {
      id,
      displayName,
      description,
      source: 'builtin',
      rootPath,
      skillFilePath,
      defaultEnabled: true,
      loadModesByAgent: LOAD_MODES_BY_AGENT,
    };
  }

  /**
   * 按 agent + 已保存配置返回 resolved skills。
   * 未知 id 的配置项忽略（不出现在结果里，原值保留在配置文件由 config 层负责）。
   */
  async resolveForAgent(
    _agentId: string,
    configs: AgentSkillConfig[] | undefined,
  ): Promise<ResolvedAgentSkill[]> {
    const defs = await this.list();
    const byId = new Map((configs ?? []).map((c) => [c.id, c]));
    return defs.map((def) => {
      const cfg = byId.get(def.id);
      const enabled = cfg ? cfg.enabled : def.defaultEnabled;
      const status: AgentSkillStatus = 'available';
      return { ...def, enabled, status };
    });
  }

  /** 读取主 SKILL.md 内容（供 $skill 注入）；失败抛错由上层兜底。 */
  async readSkillMarkdown(id: string): Promise<string> {
    const skillFilePath = path.join(this.targetRoot, id, 'SKILL.md');
    return fs.readFile(skillFilePath, 'utf-8');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/agent-skills-registry.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: Commit**

```bash
git add electron/agent-skills/registry.ts tests/agent-skills-registry.test.ts
git commit -m "feat(agent-skills): SkillRegistry 元数据解析与解析启用态"
```

---

## Task 7: config 默认 skill 补齐

**Files:**
- Modify: `electron/acp/config.ts:43-89`
- Test: `tests/agent-skills-config-defaults.test.ts`

- [ ] **Step 1: 写失败测试 tests/agent-skills-config-defaults.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { ensureDefaultAgents } from '../electron/acp/config';

describe('ensureDefaultAgents skills 默认', () => {
  it('为 claude/codex/pi 补默认 skill 配置', () => {
    const agents = ensureDefaultAgents({});
    for (const id of ['claude', 'codex', 'pi']) {
      expect(agents[id].skills).toEqual([
        { id: 'lingji-video-workflow', enabled: true },
      ]);
    }
  });

  it('不覆盖用户已有 skills 配置', () => {
    const agents = ensureDefaultAgents({
      claude: {
        enabled: true, authMode: 'subscription', apiKey: '', apiBaseUrl: '',
        model: '', envText: '', configJson: '', version: '', sortOrder: 0,
        skills: [{ id: 'lingji-video-workflow', enabled: false }],
      },
    });
    expect(agents.claude.skills).toEqual([
      { id: 'lingji-video-workflow', enabled: false },
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/agent-skills-config-defaults.test.ts`
Expected: FAIL（默认条目无 skills 字段）。

- [ ] **Step 3: 修改 makeDefaultEntry 与默认条目常量**

把 `electron/acp/config.ts` 顶部加导入：

```ts
import { BUILTIN_SKILL_ID } from '../agent-skills/constants';
```

把 `makeDefaultEntry`（43–55 行）改为带默认 skills：

```ts
function makeDefaultEntry(sortOrder: number): AgentEntry {
  return {
    enabled: false,
    authMode: 'subscription',
    apiKey: '',
    apiBaseUrl: '',
    model: '',
    envText: '',
    configJson: '',
    version: '',
    sortOrder,
    skills: [{ id: BUILTIN_SKILL_ID, enabled: true }],
  };
}
```

- [ ] **Step 4: 在 ensureDefaultAgents 内为已存在条目补 skills**

把 `ensureDefaultAgents`（70–89 行）的 `return { ... }` 之前插入一段「补默认 skills」：

```ts
  // 为已存在但缺 skills 字段的条目补默认（旧数据迁移；不覆盖已配置）
  for (const id of Object.keys(next)) {
    const entry = next[id];
    if (entry && entry.skills === undefined) {
      next[id] = { ...entry, skills: [{ id: BUILTIN_SKILL_ID, enabled: true }] };
    }
  }

  return {
    claude: CLAUDE_DEFAULT_ENTRY,
    codex: CODEX_DEFAULT_ENTRY,
    pi: PI_DEFAULT_ENTRY,
    ...next,
  };
```

注意：`CLAUDE_DEFAULT_ENTRY` 等常量已由修改后的 `makeDefaultEntry` 生成，自带默认 skills，无需另改。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/agent-skills-config-defaults.test.ts tests/acp-config.test.ts`
Expected: PASS（新测试 2 个 + 既有 acp-config 不回归）。

- [ ] **Step 6: Commit**

```bash
git add electron/acp/config.ts tests/agent-skills-config-defaults.test.ts
git commit -m "feat(agent-skills): config 默认补齐逐 agent skill 开关"
```

---

## Task 8: runtime buildArgs 注入 skill 参数

**Files:**
- Modify: `electron/agent-runtime/types.ts:3-11`（`BuildArgsCtx`）
- Modify: `electron/agent-runtime/agent-defs/pi.ts:88-97`
- Modify: `electron/agent-runtime/agent-defs/codex.ts:93-101`
- Test: `tests/agent-skills-buildargs.test.ts`

- [ ] **Step 1: 给 BuildArgsCtx 加 skills 字段**

`electron/agent-runtime/types.ts` 顶部加导入并扩展 `BuildArgsCtx`：

```ts
import type { ResolvedAgentSkill } from '../acp/types';

export interface BuildArgsCtx {
  prompt: string;
  cwd?: string;
  model?: string;
  /** 思考程度（reasoning effort）；'default' 表示跟随 CLI 默认，不透传。 */
  reasoning?: string;
  resumeSessionId?: string | null;
  isResuming?: boolean;
  /** 连接期解析出的启用 skills（pi --skill / codex --add-dir 用）。 */
  skills?: ResolvedAgentSkill[];
}
```

- [ ] **Step 2: 写失败测试 tests/agent-skills-buildargs.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { piAgentDef } from '../electron/agent-runtime/agent-defs/pi';
import { codexAgentDef } from '../electron/agent-runtime/agent-defs/codex';
import type { ResolvedAgentSkill } from '../electron/acp/types';

const skill = (enabled: boolean): ResolvedAgentSkill => ({
  id: 'lingji-video-workflow',
  displayName: 'x', description: 'y', source: 'builtin',
  rootPath: '/home/u/.lingji/agent-skills/lingji-video-workflow',
  skillFilePath: '/home/u/.lingji/agent-skills/lingji-video-workflow/SKILL.md',
  defaultEnabled: true, loadModesByAgent: {}, enabled, status: 'available',
});

describe('pi buildArgs --skill', () => {
  it('enabled skill 追加 --skill <rootPath>', () => {
    const args = piAgentDef.buildArgs({ prompt: 'hi', skills: [skill(true)] });
    const i = args.indexOf('--skill');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('/home/u/.lingji/agent-skills/lingji-video-workflow');
  });
  it('disabled skill 不追加', () => {
    const args = piAgentDef.buildArgs({ prompt: 'hi', skills: [skill(false)] });
    expect(args).not.toContain('--skill');
  });
});

describe('codex buildArgs --add-dir', () => {
  it('enabled skill 追加 --add-dir <rootPath>', () => {
    const args = codexAgentDef.buildArgs({ prompt: 'hi', skills: [skill(true)] });
    const i = args.indexOf('--add-dir');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('/home/u/.lingji/agent-skills/lingji-video-workflow');
  });
  it('prompt 仍是末尾位置参数', () => {
    const args = codexAgentDef.buildArgs({ prompt: 'HELLO', skills: [skill(true)] });
    expect(args[args.length - 1]).toBe('HELLO');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/agent-skills-buildargs.test.ts`
Expected: FAIL（buildArgs 未处理 skills）。

- [ ] **Step 4: 修改 pi.ts buildArgs**

把 pi.ts 的 `buildArgs`（88–97 行）替换为：

```ts
  buildArgs: (ctx) => {
    const args = ['--mode', 'rpc'];
    if (ctx.model && ctx.model !== 'default') {
      args.push('--model', ctx.model);
    }
    if (ctx.reasoning && ctx.reasoning !== 'default') {
      args.push('--thinking', ctx.reasoning);
    }
    // 启用的内置 skill：pi 原生 --skill <path>（可重复）
    for (const skill of ctx.skills ?? []) {
      if (skill.enabled && skill.status === 'available') {
        args.push('--skill', skill.rootPath);
      }
    }
    return args;
  },
```

- [ ] **Step 5: 修改 codex.ts buildArgs**

把 codex.ts 的 `buildArgs`（93–101 行）替换为：

```ts
  buildArgs: (ctx) => [
    'exec',
    '--json',
    ...(ctx.model && ctx.model !== 'default' ? ['--model', ctx.model] : []),
    ...(ctx.reasoning && ctx.reasoning !== 'default'
      ? ['-c', `model_reasoning_effort="${ctx.reasoning}"`]
      : []),
    // 启用的内置 skill：codex 无 --skill，改用 --add-dir 让其可访问目录
    ...(ctx.skills ?? [])
      .filter((s) => s.enabled && s.status === 'available')
      .flatMap((s) => ['--add-dir', s.rootPath]),
    ctx.prompt,
  ],
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/agent-skills-buildargs.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 7: Commit**

```bash
git add electron/agent-runtime/types.ts electron/agent-runtime/agent-defs/pi.ts electron/agent-runtime/agent-defs/codex.ts tests/agent-skills-buildargs.test.ts
git commit -m "feat(agent-skills): pi --skill / codex --add-dir 连接期加载"
```

---

## Task 9: session 与 runtime-registry 透传 skills

**Files:**
- Modify: `electron/agent-runtime/session.ts:56-71`（`AgentSessionStartInput`）, `:140-147`（buildArgs 调用）
- Modify: `electron/agent-runtime/runtime-registry.ts`（`RuntimeConnectInput` 45–54、`RuntimeContextEntry` 81–90、`connect` 152–158、`sendPrompt` start 调用 221–234）

- [ ] **Step 1: AgentSessionStartInput 加 skills + 传给 buildArgs**

`session.ts` 顶部加导入：

```ts
import type { ResolvedAgentSkill } from '../acp/types';
```

`AgentSessionStartInput`（56–71 行）的 `onEvent` 之前加字段：

```ts
  isResuming?: boolean;
  /** 连接期解析出的启用 skills（透传给 buildArgs）。 */
  skills?: ResolvedAgentSkill[];
  onEvent: (ev: AgentStreamEvent) => void;
```

`start()` 内 `def.buildArgs({...})`（140–147 行）加 `skills`：

```ts
    const args = def.buildArgs({
      prompt,
      cwd,
      model: model ?? def.defaultModel,
      reasoning: input.reasoning ?? def.defaultReasoning,
      resumeSessionId: input.resumeSessionId ?? null,
      isResuming: input.isResuming ?? false,
      skills: input.skills,
    });
```

- [ ] **Step 2: RuntimeConnectInput + context entry 加 skills**

`runtime-registry.ts` 顶部加导入：

```ts
import type { ResolvedAgentSkill } from '../acp/types';
```

`RuntimeConnectInput`（45–54 行）的 `permissionPolicy?: string;` 之后加：

```ts
  permissionPolicy?: string;
  /** 连接期解析出的启用 skills。 */
  skills?: ResolvedAgentSkill[];
```

`RuntimeContextEntry`（81–90 行）的 `env?` 之后加：

```ts
  env?: Record<string, string>;
  /** 连接期解析出的启用 skills（每轮透传给 session.start）。 */
  skills?: ResolvedAgentSkill[];
  /** 当前活跃的轮会话（仅在 prompting 期间存在） */
  activeSession: AgentSessionLike | null;
```

- [ ] **Step 3: connect 存入 skills**

`connect()` 的 `entry`（152–158 行）加 `skills`：

```ts
    const entry: RuntimeContextEntry = {
      snapshot,
      def,
      model: input.model,
      env: input.env,
      skills: input.skills,
      activeSession: null,
    };
```

- [ ] **Step 4: sendPrompt 把 skills 传给 start**

`sendPrompt` 内 `session.start({...})`（221–234 行）加 `skills`：

```ts
      await session.start({
        def: entry.def,
        prompt,
        cwd: entry.snapshot.projectDir,
        model: entry.model ?? entry.def.defaultModel,
        reasoning: entry.reasoning ?? entry.def.defaultReasoning,
        env: entry.env,
        skills: entry.skills,
        parentSession: entry.snapshot.sessionId,
        resumeSessionId: entry.snapshot.sessionId,
        isResuming: Boolean(entry.snapshot.sessionId),
        onEvent,
      });
```

- [ ] **Step 5: 回归现有 runtime 测试**

Run: `npx vitest run tests/agent-runtime/ tests/acp-connection-registry.test.ts`
Expected: PASS（skills 为可选，旧路径不传即 undefined，不回归）。

- [ ] **Step 6: Commit**

```bash
git add electron/agent-runtime/session.ts electron/agent-runtime/runtime-registry.ts
git commit -m "feat(agent-skills): runtime 连接期透传 skills 到 buildArgs"
```

---

## Task 10: IPC — listSkills、连接期解析、send 注入

**Files:**
- Modify: `electron/acp/ipc.ts`（顶部构造 SkillRegistry；`connectRuntime` 40–89；`agent:send-prompt-runtime` 112–122；新增 `agent:list-skills`）

- [ ] **Step 1: 构造 SkillRegistry（main 侧单例）**

`ipc.ts` 顶部导入区加：

```ts
import { app } from 'electron';
import { SkillRegistry } from '../agent-skills/registry';
import { AGENT_SKILLS_DIRNAME } from '../agent-skills/constants';
import { buildInjectionText } from '../agent-skills/inject';
import type { PromptInputBlock, ResolvedAgentSkill } from './types';
```

在 `const runtimeRegistry = ...` 之后加：

```ts
// 内置 skill：种子在应用资源 resources/agent-skills，运行时复制到 ~/.lingji/agent-skills。
// app.getAppPath() 在 dev 指向仓库根，在打包指向 app.asar（fs 读 asar 可用）。
const skillRegistry = new SkillRegistry({
  seedRoot: path.join(app.getAppPath(), 'resources', AGENT_SKILLS_DIRNAME),
  targetRoot: path.join(os.homedir(), '.lingji', AGENT_SKILLS_DIRNAME),
});
```

- [ ] **Step 2: connectRuntime 解析并传 skills**

在 `connectRuntime` 内、`await runtimeRegistry.connect({...})` 之前插入：

```ts
    // 解析当前 agent 启用的内置 skills（连接期 pi --skill / codex --add-dir 用）
    let resolvedSkills: ResolvedAgentSkill[] = [];
    try {
      resolvedSkills = await skillRegistry.resolveForAgent(agentId, agentEntry?.skills);
    } catch (err) {
      console.warn('[agent-skills] resolveForAgent 失败:', err);
    }
```

并把 `connect({...})` 调用加上 `skills`：

```ts
    await runtimeRegistry.connect({
      conversationId: payload.conversationId,
      agentType: agentId,
      projectDir: payload.projectDir,
      model: agentEntry?.model || def?.defaultModel,
      sessionId: payload.sessionId ?? null,
      env,
      permissionPolicy: policy,
      skills: resolvedSkills,
    });
```

- [ ] **Step 3: 新增 agent:list-skills handler**

在 `agent:get-latest-version` handler（190 行）之后加：

```ts
  // 列出某 agent 的内置 skills（renderer 设置页 / composer 补全用）
  ipcMain.handle('agent:list-skills', async (_e, agentId?: string) => {
    const id = normalizeAgentId(agentId ?? 'claude');
    try {
      const cfg = await config.load();
      const entry = cfg.agents[id];
      return await skillRegistry.resolveForAgent(id, entry?.skills);
    } catch (err) {
      console.warn('[agent-skills] list-skills 失败:', err);
      return [] as ResolvedAgentSkill[];
    }
  });
```

- [ ] **Step 4: send handler 改为带 skillIds 注入**

把 `agent:send-prompt-runtime` handler（112–122 行）替换为：

```ts
  ipcMain.handle(
    'agent:send-prompt-runtime',
    async (
      _event,
      conversationId: number,
      contents: unknown[],
      opts?: { model?: string; reasoning?: string; skillIds?: string[] },
    ) => {
      const finalContents = await maybeInjectSkills(conversationId, contents, opts?.skillIds);
      await runtimeRegistry.sendPrompt(conversationId, finalContents, {
        model: opts?.model,
        reasoning: opts?.reasoning,
      });
    },
  );
```

在 `registerAgentIpc` 函数体之外（文件底部 `ensureProjectClaudeMd` 之前）加注入辅助：

```ts
/**
 * 若本轮带 skillIds：main 二次校验（当前 agent 已启用 + skill 存在），
 * 读取主 SKILL.md 拼到 prompt 前。任何校验失败 / 读取失败都安静降级为原始消息。
 */
async function maybeInjectSkills(
  conversationId: number,
  contents: unknown[],
  requestedIds: string[] | undefined,
): Promise<unknown[]> {
  if (!requestedIds || requestedIds.length === 0) return contents;
  const snapshot = runtimeRegistry.get(conversationId);
  if (!snapshot) return contents;

  let enabled: ResolvedAgentSkill[] = [];
  try {
    const cfg = await config.load();
    const entry = cfg.agents[snapshot.agentType];
    const resolved = await skillRegistry.resolveForAgent(snapshot.agentType, entry?.skills);
    enabled = resolved.filter((s) => s.enabled && s.status === 'available');
  } catch {
    return contents;
  }

  // requestedIds 已是 renderer 解析出的裸 id（不含 $）；此处仅去重并校验启用态。
  const enabledIds = new Set(enabled.map((s) => s.id));
  const seenIds = new Set<string>();
  const valid = requestedIds.filter((id) => {
    if (seenIds.has(id) || !enabledIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  if (valid.length === 0) return contents;

  const injected: { id: string; markdown: string }[] = [];
  for (const id of valid) {
    try {
      injected.push({ id, markdown: await skillRegistry.readSkillMarkdown(id) });
    } catch (err) {
      console.warn(`[agent-skills] 读取 ${id} SKILL.md 失败:`, err);
    }
  }
  if (injected.length === 0) return contents;

  const blocks = contents as PromptInputBlock[];
  const userText = blocks
    .filter((b): b is PromptInputBlock & { type: 'text' } => !!b && (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('\n');
  const nonText = blocks.filter((b) => !b || (b as { type?: string }).type !== 'text');
  const injectedText = buildInjectionText(injected, userText);
  return [{ type: 'text', text: injectedText } as PromptInputBlock, ...nonText];
}
```

- [ ] **Step 5: 类型与回归校验**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ipc.ts|inject|registry" | head` then `npx vitest run tests/acp-config.test.ts`
Expected: 无 ipc/registry/inject 相关类型错误；acp-config 测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add electron/acp/ipc.ts
git commit -m "feat(agent-skills): listSkills IPC + 连接期解析 + \$skill 注入"
```

---

## Task 11: preload 与前端 AgentAPI 契约

**Files:**
- Modify: `electron/preload.ts:481-488`
- Modify: `src/lib/agent-api.ts`（导入、接口）

- [ ] **Step 1: preload 暴露 listSkills + opts.skillIds**

`electron/preload.ts` 的 agentAPI（481 行起）：在 `disconnectRuntime` 之后加：

```ts
  listSkills: (agentId: string) => ipcRenderer.invoke('agent:list-skills', agentId),
```

把 `sendPromptToConversation`（484–488 行）的 opts 类型加 `skillIds`：

```ts
  sendPromptToConversation: (
    conversationId: number,
    contents: unknown[],
    opts?: { model?: string; reasoning?: string; skillIds?: string[] },
  ) => ipcRenderer.invoke('agent:send-prompt-runtime', conversationId, contents, opts),
```

- [ ] **Step 2: agent-api.ts 接口同步**

`src/lib/agent-api.ts` 顶部导入加 `ResolvedAgentSkill`：

```ts
import type {
  AgentConfigData,
  AgentMode,
  ConfigOption,
  ConnectionStatus,
  PermissionOption,
  PermissionPolicy,
  PreflightCheck,
  PromptInputBlock,
  ResolvedAgentSkill,
} from '../../electron/acp/types';
```

`AgentAPI` 接口里 `disconnectRuntime` 之后加：

```ts
  /** 列出某 agent 的内置 skills（设置页 / composer 补全）。 */
  listSkills(agentId: string): Promise<ResolvedAgentSkill[]>;
```

把 `sendPromptToConversation` 签名（110–114 行）改为：

```ts
  sendPromptToConversation(
    conversationId: number,
    contents: PromptInputBlock[],
    opts?: { model?: string; reasoning?: string; skillIds?: string[] },
  ): Promise<void>;
```

- [ ] **Step 3: 类型校验**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "agent-api|preload" | head`
Expected: 无相关错误。

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts src/lib/agent-api.ts
git commit -m "feat(agent-skills): preload/agentAPI 暴露 listSkills 与 skillIds"
```

---

## Task 12: 上下文链路透传 skillIds（context + ChatPane）

**Files:**
- Modify: `src/contexts/acp-connections-context.tsx:554-586`（`sendPrompt` opts 类型）+ 其 `Connection.send` 类型定义处
- Modify: `src/components/agent/ChatPane.tsx:179-189`（handleSend 解析 token）

- [ ] **Step 1: context sendPrompt opts 加 skillIds**

`src/contexts/acp-connections-context.tsx` 的 `sendPrompt`（554–558 行）签名改为：

```ts
  async function sendPrompt(
    conversationId: number,
    contents: PromptInputBlock[],
    opts?: { model?: string; reasoning?: string; skillIds?: string[] },
  ): Promise<void> {
```

> 同步修改：在本文件内搜索 `send:` / `send(` 的 `Connection`/context value 类型定义（暴露给 `useConnection()` 的 `send` 方法），把它的 opts 类型同样补 `skillIds?: string[]`，使 ChatPane 传入时类型通过。若 send 直接转调 sendPrompt，仅需改对外类型签名。

- [ ] **Step 2: ChatPane.handleSend 解析 $token**

`src/components/agent/ChatPane.tsx` 顶部导入加：

```ts
import { parseSkillTokens } from '../../../electron/agent-skills/inject';
```

把 `handleSend`（179–189 行）替换为：

```ts
  const handleSend = useCallback(
    async (blocks: PromptInputBlock[]) => {
      if (!conversationId || !projectDir) return;
      await ensureConnected();
      const opts: { model?: string; reasoning?: string; skillIds?: string[] } = {};
      if (selectedModel) opts.model = selectedModel;
      if (selectedReasoning) opts.reasoning = selectedReasoning;
      // 解析用户消息里的 $skill-id（main 侧会二次校验启用态）
      const text = blocks
        .filter((b): b is PromptInputBlock & { type: 'text' } => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      const skillIds = parseSkillTokens(text);
      if (skillIds.length > 0) opts.skillIds = skillIds;
      await connection.send(blocks, Object.keys(opts).length > 0 ? opts : undefined);
    },
    [conversationId, projectDir, ensureConnected, connection, selectedModel, selectedReasoning],
  );
```

- [ ] **Step 3: 类型校验**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ChatPane|acp-connections" | head`
Expected: 无相关错误。

- [ ] **Step 4: Commit**

```bash
git add src/contexts/acp-connections-context.tsx src/components/agent/ChatPane.tsx
git commit -m "feat(agent-skills): renderer 链路解析并透传 \$skill skillIds"
```

---

## Task 13: 设置页 Skills section

**Files:**
- Modify: `src/components/settings/AgentSettingsTab.tsx`
- Test: `tests/agent-settings-skills.test.tsx`

- [ ] **Step 1: 写失败测试 tests/agent-settings-skills.test.tsx**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AgentSettingsTab } from '../src/components/settings/AgentSettingsTab';
import type { ResolvedAgentSkill } from '../electron/acp/types';

const skill: ResolvedAgentSkill = {
  id: 'lingji-video-workflow',
  displayName: '灵机剪影视频工作流',
  description: '工作流说明',
  source: 'builtin',
  rootPath: '/Users/u/.lingji/agent-skills/lingji-video-workflow',
  skillFilePath: '/Users/u/.lingji/agent-skills/lingji-video-workflow/SKILL.md',
  defaultEnabled: true,
  loadModesByAgent: { claude: ['context_file', 'prompt_injection'] },
  enabled: true,
  status: 'available',
};

beforeEach(() => {
  (window as unknown as { agentAPI: unknown }).agentAPI = {
    getConfig: vi.fn().mockResolvedValue({
      agents: { claude: { enabled: true, authMode: 'custom_api', apiKey: '', apiBaseUrl: '', model: '', envText: '', configJson: '{}', version: '', sortOrder: 0, skills: [{ id: 'lingji-video-workflow', enabled: true }] } },
      permissionPolicy: 'tiered', activeAgentId: 'claude',
    }),
    getApiKey: vi.fn().mockResolvedValue(''),
    runPreflight: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([skill]),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    setApiKey: vi.fn().mockResolvedValue(undefined),
  };
});

describe('AgentSettingsTab Skills section', () => {
  it('展示内置 skill 名称与加载方式', async () => {
    render(<AgentSettingsTab />);
    expect(await screen.findByText('灵机剪影视频工作流')).toBeTruthy();
    // 加载方式含「上下文文件引导」与「$ 显式注入」
    expect(screen.getByText(/上下文文件引导/)).toBeTruthy();
    expect(screen.getByText(/显式注入/)).toBeTruthy();
  });

  it('切换开关写回 config.skills', async () => {
    render(<AgentSettingsTab />);
    const toggle = await screen.findByRole('switch', { name: /灵机剪影视频工作流/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });
});
```

> 注：若项目里没有 `@testing-library/react` 的 `switch` role 约定，按 `AgentSettingsTab` 实际所用开关组件调整选择器（见既有 `tests/agent-settings-active.test.tsx` 的查询方式对齐）。实现前先看一眼该测试文件确认渲染/查询约定。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/agent-settings-skills.test.tsx`
Expected: FAIL（无 Skills section，listSkills 未被调用）。

- [ ] **Step 3: 在 AgentSettingsTab 加载 skills 状态**

在 `import type { ... } from '../../../electron/acp/types';` 里补 `ResolvedAgentSkill`、`AgentSkillLoadMode`：

```ts
import type {
  AgentConfigData,
  AgentEntry,
  AgentSkillLoadMode,
  PreflightCheck,
  ResolvedAgentSkill,
} from '../../../electron/acp/types';
```

在组件 state 区（`const [uninstallDialogOpen, ...]` 之后）加：

```ts
  const [skills, setSkills] = useState<ResolvedAgentSkill[]>([]);
```

`makeDefaultEntry`（36–49 行）的返回对象补 `skills`（与 config 默认一致）：

```ts
    version: profile.defaultVersion ?? '0.25.0',
    sortOrder: 0,
    skills: [{ id: 'lingji-video-workflow', enabled: true }],
  };
```

在 `loadConfig` 内（拿到 config 后）和 `handleSelectAgent` 内加载 skills：

```ts
  const loadSkills = useCallback(async (agentId: string) => {
    if (typeof window.agentAPI?.listSkills !== 'function') return;
    try {
      setSkills(await window.agentAPI.listSkills(agentId));
    } catch {
      setSkills([]);
    }
  }, []);
```

并在初始 `useEffect`（81–85 行）与 `handleSelectAgent`（103–108 行）中分别 `void loadSkills(DEFAULT_AGENT_ID)` / `void loadSkills(agentId)`。

- [ ] **Step 4: 加 Skills section + 开关写回 + 加载方式渲染**

在「模型」section（221–243 行那段 `profile.managed ? ... : ...` 块）之后、`<Divider label="高级配置" />` 之前插入：

```tsx
      <Divider label="Skills" />
      {skills.length === 0 ? (
        <p className={styles.guideText}>暂无可用内置 skill（种子缺失或复制失败）。</p>
      ) : (
        skills.map((skill) => {
          const cfgEnabled =
            agent.skills?.find((s) => s.id === skill.id)?.enabled ?? skill.enabled;
          const modes = skill.loadModesByAgent[selectedAgentId] ?? [];
          return (
            <Field key={skill.id} label={skill.displayName}>
              <div className={styles.skillRow}>
                <div className={styles.skillMeta}>
                  <span className={styles.skillDesc}>{skill.description}</span>
                  <span className={styles.skillModes}>
                    加载方式：{formatLoadModes(modes)}
                  </span>
                  <span className={styles.skillPath}>{skill.rootPath}</span>
                  <span className={styles.skillStatus}>
                    {skill.status === 'available' ? '可用' : skill.status === 'missing' ? '缺失' : '配置错误'}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={cfgEnabled}
                  aria-label={skill.displayName}
                  className={cfgEnabled ? styles.switchOn : styles.switchOff}
                  onClick={() => toggleSkill(skill.id, !cfgEnabled)}
                >
                  {cfgEnabled ? '启用' : '关闭'}
                </button>
              </div>
            </Field>
          );
        })
      )}
```

在组件内加 `toggleSkill` 与 `formatLoadModes`（后者放文件底部辅助函数区）：

```ts
  const toggleSkill = useCallback(
    (skillId: string, enabled: boolean) => {
      if (!config) return;
      const current = agent.skills ?? [{ id: skillId, enabled: true }];
      const has = current.some((s) => s.id === skillId);
      const nextSkills = has
        ? current.map((s) => (s.id === skillId ? { ...s, enabled } : s))
        : [...current, { id: skillId, enabled }];
      updateAgent({ skills: nextSkills });
    },
    [agent.skills, config, updateAgent],
  );
```

文件底部（`getStatusVariant` 旁）加：

```ts
const LOAD_MODE_LABELS: Record<AgentSkillLoadMode, string> = {
  native: '原生加载',
  directory_access: '目录访问',
  context_file: '上下文文件引导',
  prompt_injection: '$ 显式注入',
};

function formatLoadModes(modes: AgentSkillLoadMode[]): string {
  if (modes.length === 0) return '—';
  return modes.map((m) => LOAD_MODE_LABELS[m]).join(' + ');
}
```

> 样式类 `skillRow/skillMeta/skillDesc/skillModes/skillPath/skillStatus/switchOn/switchOff` 加到 `AgentSettingsTab.module.css`（复用既有 `guideText`/`statusRow` 风格：flex 行布局、小号灰字、开关用圆角 pill；switchOn 用 `--color-system-blue` 背景、switchOff 用 `--mac-border`）。开关切换后由现有「保存配置」按钮 `handleSave` 落盘 `config`（已含 `skills`），无需新增保存逻辑。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/agent-settings-skills.test.tsx tests/agent-settings-active.test.tsx`
Expected: PASS（新测试 + 既有设置页测试不回归）。

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AgentSettingsTab.tsx src/components/settings/AgentSettingsTab.module.css tests/agent-settings-skills.test.tsx
git commit -m "feat(agent-skills): 设置页 Skills section（开关 + 加载方式 + 状态）"
```

---

## Task 14: Composer `$` 技能补全

**Files:**
- Modify: `src/components/agent/MessageInput.tsx`
- Test: `tests/message-input-skill-autocomplete.test.tsx`

- [ ] **Step 1: 写失败测试 tests/message-input-skill-autocomplete.test.tsx**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from '../src/components/agent/MessageInput';

const skillItems = [
  { id: 'lingji-video-workflow', label: '$lingji-video-workflow', description: '灵机剪影视频工作流' },
];

describe('MessageInput $ 技能补全', () => {
  it('输入 $ 展示启用 skill，选择后插入 $id', () => {
    render(
      <MessageInput
        onSend={() => {}}
        skillItems={skillItems}
      />,
    );
    const ta = screen.getByPlaceholderText('输入消息…') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '$' } });
    const item = screen.getByText('$lingji-video-workflow');
    expect(item).toBeTruthy();
    fireEvent.mouseDown(item);
    expect(ta.value).toContain('$lingji-video-workflow');
  });

  it('skillItems 为空时输入 $ 不弹菜单', () => {
    render(<MessageInput onSend={() => {}} skillItems={[]} />);
    const ta = screen.getByPlaceholderText('输入消息…');
    fireEvent.change(ta, { target: { value: '$' } });
    expect(screen.queryByText('$lingji-video-workflow')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/message-input-skill-autocomplete.test.tsx`
Expected: FAIL（无 `skillItems` prop / 无 `$` 菜单）。

- [ ] **Step 3: 给 MessageInput 加 skillItems prop 与 $ 补全**

`MessageInputProps`（54–73 行）加：

```ts
  /** 当前 agent 启用的 skills（用于 $ 补全）；空数组不弹菜单。 */
  skillItems?: { id: string; label: string; description?: string }[];
```

组件参数解构（117–132 行）加 `skillItems`：

```ts
  onModeChange,
  skillItems,
}: MessageInputProps) {
```

在 `@` 文件提及 state 区（164–169 行）之后加 `$` skill state：

```ts
  // ── $ 技能补全 ──
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillSelectedIdx, setSkillSelectedIdx] = useState(0);
  const skills = useMemo(() => skillItems ?? [], [skillItems]);

  const filteredSkills = useMemo((): MenuItem[] => {
    if (!skillMenuOpen || skills.length === 0) return [];
    const match = text.match(/\$([a-z0-9-]*)$/i);
    if (!match) return [];
    const filter = match[1].toLowerCase();
    return skills
      .filter((s) => s.id.toLowerCase().startsWith(filter))
      .map((s) => ({ id: s.id, label: s.label, description: s.description, icon: 'command' as const }));
  }, [skillMenuOpen, skills, text]);
```

在 `handleSlashSelect`/`handleAtSelect` 旁加 `handleSkillSelect`：

```ts
  const handleSkillSelect = useCallback((item: MenuItem) => {
    // 用 $id 替换光标前最后一个 $partial
    const current = textRef.current;
    const replaced = current.replace(/\$([a-z0-9-]*)$/i, `$${item.id} `);
    setText(replaced === current ? `${current}$${item.id} ` : replaced);
    setSkillMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);
```

在 `handleTextChange`（375–403 行）的 `/` 检测之后、`@` 检测之前加 `$` 检测：

```ts
    // $ 技能补全检测（光标前最后一个 token 以 $ 开头）
    const cursorPos = e.target.selectionStart;
    if (skills.length > 0 && cursorPos != null) {
      const beforeCursor = value.slice(0, cursorPos);
      if (/(^|\s)\$[a-z0-9-]*$/i.test(beforeCursor)) {
        setSkillSelectedIdx(0);
        setSkillMenuOpen(true);
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        return;
      }
    }
    setSkillMenuOpen(false);
```

在 `handleKeyDown`（407–436 行）的 `/` 菜单导航块之后加 `$` 菜单导航（与之同构）：

```ts
    if (skillMenuOpen && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSkillSelectedIdx((i) => i < filteredSkills.length - 1 ? i + 1 : 0); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSkillSelectedIdx((i) => i > 0 ? i - 1 : filteredSkills.length - 1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSkillSelect(filteredSkills[skillSelectedIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSkillMenuOpen(false); return; }
    }
```

并把 `handleKeyDown` 依赖数组补 `skillMenuOpen, filteredSkills, skillSelectedIdx, handleSkillSelect`。

在渲染区的自动补全菜单组（470–485 行）加 `$` 菜单：

```tsx
        {skillMenuOpen && filteredSkills.length > 0 && (
          <AutocompleteMenu
            items={filteredSkills}
            selectedIndex={skillSelectedIdx}
            onSelect={handleSkillSelect}
            hint="输入 $ 调用技能"
          />
        )}
```

- [ ] **Step 4: ChatComposer 透传 skillItems + ChatPane 提供数据**

`src/components/agent/ChatComposer.tsx`：`ChatComposerProps extends MessageInputProps` 已自动含 `skillItems`，`<MessageInput {...messageInputProps} />` 已透传——确认 `skillItems` 未被解构拦截（若 ChatComposer 显式解构了部分 props，把 `skillItems` 留在 `...messageInputProps` 内即可，无需改动）。

`src/components/agent/ChatPane.tsx`：加载当前 agent 的启用 skills 作为补全项。在 `agentType` 定义后加：

```ts
  const [skillItems, setSkillItems] = useState<{ id: string; label: string; description?: string }[]>([]);
  useEffect(() => {
    if (!agentType || typeof window.agentAPI?.listSkills !== 'function') {
      setSkillItems([]);
      return;
    }
    let alive = true;
    void window.agentAPI.listSkills(agentType).then((list) => {
      if (!alive) return;
      setSkillItems(
        list
          .filter((s) => s.enabled && s.status === 'available')
          .map((s) => ({ id: s.id, label: `$${s.id}`, description: s.displayName })),
      );
    });
    return () => { alive = false; };
  }, [agentType]);
```

并在 `<ChatComposer ... />`（260–286 行）加一行 prop：

```tsx
          onOpenAgentSettings={onOpenAgentSettings}
          skillItems={skillItems}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/message-input-skill-autocomplete.test.tsx`
Expected: PASS（2 个用例）。

- [ ] **Step 6: Commit**

```bash
git add src/components/agent/MessageInput.tsx src/components/agent/ChatComposer.tsx src/components/agent/ChatPane.tsx tests/message-input-skill-autocomplete.test.tsx
git commit -m "feat(agent-skills): composer \$ 技能补全 + ChatPane 注入启用 skills"
```

---

## Task 15: 项目上下文引导段落

**Files:**
- Modify: `electron/acp/contract-sync.ts:57-78`（`buildFileFirstContractBlock`）
- Test: `tests/contract-sync.test.ts`（追加用例）

- [ ] **Step 1: 在 contract-sync.test.ts 追加失败用例**

在 `tests/contract-sync.test.ts` 末尾的 describe 内加：

```ts
  it('契约块含内置工作流引导段落', () => {
    const block = buildFileFirstContractBlock();
    expect(block).toContain('可用内置工作流');
    expect(block).toContain('$lingji-video-workflow');
  });
```

（确认该测试文件已 `import { buildFileFirstContractBlock } from '../electron/acp/contract-sync'`；若没有则补导入。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/contract-sync.test.ts`
Expected: FAIL（块内无该段落）。

- [ ] **Step 3: 在 buildFileFirstContractBlock 末尾追加段落**

把 `buildFileFirstContractBlock` 返回模板末尾（`- 仅做纯编辑...` 那行之后、反引号结束之前）追加：

```ts
- 仅做纯编辑。**不要**触发重新生成、重新导出、TTS 配音或 AI 画图。

### 可用内置工作流

本应用提供内置 \`$lingji-video-workflow\`。当用户希望从稿件推进到灵机剪影视频，或需要协调文稿、生成、时间线、Motion Card 精修时，优先使用该 workflow。用户也可以在对话中显式输入 \`$lingji-video-workflow\`。`;
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/contract-sync.test.ts`
Expected: PASS（含新用例，既有 upsert 用例不回归）。

- [ ] **Step 5: Commit**

```bash
git add electron/acp/contract-sync.ts tests/contract-sync.test.ts
git commit -m "feat(agent-skills): file-first 契约追加内置工作流引导"
```

---

## Task 16: 打包纳入 resources/ 种子

**Files:**
- Modify: `scripts/package-mac-helpers.cjs:4`
- Modify: `scripts/package-windows.cjs`（若有独立 staging 列表）
- Test: `tests/package-runtime-deps.test.ts`（若覆盖 STAGED_PROJECT_ROOTS 则同步）

- [ ] **Step 1: staging 纳入 resources**

`scripts/package-mac-helpers.cjs` 第 4 行：

```js
const STAGED_PROJECT_ROOTS = new Set(['dist', 'dist-electron', 'src', 'resources']);
```

- [ ] **Step 2: 确认 Windows 打包同样纳入**

Run: `grep -n "STAGED_PROJECT_ROOTS\|'src'\|\"src\"\|shouldStageProjectPath\|resources" scripts/package-windows.cjs`
- 若 Windows 脚本复用 `package-mac-helpers.cjs` 的 `shouldStageProjectPath`，则已自动覆盖，无需改动。
- 若 Windows 有独立 staging 列表，则把 `resources` 加进去（与 mac 对齐）。

- [ ] **Step 3: 回归打包依赖测试**

Run: `npx vitest run tests/package-runtime-deps.test.ts`
Expected: PASS（若该测试断言 staged roots，更新断言纳入 `resources`）。

- [ ] **Step 4: 校验 dev 路径解析**

Run:
```bash
node -e "const p=require('path');console.log(require('fs').existsSync(p.join(process.cwd(),'resources','agent-skills','lingji-video-workflow','SKILL.md')))"
```
Expected: `true`（确认 `app.getAppPath()`/repo 根下种子可达；dev 模式 `app.getAppPath()` 即仓库根）。

- [ ] **Step 5: Commit**

```bash
git add scripts/package-mac-helpers.cjs scripts/package-windows.cjs tests/package-runtime-deps.test.ts
git commit -m "build(agent-skills): 打包纳入 resources/agent-skills 种子"
```

---

## Task 17: 全量校验与构建

**Files:** 无新增（验证任务）

- [ ] **Step 1: 跑全部新增 + 相邻测试**

Run:
```bash
npx vitest run tests/agent-skills-bundled.test.ts tests/agent-skills-frontmatter.test.ts tests/agent-skills-registry.test.ts tests/agent-skills-inject.test.ts tests/agent-skills-config-defaults.test.ts tests/agent-skills-buildargs.test.ts tests/agent-settings-skills.test.tsx tests/message-input-skill-autocomplete.test.tsx tests/contract-sync.test.ts tests/acp-config.test.ts tests/agent-settings-active.test.tsx
```
Expected: 全部 PASS。

- [ ] **Step 2: 跑完整测试套件确认无回归**

Run: `npm test`
Expected: 全绿（如有非本任务相关的既有失败，记录但不在本计划范围内修复）。

- [ ] **Step 3: 编译 + 混淆构建（导出/IPC 链路改动需过 build）**

Run: `npm run build`
Expected: 编译通过（main + preload + renderer），无类型错误。

- [ ] **Step 4: 手动验收清单（记录结果，不在 CI）**

逐项确认（删除 `~/.lingji/agent-skills` 后 `npm run dev`）：
1. 启动后自动生成 `~/.lingji/agent-skills/lingji-video-workflow/SKILL.md`。
2. 设置页三类 agent 下都见 `lingji-video-workflow`，可开关，显示加载方式（pi 原生加载、codex 目录访问、claude 上下文文件引导，均含 $ 显式注入）。
3. 对话输入 `$` 弹出 `$lingji-video-workflow`，选择后插入。
4. 发送含 `$lingji-video-workflow` 的消息 → main 注入 SKILL.md（可在主进程日志/agent 输入侧确认）。
5. 关闭某 agent 的 skill 后该 agent 不再补全，手写 `$lingji-video-workflow` 也不注入。
6. 普通消息（无 `$`）不注入全文。

- [ ] **Step 5: 最终提交（如有 build 产物外的零散修正）**

```bash
git add -A
git commit -m "test(agent-skills): 全量校验与构建通过"
```

---

## Self-Review

**Spec 覆盖核对：**
- 首启动复制种子 → Task 4 + Task 10（registry.ensureBundled 在 list/connect/send 前触发）+ Task 16（打包）。✅
- 统一用户配置目录读取 → Task 6 registry targetRoot `~/.lingji/agent-skills`。✅
- 配置中心 Skills 列表（首期仅 `$lingji-video-workflow`）→ Task 13。✅
- 默认启用、可按 agent 关闭 → Task 7（默认）+ Task 13（开关写回）。✅
- `$` 补全 → Task 14。✅
- 显式 `$` 注入主 SKILL.md → Task 5 + Task 10 + Task 12。✅
- Pi `--skill` / Codex `--add-dir` / Claude 上下文引导 → Task 8 + Task 9 + Task 15。✅
- 配置中心显示加载方式 → Task 13（formatLoadModes + LOAD_MODES_BY_AGENT）。✅
- 数据模型（AgentSkillDefinition/Config/ResolvedAgentSkill/AgentEntry.skills）→ Task 2。✅
- IPC listSkills + opts.skillIds 安全二次校验 → Task 10 + Task 11。✅
- 迁移兼容（旧 config 无 skills 补默认、未知 id 忽略）→ Task 7 + Task 6 resolveForAgent。✅
- 错误处理（种子缺失返回空、读取失败降级、未启用不注入）→ Task 4/6/10。✅
- 项目上下文引导段落 → Task 15。✅

**Placeholder 扫描：** 无「TODO/待补」式步骤；测试代码与实现代码均给出完整内容。两处显式标注「实现前先看一眼既有文件确认查询/解构约定」（Task 13 开关组件、Task 14 ChatComposer 透传）属于必要的现状核对，非占位。

**类型一致性：** `ResolvedAgentSkill`（含 `enabled/status/rootPath/loadModesByAgent`）在 Task 2 定义后，于 Task 6（resolveForAgent 返回）、Task 8（buildArgs ctx.skills）、Task 9（session/registry 透传）、Task 10（IPC）、Task 11（agent-api）、Task 13/14（renderer）一致使用。`AgentSkillConfig`（`{id,enabled}`）在 Task 2/7/13 一致。`skillIds`（`string[]`）在 Task 10/11/12 一致。`BUILTIN_SKILL_ID`/`LOAD_MODES_BY_AGENT` 单一来源（constants.ts）。`buildInjectionText`/`parseSkillTokens` 签名在 Task 5 定义后于 Task 10/12 一致调用。✅

**潜在执行风险（执行者注意）：**
- Task 12「Connection.send opts 类型」需在 `acp-connections-context.tsx` 找到对外 `send` 方法的类型声明同步加 `skillIds`，否则 ChatPane 传参类型不过——已在步骤内点名。
- Task 13/14 的 UI 选择器/样式需对齐既有组件约定，已要求先比对 `agent-settings-active.test.tsx` 与 ChatComposer 实际解构。

# 灵机 CLI Plan 4 — AI 卡片操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI 能 headless 读取/修改/删除/重生成/转换 AI 卡片（作用于 `project.json` 的 `aiAnalysis.analysisResult.cards`）。

**Architecture:** 即时类（list/show/update/delete）= 直接读写 `project.json` 的轻量 MCP 工具（非 task）；任务类（regenerate/regen-media/convert）= 复用 Plan 2 的 `registerGenerationTool`（带 `extraInput: { cardId }`），run 内复用主进程既有原语（`regenerateAICard`、`handleGenerateCardImage/Video`、`planMotionConversion`+`mergeMotionConversionResult`）。写回后发 `pipeline:project-updated`（sections `['aiAnalysis']`）。

**Tech Stack:** TypeScript、Electron 主进程、`@modelcontextprotocol/sdk`、Vitest。

参考：spec `…-cli-design.md`（§4.4、§5、§9.1 Plan 4）；Plan 2/3 的 `headless-generation.ts`（`registerGenerationTool` 已支持 `extraInput`/`ctx.params`）、`headless-settings.ts`、`runs/analyze-run.ts`（模板/样式装配蓝本）。

**关键前置事实（已核实）：**
- 卡片在 `project.json` → `aiAnalysis.analysisResult.cards`（`AICard[]`）；section 写回形状 `{ analysisResult, coverCandidates }`（见 `runs/analyze-run.ts`）。
- `updateCardInResult(result, cardId, partial)` / `removeCardInResult(result, cardId)`：`src/lib/ai-persistence.ts`（纯函数）。
- `deleteCardAssets(projectDir, cardId)`：`electron/ai-card-assets.ts`（递归删 `ai-cards/<cardId>/`）。
- 可改字段：`title/enabled/displayMode/startMs/endMs/displayDurationMs/template/stylePresetId/cardPrompt`（`src/types/ai.ts:140`）。
- regenerate：复刻 `electron/main.ts` 的 `regenerate-ai-card` 处理体（模板 `cards.segment`/`card.image` + `loadProjectStylePresetId` + `regenerateAICard(entries, card, segment, settings, opts)` + `validateMotionSource: assertCardRenders`）。
- regen-media：`handleGenerateCardImage(args, ctx)` / `handleGenerateCardVideo(args, ctx)`（`electron/card-media-handlers.ts`）。
- convert→motion：`planMotionConversion(card, analysisResult)`（`src/lib/ai-card-conversion.ts`）→ segment 分支用 `regenerateAICard`，subtitles 分支用 `generateSingleCardFromSubtitles`（`src/lib/ai-analysis.ts`）→ `mergeMotionConversionResult(original, generated)`。convert→image/video：本地字段重写（无生成），随后可选 regen-media。
- 卡片 segment 查找：`analysisResult.segments.find(s => s.id === card.segmentId)`。`parseSrt`、`HeadlessProjectContext.saveSection` 同 Plan 3。
- **motion NL modify 无可复用核心**（无 `motion.modify` prompt kind、无 modify 函数），本计划**不做 `cards modify`**，在 help 中不暴露，留待后续。

**范围限定：**
- `cards convert --to image|video`：仅本地类型重写（生成空 idle media），与 UI 行为一致；用户随后 `cards regen-media` 出图/视频。`--to motion`：走 motion 转换 + 合并。
- regen-media 复用卡片现有 `content`（MediaCardContent）的 prompt/aspectRatio/provider/model。

---

## File Structure

- `electron/pipeline/card-ops.ts`（新增）：即时 headless `listCards/getCard/updateCard/deleteCard`。
- `electron/pipeline/card-tools.ts`（新增）：注册 4 个即时 MCP 工具（list/get/update/delete），update/delete 写后发 `pipeline:project-updated`。
- `electron/pipeline/runs/card-run.ts`（新增）：`runRegenerateCard/runRegenerateCardMedia/runConvertCard`（注入式）。
- `electron/pipeline/headless-generation.ts`（修改）：`registerGenerationTools` 追加 regenerate/regen-media/convert 三工具（`extraInput: { cardId, to? }`）。
- `electron/pipeline/tools/register.ts`（修改）：调用 `registerCardTools`。
- `tests/pipeline-mcp-registration.test.ts`（修改）：计数与名单。
- `cli/src/commands/cards.ts`（修改）：从「仅 gen」扩展为 list/show/update/regenerate/regen-media/convert/delete。
- `cli/src/index.ts`（修改）：HELP 文案。
- 测试：`tests/card-ops.test.ts`、`tests/card-tools.test.ts`、`tests/card-run.test.ts`、`tests/cli-cards-command.test.ts`（扩展）。

---

## Task 1: 即时卡片操作（headless）

**Files:**
- Create: `electron/pipeline/card-ops.ts`
- Test: `tests/card-ops.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/card-ops.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listCards, getCard, updateCard, deleteCard } from '../electron/pipeline/card-ops';

function project(cards: unknown[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-card-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x', timeline: null,
    aiAnalysis: { analysisResult: { segments: [], cards, coverPrompts: [], summary: '', keywords: [] }, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}
const CARD = { id: 'c1', segmentId: 's1', type: 'summary', title: '标题', content: '内容', startMs: 0, endMs: 1000, displayDurationMs: 1000, displayMode: 'pip', template: 'default', enabled: true, style: {} };

describe('card-ops', () => {
  it('listCards returns summaries', async () => {
    const dir = project([CARD]);
    try {
      const list = await listCards(dir);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: 'c1', type: 'summary', title: '标题', enabled: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('getCard returns full card; throws card_not_found', async () => {
    const dir = project([CARD]);
    try {
      expect((await getCard(dir, 'c1')).content).toBe('内容');
      await expect(getCard(dir, 'nope')).rejects.toMatchObject({ code: 'card_not_found' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('updateCard whitelists fields and persists', async () => {
    const dir = project([CARD]);
    try {
      const updated = await updateCard(dir, 'c1', { title: '新标题', enabled: false, type: 'data' } as never);
      expect(updated.title).toBe('新标题');
      expect(updated.enabled).toBe(false);
      expect((updated as any).type).toBe('summary'); // type not whitelisted → unchanged
      const saved = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf-8'));
      expect(saved.aiAnalysis.analysisResult.cards[0].title).toBe('新标题');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('deleteCard removes the card', async () => {
    const dir = project([CARD]);
    try {
      await deleteCard(dir, 'c1');
      const saved = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf-8'));
      expect(saved.aiAnalysis.analysisResult.cards).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-ops.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/pipeline/card-ops.ts
import { loadProjectFile } from '../project-file';
import { HeadlessProjectContext } from './context';
import { updateCardInResult, removeCardInResult } from '../../src/lib/ai-persistence';
import { deleteCardAssets } from '../ai-card-assets';
import { GenerationError } from './generation-error';
import type { AICard } from '../../src/types/ai';

const UPDATABLE: ReadonlyArray<keyof AICard> = [
  'title', 'enabled', 'displayMode', 'startMs', 'endMs', 'displayDurationMs', 'template', 'stylePresetId', 'cardPrompt',
];

export interface CardSummary {
  id: string; segmentId: string; type: string; title: string;
  enabled: boolean; startMs: number; endMs: number; renderMode?: string;
}

async function readCards(projectPath: string) {
  const data = await loadProjectFile(projectPath);
  const analysisResult = data.aiAnalysis?.analysisResult ?? null;
  return { data, analysisResult, cards: analysisResult?.cards ?? [] };
}

export async function listCards(projectPath: string): Promise<CardSummary[]> {
  const { cards } = await readCards(projectPath);
  return cards.map((c) => ({
    id: c.id, segmentId: c.segmentId, type: c.type, title: c.title,
    enabled: c.enabled, startMs: c.startMs, endMs: c.endMs, renderMode: c.renderMode,
  }));
}

export async function getCard(projectPath: string, cardId: string): Promise<AICard> {
  const { cards } = await readCards(projectPath);
  const card = cards.find((c) => c.id === cardId);
  if (!card) throw new GenerationError('card_not_found', `卡片不存在: ${cardId}`);
  return card;
}

export async function updateCard(
  projectPath: string,
  cardId: string,
  updates: Partial<AICard>,
): Promise<AICard> {
  const { data, analysisResult, cards } = await readCards(projectPath);
  if (!cards.some((c) => c.id === cardId)) {
    throw new GenerationError('card_not_found', `卡片不存在: ${cardId}`);
  }
  const clean: Partial<AICard> = {};
  for (const k of UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(updates, k)) {
      (clean as Record<string, unknown>)[k] = (updates as Record<string, unknown>)[k];
    }
  }
  const next = updateCardInResult(analysisResult, cardId, clean);
  await new HeadlessProjectContext(projectPath).saveSection('aiAnalysis', {
    analysisResult: next,
    coverCandidates: data.aiAnalysis?.coverCandidates ?? [],
  });
  return next!.cards.find((c) => c.id === cardId)!;
}

export async function deleteCard(projectPath: string, cardId: string): Promise<{ ok: true }> {
  const { data, analysisResult, cards } = await readCards(projectPath);
  if (!cards.some((c) => c.id === cardId)) {
    throw new GenerationError('card_not_found', `卡片不存在: ${cardId}`);
  }
  const next = removeCardInResult(analysisResult, cardId);
  await deleteCardAssets(projectPath, cardId).catch(() => {});
  await new HeadlessProjectContext(projectPath).saveSection('aiAnalysis', {
    analysisResult: next,
    coverCandidates: data.aiAnalysis?.coverCandidates ?? [],
  });
  return { ok: true };
}
```

> 实现前确认：`removeCardInResult` 的真实导出名（`src/lib/ai-persistence.ts`；若实际是 `removeCardsInResult(result, [cardId])`，用它包一层）。`deleteCardAssets` 的导出与签名（`electron/ai-card-assets.ts`）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/card-ops.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/card-ops.ts tests/card-ops.test.ts
git commit -m "feat(cli): headless 卡片即时操作 list/get/update/delete"
```

---

## Task 2: 即时卡片 MCP 工具

**Files:**
- Create: `electron/pipeline/card-tools.ts`
- Modify: `electron/pipeline/tools/register.ts`、`tests/pipeline-mcp-registration.test.ts`
- Test: `tests/card-tools.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/card-tools.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { registerCardTools } from '../electron/pipeline/card-tools';

class FakeMcpServer {
  tools = new Map<string, { def: unknown; handler: (args: unknown) => unknown }>();
  registerTool(name: string, def: unknown, handler: (args: unknown) => unknown): void {
    this.tools.set(name, { def, handler });
  }
}
function project(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-ct-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x', timeline: null,
    aiAnalysis: { analysisResult: { segments: [], cards: [{ id: 'c1', segmentId: 's1', type: 'summary', title: 'T', content: 'x', startMs: 0, endMs: 1000, displayDurationMs: 1000, displayMode: 'pip', template: 'default', enabled: true, style: {} }], coverPrompts: [], summary: '', keywords: [] }, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}

describe('registerCardTools', () => {
  it('registers list/get/update/delete and list returns cards', async () => {
    const dir = project();
    try {
      const server = new FakeMcpServer();
      registerCardTools(server as never, () => null, () => '/tmp');
      for (const n of ['lingji_list_cards', 'lingji_get_card', 'lingji_update_card', 'lingji_delete_card']) {
        expect(server.tools.has(n)).toBe(true);
      }
      const res = (await server.tools.get('lingji_list_cards')!.handler({ projectPath: dir })) as { content: { text: string }[] };
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed[0].id).toBe('c1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('update_card applies whitelisted field', async () => {
    const dir = project();
    try {
      const server = new FakeMcpServer();
      registerCardTools(server as never, () => null, () => '/tmp');
      const res = (await server.tools.get('lingji_update_card')!.handler({ projectPath: dir, cardId: 'c1', enabled: false })) as { content: { text: string }[] };
      expect(JSON.parse(res.content[0].text).enabled).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-tools.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 card-tools.ts**

```ts
// electron/pipeline/card-tools.ts
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listCards, getCard, updateCard, deleteCard } from './card-ops';
import { emitProjectUpdated } from './headless-generation';
import type { AICard } from '../../src/types/ai';

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string, code?: string) {
  const payload: Record<string, unknown> = { error: message };
  if (code) payload.code = code;
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}
function err(e: unknown) {
  const x = e as { code?: string; message?: string };
  return errorResult(x?.message ?? String(e), x?.code);
}

export function registerCardTools(
  server: McpServer,
  getMainWindow: () => BrowserWindow | null,
  _getUserDataPath: () => string,
): void {
  server.registerTool(
    'lingji_list_cards',
    { title: '列出卡片', description: '返回项目 AI 卡片摘要（id/segmentId/type/title/enabled/时间/renderMode）。', inputSchema: { projectPath: z.string() } },
    async ({ projectPath }) => { try { return jsonResult(await listCards(projectPath)); } catch (e) { return err(e); } },
  );
  server.registerTool(
    'lingji_get_card',
    { title: '查看卡片', description: '返回单张卡片完整对象。', inputSchema: { projectPath: z.string(), cardId: z.string() } },
    async ({ projectPath, cardId }) => { try { return jsonResult(await getCard(projectPath, cardId)); } catch (e) { return err(e); } },
  );
  server.registerTool(
    'lingji_update_card',
    {
      title: '修改卡片字段', description: '修改卡片白名单字段（title/enabled/displayMode/start/end/duration/template/stylePresetId/cardPrompt）。',
      inputSchema: {
        projectPath: z.string(), cardId: z.string(),
        title: z.string().optional(), enabled: z.boolean().optional(),
        displayMode: z.enum(['fullscreen', 'pip']).optional(),
        startMs: z.number().optional(), endMs: z.number().optional(), displayDurationMs: z.number().optional(),
        template: z.string().optional(), stylePresetId: z.string().optional(), cardPrompt: z.string().optional(),
      },
    },
    async ({ projectPath, cardId, ...fields }) => {
      try {
        const updated = await updateCard(projectPath, cardId, fields as Partial<AICard>);
        emitProjectUpdated(getMainWindow, projectPath, ['aiAnalysis']);
        return jsonResult(updated);
      } catch (e) { return err(e); }
    },
  );
  server.registerTool(
    'lingji_delete_card',
    { title: '删除卡片', description: '删除卡片并清理其媒体资源。', inputSchema: { projectPath: z.string(), cardId: z.string() } },
    async ({ projectPath, cardId }) => {
      try {
        const r = await deleteCard(projectPath, cardId);
        emitProjectUpdated(getMainWindow, projectPath, ['aiAnalysis']);
        return jsonResult(r);
      } catch (e) { return err(e); }
    },
  );
}
```

- [ ] **Step 4: 接入 register.ts**

在 `electron/pipeline/tools/register.ts` import `registerCardTools` 并在 `registerPipelineMcpTools` 末尾（`registerGenerationTools(...)` 之后）调用 `registerCardTools(server, getMainWindow, getUserDataPath);`。
在 `tests/pipeline-mcp-registration.test.ts` 追加 4 个名（`lingji_list_cards`/`lingji_get_card`/`lingji_update_card`/`lingji_delete_card`），数量改为 `>= 19`。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/card-tools.test.ts tests/pipeline-mcp-registration.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add electron/pipeline/card-tools.ts electron/pipeline/tools/register.ts tests/card-tools.test.ts tests/pipeline-mcp-registration.test.ts
git commit -m "feat(cli): 即时卡片 MCP 工具 list/get/update/delete"
```

---

## Task 3: 卡片任务操作（regenerate / regen-media / convert）

**Files:**
- Create: `electron/pipeline/runs/card-run.ts`
- Test: `tests/card-run.test.ts`

复杂 run，**实现前 READ** `electron/main.ts` 的 `regenerate-ai-card`（~741-799）、`card-media-handlers.ts` 的 `handleGenerateCardImage/Video`、`src/lib/ai-card-conversion.ts`（`planMotionConversion`/`mergeMotionConversionResult`）与 `src/store/ai.ts` 的 `convertCardToMotion`/`convertCardToMedia`/`regenerateCardMedia` 作为编排蓝本。所有外部生成函数以**可注入依赖**暴露，测试不触网。

- [ ] **Step 1: 写失败测试**

```ts
// tests/card-run.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runRegenerateCard, runConvertCard } from '../electron/pipeline/runs/card-run';

function project(card: unknown, segment: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-cr-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x', timeline: null,
    aiAnalysis: { analysisResult: { segments: [segment], cards: [card], coverPrompts: [], summary: 'S', keywords: ['k'] }, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  writeFileSync(path.join(dir, 'podcast-subtitles.srt'), '1\n00:00:00,000 --> 00:00:01,000\n你好\n');
  return dir;
}
const ud = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'lingji-crud-')); writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ aiSettings: { llmProviders: [{ id: 'l1', name: 'x', type: 'openai_compatible', baseUrl: 'h', apiKey: 'k', models: ['m'] }], defaultProviderId: 'l1', defaultModel: 'm' } })); return d; };
const handle = () => ({ taskId: 't', signal: new AbortController().signal, update: () => {}, log: () => {} });
const SEG = { id: 's1', title: '段', summary: '摘要', startMs: 0, endMs: 1000 };
const CARD = { id: 'c1', segmentId: 's1', type: 'summary', title: 'T', content: '内容', startMs: 0, endMs: 1000, displayDurationMs: 1000, displayMode: 'pip', template: 'default', enabled: true, style: {} };

describe('runRegenerateCard', () => {
  it('regenerates a card and persists, preserving id', async () => {
    const dir = project(CARD, SEG); const u = ud();
    try {
      const res = await runRegenerateCard(
        { projectPath: dir, userDataPath: u, handle: handle() as never, params: { cardId: 'c1' } },
        { regenerate: async (_e, card) => ({ ...card, title: '重生成后' }) as never },
      );
      expect((res as any).title).toBe('重生成后');
      const saved = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf-8'));
      expect(saved.aiAnalysis.analysisResult.cards[0].title).toBe('重生成后');
      expect(saved.aiAnalysis.analysisResult.cards[0].id).toBe('c1');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(u, { recursive: true, force: true }); }
  });
  it('throws card_not_found for missing card', async () => {
    const dir = project(CARD, SEG); const u = ud();
    try {
      await expect(runRegenerateCard({ projectPath: dir, userDataPath: u, handle: handle() as never, params: { cardId: 'zzz' } }, { regenerate: async () => ({}) as never })).rejects.toMatchObject({ code: 'card_not_found' });
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(u, { recursive: true, force: true }); }
  });
});

describe('runConvertCard to=image (local rewrite, no generation)', () => {
  it('rewrites card type to image and persists', async () => {
    const dir = project(CARD, SEG); const u = ud();
    try {
      const res = await runConvertCard({ projectPath: dir, userDataPath: u, handle: handle() as never, params: { cardId: 'c1', to: 'image' } }, {});
      expect((res as any).type).toBe('image');
      const saved = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf-8'));
      expect(saved.aiAnalysis.analysisResult.cards[0].type).toBe('image');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(u, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/card-run.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 card-run.ts**

实现三个导出（签名固定，便于工具与测试）：
```ts
// electron/pipeline/runs/card-run.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSrt } from '../../../src/lib/srt-parser';
import { regenerateAICard, generateSingleCardFromSubtitles } from '../../../src/lib/ai-analysis';
import { planMotionConversion, mergeMotionConversionResult } from '../../../src/lib/ai-card-conversion';
import { handleGenerateCardImage, handleGenerateCardVideo } from '../../card-media-handlers';
import { updateCardInResult } from '../../../src/lib/ai-persistence';
import { loadFullHeadlessAISettings, loadHeadlessProjectBindings } from '../headless-settings';
import { loadEffectivePromptTemplate } from '../../prompts-io';
import { loadProjectFile } from '../../project-file';
import { HeadlessProjectContext } from '../context';
import { GenerationError } from '../generation-error';
import type { GenerationRunCtx } from '../headless-generation';
import type { AICard, AISegment, AIAnalysisResult } from '../../../src/types/ai';
import type { SrtEntry } from '../../../src/types';

interface Loaded {
  projectPath: string; settings: Awaited<ReturnType<typeof loadFullHeadlessAISettings>>;
  projectBindings: Awaited<ReturnType<typeof loadHeadlessProjectBindings>>;
  result: AIAnalysisResult; card: AICard; segment: AISegment | undefined; entries: SrtEntry[];
  coverCandidates: unknown[];
}

async function loadForCard(ctx: GenerationRunCtx): Promise<Loaded> {
  const { projectPath, userDataPath } = ctx;
  const settings = await loadFullHeadlessAISettings(userDataPath);
  const projectBindings = await loadHeadlessProjectBindings(projectPath);
  const data = await loadProjectFile(projectPath);
  const result = data.aiAnalysis?.analysisResult ?? null;
  const cardId = String((ctx.params ?? {}).cardId ?? '');
  const card = result?.cards.find((c) => c.id === cardId);
  if (!result || !card) throw new GenerationError('card_not_found', `卡片不存在: ${cardId}`);
  const segment = result.segments.find((s) => s.id === card.segmentId);
  let entries: SrtEntry[] = [];
  try { entries = parseSrt(await readFile(join(projectPath, 'podcast-subtitles.srt'), 'utf-8')); } catch { /* ok */ }
  return { projectPath, settings, projectBindings, result, card, segment, entries, coverCandidates: data.aiAnalysis?.coverCandidates ?? [] };
}

async function persistCard(l: Loaded, nextCard: AICard): Promise<AICard> {
  const next = updateCardInResult(l.result, nextCard.id, nextCard);
  await new HeadlessProjectContext(l.projectPath).saveSection('aiAnalysis', {
    analysisResult: next, coverCandidates: l.coverCandidates,
  });
  return next!.cards.find((c) => c.id === nextCard.id)!;
}

interface RegenDeps {
  regenerate?: (entries: SrtEntry[], card: AICard, segment: AISegment, settings: unknown, opts: Record<string, unknown>) => Promise<AICard>;
}

/** 重新生成整卡（复刻 main 的 regenerate-ai-card 装配） */
export async function runRegenerateCard(ctx: GenerationRunCtx, deps: RegenDeps = {}): Promise<AICard> {
  const regenerate = deps.regenerate ?? (regenerateAICard as never);
  const l = await loadForCard(ctx);
  if (!l.segment) throw new GenerationError('no_segment', `卡片无对应段落: ${l.card.segmentId}`);
  ctx.handle.update({ phase: '重生成', percent: 20 });
  const [cardTemplate, imageTemplate] = await Promise.all([
    loadEffectivePromptTemplate('cards.segment', { userDataPath: ctx.userDataPath, projectDir: l.projectPath }),
    loadEffectivePromptTemplate('card.image', { userDataPath: ctx.userDataPath, projectDir: l.projectPath }),
  ]);
  const generated = await regenerate(l.entries, l.card, l.segment, l.settings, {
    globalPrompt: l.result.globalPrompt,
    projectStylePresetId: (await loadProjectFile(l.projectPath)).stylePresetId,
    defaultStylePresetId: l.settings.defaultStylePresetId,
    cardPrompt: l.card.cardPrompt,
    programSummary: l.result.summary,
    keywords: l.result.keywords,
    cardTemplate, imageTemplate,
    projectBindings: l.projectBindings,
  });
  ctx.handle.update({ phase: '写入', percent: 90 });
  return persistCard(l, { ...generated, id: l.card.id, segmentId: l.card.segmentId });
}

interface MediaDeps {
  generateImage?: typeof handleGenerateCardImage;
  generateVideo?: typeof handleGenerateCardVideo;
}

/** 仅重生成图/视频媒体 */
export async function runRegenerateCardMedia(ctx: GenerationRunCtx, deps: MediaDeps = {}): Promise<AICard> {
  const l = await loadForCard(ctx);
  const content = l.card.content as Record<string, unknown>;
  if (l.card.type !== 'image' && l.card.type !== 'video') {
    throw new GenerationError('not_media_card', `仅 image/video 卡可重生成媒体，实际为 ${l.card.type}`);
  }
  const cmnCtx = { settings: l.settings, projectBindings: l.projectBindings, onProgress: () => {}, signal: ctx.handle.signal };
  const base = {
    projectDir: l.projectPath, cardId: l.card.id,
    prompt: String(content.prompt ?? l.card.title), negativePrompt: content.negativePrompt as string | undefined,
    aspectRatio: (content.aspectRatio ?? '16:9') as never,
    providerId: content.providerId as string | undefined, model: content.model as string | undefined,
    extraParams: content.extraParams as Record<string, unknown> | undefined,
  };
  ctx.handle.update({ phase: '生成媒体', percent: 30 });
  let mediaContent;
  if (l.card.type === 'image') {
    mediaContent = await (deps.generateImage ?? handleGenerateCardImage)(base as never, cmnCtx as never);
  } else {
    mediaContent = await (deps.generateVideo ?? handleGenerateCardVideo)(
      { ...base, durationSeconds: Math.max(1, Math.round((l.card.displayDurationMs ?? 3000) / 1000)) } as never,
      cmnCtx as never,
    );
  }
  ctx.handle.update({ phase: '写入', percent: 90 });
  const patch: Partial<AICard> = { content: mediaContent as never };
  if (l.card.type === 'video' && (mediaContent as { mediaDurationMs?: number }).mediaDurationMs) {
    patch.displayDurationMs = (mediaContent as { mediaDurationMs: number }).mediaDurationMs;
  }
  return persistCard(l, { ...l.card, ...patch });
}

interface ConvertDeps {
  regenerate?: RegenDeps['regenerate'];
  fromSubtitles?: (entries: SrtEntry[], draft: unknown, settings: unknown, opts: Record<string, unknown>) => Promise<AICard>;
}

/** 转换卡片类型：image/video=本地重写；motion=生成+合并 */
export async function runConvertCard(ctx: GenerationRunCtx, deps: ConvertDeps = {}): Promise<AICard> {
  const to = String((ctx.params ?? {}).to ?? '');
  const l = await loadForCard(ctx);
  ctx.handle.update({ phase: '转换', percent: 20 });

  if (to === 'image' || to === 'video') {
    // 本地字段重写（与 store.convertCardToMedia 一致）：建空 idle media，由用户后续 regen-media 生成
    const next = mergeMediaConversion(l.card, l.segment, to);
    ctx.handle.update({ phase: '写入', percent: 90 });
    return persistCard(l, next);
  }
  if (to === 'motion') {
    const plan = planMotionConversion(l.card, l.result);
    if (plan.kind === 'noop') return l.card;
    let generated: AICard;
    if (plan.kind === 'segment') {
      const regenerate = deps.regenerate ?? (regenerateAICard as never);
      const [cardTemplate, imageTemplate] = await Promise.all([
        loadEffectivePromptTemplate('cards.segment', { userDataPath: ctx.userDataPath, projectDir: l.projectPath }),
        loadEffectivePromptTemplate('card.image', { userDataPath: ctx.userDataPath, projectDir: l.projectPath }),
      ]);
      generated = await regenerate(l.entries, l.card, plan.segment, l.settings, {
        globalPrompt: l.result.globalPrompt, projectStylePresetId: (await loadProjectFile(l.projectPath)).stylePresetId,
        defaultStylePresetId: l.settings.defaultStylePresetId, cardPrompt: l.card.cardPrompt,
        programSummary: l.result.summary, keywords: l.result.keywords, cardTemplate, imageTemplate, projectBindings: l.projectBindings,
      });
    } else {
      const fromSubtitles = deps.fromSubtitles ?? (generateSingleCardFromSubtitles as never);
      generated = await fromSubtitles(l.entries, plan.draft, l.settings, {
        globalPrompt: l.result.globalPrompt, programSummary: l.result.summary, keywords: l.result.keywords, projectBindings: l.projectBindings,
      });
    }
    const merged = mergeMotionConversionResult(l.card, generated);
    ctx.handle.update({ phase: '写入', percent: 90 });
    return persistCard(l, merged);
  }
  throw new GenerationError('bad_convert_target', `不支持的转换目标: ${to}（image/video/motion）`);
}
```
其中 `mergeMediaConversion(card, segment, mediaType)` 复刻 `src/store/ai.ts` 的 `convertCardToMedia` 本地重写逻辑（seedPrompt、idle MediaCardContent、`type/template/style/displayDurationMs`）。**实现前 READ** `convertCardToMedia`（`src/store/ai.ts:564-612`）并把其纯逻辑搬为本模块内的 `mergeMediaConversion`（复制其用到的 `MEDIA_DEFAULT_DURATION_MS` 常量、`getDefaultTemplate`/`DEFAULT_CARD_STYLE` 从 `src/types/ai.ts` import）。

> 实现前确认：`regenerateAICard`、`generateSingleCardFromSubtitles`、`planMotionConversion`、`mergeMotionConversionResult`、`handleGenerateCardImage/Video` 的真实签名与导出路径；`regenerate-ai-card` 主处理体的 options 字段名以源码为准（与 Plan 3 analyze 一致）。注入式 dep 默认值用真实函数，测试用注入跳过网络。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/card-run.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/runs/card-run.ts tests/card-run.test.ts
git commit -m "feat(cli): headless 卡片任务 run（重生成/重生成媒体/转换）"
```

---

## Task 4: 注册卡片任务工具

**Files:**
- Modify: `electron/pipeline/headless-generation.ts`、`tests/pipeline-mcp-registration.test.ts`

- [ ] **Step 1: 改注册测试（先红）**

`tests/pipeline-mcp-registration.test.ts` 追加 `lingji_regenerate_card`/`lingji_regenerate_card_media`/`lingji_convert_card`，数量改为 `>= 22`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts`
Expected: FAIL。

- [ ] **Step 3: 注册**

在 `registerGenerationTools` 追加（import 三个 run）：
```ts
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_regenerate_card', title: '重新生成卡片',
    description: '按 cardId 重新生成整卡（复用分析卡片生成逻辑）。返回 taskId。',
    kind: 'generate_cards', sections: ['aiAnalysis'],
    extraInput: { cardId: z.string() },
    run: (ctx) => runRegenerateCard(ctx),
  });
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_regenerate_card_media', title: '重新生成卡片媒体',
    description: '仅重新生成 image/video 卡的媒体素材。返回 taskId。',
    kind: 'generate_cards', sections: ['aiAnalysis'],
    extraInput: { cardId: z.string() },
    run: (ctx) => runRegenerateCardMedia(ctx),
  });
  registerGenerationTool(server, getMainWindow, getUserDataPath, {
    name: 'lingji_convert_card', title: '转换卡片类型',
    description: '将卡片转换为 image/video（本地重写）或 motion（生成+合并）。返回 taskId。',
    kind: 'generate_motion', sections: ['aiAnalysis'],
    extraInput: { cardId: z.string(), to: z.enum(['image', 'video', 'motion']) },
    run: (ctx) => runConvertCard(ctx),
  });
```
> 注：三者皆 task；`generate_cards`/`generate_motion` 均在 `PIPELINE_TASK_KINDS`。`runRegenerateCardMedia` 也接受 `ctx`（其 deps 默认真实函数）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/pipeline-mcp-registration.test.ts tests/card-run.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/pipeline/headless-generation.ts tests/pipeline-mcp-registration.test.ts
git commit -m "feat(cli): 注册卡片任务工具 regenerate/regen-media/convert"
```

---

## Task 5: CLI cards 命令扩展

**Files:**
- Modify: `cli/src/commands/cards.ts`、`cli/src/index.ts`
- Test: `tests/cli-cards-command.test.ts`（扩展）

`cards` 现有 `gen`（→ analyze）。扩展为多子命令。即时类直接 `client.call` 并输出；任务类走 `runGenerationCommand`（带 cardId/to extraArgs）。

- [ ] **Step 1: 扩展测试**

```ts
// tests/cli-cards-command.test.ts （替换 Plan 3 的版本，保留 gen 用例）
import { describe, it, expect } from 'vitest';
import { runCardsCommand } from '../cli/src/commands/cards';
import type { ToolCaller } from '../cli/src/client';
function fake() { const calls: any[] = []; return { calls, client: { async call(n: string, a?: unknown) { calls.push({ name: n, args: a }); return n === 'lingji_get_active_project' ? { projectPath: '/p' } : (n === 'lingji_list_cards' ? [{ id: 'c1' }] : { taskId: 't' }); }, async close() {} } as ToolCaller }; }

describe('runCardsCommand', () => {
  it('gen → lingji_analyze_subtitles', async () => { const { client, calls } = fake(); await runCardsCommand('gen', [], {}, client); expect(calls.some((c) => c.name === 'lingji_analyze_subtitles')).toBe(true); });
  it('list → lingji_list_cards (instant)', async () => { const { client, calls } = fake(); const r = await runCardsCommand('list', [], {}, client); expect(calls.some((c) => c.name === 'lingji_list_cards')).toBe(true); expect((r as any[])[0].id).toBe('c1'); });
  it('show <id> → lingji_get_card', async () => { const { client, calls } = fake(); await runCardsCommand('show', ['c1'], {}, client); expect(calls.find((c) => c.name === 'lingji_get_card')?.args).toMatchObject({ projectPath: '/p', cardId: 'c1' }); });
  it('update <id> --enabled false → lingji_update_card', async () => { const { client, calls } = fake(); await runCardsCommand('update', ['c1'], { enabled: 'false' }, client); const call = calls.find((c) => c.name === 'lingji_update_card'); expect(call.args).toMatchObject({ projectPath: '/p', cardId: 'c1', enabled: false }); });
  it('delete <id> → lingji_delete_card', async () => { const { client, calls } = fake(); await runCardsCommand('delete', ['c1'], {}, client); expect(calls.find((c) => c.name === 'lingji_delete_card')?.args).toMatchObject({ cardId: 'c1' }); });
  it('regenerate <id> → lingji_regenerate_card (task)', async () => { const { client, calls } = fake(); await runCardsCommand('regenerate', ['c1'], {}, client); const call = calls.find((c) => c.name === 'lingji_regenerate_card'); expect(call.args).toMatchObject({ projectPath: '/p', cardId: 'c1' }); });
  it('convert <id> --to motion → lingji_convert_card', async () => { const { client, calls } = fake(); await runCardsCommand('convert', ['c1'], { to: 'motion' }, client); const call = calls.find((c) => c.name === 'lingji_convert_card'); expect(call.args).toMatchObject({ projectPath: '/p', cardId: 'c1', to: 'motion' }); });
  it('unknown → bad_args', async () => { const { client } = fake(); await expect(runCardsCommand('frob', [], {}, client)).rejects.toMatchObject({ code: 'bad_args' }); });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-cards-command.test.ts`
Expected: FAIL（签名变了/子命令未实现）。

- [ ] **Step 3: 实现**

```ts
// cli/src/commands/cards.ts
import type { ToolCaller } from '../client';
import { runGenerationCommand } from './generation';
import { resolveProjectPath } from '../project-resolve';
import { CliError } from '../errors';

const UPDATE_FIELDS: Record<string, 'string' | 'boolean' | 'number'> = {
  title: 'string', enabled: 'boolean', 'display-mode': 'string',
  start: 'number', end: 'number', duration: 'number',
  template: 'string', 'style-preset': 'string', 'card-prompt': 'string',
};
const FIELD_TO_ARG: Record<string, string> = {
  title: 'title', enabled: 'enabled', 'display-mode': 'displayMode',
  start: 'startMs', end: 'endMs', duration: 'displayDurationMs',
  template: 'template', 'style-preset': 'stylePresetId', 'card-prompt': 'cardPrompt',
};

function requireId(positionals: string[]): string {
  const id = positionals[0];
  if (!id) throw new CliError('需要 cardId：lingji cards <show|update|regenerate|regen-media|convert|delete> <cardId>', 'bad_args', 2);
  return id;
}

export async function runCardsCommand(
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean>,
  client: ToolCaller,
): Promise<unknown> {
  switch (action) {
    case 'gen':
      return runGenerationCommand({ toolName: 'lingji_analyze_subtitles', flags, client });
    case 'list': {
      const projectPath = await resolveProjectPath(flags, client);
      return client.call('lingji_list_cards', { projectPath });
    }
    case 'show': {
      const projectPath = await resolveProjectPath(flags, client);
      return client.call('lingji_get_card', { projectPath, cardId: requireId(positionals) });
    }
    case 'update': {
      const projectPath = await resolveProjectPath(flags, client);
      const cardId = requireId(positionals);
      const updates: Record<string, unknown> = {};
      for (const [flag, type] of Object.entries(UPDATE_FIELDS)) {
        if (!(flag in flags)) continue;
        const raw = flags[flag];
        const arg = FIELD_TO_ARG[flag];
        if (type === 'boolean') updates[arg] = raw === true || raw === 'true';
        else if (type === 'number') updates[arg] = Number(raw);
        else updates[arg] = String(raw);
      }
      return client.call('lingji_update_card', { projectPath, cardId, ...updates });
    }
    case 'delete': {
      const projectPath = await resolveProjectPath(flags, client);
      return client.call('lingji_delete_card', { projectPath, cardId: requireId(positionals) });
    }
    case 'regenerate':
      return runGenerationCommand({ toolName: 'lingji_regenerate_card', flags, client, extraArgs: { cardId: requireId(positionals) } });
    case 'regen-media':
      return runGenerationCommand({ toolName: 'lingji_regenerate_card_media', flags, client, extraArgs: { cardId: requireId(positionals) } });
    case 'convert': {
      const to = typeof flags.to === 'string' ? flags.to : '';
      if (!['image', 'video', 'motion'].includes(to)) throw new CliError('convert 需要 --to image|video|motion', 'bad_args', 2);
      return runGenerationCommand({ toolName: 'lingji_convert_card', flags, client, extraArgs: { cardId: requireId(positionals), to } });
    }
    default:
      throw new CliError(`未知 cards 子命令: ${action ?? '(空)'}（支持 gen/list/show/update/regenerate/regen-media/convert/delete）`, 'bad_args', 2);
  }
}
```

> 注：`runCardsCommand` 现在签名是 `(action, positionals, flags, client)`，比 Plan 3 多了 `positionals`。需同步改 `index.ts` 的 `case 'cards'` 调用为 `runCardsCommand(action, positionals, flags, client)`。

- [ ] **Step 4: 接入 index.ts**

`case 'cards': return runCardsCommand(action, positionals, flags, client);`（传入 positionals）。HELP 的 cards 行替换为：
```
  lingji cards gen|list|show|update|regenerate|regen-media|convert|delete [<cardId>] [字段/--to/--wait]
```
（`update` 字段开关：`--title/--enabled/--display-mode/--start/--end/--duration/--template/--style-preset/--card-prompt`）

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/cli-cards-command.test.ts`
Expected: PASS（8 passed）。

- [ ] **Step 6: 提交**

```bash
git add cli/src/commands/cards.ts cli/src/index.ts tests/cli-cards-command.test.ts
git commit -m "feat(cli): cards 命令扩展 list/show/update/regenerate/regen-media/convert/delete"
```

---

## Task 6: 全量测试 + 构建 + 端到端手动验收

**Files:** 无（验证）

- [ ] **Step 1: 全量单测** — Run: `npm test` → 全绿。
- [ ] **Step 2: 构建** — Run: `npm run build` → 成功，无类型错误。
- [ ] **Step 3: CLI 重建 + help** — Run: `npm run build:cli && node dist-cli/lingji.mjs help` → 含 cards 多子命令。
- [ ] **Step 4: 端到端（需运行应用 + 已有分析卡片的项目）**

```bash
node dist-cli/lingji.mjs cards list --json
node dist-cli/lingji.mjs cards show <cardId>
node dist-cli/lingji.mjs cards update <cardId> --enabled false
node dist-cli/lingji.mjs cards convert <cardId> --to motion --wait
node dist-cli/lingji.mjs cards regenerate <cardId> --wait
node dist-cli/lingji.mjs cards delete <cardId>
```
Expected：即时命令立即生效并在 UI（若项目打开）经 `pipeline:project-updated` 刷新；任务命令返回 taskId 并可 `--wait`。

- [ ] **Step 5: 错误路径** — 不存在的 cardId → `card_not_found`；`convert` 缺 `--to` → `bad_args`；非 media 卡 `regen-media` → `not_media_card`。
- [ ] **Step 6: 记录验收结果。**

---

## 完成定义

- 全部单测通过；`npm run build` 通过。
- `lingji cards list/show/update/delete`（即时）与 `regenerate/regen-media/convert`（任务）可 headless 工作；项目打开时 UI 刷新。
- `cards modify`（motion 自然语言）**本计划不做**（无可复用核心），已在范围中注明。
- 未触碰 `useAIVideoWorkflow.ts`；未改导出/渲染参数。
- 未改 `dist*`/`release`/`work` 产物；`dist-cli/` 仍忽略。

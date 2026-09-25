# 发布视频 Tab 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增工程内「发布视频」tab，把 social-auto-upload 的上传能力移植成 TypeScript，跑在 Electron 主进程，GUI 表单一键把工程导出的 MP4 发布到抖音/视频号/小红书/快手/B 站。

**Architecture:** Playwright(npm) 跑在主进程驱动 4 个平台（抖音/视频号/小红书/快手）的 1:1 港自 sau Python uploader；B 站走随包内置 biliup 二进制 spawn。全局账号库以 Playwright storageState JSON 存于 userData。Renderer 经 preload IPC（`publishAPI`）驱动，发布进度接入底部统一进度系统。

**Tech Stack:** Electron 主进程 / Playwright / TypeScript / React 19 / Zustand / Vitest。参考源 `/Users/yoqu/Documents/social-auto-upload`（只读参考，不改）。

---

## 实施说明（移植任务约定）

- 4 个 Playwright 平台模块是 **sau Python uploader 的逐字翻译**。每个 port 任务给出：① 参考源文件与函数 ② TS 函数契约（签名 + 类型，与 `types.ts` 一致）③ storageState/参数映射 ④ 注入 mock 的"调用顺序/参数"单测。**选择器与具体 DOM 流程在实现时从参考源翻译**——这是有意如此，因为选择器是源文件的事实，不在计划里复制几百行。
- 纯逻辑/基础设施任务给出完整代码。
- 计划分 5 个阶段，每阶段结束都能编译且有可测产物：Phase 0 空壳 tab + 账号库；Phase 1 抖音端到端；Phase 2 其余 3 个 Playwright 平台；Phase 3 多平台同发 + B 站；Phase 4 打包。
- 提交信息用中文 conventional commits，与仓库风格一致。

---

## Phase 0 — 基础设施与契约

### Task 1: 共享类型 + accountId 纯函数

**Files:**
- Create: `electron/publish/types.ts`
- Create: `electron/publish/account-id.ts`
- Test: `tests/publish/account-id.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/publish/account-id.test.ts
import { describe, it, expect } from 'vitest';
import { buildAccountId, parseAccountId } from '../../electron/publish/account-id';

describe('account-id', () => {
  it('builds `${platform}_${accountName}`', () => {
    expect(buildAccountId('douyin', '一叶知秋')).toBe('douyin_一叶知秋');
  });
  it('round-trips through parse', () => {
    expect(parseAccountId('bilibili_一叶知秋')).toEqual({
      platform: 'bilibili',
      accountName: '一叶知秋',
    });
  });
  it('parses account names containing underscores', () => {
    expect(parseAccountId('douyin_a_b_c')).toEqual({ platform: 'douyin', accountName: 'a_b_c' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/publish/account-id.test.ts`
Expected: FAIL（找不到模块 `account-id`）

- [ ] **Step 3: 写类型与实现**

```ts
// electron/publish/types.ts
export type PublishPlatform = 'douyin' | 'tencent' | 'xiaohongshu' | 'kuaishou' | 'bilibili';

export interface PublishAccount {
  id: string;
  platform: PublishPlatform;
  accountName: string;
  storageStatePath: string;
  status: 'valid' | 'expired' | 'unknown';
  lastCheckedAt?: number;
}

export interface PublishTarget {
  accountId: string;
  overrides?: { title?: string; desc?: string; tags?: string[] };
  bilibili?: { tid: number };
}

export interface PublishShared {
  title: string;
  desc: string;
  tags: string[];
  thumbnail?: string;
  scheduleAt?: number;
}

export interface PublishResult {
  state: 'pending' | 'running' | 'success' | 'failed';
  percent?: number;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface PublishJob {
  id: string;
  filePath: string;
  shared: PublishShared;
  targets: PublishTarget[];
  results: Record<string, PublishResult>;
}

// 单平台上传入参（engine → platform 模块）
export interface UploadVideoOptions {
  storageStatePath: string;
  filePath: string;
  title: string;
  desc: string;
  tags: string[];
  thumbnail?: string;
  scheduleAt?: number;
  headless: boolean;
  tid?: number;               // B 站专属：分区 id（runner 从 target.bilibili.tid 透传）
  onProgress?: (percent: number, message?: string) => void;
}

export interface LoginOptions {
  storageStatePath: string;
  onQrcode?: (pngPath: string) => void;
}

export interface PlatformModule {
  platform: PublishPlatform;
  login(opts: LoginOptions): Promise<{ success: boolean; message: string }>;
  checkCookie(storageStatePath: string): Promise<boolean>;
  uploadVideo(opts: UploadVideoOptions): Promise<void>;
}
```

```ts
// electron/publish/account-id.ts
import type { PublishPlatform } from './types';

export function buildAccountId(platform: PublishPlatform, accountName: string): string {
  return `${platform}_${accountName}`;
}

export function parseAccountId(id: string): { platform: PublishPlatform; accountName: string } {
  const idx = id.indexOf('_');
  return {
    platform: id.slice(0, idx) as PublishPlatform,
    accountName: id.slice(idx + 1),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/publish/account-id.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add electron/publish/types.ts electron/publish/account-id.ts tests/publish/account-id.test.ts
git commit -m "feat(publish): 发布模块共享类型与 accountId 纯函数"
```

---

### Task 2: 账号库 accounts.ts（registry CRUD + storageState 路径 + cookies 导入）

**Files:**
- Create: `electron/publish/accounts.ts`
- Test: `tests/publish/accounts.test.ts`

账号库以一个根目录为参数（生产传 `app.getPath('userData')/publish`），便于测试用临时目录注入。

- [ ] **Step 1: 写失败测试**

```ts
// tests/publish/accounts.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../electron/publish/accounts';

function freshStore() {
  const root = mkdtempSync(join(tmpdir(), 'pub-acc-'));
  return new AccountStore(root);
}

describe('AccountStore', () => {
  let store: AccountStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('storageState 路径为 accounts/<platform>_<account>.json', () => {
    const p = store.storageStatePath('douyin', '一叶知秋');
    expect(p.endsWith('accounts/douyin_一叶知秋.json')).toBe(true);
  });

  it('upsert 后 list 能读回，且 id 正确', () => {
    store.upsert({ platform: 'douyin', accountName: '一叶知秋', status: 'valid' });
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('douyin_一叶知秋');
    expect(list[0].storageStatePath).toBe(store.storageStatePath('douyin', '一叶知秋'));
  });

  it('remove 删除 registry 条目与 storageState 文件', () => {
    store.upsert({ platform: 'douyin', accountName: 'a', status: 'valid' });
    const sp = store.storageStatePath('douyin', 'a');
    writeFileSync(sp, '{}');
    store.remove('douyin_a');
    expect(store.list()).toHaveLength(0);
    expect(existsSync(sp)).toBe(false);
  });

  it('importCookie 把外部 storageState JSON 拷入并登记', () => {
    const ext = join(mkdtempSync(join(tmpdir(), 'ext-')), 'douyin_一叶知秋.json');
    writeFileSync(ext, JSON.stringify({ cookies: [], origins: [] }));
    const acc = store.importCookie('douyin', '一叶知秋', ext);
    expect(acc.id).toBe('douyin_一叶知秋');
    expect(existsSync(acc.storageStatePath)).toBe(true);
    expect(store.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publish/accounts.test.ts`
Expected: FAIL（找不到 `AccountStore`）

- [ ] **Step 3: 实现**

```ts
// electron/publish/accounts.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PublishAccount, PublishPlatform } from './types';
import { buildAccountId } from './account-id';

interface RegistryEntry {
  platform: PublishPlatform;
  accountName: string;
  status: PublishAccount['status'];
  lastCheckedAt?: number;
}

export class AccountStore {
  private readonly accountsDir: string;
  private readonly registryPath: string;

  constructor(private readonly root: string) {
    this.accountsDir = join(root, 'accounts');
    this.registryPath = join(root, 'registry.json');
    mkdirSync(this.accountsDir, { recursive: true });
  }

  storageStatePath(platform: PublishPlatform, accountName: string): string {
    return join(this.accountsDir, `${buildAccountId(platform, accountName)}.json`);
  }

  private readRegistry(): RegistryEntry[] {
    if (!existsSync(this.registryPath)) return [];
    try {
      return JSON.parse(readFileSync(this.registryPath, 'utf-8')) as RegistryEntry[];
    } catch {
      return [];
    }
  }

  private writeRegistry(entries: RegistryEntry[]): void {
    writeFileSync(this.registryPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  private toAccount(e: RegistryEntry): PublishAccount {
    return {
      id: buildAccountId(e.platform, e.accountName),
      platform: e.platform,
      accountName: e.accountName,
      storageStatePath: this.storageStatePath(e.platform, e.accountName),
      status: e.status,
      lastCheckedAt: e.lastCheckedAt,
    };
  }

  list(): PublishAccount[] {
    return this.readRegistry().map((e) => this.toAccount(e));
  }

  upsert(entry: RegistryEntry): PublishAccount {
    const entries = this.readRegistry();
    const id = buildAccountId(entry.platform, entry.accountName);
    const idx = entries.findIndex((e) => buildAccountId(e.platform, e.accountName) === id);
    if (idx >= 0) entries[idx] = { ...entries[idx], ...entry };
    else entries.push(entry);
    this.writeRegistry(entries);
    return this.toAccount(entry);
  }

  setStatus(id: string, status: PublishAccount['status'], lastCheckedAt?: number): void {
    const entries = this.readRegistry();
    const idx = entries.findIndex((e) => buildAccountId(e.platform, e.accountName) === id);
    if (idx >= 0) {
      entries[idx].status = status;
      if (lastCheckedAt != null) entries[idx].lastCheckedAt = lastCheckedAt;
      this.writeRegistry(entries);
    }
  }

  remove(id: string): void {
    const entries = this.readRegistry();
    const target = entries.find((e) => buildAccountId(e.platform, e.accountName) === id);
    this.writeRegistry(entries.filter((e) => buildAccountId(e.platform, e.accountName) !== id));
    if (target) {
      const sp = this.storageStatePath(target.platform, target.accountName);
      if (existsSync(sp)) rmSync(sp);
    }
  }

  importCookie(platform: PublishPlatform, accountName: string, sourcePath: string): PublishAccount {
    const dest = this.storageStatePath(platform, accountName);
    copyFileSync(sourcePath, dest);
    return this.upsert({ platform, accountName, status: 'unknown' });
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/publish/accounts.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add electron/publish/accounts.ts tests/publish/accounts.test.ts
git commit -m "feat(publish): 全局账号库 AccountStore（registry/storageState/导入）"
```

---

### Task 3: AppPage 接入 + 空壳 tab + 列账号 IPC 三件套

**Files:**
- Modify: `src/lib/electron-api.ts:35`（AppPage 加 `'publish'`；新增 `publishAPI` 类型）
- Modify: `electron/publish/ipc.ts`（Create）— 注册 `publish:list-accounts` / `publish:delete-account`
- Modify: `electron/main.ts`（import 并调用 `registerPublishIpc`）
- Modify: `electron/preload.ts`（暴露 `publishAPI`）
- Create: `src/store/publish.ts`
- Create: `src/components/publish/PublishWorkbench.tsx`
- Modify: `src/components/WorkspaceTabs.tsx`（加第三个 tab）
- Modify: `src/App.tsx:1100,1189-1252`（showWorkspaceTabs 含 publish；渲染 PublishWorkbench）

- [ ] **Step 1: 扩展 AppPage 与 API 类型**

`src/lib/electron-api.ts` 第 35 行：
```ts
export type AppPage = 'welcome' | 'setup' | 'editor' | 'script-workbench' | 'settings' | 'auto-run' | 'publish';
```

在该文件追加（与其他 API 契约同处）：
```ts
import type { PublishAccount } from '../../electron/publish/types';

export interface PublishAPI {
  listAccounts(): Promise<PublishAccount[]>;
  deleteAccount(id: string): Promise<void>;
}
```
并把 `publishAPI: PublishAPI` 挂到暴露给 window 的类型上（沿用文件里既有 electronAPI/agentAPI 的声明模式）。

- [ ] **Step 2: 主进程 IPC 注册**

```ts
// electron/publish/ipc.ts
import { ipcMain, app } from 'electron';
import { join } from 'node:path';
import { AccountStore } from './accounts';

let store: AccountStore | null = null;
function getStore(): AccountStore {
  if (!store) store = new AccountStore(join(app.getPath('userData'), 'publish'));
  return store;
}

export function registerPublishIpc(): void {
  ipcMain.handle('publish:list-accounts', () => getStore().list());
  ipcMain.handle('publish:delete-account', (_e, id: string) => {
    getStore().remove(id);
  });
}
```
在 `electron/main.ts` 顶部 import 后，于应用就绪流程（其它 `registerXxxIpc`/`ipcMain.handle` 集中处附近）调用 `registerPublishIpc()`。

- [ ] **Step 3: preload 暴露**

`electron/preload.ts` 在 `contextBridge.exposeInMainWorld` 区，仿照已有 `agentAPI` 模式新增：
```ts
contextBridge.exposeInMainWorld('publishAPI', {
  listAccounts: () => ipcRenderer.invoke('publish:list-accounts'),
  deleteAccount: (id: string) => ipcRenderer.invoke('publish:delete-account', id),
});
```

- [ ] **Step 4: publish store 骨架**

```ts
// src/store/publish.ts
import { create } from 'zustand';
import type { PublishAccount } from '../lib/electron-api';

interface PublishState {
  accounts: PublishAccount[];
  loadAccounts: () => Promise<void>;
}

export const usePublishStore = create<PublishState>((set) => ({
  accounts: [],
  loadAccounts: async () => {
    const accounts = await window.publishAPI.listAccounts();
    set({ accounts });
  },
}));
```
（`PublishAccount` 从 electron-api 重导出，避免 renderer 直接 import 主进程类型路径；在 electron-api.ts 里 `export type { PublishAccount } from '../../electron/publish/types';`）

- [ ] **Step 5: 空壳 tab 组件**

```tsx
// src/components/publish/PublishWorkbench.tsx
import { useEffect } from 'react';
import { usePublishStore } from '../../store/publish';

export function PublishWorkbench({ projectDir }: { projectDir: string | null }) {
  const loadAccounts = usePublishStore((s) => s.loadAccounts);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);
  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <h2>发布视频</h2>
      <p style={{ color: 'var(--color-text-secondary)' }}>工程目录：{projectDir ?? '未打开'}</p>
    </div>
  );
}
```

- [ ] **Step 6: WorkspaceTabs 加第三 tab + App.tsx 接线**

`src/components/WorkspaceTabs.tsx`：把 `active`/`onSwitch` 类型从 `'script-workbench' | 'editor'` 扩为加 `'publish'`，并渲染第三个 tab 项「发布」。
`src/App.tsx`：
- 第 1100 行 `showWorkspaceTabs = page === 'editor' || page === 'script-workbench' || page === 'publish';`
- `handleWorkspaceTabSwitch` 参数类型加 `'publish'`；第 1191 行 `active={page as 'script-workbench' | 'editor' | 'publish'}`
- 在 editor 的 `<div style={{ display: page === 'editor' ... }}>` 之后追加：
```tsx
<div style={{ display: page === 'publish' ? 'contents' : 'none' }}>
  <PublishWorkbench projectDir={currentProjectDir} />
</div>
```

- [ ] **Step 7: 手动验证 + 编译**

Run: `npm run build`
Expected: 编译通过。`npm run dev` 打开工程后能看到第三个「发布」tab，点进去显示空壳页与工程目录，无账号。

- [ ] **Step 8: 提交**

```bash
git add electron/publish/ipc.ts electron/main.ts electron/preload.ts src/lib/electron-api.ts src/store/publish.ts src/components/publish/PublishWorkbench.tsx src/components/WorkspaceTabs.tsx src/App.tsx
git commit -m "feat(publish): 工程内发布 tab 空壳 + 列账号 IPC 三件套"
```

---

## Phase 1 — Playwright 引擎 + 抖音端到端

### Task 4: stealth 注入 + 引擎 engine.ts

**Files:**
- Create: `electron/publish/stealth.ts`（港 `utils/base_social_media.py` 的 `set_init_script`）
- Create: `electron/publish/engine.ts`
- Test: `tests/publish/engine.test.ts`

参考源：`/Users/yoqu/Documents/social-auto-upload/utils/base_social_media.py`（`set_init_script` 注入的反检测脚本文件 `utils/stealth.min.js`——把该 JS 一并拷到 `electron/publish/stealth.min.js` 并随包）。

- [ ] **Step 1: 写失败测试（engine 用 mock playwright）**

```ts
// tests/publish/engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withContext } from '../../electron/publish/engine';

it('withContext 用 storageState 建 context 并在结束后关闭', async () => {
  const close = vi.fn();
  const newContext = vi.fn().mockResolvedValue({
    addInitScript: vi.fn(),
    close: vi.fn(),
  });
  const browser = { newContext, close };
  const launch = vi.fn().mockResolvedValue(browser);
  const fakePlaywright = { chromium: { launch } };

  const ran = vi.fn().mockResolvedValue('ok');
  const result = await withContext(
    { storageStatePath: '/tmp/s.json', headless: true },
    ran,
    fakePlaywright as any,
  );

  expect(result).toBe('ok');
  expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  expect(newContext).toHaveBeenCalledWith(expect.objectContaining({ storageState: '/tmp/s.json' }));
  expect(ran).toHaveBeenCalled();
  expect(browser.close).toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publish/engine.test.ts`
Expected: FAIL（找不到 `withContext`）

- [ ] **Step 3: 实现 stealth + engine**

```ts
// electron/publish/stealth.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';

let cached: string | null = null;
function stealthScript(): string {
  if (cached == null) cached = readFileSync(join(__dirname, 'stealth.min.js'), 'utf-8');
  return cached;
}

export async function applyStealth(context: BrowserContext): Promise<BrowserContext> {
  await context.addInitScript(stealthScript());
  return context;
}
```

```ts
// electron/publish/engine.ts
import type { BrowserContext } from 'playwright';
import { applyStealth } from './stealth';

interface ContextOpts {
  storageStatePath?: string;
  headless: boolean;
}

// fakePlaywright 仅供测试注入；生产用 dynamic import('playwright')
export async function withContext<T>(
  opts: ContextOpts,
  run: (ctx: BrowserContext) => Promise<T>,
  playwrightModule?: any,
): Promise<T> {
  const pw = playwrightModule ?? (await import('playwright'));
  const browser = await pw.chromium.launch({ headless: opts.headless });
  try {
    const context = await browser.newContext(
      opts.storageStatePath ? { storageState: opts.storageStatePath } : {},
    );
    await applyStealth(context);
    try {
      return await run(context);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
```
注：测试里 mock 的 context 无需 `applyStealth` 真正读文件——把 `applyStealth` 调用包在 try 或让测试 mock 的 context 带 `addInitScript`（上面测试已带）。stealth.min.js 从参考源 `utils/stealth.min.js` 拷贝。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/publish/engine.test.ts`
Expected: PASS

- [ ] **Step 5: 装依赖 + 提交**

```bash
npm install playwright
git add package.json package-lock.json electron/publish/stealth.ts electron/publish/stealth.min.js electron/publish/engine.ts tests/publish/engine.test.ts
git commit -m "feat(publish): Playwright 引擎 withContext + stealth 注入"
```

---

### Task 5: 抖音平台模块 platforms/douyin.ts

**Files:**
- Create: `electron/publish/platforms/douyin.ts`
- Test: `tests/publish/douyin.test.ts`

参考源 `uploader/douyin_uploader/main.py`：
- `checkCookie` ← `cookie_auth(account_file)`（用 storageState 起 context 访问创作者中心，未跳登录即有效）
- `login` ← `douyin_setup` / `douyin_cookie_gen`（headed 打开登录页，用户扫码；登录完成后 `context.storage_state(path=account_file)`）
- `uploadVideo` ← `class DouYinVideo.upload(playwright)`（第 472、587 行）：进入上传页 → set file input → 填 title/desc → 加 tags → 处理 thumbnail → schedule → 发布 → `context.storage_state` 回写

**翻译契约**：实现 `PlatformModule`（见 types.ts）。`login` 用 headed（`headless:false`）；`uploadVideo` 用传入 `headless`。所有 DOM 选择器与等待逐字翻译自上述 Python 函数。

- [ ] **Step 1: 写失败测试（注入 mock page，验证调用顺序与参数映射，不连真实浏览器）**

```ts
// tests/publish/douyin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { uploadDouyinVideo } from '../../electron/publish/platforms/douyin';

function makeMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({
      fill: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      waitFor: vi.fn().mockResolvedValue(undefined),
    }),
    getByText: vi.fn().mockReturnValue({ click: vi.fn(), waitFor: vi.fn() }),
    waitForURL: vi.fn().mockResolvedValue(undefined),
  };
}

it('uploadDouyinVideo 设置文件并填入标题', async () => {
  const page = makeMockPage();
  await uploadDouyinVideo(page as any, {
    filePath: '/tmp/v.mp4',
    title: '标题',
    desc: '描述',
    tags: ['a', 'b'],
    headless: true,
  } as any);
  expect(page.setInputFiles).toHaveBeenCalledWith(expect.anything(), '/tmp/v.mp4');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publish/douyin.test.ts`
Expected: FAIL（找不到 `uploadDouyinVideo`）

- [ ] **Step 3: 实现（从参考源翻译）**

把 `uploader/douyin_uploader/main.py` 的 `DouYinVideo.upload` 主体翻译为导出函数 `uploadDouyinVideo(page, opts)`，并组合出 `PlatformModule`：

```ts
// electron/publish/platforms/douyin.ts 结构骨架（DOM 细节从参考源翻译）
import type { Page } from 'playwright';
import { withContext } from '../engine';
import type { LoginOptions, PlatformModule, UploadVideoOptions } from '../types';

const CREATOR_UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';

export async function uploadDouyinVideo(page: Page, opts: UploadVideoOptions): Promise<void> {
  await page.goto(CREATOR_UPLOAD_URL);
  await page.setInputFiles('input[type="file"]', opts.filePath); // 选择器以参考源为准
  // …填 title/desc、加 tags、thumbnail、schedule、点发布：逐字翻译 main.py:587-687
}

export const douyin: PlatformModule = {
  platform: 'douyin',
  async checkCookie(storageStatePath) {
    return withContext({ storageStatePath, headless: true }, async (ctx) => {
      // 翻译 cookie_auth：访问创作者页，判断是否被重定向到登录
      const page = await ctx.newPage();
      // …return true/false
      return true;
    });
  },
  async login(opts: LoginOptions) {
    return withContext({ storageStatePath: undefined, headless: false }, async (ctx) => {
      // 翻译 douyin_cookie_gen：打开登录页，用户扫码；完成后 ctx.storageState({ path: opts.storageStatePath })
      return { success: true, message: '登录完成' };
    });
  },
  async uploadVideo(opts: UploadVideoOptions) {
    await withContext({ storageStatePath: opts.storageStatePath, headless: opts.headless }, async (ctx) => {
      const page = await ctx.newPage();
      await uploadDouyinVideo(page, opts);
      await ctx.storageState({ path: opts.storageStatePath });
    });
  },
};
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/publish/douyin.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/publish/platforms/douyin.ts tests/publish/douyin.test.ts
git commit -m "feat(publish): 抖音平台模块（login/check/uploadVideo 港自 sau）"
```

---

### Task 6: 平台注册表 + 登录/校验/删除 IPC + Settings 发布账号 tab

**Files:**
- Create: `electron/publish/platforms/index.ts`（平台注册表 `PLATFORMS: Record<PublishPlatform, PlatformModule>`）
- Modify: `electron/publish/ipc.ts`（加 `publish:login` / `publish:check`）
- Modify: `electron/preload.ts`、`src/lib/electron-api.ts`（PublishAPI 加 login/check）
- Modify: `src/store/publish.ts`（addAccount/login/check/remove 动作）
- Create: `src/components/settings/PublishAccountsTab.tsx`
- Create: `src/components/settings/PublishAccountsTab.module.css`
- Modify: `src/components/settings/`(Settings 容器)（注册新 tab「发布账号」）

- [ ] **Step 1: 平台注册表**

```ts
// electron/publish/platforms/index.ts
import type { PlatformModule, PublishPlatform } from '../types';
import { douyin } from './douyin';

export const PLATFORMS = { douyin } as Partial<Record<PublishPlatform, PlatformModule>>;
export function getPlatform(p: PublishPlatform): PlatformModule {
  const mod = PLATFORMS[p];
  if (!mod) throw new Error(`平台未实现: ${p}`);
  return mod;
}
```
（Phase 2/3 逐步把 tencent/xiaohongshu/kuaishou/bilibili 填进 PLATFORMS）

- [ ] **Step 2: 扩展 ipc.ts**

在 `registerPublishIpc` 内加：
```ts
ipcMain.handle('publish:login', async (e, platform: PublishPlatform, accountName: string) => {
  const s = getStore();
  const sp = s.storageStatePath(platform, accountName);
  const res = await getPlatform(platform).login({
    storageStatePath: sp,
    onQrcode: (png) => e.sender.send('publish:qrcode', { platform, accountName, png }),
  });
  if (res.success) s.upsert({ platform, accountName, status: 'valid' });
  return res;
});
ipcMain.handle('publish:check', async (_e, id: string) => {
  const s = getStore();
  const { platform } = parseAccountId(id);
  const ok = await getPlatform(platform).checkCookie(s.list().find((a) => a.id === id)!.storageStatePath);
  s.setStatus(id, ok ? 'valid' : 'expired', Date.now());
  return ok;
});
```
（import `getPlatform`、`parseAccountId`）

- [ ] **Step 3: preload + electron-api 扩 PublishAPI**

preload 加 `login`/`check`/`onQrcode`；electron-api 的 `PublishAPI` 加：
```ts
login(platform: PublishPlatform, accountName: string): Promise<{ success: boolean; message: string }>;
check(id: string): Promise<boolean>;
onQrcode(cb: (p: { platform: string; accountName: string; png: string }) => void): () => void;
```

- [ ] **Step 4: store 动作**

`src/store/publish.ts` 加 `addAccount(platform, accountName)`（调 login 后 reload）、`checkAccount(id)`、`removeAccount(id)`，都 reload accounts。

- [ ] **Step 5: Settings「发布账号」tab UI**

新建 `PublishAccountsTab.tsx`：列出 accounts（平台图标 + 账号名 + 状态徽标 + 校验/重登/删除按钮）；底部「添加账号」选平台 + 输账号名 → addAccount。登录中显示二维码（监听 `onQrcode`，抖音是 headed 窗口扫码，二维码也可能在窗口内，弹窗显示 png 兜底）。在 Settings 容器里仿照既有 Agent/MCP tab 注册「发布账号」。

- [ ] **Step 6（可选，spec §6）: 导入现有 cookies 入口**

`AccountStore.importCookie`（Task 2 已实现）经 `publish:import-cookies` IPC 暴露；Settings tab 加「从 social-auto-upload 导入」按钮，选平台+账号名+源 JSON 文件 → importCookie → reload。若本期不做，跳过此 step（不阻塞）。

- [ ] **Step 7: 手动验证 + 提交**

Run: `npm run build` → PASS。`npm run dev` 在 Settings 看到「发布账号」tab，能添加抖音账号、弹出登录窗口扫码、登录后状态 valid、可校验/删除。
```bash
git add electron/publish/platforms/index.ts electron/publish/ipc.ts electron/preload.ts src/lib/electron-api.ts src/store/publish.ts src/components/settings/PublishAccountsTab.tsx src/components/settings/PublishAccountsTab.module.css src/components/settings/*
git commit -m "feat(publish): 平台注册表 + 登录/校验 IPC + Settings 发布账号 tab"
```

---

### Task 7: 发布执行 IPC + 进度桥 + 发布表单（单平台跑通）

**Files:**
- Create: `electron/publish/runner.ts`（串行执行 PublishJob，发 `publish:progress`，接 task-progress 桥）
- Modify: `electron/publish/ipc.ts`（`publish:run` / `publish:cancel`）
- Modify: preload / electron-api（run/cancel/onProgress）
- Modify: `src/store/publish.ts`（job 态 + onProgress 订阅）
- Modify: `src/components/publish/PublishWorkbench.tsx`（完整表单 + 进度区）
- Reference: `src/store/task-progress.ts`、`src/lib/pipeline-progress-bridge.ts`（进度接入，CLAUDE.md 铁律）

- [ ] **Step 1: runner 串行执行**

```ts
// electron/publish/runner.ts
import type { WebContents } from 'electron';
import type { PublishJob } from './types';
import { getPlatform } from './platforms';
import { parseAccountId } from './account-id';
import { AccountStore } from './accounts';

export async function runPublishJob(
  job: PublishJob,
  store: AccountStore,
  sender: WebContents,
  isCancelled: () => boolean,
  headless: boolean,
): Promise<void> {
  for (const target of job.targets) {
    if (isCancelled()) break;
    const acc = store.list().find((a) => a.id === target.accountId);
    if (!acc) continue;
    const send = (state: string, percent?: number, message?: string) =>
      sender.send('publish:progress', { jobId: job.id, accountId: target.accountId, state, percent, message });
    send('running', 0);
    try {
      const { platform } = parseAccountId(target.accountId);
      await getPlatform(platform).uploadVideo({
        storageStatePath: acc.storageStatePath,
        filePath: job.filePath,
        title: target.overrides?.title ?? job.shared.title,
        desc: target.overrides?.desc ?? job.shared.desc,
        tags: target.overrides?.tags ?? job.shared.tags,
        thumbnail: job.shared.thumbnail,
        scheduleAt: job.shared.scheduleAt,
        headless,
        onProgress: (p, m) => send('running', p, m),
      });
      send('success', 100);
    } catch (err) {
      send('failed', undefined, err instanceof Error ? err.message : String(err));
    }
  }
}
```

- [ ] **Step 2: ipc.ts 加 run/cancel + 进度桥**

`publish:run` 起一个父 task（`task-progress` startTask，经 `pipeline:task-update` 桥），每 target 完成 updateTask；全部完成 completeTask/failTask。维护 `cancelled` 标志，`publish:cancel` 置位。

- [ ] **Step 3: 发布表单 UI**

`PublishWorkbench.tsx` 实现 §5 布局：文件来源（默认扫工程目录 `*.mp4` + 选择器）、统一文案、账号多选（从 store.accounts，按状态禁用未登录、给"去设置"入口）、一键发布、进度区（每 target 一行，订阅 onProgress 实时更新）。

- [ ] **Step 4: 手动验证（单平台真实发布）**

`npm run dev`，工程已导出 MP4 + 已登录抖音 → 选抖音账号 + 填文案 + 一键发布 → 抖音端到端上传成功，进度区与底部统一进度条同步。

- [ ] **Step 5: 提交**

```bash
git add electron/publish/runner.ts electron/publish/ipc.ts electron/preload.ts src/lib/electron-api.ts src/store/publish.ts src/components/publish/PublishWorkbench.tsx
git commit -m "feat(publish): 发布执行串行 runner + 进度桥 + 发布表单（抖音跑通）"
```

---

## Phase 2 — 其余 3 个 Playwright 平台

> 每个平台一个 Task，模式与 Task 5 完全一致：写 mock-page 调用顺序测试 → 从参考源翻译 → 注册进 `PLATFORMS` → 提交。UI/IPC/runner 无需改动（自动适配注册表）。

### Task 8: 视频号 platforms/tencent.ts

**Files:** Create `electron/publish/platforms/tencent.ts`；Test `tests/publish/tencent.test.ts`；Modify `electron/publish/platforms/index.ts`（注册 tencent）。
参考源 `uploader/tencent_uploader/main.py`（1230 行，最大）。

- [ ] Step 1: 写 mock-page 测试 `uploadTencentVideo` 设置文件并填标题（结构同 Task 5 Step 1，函数名 `uploadTencentVideo`）。
- [ ] Step 2: `npx vitest run tests/publish/tencent.test.ts` → FAIL。
- [ ] Step 3: 从 `tencent_uploader/main.py` 翻译 `login`/`checkCookie`/`uploadVideo`，导出 `tencent: PlatformModule`，结构同 douyin.ts；视频号上传页 URL/选择器以参考源为准。
- [ ] Step 4: 测试 → PASS。
- [ ] Step 5: `index.ts` 加 `import { tencent } ...` 并入 `PLATFORMS`；提交 `feat(publish): 视频号平台模块`。

### Task 9: 小红书 platforms/xiaohongshu.ts

**Files:** Create `electron/publish/platforms/xiaohongshu.ts`；Test `tests/publish/xiaohongshu.test.ts`；Modify `index.ts`。
参考源 `uploader/xiaohongshu_uploader/main.py`（Playwright 那套，**不是** `xhs_uploader`）。

- [ ] Step 1: 写 mock-page 测试 `uploadXiaohongshuVideo`。
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 从 `xiaohongshu_uploader/main.py` 翻译，导出 `xiaohongshu: PlatformModule`。
- [ ] Step 4: 测试 → PASS。
- [ ] Step 5: 注册进 PLATFORMS；提交 `feat(publish): 小红书平台模块`。

### Task 10: 快手 platforms/kuaishou.ts

**Files:** Create `electron/publish/platforms/kuaishou.ts`；Test `tests/publish/kuaishou.test.ts`；Modify `index.ts`。
参考源 `uploader/ks_uploader/main.py`。

- [ ] Step 1: 写 mock-page 测试 `uploadKuaishouVideo`。
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 从 `ks_uploader/main.py` 翻译，导出 `kuaishou: PlatformModule`。
- [ ] Step 4: 测试 → PASS。
- [ ] Step 5: 注册进 PLATFORMS；提交 `feat(publish): 快手平台模块`。

---

## Phase 3 — 多平台同发 + B 站

### Task 11: 多平台同发 + 各账号文案覆盖

**Files:** Modify `src/components/publish/PublishWorkbench.tsx`、`src/store/publish.ts`。
runner 已支持多 target 串行；本任务补 UI。

- [ ] **Step 1:** 账号区改多选（checkbox），构造 `targets: PublishTarget[]`，「一键发布 (N 个目标)」按钮显示数量。
- [ ] **Step 2:** 每个被选账号一个「文案覆盖▸」折叠区，写入 `target.overrides`。
- [ ] **Step 3:** 进度区每 target 一行（平台·账号 + 状态 + 百分比/消息），单 target 失败不影响其它（runner 已保证）。
- [ ] **Step 4:** 手动验证：同时选抖音+快手两个账号，一键发布，两行进度独立推进，其一失败不连坐。
- [ ] **Step 5:** 提交 `feat(publish): 多平台同发 + 各账号文案覆盖`。

### Task 12: biliup 运行时 biliup-runtime.ts

**Files:** Create `electron/publish/biliup-runtime.ts`；Test `tests/publish/biliup-runtime.test.ts`。
参考源 `uploader/bilibili_uploader/runtime.py`（移植平台 key/资产选择/路径推导/spawn；首期二进制随包内置，运行时只做"定位 + spawn"，下载逻辑可省）。

- [ ] **Step 1: 写失败测试（纯逻辑：平台 key 与二进制路径推导）**

```ts
// tests/publish/biliup-runtime.test.ts
import { describe, it, expect } from 'vitest';
import { buildPlatformKey, biliupBinaryName } from '../../electron/publish/biliup-runtime';

it('平台 key 归一化 darwin/arm64 → macos-aarch64', () => {
  expect(buildPlatformKey('darwin', 'arm64')).toBe('macos-aarch64');
  expect(buildPlatformKey('win32', 'x64')).toBe('windows-x86_64');
});
it('windows 用 biliup.exe', () => {
  expect(biliupBinaryName('win32')).toBe('biliup.exe');
  expect(biliupBinaryName('darwin')).toBe('biliup');
});
```

- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3:** 实现 `buildPlatformKey`/`biliupBinaryName`/`resolveBiliupPath(resourcesRoot)`（定位随包解包路径）/`runBiliup(args): Promise<{ code, stdout, stderr }>`（`child_process.spawn`，含 interactive 模式继承 stdio 供登录）。映射规则照 `runtime.py` 的 `_normalize_system`/`_normalize_machine`。
- [ ] **Step 4:** 测试 → PASS。
- [ ] **Step 5:** 提交 `feat(publish): biliup 运行时（定位内置二进制 + spawn）`。

### Task 13: B 站平台模块 + tid 表单 + 扫码弹窗

**Files:** Create `electron/publish/platforms/bilibili.ts`；Test `tests/publish/bilibili.test.ts`；Modify `index.ts`、`PublishWorkbench.tsx`（tid 字段 + desc 必填）、`PublishAccountsTab.tsx`（B 站扫码弹窗）。
参考源 `sau_cli.py` 的 `login_bilibili_account`/`check_bilibili_account`/`upload_bilibili_video`（biliup 子命令：`login` / `renew` / `upload --title --desc --tid --tag`）。

- [ ] **Step 1: 写失败测试（注入 mock runBiliup，验证 upload 参数拼装）**

```ts
// tests/publish/bilibili.test.ts
import { it, expect, vi } from 'vitest';
import { buildBiliupUploadArgs } from '../../electron/publish/platforms/bilibili';

it('upload 参数含 -u/upload/--tid/--tag', () => {
  const args = buildBiliupUploadArgs('/c/bili.json', {
    filePath: '/v.mp4', title: 'T', desc: 'D', tags: ['a', 'b'], tid: 21, headless: true,
  } as any);
  expect(args).toEqual(['-u', '/c/bili.json', 'upload', '/v.mp4', '--title', 'T', '--desc', 'D', '--tid', '21', '--tag', 'a,b']);
});
```

- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3:** 实现 `buildBiliupUploadArgs` 与 `bilibili: PlatformModule`：
  - `checkCookie(sp)` → `runBiliup(['-u', sp, 'renew'])` code===0
  - `login(opts)` → `runBiliup(['-u', sp, 'login'], interactive)`；biliup 产 `qrcode.png`，经 `opts.onQrcode(pngPath)` 推给 UI 弹窗
  - `uploadVideo(opts)` → `runBiliup(buildBiliupUploadArgs(sp, opts))`，非零退出抛错
  - `uploadVideo` 的 `tid` 来自 `PublishTarget.bilibili.tid`（runner 透传：扩展 UploadVideoOptions 可选 `tid`，或 B 站分支单独取）。**实现时 runner 对 bilibili target 读取 `target.bilibili.tid` 并入参。**
- [ ] **Step 4:** 测试 → PASS。
- [ ] **Step 5:** UI：B 站账号被选中时展开**分区(tid) 必填**输入 + desc 必填校验，写入 `target.bilibili.tid`；账号 tab 加 B 站扫码弹窗（显示 qrcode.png）。注册进 PLATFORMS。
- [ ] **Step 6:** 手动验证：登录 B 站（扫码）→ 选 B 站 + 填 tid → 发布成功。
- [ ] **Step 7:** 提交 `feat(publish): B 站平台模块（biliup spawn + tid 表单 + 扫码）`。

---

## Phase 4 — 打包

### Task 14: Playwright Chromium 随包（asarUnpack + browsers path）

**Files:** Modify `package.json`（build 配置 / `asarUnpack`）、`scripts/package-mac-helpers.cjs`、`electron/publish/engine.ts`（生产指向解包后的 `PLAYWRIGHT_BROWSERS_PATH`）。
参考既有 `@remotion/renderer` Chrome Headless Shell 的解包处理方式（对照 memory「pi 进程内 SDK 迁移」asar 坑）。

- [ ] **Step 1:** 在打包配置 `asarUnpack` 加入 Playwright 浏览器目录；构建期执行 `playwright install chromium` 并把产物纳入资源。
- [ ] **Step 2:** `engine.ts` 启动前设 `process.env.PLAYWRIGHT_BROWSERS_PATH` 指向解包后实际路径（开发态用默认，生产态用 `process.resourcesPath` 下路径）。
- [ ] **Step 3:** Run `npm run package:mac`，安装产出的 .app，验证抖音发布在打包版可用（非 dev）。
- [ ] **Step 4:** 提交 `build(publish): 随包 Playwright Chromium（asarUnpack + browsers path）`。

### Task 15: biliup 二进制随包

**Files:** Modify `package.json`/打包脚本、`scripts/package-mac-helpers.cjs`；新增构建期拉取脚本 `scripts/fetch-biliup.cjs`。
对照 memory「Windows 打包 npm.cmd」：Win 打包注意 spawn。

- [ ] **Step 1:** `scripts/fetch-biliup.cjs`：按目标平台从 biliup GitHub release 下载并解压到 `resources/biliup/<platform-key>/`（构建期执行）。
- [ ] **Step 2:** 打包配置把 `resources/biliup` 纳入产物 + `asarUnpack`；`biliup-runtime.resolveBiliupPath` 生产态指向 `process.resourcesPath/biliup/<key>/<bin>`。
- [ ] **Step 3:** Run `npm run package:mac`，验证打包版 B 站登录/上传可用。
- [ ] **Step 4:** 提交 `build(publish): 随包 biliup 二进制 + 构建期拉取脚本`。

---

## 收尾

- [ ] **全量验证：** `npm test` 全绿；`npm run build` 通过；打包版手动跑通 5 平台各至少一次登录 + 一次发布。
- [ ] **文档：** 按 AGENTS.md 规则更新 CHANGELOG.md / Release notes（memory「Release & CHANGELOG rule」）。
- [ ] **范围复核：** 对照 spec §11，确认未含 upload-note / TikTok / YouTube / 百家号 / agent 暴露 / 并发开关。

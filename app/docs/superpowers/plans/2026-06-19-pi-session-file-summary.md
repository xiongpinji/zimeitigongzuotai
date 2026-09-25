# pi 会话改动文件结果集面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在内置 pi agent 对话结束后，于消息区末尾渲染一张「本次共改动 N 个文件」结果卡片，聚合整次会话新增/编辑/删除的全部文件，每行提供「打开方式」下拉（macOS 快速预览 / 打开 / 在 Finder 中显示）。

**Architecture:** 渲染时派生 —— 不新增任何 store 状态或持久化字段。一个纯函数扫描会话所有 turn 的 `file_changed` block 与可转为文件变更的 `tool_call` block（复用现有 `fileChangeFromToolCall`），按路径去重聚合出文件列表；面板组件在非 streaming 且文件数 ≥ 1 时渲染。打开/预览经新增的两个 IPC（`open-path`、`quick-look-file`）与既有 `show-item-in-folder`。

**Tech Stack:** React 19 / TypeScript、Electron（main `shell` + `child_process.spawn qlmanage`）、Vitest、`diff` 库（既有 `changedLineCount`）、`src/ui` DropdownMenu primitive。

参考规格：`docs/superpowers/specs/2026-06-19-pi-session-file-summary-design.md`

---

### Task 1: 聚合纯函数 `session-file-summary.ts`（TDD）

把会话 turns 聚合为去重后的文件列表。复用 `fileChangeFromToolCall`（处理 tool_call 块）与 `changedLineCount`（行数）。

**Files:**
- Create: `src/components/agent/session-file-summary.ts`
- Modify: `src/components/agent/FileChangedBlock.tsx`（导出 `changedLineCount` 与 `FileChangedBlockData`，当前 `FileChangedBlockData` 已 export，仅需新增导出 `changedLineCount`）
- Test: `tests/session-file-summary.test.ts`

- [ ] **Step 1: 导出 `changedLineCount`**

在 `src/components/agent/FileChangedBlock.tsx` 第 29 行，把函数声明前加 `export`：

```ts
export function changedLineCount(file: FileChangedBlockData): { added: number; removed: number } {
```

（其余实现不变。`FileChangedBlockData` 接口已是 `export interface`，无需改动。）

- [ ] **Step 2: 写失败测试**

创建 `tests/session-file-summary.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { summarizeSessionFiles, classifyFileKind } from '../src/components/agent/session-file-summary';
import type { ConversationTurn } from '../src/types/conversation';

function assistantTurn(id: number, blocks: ConversationTurn['blocks']): ConversationTurn {
  return { id, conversationId: 1, role: 'assistant', blocks, createdAt: '2026-06-19T00:00:00Z' };
}

describe('classifyFileKind', () => {
  it('maps by extension', () => {
    expect(classifyFileKind('a.png').kind).toBe('image');
    expect(classifyFileKind('a.mp4').kind).toBe('video');
    expect(classifyFileKind('a.mp3').kind).toBe('audio');
    expect(classifyFileKind('a.md').kind).toBe('markdown');
    expect(classifyFileKind('a.txt').kind).toBe('document');
    expect(classifyFileKind('a.ts').kind).toBe('code');
    expect(classifyFileKind('a.bin').kind).toBe('other');
  });
  it('uppercases ext and extracts name', () => {
    const c = classifyFileKind('/root/dir/cover-3x4.PNG');
    expect(c.ext).toBe('PNG');
    expect(c.name).toBe('cover-3x4.PNG');
  });
});

describe('summarizeSessionFiles', () => {
  it('returns empty summary for no file changes', () => {
    const s = summarizeSessionFiles([assistantTurn(1, [{ type: 'text', text: 'hi' }])]);
    expect(s.files).toEqual([]);
    expect(s.totalAdded).toBe(0);
    expect(s.totalRemoved).toBe(0);
  });

  it('aggregates a created file from a file_changed block', () => {
    const s = summarizeSessionFiles([
      assistantTurn(1, [
        { type: 'file_changed', path: '/p/cover.md', before: null, after: 'line1\nline2' },
      ]),
    ]);
    expect(s.files).toHaveLength(1);
    expect(s.files[0]).toMatchObject({ path: '/p/cover.md', name: 'cover.md', ext: 'MD', kind: 'markdown', operation: 'create', added: 2, removed: 0 });
    expect(s.totalAdded).toBe(2);
  });

  it('dedupes by path and merges line counts across turns', () => {
    const s = summarizeSessionFiles([
      assistantTurn(1, [{ type: 'file_changed', path: '/p/a.txt', before: null, after: 'x' }]),
      assistantTurn(2, [{ type: 'file_changed', path: '/p/a.txt', before: 'x', after: 'x\ny', operation: 'edit' }]),
    ]);
    expect(s.files).toHaveLength(1);
    expect(s.files[0].path).toBe('/p/a.txt');
    expect(s.files[0].added).toBe(2); // 1 (create) + 1 (edit adds one line)
  });

  it('create-then-edit stays create; anything-then-delete becomes delete', () => {
    const created = summarizeSessionFiles([
      assistantTurn(1, [{ type: 'file_changed', path: '/p/a.txt', before: null, after: 'x', operation: 'create' }]),
      assistantTurn(2, [{ type: 'file_changed', path: '/p/a.txt', before: 'x', after: 'x\ny', operation: 'edit' }]),
    ]);
    expect(created.files[0].operation).toBe('create');

    const deleted = summarizeSessionFiles([
      assistantTurn(1, [{ type: 'file_changed', path: '/p/a.txt', before: null, after: 'x', operation: 'create' }]),
      assistantTurn(2, [{ type: 'file_changed', path: '/p/a.txt', before: 'x', after: '', operation: 'delete' }]),
    ]);
    expect(deleted.files[0].operation).toBe('delete');
  });

  it('extracts file changes from tool_call blocks via fileChangeFromToolCall', () => {
    const s = summarizeSessionFiles([
      assistantTurn(1, [
        {
          type: 'tool_call',
          toolCallId: 't1',
          title: 'Write',
          kind: 'write',
          status: 'completed',
          rawInput: JSON.stringify({ path: '/p/new.md', content: 'hello\nworld' }),
        },
      ]),
    ]);
    expect(s.files).toHaveLength(1);
    expect(s.files[0]).toMatchObject({ path: '/p/new.md', operation: 'create' });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/session-file-summary.test.ts`
Expected: FAIL —— 模块 `session-file-summary` 不存在 / 导出未定义。

- [ ] **Step 4: 实现 `session-file-summary.ts`**

创建 `src/components/agent/session-file-summary.ts`：

```ts
/**
 * 会话级文件改动聚合（渲染时派生，无持久化）。
 *
 * 扫描某会话所有 turn 的 block：
 *  - type === 'file_changed' 的块直接计入；
 *  - type === 'tool_call' 的块经 fileChangeFromToolCall 转换（与 AssistantMessage 渲染口径一致）。
 * 按绝对/原始路径去重，跨多次操作累加 +/- 行数并归并操作终态。
 */
import type { ConversationBlock, ConversationTurn } from '../../types/conversation';
import { fileChangeFromToolCall } from './tool-call-descriptor';
import { changedLineCount, type FileChangedBlockData } from './FileChangedBlock';

export type FileKind = 'image' | 'video' | 'audio' | 'markdown' | 'document' | 'code' | 'other';

export interface SummaryFile {
  path: string;
  name: string;
  /** 大写、无点的扩展名，如 'PNG'；无扩展名时为空串。 */
  ext: string;
  kind: FileKind;
  operation: 'create' | 'edit' | 'delete';
  added: number;
  removed: number;
}

export interface SessionFileSummary {
  files: SummaryFile[];
  totalAdded: number;
  totalRemoved: number;
}

const EXT_KIND: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', heic: 'image', avif: 'image',
  mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', aac: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio',
  md: 'markdown', mdx: 'markdown',
  txt: 'document', json: 'document', csv: 'document', srt: 'document', pdf: 'document', yaml: 'document', yml: 'document',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', css: 'code', html: 'code', py: 'code', sh: 'code',
};

export function classifyFileKind(path: string): { name: string; ext: string; kind: FileKind } {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  const rawExt = dot > 0 ? name.slice(dot + 1) : '';
  const ext = rawExt.toUpperCase();
  const kind = EXT_KIND[rawExt.toLowerCase()] ?? 'other';
  return { name, ext, kind };
}

type Operation = SummaryFile['operation'];

function mergeOperation(prev: Operation, next: Operation): Operation {
  if (next === 'delete') return 'delete';        // 任意态后 delete → delete
  if (prev === 'create') return 'create';        // 先 create 后 edit → create
  if (next === 'create') return 'create';
  return prev;                                    // edit/edit → edit
}

/** 把任意 ConversationBlock 归一化为文件变更描述（与 AssistantMessage 渲染口径一致）。 */
function toFileChange(block: ConversationBlock): FileChangedBlockData | null {
  if (block.type === 'file_changed') {
    return {
      type: 'file_changed',
      path: block.path,
      before: block.before,
      after: block.after,
      diff: block.diff,
      operation: block.operation,
    };
  }
  if (block.type === 'tool_call') {
    const change = fileChangeFromToolCall({
      type: 'tool_call',
      toolCallId: block.toolCallId,
      title: block.title,
      kind: block.kind,
      status: block.status,
      rawInput: block.rawInput,
      rawOutput: block.rawOutput,
    });
    if (!change) return null;
    return { type: 'file_changed', ...change };
  }
  return null;
}

export function summarizeSessionFiles(turns: ConversationTurn[]): SessionFileSummary {
  const map = new Map<string, SummaryFile>();

  for (const turn of turns) {
    for (const block of turn.blocks) {
      const change = toFileChange(block);
      if (!change) continue;
      const { added, removed } = changedLineCount(change);
      const op: Operation = change.operation ?? 'edit';
      const existing = map.get(change.path);
      if (existing) {
        existing.added += added;
        existing.removed += removed;
        existing.operation = mergeOperation(existing.operation, op);
      } else {
        const { name, ext, kind } = classifyFileKind(change.path);
        map.set(change.path, { path: change.path, name, ext, kind, operation: op, added, removed });
      }
    }
  }

  const files = Array.from(map.values());
  const totalAdded = files.reduce((acc, f) => acc + f.added, 0);
  const totalRemoved = files.reduce((acc, f) => acc + f.removed, 0);
  return { files, totalAdded, totalRemoved };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/session-file-summary.test.ts`
Expected: PASS（全部用例绿）。

- [ ] **Step 6: 提交**

```bash
git add src/components/agent/session-file-summary.ts src/components/agent/FileChangedBlock.tsx tests/session-file-summary.test.ts
git commit -m "feat(agent): 会话文件改动聚合纯函数 session-file-summary"
```

---

### Task 2: 新增 IPC `open-path` 与 `quick-look-file`（三件套）

为面板提供「打开（默认 App）」与「快速预览（macOS Quick Look）」能力。`show-item-in-folder`、`open-external` 已存在，复用。

**Files:**
- Modify: `electron/main.ts:2344-2350`（在既有 `show-item-in-folder` / `open-external` 旁新增）
- Modify: `electron/preload.ts:229-230`（在既有 `showItemInFolder` / `openExternal` 旁新增）
- Modify: `src/lib/electron-api.ts:361-362`（在既有类型旁新增）

- [ ] **Step 1: main 新增 handler**

在 `electron/main.ts` 第 2350 行（`open-external` handler 之后）插入。先确认文件顶部已 `import { spawn } from 'node:child_process'`（若未导入则补上 import；`shell` 已从 `electron` 导入）：

```ts
ipcMain.handle('open-path', async (_event, filePath: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const error = await shell.openPath(filePath);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('quick-look-file', async (_event, filePath: string): Promise<{ ok: boolean; error?: string }> => {
  if (process.platform === 'darwin') {
    try {
      // qlmanage -p 调出 macOS 原生快速预览；detached + unref 不阻塞主进程。
      const child = spawn('qlmanage', ['-p', filePath], { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  // 非 macOS 降级为默认 App 打开。
  const error = await shell.openPath(filePath);
  return error ? { ok: false, error } : { ok: true };
});
```

- [ ] **Step 2: 确认 import**

Run: `grep -n "child_process\|from 'node:child_process'" electron/main.ts`
Expected: 命中一行 import；若无输出，在 main.ts 顶部 import 区加入：

```ts
import { spawn } from 'node:child_process';
```

- [ ] **Step 3: preload 暴露**

在 `electron/preload.ts` 第 230 行（`openExternal` 之后）插入：

```ts
  openPath: (filePath: string) =>
    ipcRenderer.invoke('open-path', filePath) as Promise<{ ok: boolean; error?: string }>,
  quickLookFile: (filePath: string) =>
    ipcRenderer.invoke('quick-look-file', filePath) as Promise<{ ok: boolean; error?: string }>,
```

- [ ] **Step 4: electron-api 类型契约**

在 `src/lib/electron-api.ts` 第 362 行（`openExternal` 之后）插入：

```ts
  /** 用系统默认 App 打开文件，返回成功标记。 */
  openPath: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  /** macOS 调用 Quick Look 预览；非 macOS 降级为默认 App 打开。 */
  quickLookFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
```

- [ ] **Step 5: 类型构建校验**

Run: `npx tsc -p tsconfig.json --noEmit`（若仓库无该配置则 `npm run build` 的 tsc 阶段）
Expected: 无与 `openPath` / `quickLookFile` 相关的类型错误。

- [ ] **Step 6: 提交**

```bash
git add electron/main.ts electron/preload.ts src/lib/electron-api.ts
git commit -m "feat(ipc): 新增 open-path 与 quick-look-file（含 preload+类型）"
```

---

### Task 3: 面板组件 `SessionFileSummaryPanel.tsx`

渲染聚合结果卡片，每行带「打开方式」下拉。复用 `src/ui` 的 DropdownMenu 与既有 `isMac` 检测口径。

**Files:**
- Create: `src/components/agent/SessionFileSummaryPanel.tsx`

- [ ] **Step 1: 实现组件**

创建 `src/components/agent/SessionFileSummaryPanel.tsx`：

```tsx
/**
 * SessionFileSummaryPanel — pi 会话结束后的「本次共改动 N 个文件」结果卡片。
 *
 * 渲染条件由调用方（MessageList）保证：非 streaming 且文件数 ≥ 1。
 * 每行提供「打开方式」下拉：macOS 快速预览 / 打开 / 在 Finder 中显示；
 * 非 macOS 仅 打开 / 在资源管理器中显示。删除态文件禁用打开/预览。
 */
import { ChevronDown, FileText, Image as ImageIcon, Film, Music, FileCode2, File } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui';
import { RollingNumber } from './RollingNumber';
import { summarizeSessionFiles, type FileKind, type SummaryFile } from './session-file-summary';
import type { ConversationTurn } from '../../types/conversation';
import styles from './AgentTranscript.module.css';

const isMac = navigator.platform.toUpperCase().includes('MAC');

const KIND_LABEL: Record<FileKind, string> = {
  image: '图像',
  video: '视频',
  audio: '音频',
  markdown: '文档',
  document: '文档',
  code: '代码',
  other: '文件',
};

function KindIcon({ kind }: { kind: FileKind }) {
  const size = 16;
  switch (kind) {
    case 'image': return <ImageIcon size={size} />;
    case 'video': return <Film size={size} />;
    case 'audio': return <Music size={size} />;
    case 'markdown':
    case 'document': return <FileText size={size} />;
    case 'code': return <FileCode2 size={size} />;
    default: return <File size={size} />;
  }
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

function resolvePath(projectDir: string | null | undefined, p: string): string {
  if (isAbsolute(p) || !projectDir) return p;
  const base = projectDir.replace(/[\\/]+$/, '');
  return `${base}/${p}`;
}

function subtitle(file: SummaryFile): string {
  const label = KIND_LABEL[file.kind];
  return file.ext ? `${label} · ${file.ext}` : label;
}

export function SessionFileSummaryPanel({
  turns,
  projectDir,
}: {
  turns: ConversationTurn[];
  projectDir?: string | null;
}) {
  const summary = summarizeSessionFiles(turns);
  if (summary.files.length === 0) return null;

  const openWith = (file: SummaryFile) => window.electronAPI.openPath(resolvePath(projectDir, file.path));
  const quickLook = (file: SummaryFile) => window.electronAPI.quickLookFile(resolvePath(projectDir, file.path));
  const reveal = (file: SummaryFile) => window.electronAPI.showItemInFolder(resolvePath(projectDir, file.path));

  return (
    <div className={styles.sessionFileSummary}>
      <div className={styles.sessionFileSummaryHeader}>
        <span className={styles.sessionFileSummaryTitle}>本次共改动 {summary.files.length} 个文件</span>
        {summary.totalAdded > 0 ? (
          <span className={styles.plus}>+<RollingNumber value={summary.totalAdded} prefix="+" /></span>
        ) : null}
        {summary.totalRemoved > 0 ? (
          <span className={styles.minus}>-<RollingNumber value={summary.totalRemoved} prefix="-" /></span>
        ) : null}
      </div>
      <ul className={styles.sessionFileList}>
        {summary.files.map((file) => {
          const deleted = file.operation === 'delete';
          return (
            <li key={file.path} className={styles.sessionFileRow}>
              <span className={styles.sessionFileIcon}><KindIcon kind={file.kind} /></span>
              <span className={styles.sessionFileMeta}>
                <span className={styles.sessionFileName} title={file.path}>{file.name}</span>
                <span className={styles.sessionFileSub}>{subtitle(file)}</span>
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className={styles.sessionFileOpenBtn}>
                  打开方式 <ChevronDown size={13} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isMac ? (
                    <DropdownMenuItem disabled={deleted} onSelect={() => quickLook(file)}>
                      快速预览
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem disabled={deleted} onSelect={() => openWith(file)}>
                    打开
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => reveal(file)}>
                    {isMac ? '在 Finder 中显示' : '在资源管理器中显示'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: 校验 DropdownMenuContent 的 `align` prop 与 DropdownMenuTrigger 是否接收 `className`**

Run: `sed -n '105,130p' src/ui/components/dropdown-menu.tsx; sed -n '68,104p' src/ui/components/dropdown-menu.tsx`
Expected: 确认 `DropdownMenuContentProps` 支持 `align`，`DropdownMenuTrigger` 接收 `className`。若 `align` 不存在则删掉该 prop；若 Trigger 不接收 className，改为 `asChild` 包一个 `<button className=...>`。按实际签名调整后保存。

- [ ] **Step 3: 类型构建校验**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无 `SessionFileSummaryPanel` 相关类型错误。

- [ ] **Step 4: 提交**

```bash
git add src/components/agent/SessionFileSummaryPanel.tsx
git commit -m "feat(agent): 会话改动文件结果集面板组件"
```

---

### Task 4: 接入 MessageList + ChatPane 传 projectDir

在消息列表末尾、非 streaming 时渲染面板。

**Files:**
- Modify: `src/components/agent/MessageList.tsx`
- Modify: `src/components/agent/ChatPane.tsx`

- [ ] **Step 1: MessageList 新增 `projectDir` prop**

在 `src/components/agent/MessageList.tsx` 的 `MessageListProps`（约第 31-39 行）追加：

```ts
  /** 用于把相对文件路径解析为绝对路径（会话结束文件结果集）。 */
  projectDir?: string | null;
```

并在函数参数解构（约第 49-55 行）加入 `projectDir`：

```ts
export function MessageList({
  turns,
  pendingPermission,
  onRespondPermission,
  fallbackAgentId,
  isStreaming,
  projectDir,
}: MessageListProps): React.ReactElement {
```

- [ ] **Step 2: 渲染面板**

在 `MessageList.tsx` 顶部 import 区加入：

```ts
import { SessionFileSummaryPanel } from './SessionFileSummaryPanel';
```

在 `</AnimatePresence>` 之后、权限卡兜底渲染之前（约第 143 行）插入：

```tsx
      {/* 会话结束（非 streaming）后，在末尾汇总本次改动的全部文件 */}
      {!isStreaming ? (
        <SessionFileSummaryPanel turns={turns} projectDir={projectDir} />
      ) : null}
```

（面板内部已对「文件数为 0」返回 null，无需额外条件。）

- [ ] **Step 3: ChatPane 透传 projectDir**

在 `src/components/agent/ChatPane.tsx` 找到渲染 `<MessageList ... />` 的位置（`grep -n "<MessageList" src/components/agent/ChatPane.tsx`），为其补上 `projectDir={projectDir}`（`projectDir` 已是 ChatPane 的入参，见 ChatPane.tsx:31,131）。例如：

```tsx
<MessageList
  turns={...}
  pendingPermission={...}
  onRespondPermission={...}
  isStreaming={...}
  projectDir={projectDir}
/>
```

- [ ] **Step 4: 类型构建校验**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无相关类型错误。

- [ ] **Step 5: 提交**

```bash
git add src/components/agent/MessageList.tsx src/components/agent/ChatPane.tsx
git commit -m "feat(agent): MessageList 末尾接入会话文件结果集面板"
```

---

### Task 5: 面板样式（AgentTranscript.module.css）

新增面板用到的 class，沿用 DESIGN.md 单色系统蓝、复用现有 token。

**Files:**
- Modify: `src/components/agent/AgentTranscript.module.css`

- [ ] **Step 1: 确认既有 class 与变量风格**

Run: `grep -n "\.plus\|\.minus\|\.event\b\|--color-\|var(--" src/components/agent/AgentTranscript.module.css | head -30`
Expected: 看到 `.plus` / `.minus` 已存在（面板复用），以及该文件使用的 CSS 变量命名（如 `--color-border-subtle` / `--color-text-*`），照此风格书写。

- [ ] **Step 2: 追加样式**

在 `src/components/agent/AgentTranscript.module.css` 末尾追加（变量名以 Step 1 实测为准，下面用仓库常见 token）：

```css
.sessionFileSummary {
  margin-top: 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-window-bg);
}

.sessionFileSummaryHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border-subtle);
}

.sessionFileSummaryTitle {
  flex: 1;
}

.sessionFileList {
  list-style: none;
  margin: 0;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sessionFileRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
}

.sessionFileRow:hover {
  background: var(--color-fill-quaternary, rgba(120, 120, 128, 0.08));
}

.sessionFileIcon {
  display: inline-flex;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.sessionFileMeta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.sessionFileName {
  font-size: 13px;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sessionFileSub {
  font-size: 11px;
  color: var(--color-text-tertiary, var(--color-text-secondary));
}

.sessionFileOpenBtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-window-bg);
  color: var(--color-text-primary);
  cursor: pointer;
}

.sessionFileOpenBtn:hover {
  background: var(--color-fill-quaternary, rgba(120, 120, 128, 0.08));
}
```

- [ ] **Step 3: 类型/构建检查**

Run: `npx vitest run tests/session-file-summary.test.ts`
Expected: PASS（确认未破坏聚合逻辑；CSS 改动不影响测试，作为快速回归）。

- [ ] **Step 4: 提交**

```bash
git add src/components/agent/AgentTranscript.module.css
git commit -m "style(agent): 会话文件结果集面板样式"
```

---

### Task 6: 端到端手动验证

IPC 与 Quick Look 无法在 Vitest 中可靠单测，做一次真机冒烟。

**Files:** 无（验证）

- [ ] **Step 1: 启动应用**

Run: `npm run dev`

- [ ] **Step 2: 在 AI 面板用 pi agent 触发一次会改动文件的对话**

例如让 pi 生成封面提示词 / 写一个 md，等待会话结束（非 streaming）。
Expected:
- 消息区末尾出现「本次共改动 N 个文件」卡片，列出全部新增/编辑/删除文件，带 `+/-` 行数。
- 每行右侧「打开方式 ▾」下拉：macOS 显示「快速预览 / 打开 / 在 Finder 中显示」。
- 点「快速预览」对图片/md 弹出 macOS Quick Look；点「打开」用默认 App 打开；点「在 Finder 中显示」定位文件。
- 删除态文件的「快速预览 / 打开」置灰禁用。
- 对话进行中（streaming）时面板不出现。

- [ ] **Step 3: 构建校验**

Run: `npm run build`
Expected: 编译通过（main + preload + renderer），无类型错误。

- [ ] **Step 4: 全量测试**

Run: `npm test`
Expected: 现有测试与 `session-file-summary` 测试全部通过。

---

## Self-Review

- **Spec coverage:**
  - 整个会话聚合 → Task 1（`summarizeSessionFiles`）+ Task 4（末尾渲染）✓
  - 全部触碰文件（create/edit/delete 一个列表）→ Task 1 操作终态归并 + Task 3 行渲染 ✓
  - 打开方式精简版（macOS 快速预览/打开/Finder；非 macOS 打开/资源管理器）→ Task 2 IPC + Task 3 下拉 ✓
  - 交给系统预览（不内联）→ Task 3 调 `quickLookFile`/`openPath`，无内联播放 ✓
  - 现有 FileChangedBlock 不动 → 仅在其文件新增 `export changedLineCount`，渲染逻辑未改 ✓
  - 错误处理：main 侧捕获并返回 `{ok,error}`，删除态 UI 禁用，空集合/streaming 不渲染 ✓
  - 测试：Task 1 纯函数单测，Task 6 IPC 手动冒烟 ✓
- **Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码或精确命令。Task 2 Step 2 与 Task 3 Step 2 是「按实测签名核对并调整」，这是对既有 API 的真实校验步骤，非占位。
- **Type consistency:** `summarizeSessionFiles` / `classifyFileKind` / `SummaryFile` / `FileKind` / `SessionFileSummary` 在 Task 1 定义，Task 3 使用一致；`openPath` / `quickLookFile` 在 Task 2 三件套同名；`changedLineCount` 与 `FileChangedBlockData` 从 FileChangedBlock 导出后在 Task 1 复用。
```

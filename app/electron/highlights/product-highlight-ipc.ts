/** Owner-only desktop bridge for explicitly selected local highlight inputs. */
import { lstatSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HighlightArtifactBundle } from './highlight-batch-artifacts';
import { HIGHLIGHT_BATCH_FAILURE_CODES, HighlightBatchQueueError, type HighlightBatchTaskV1 } from './highlight-batch-queue';
import { AuthorizedRecordingImportError } from './authorized-recording-import';
import { ProductHighlightController, ProductHighlightControllerError } from './product-highlight-controller';

export const HIGHLIGHT_V1_CHANNELS = {
  chooseRoot: 'highlight-v1:choose-root',
  chooseRecordings: 'highlight-v1:choose-recordings',
  chooseNode: 'highlight-v1:choose-node',
  chooseHotClip: 'highlight-v1:choose-hotclip',
  import: 'highlight-v1:import',
  list: 'highlight-v1:list',
  read: 'highlight-v1:read',
  cancel: 'highlight-v1:cancel',
  retry: 'highlight-v1:retry',
  run: 'highlight-v1:run',
} as const;

export type HighlightV1IpcErrorCode =
  | 'forbidden' | 'busy' | 'stopped' | 'invalid_request' | 'invalid_selection'
  | 'selection_required' | 'consent_required' | 'source_unavailable'
  | 'root_mismatch'
  | 'task_not_found' | 'invalid_transition' | 'attempt_limit_reached' | 'internal_error';
export type HighlightV1Result<T> = ({ ok: true } & T) | { ok: false; code: HighlightV1IpcErrorCode };

export interface HighlightV1TaskDto {
  id: string;
  name: string;
  sourceSha256: string;
  state: HighlightBatchTaskV1['state'];
  attempt: number;
  candidateCount: number;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export type HighlightV1RunInput = {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
  timeoutMs: number;
  concurrency: number;
  maxAttempts: number;
  allowModelDownload: boolean;
};

type DialogResult = { canceled: boolean; filePaths: string[] };
type Handler = (event: unknown, input?: unknown) => unknown;
export interface ProductHighlightIpcOptions {
  ipc: { handle(channel: string, handler: Handler): void };
  controller: ProductHighlightController;
  /** Only the current, trusted main window can invoke operations. */
  allowedSender(event: unknown): boolean;
  pickDirectory(title: string): Promise<DialogResult>;
  pickFiles(title: string, defaultPath?: string): Promise<DialogResult>;
}

const TASK_ID_RE = /^hbatch_[a-f0-9]{64}$/;
const EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const DISPLAY_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;
const FAILURE_CODES = new Set<string>(HIGHLIGHT_BATCH_FAILURE_CODES);

function displayName(path: string): string {
  return basename(path).slice(0, 160).replace(DISPLAY_UNSAFE, '\uFFFD');
}

function dto(task: HighlightBatchTaskV1): HighlightV1TaskDto {
  return {
    id: task.id,
    name: displayName(task.recording.sourceRef),
    sourceSha256: task.sourceSha256,
    state: task.state,
    attempt: task.attempt,
    candidateCount: task.candidateIds.length,
    lastErrorCode: task.lastErrorCode && FAILURE_CODES.has(task.lastErrorCode)
      ? task.lastErrorCode : task.lastErrorCode ? 'internal_error' : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function regularFile(path: string): boolean {
  try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink(); }
  catch { return false; }
}

function directory(path: string): boolean {
  try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); }
  catch { return false; }
}

function within(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorCode(error: unknown): HighlightV1IpcErrorCode {
  if (error instanceof ProductHighlightControllerError) {
    return error.code === 'invalid_configuration' ? 'invalid_request' : error.code;
  }
  if (error instanceof AuthorizedRecordingImportError) return error.code;
  if (error instanceof HighlightBatchQueueError) {
    if (error.code === 'task_not_found' || error.code === 'invalid_transition' ||
        error.code === 'attempt_limit_reached') return error.code;
    if (error.code === 'invalid_attempt_limit') return 'invalid_request';
  }
  return 'internal_error';
}

/** The selected paths remain in main-process memory; renderer receives only bounded display DTOs. */
export function registerProductHighlightIpc(options: ProductHighlightIpcOptions): void {
  const { ipc, controller } = options;
  let mediaRoot: string | null = null;
  let selectedRecordings: string[] = [];
  let nodeExecutable: string | null = null;
  let hotClipDir: string | null = null;
  let choosing = false;

  function handle(channel: string, operation: (input: unknown) => Promise<unknown> | unknown): void {
    ipc.handle(channel, async (event, input) => {
      if (!options.allowedSender(event)) return { ok: false, code: 'forbidden' };
      try { return await operation(input); }
      catch (error) { return { ok: false, code: errorCode(error) }; }
    });
  }

  async function choose(pick: () => Promise<DialogResult>): Promise<DialogResult | null | { busy: true }> {
    if (choosing) return { busy: true };
    choosing = true;
    try {
      const result = await pick();
      return result.canceled ? null : result;
    } finally { choosing = false; }
  }

  handle(HIGHLIGHT_V1_CHANNELS.chooseRoot, async () => {
    const selected = await choose(() => options.pickDirectory('选择已授权直播录屏目录'));
    if (selected && 'busy' in selected) return { ok: false, code: 'busy' };
    if (!selected) return { ok: false, code: 'selection_required' };
    const root = selected.filePaths.length === 1 ? selected.filePaths[0] : '';
    if (!isAbsolute(root) || !directory(root)) return { ok: false, code: 'invalid_selection' };
    mediaRoot = resolve(root);
    selectedRecordings = [];
    return { ok: true, label: displayName(mediaRoot) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.chooseRecordings, async () => {
    if (!mediaRoot) return { ok: false, code: 'selection_required' };
    selectedRecordings = [];
    const selected = await choose(() => options.pickFiles('选择直播录屏（最多 100 个）', mediaRoot!));
    if (selected && 'busy' in selected) return { ok: false, code: 'busy' };
    if (!selected) return { ok: false, code: 'selection_required' };
    const paths = selected.filePaths;
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > 100 ||
        paths.some((path) => typeof path !== 'string' || !isAbsolute(path) ||
          !within(mediaRoot!, path) || !regularFile(path) || !EXTENSIONS.has(extname(path).toLowerCase())) ||
        new Set(paths.map((path) => resolve(path).toLowerCase())).size !== paths.length) {
      return { ok: false, code: 'invalid_selection' };
    }
    selectedRecordings = paths.map((path) => resolve(path));
    return { ok: true, names: selectedRecordings.map(displayName) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.chooseNode, async () => {
    const selected = await choose(() => options.pickFiles('选择 Node.js 可执行文件'));
    if (selected && 'busy' in selected) return { ok: false, code: 'busy' };
    if (!selected) return { ok: false, code: 'selection_required' };
    const executable = selected.filePaths.length === 1 ? selected.filePaths[0] : '';
    const name = basename(executable).toLowerCase();
    if (!isAbsolute(executable) || !regularFile(executable) ||
        (process.platform === 'win32' ? name !== 'node.exe' : name !== 'node')) {
      return { ok: false, code: 'invalid_selection' };
    }
    nodeExecutable = resolve(executable);
    return { ok: true, label: displayName(nodeExecutable) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.chooseHotClip, async () => {
    const selected = await choose(() => options.pickDirectory('选择另行安装的 HotClip 目录'));
    if (selected && 'busy' in selected) return { ok: false, code: 'busy' };
    if (!selected) return { ok: false, code: 'selection_required' };
    const root = selected.filePaths.length === 1 ? selected.filePaths[0] : '';
    if (!isAbsolute(root) || !directory(root) ||
        !regularFile(join(root, 'src', 'cli', 'index.ts')) ||
        !regularFile(join(root, 'node_modules', 'tsx', 'package.json'))) {
      return { ok: false, code: 'invalid_selection' };
    }
    hotClipDir = resolve(root);
    return { ok: true, label: displayName(hotClipDir) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.import, async (input) => {
    if (!mediaRoot || !selectedRecordings.length) return { ok: false, code: 'selection_required' };
    if (!object(input) ||
        !(input.maxClips === null || input.maxClips === undefined ||
          (Number.isInteger(input.maxClips) && (input.maxClips as number) >= 1 && (input.maxClips as number) <= 12))) {
      return { ok: false, code: 'invalid_request' };
    }
    const paths = selectedRecordings;
    selectedRecordings = [];
    const tasks = await controller.importRecordings({
      mediaRootDir: mediaRoot, videoPaths: paths, maxClips: (input.maxClips as number | null | undefined) ?? null,
    });
    return { ok: true, tasks: tasks.map(dto) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.list, () => ({
    ok: true, busy: controller.hasActiveWork, tasks: controller.list().map(dto),
  }));

  handle(HIGHLIGHT_V1_CHANNELS.read, (input) => {
    if (!object(input) || typeof input.id !== 'string' || !TASK_ID_RE.test(input.id)) {
      return { ok: false, code: 'invalid_request' };
    }
    const artifact: HighlightArtifactBundle | null = controller.readArtifact(input.id);
    if (!artifact) return { ok: false, code: 'task_not_found' };
    return { ok: true, artifact };
  });

  handle(HIGHLIGHT_V1_CHANNELS.cancel, (input) => {
    if (!object(input) || typeof input.id !== 'string' || !TASK_ID_RE.test(input.id)) {
      return { ok: false, code: 'invalid_request' };
    }
    return { ok: true, task: dto(controller.cancel(input.id)) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.retry, (input) => {
    if (!object(input) || typeof input.id !== 'string' || !TASK_ID_RE.test(input.id) ||
        !Number.isInteger(input.maxAttempts) || (input.maxAttempts as number) < 1 ||
        (input.maxAttempts as number) > 5) return { ok: false, code: 'invalid_request' };
    return { ok: true, task: dto(controller.retry(input.id, input.maxAttempts as number)) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.run, async (input) => {
    if (!object(input)) return { ok: false, code: 'invalid_request' };
    if (input.allowModelDownload !== true) return { ok: false, code: 'consent_required' };
    if (!mediaRoot || !nodeExecutable || !hotClipDir) return { ok: false, code: 'selection_required' };
    const queued = controller.list().filter((task) => task.state === 'queued');
    if (queued.some((task) => !within(mediaRoot!, task.recording.sourceRef))) {
      return { ok: false, code: 'root_mismatch' };
    }
    const tasks = await controller.runQueued({
      mediaRootDir: mediaRoot,
      executable: nodeExecutable,
      argsPrefix: ['--import', 'tsx', 'src/cli/index.ts'],
      cwd: hotClipDir,
      timeoutMs: input.timeoutMs as number,
      concurrency: input.concurrency as number,
      maxAttempts: input.maxAttempts as number,
      llmBaseUrl: input.llmBaseUrl as string,
      llmModel: input.llmModel as string,
      llmApiKey: input.llmApiKey as string | undefined,
      allowModelDownload: true,
    });
    return { ok: true, tasks: tasks.map(dto) };
  });
}

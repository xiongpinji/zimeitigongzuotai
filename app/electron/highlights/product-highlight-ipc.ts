/** Owner-only desktop bridge for explicitly selected local highlight inputs. */
import { lstatSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HighlightArtifactBundle } from './highlight-batch-artifacts';
import { HIGHLIGHT_BATCH_FAILURE_CODES, HighlightBatchQueueError, type HighlightBatchTaskV1 } from './highlight-batch-queue';
import { AuthorizedRecordingImportError } from './authorized-recording-import';
import { ProductHighlightController, ProductHighlightControllerError } from './product-highlight-controller';
import type { ReviewedClipExporter } from './reviewed-clip-exporter';
import { ReviewedClipExportError, type ReviewedClipErrorCode } from './reviewed-clip-receipts';

export const HIGHLIGHT_V1_CHANNELS = {
  chooseRoot: 'highlight-v1:choose-root',
  chooseRecordings: 'highlight-v1:choose-recordings',
  chooseSubtitles: 'highlight-v1:choose-subtitles',
  chooseNode: 'highlight-v1:choose-node',
  chooseHotClip: 'highlight-v1:choose-hotclip',
  import: 'highlight-v1:import',
  list: 'highlight-v1:list',
  read: 'highlight-v1:read',
  cancel: 'highlight-v1:cancel',
  retry: 'highlight-v1:retry',
  run: 'highlight-v1:run',
  exportReviewed: 'highlight-v1:export-reviewed',
  listReviewed: 'highlight-v1:list-reviewed',
  verifiedOutput: 'highlight-v1:verified-output',
  cancelExport: 'highlight-v1:cancel-export',
} as const;

export type HighlightV1IpcErrorCode =
  | 'forbidden' | 'busy' | 'stopped' | 'invalid_request' | 'invalid_selection'
  | 'selection_required' | 'consent_required' | 'source_unavailable'
  | 'root_mismatch'
  | 'task_not_found' | 'invalid_transition' | 'attempt_limit_reached' | 'internal_error'
  | ReviewedClipErrorCode;
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
  exporter: ReviewedClipExporter;
  /** Only the current, trusted main window can invoke operations. */
  allowedSender(event: unknown): boolean;
  pickDirectory(title: string): Promise<DialogResult>;
  pickFiles(title: string, defaultPath?: string): Promise<DialogResult>;
}

const TASK_ID_RE = /^hbatch_[a-f0-9]{64}$/;
const CLIP_ID_RE = /^hclip_[a-f0-9]{64}$/;
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

function pathKey(path: string): string {
  const canonical = resolve(path);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorCode(error: unknown): HighlightV1IpcErrorCode {
  if (error instanceof ReviewedClipExportError) return error.code;
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
  const { ipc, controller, exporter } = options;
  let mediaRoot: string | null = null;
  let selectedRecordings: string[] = [];
  const selectedSubtitles = new Map<string, string>();
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
    selectedSubtitles.clear();
    return { ok: true, label: displayName(mediaRoot) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.chooseRecordings, async () => {
    if (!mediaRoot) return { ok: false, code: 'selection_required' };
    selectedRecordings = [];
    selectedSubtitles.clear();
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

  handle(HIGHLIGHT_V1_CHANNELS.chooseSubtitles, async () => {
    if (!mediaRoot || !selectedRecordings.length) return { ok: false, code: 'selection_required' };
    selectedSubtitles.clear();
    const selected = await choose(() => options.pickFiles('选择与录屏同名的 SRT 字幕（可选）', mediaRoot!));
    if (selected && 'busy' in selected) return { ok: false, code: 'busy' };
    if (!selected) return { ok: false, code: 'selection_required' };
    const paths = selected.filePaths;
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > selectedRecordings.length ||
        paths.some((path) => typeof path !== 'string' || !isAbsolute(path) ||
          !within(mediaRoot!, path) || !regularFile(path) || extname(path).toLowerCase() !== '.srt')) {
      return { ok: false, code: 'invalid_selection' };
    }
    const stems = selectedRecordings.map((path) => pathKey(path.slice(0, -extname(path).length)));
    const stemCounts = new Map<string, number>();
    for (const stem of stems) stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
    const recordingByStem = new Map(selectedRecordings.map((path, index) => [stems[index], pathKey(path)]));
    for (const raw of paths) {
      const path = resolve(raw);
      const stem = pathKey(path.slice(0, -extname(path).length));
      const recording = recordingByStem.get(stem);
      if (!recording || stemCounts.get(stem) !== 1 || selectedSubtitles.has(recording)) {
        selectedSubtitles.clear();
        return { ok: false, code: 'invalid_selection' };
      }
      selectedSubtitles.set(recording, path);
    }
    return { ok: true, names: paths.map(displayName) };
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
    const subtitlePaths = paths.map((path) => selectedSubtitles.get(pathKey(path)) ?? null);
    selectedRecordings = [];
    selectedSubtitles.clear();
    const tasks = await controller.importRecordings({
      mediaRootDir: mediaRoot, videoPaths: paths, subtitlePaths,
      maxClips: (input.maxClips as number | null | undefined) ?? null,
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

  handle(HIGHLIGHT_V1_CHANNELS.exportReviewed, async (input) => {
    if (!mediaRoot) return { ok: false, code: 'selection_required' };
    if (!object(input)) return { ok: false, code: 'invalid_request' };
    if (input.reviewConfirmed !== true) return { ok: false, code: 'review_required' };
    const results = await exporter.exportBatch({
      mediaRootDir: mediaRoot,
      reviewConfirmed: true,
      selections: input.selections,
      concurrency: input.concurrency,
    });
    return { ok: true, results: results.map((result) => result.status === 'completed'
      ? { status: result.status, id: result.id, taskId: result.taskId,
        highlightId: result.highlightId, outputSha256: result.outputSha256,
        outputDurationMs: result.outputDurationMs, reused: result.reused }
      : result) };
  });

  handle(HIGHLIGHT_V1_CHANNELS.listReviewed, () => ({
    ok: true, clips: exporter.list(), busy: exporter.hasActiveWork,
  }));

  handle(HIGHLIGHT_V1_CHANNELS.verifiedOutput, async (input) => {
    if (!object(input) || typeof input.id !== 'string' || !CLIP_ID_RE.test(input.id)) {
      return { ok: false, code: 'invalid_request' };
    }
    const { path, receipt } = await exporter.verifiedOutput(input.id);
    return { ok: true, path, durationMs: receipt.outputDurationMs };
  });

  handle(HIGHLIGHT_V1_CHANNELS.cancelExport, () => ({
    ok: true, cancelled: exporter.cancelActive(),
  }));
}

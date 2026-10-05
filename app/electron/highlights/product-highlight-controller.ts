/** Explicit product operations over the owner-held highlight queue and artifact store. */
import { lstatSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import {
  importAuthorizedRecordings,
  type AuthorizedRecordingImportOptions,
} from './authorized-recording-import';
import {
  type HighlightArtifactBundle,
} from './highlight-batch-artifacts';
import type { HighlightBatchTaskV1 } from './highlight-batch-queue';
import { HighlightBatchSourceError, HighlightBatchScheduler } from './highlight-batch-scheduler';
import { createAuthorizedLocalHotClipRunner } from './local-source-observer';
import { verifyStoredSrt } from './authorized-subtitle-snapshot';
import type { ProductHighlightRuntime } from './product-highlight-bootstrap';

export type ProductHighlightControllerErrorCode = 'invalid_configuration' | 'busy' | 'stopped';

export class ProductHighlightControllerError extends Error {
  readonly code: ProductHighlightControllerErrorCode;

  constructor(code: ProductHighlightControllerErrorCode) {
    super(code === 'invalid_configuration'
      ? 'Highlight execution configuration is invalid'
      : code === 'busy' ? 'Highlight batch is already running' : 'Highlight controller is stopping');
    this.name = 'ProductHighlightControllerError';
    this.code = code;
  }
}

export interface ProductHighlightRunConfiguration {
  mediaRootDir: string;
  /** User-selected executable; command-shell wrappers are intentionally unsupported. */
  executable: string;
  argsPrefix?: readonly string[];
  cwd: string;
  timeoutMs: number;
  concurrency: number;
  maxAttempts: number;
  llmBaseUrl: string;
  llmModel: string;
  /** Ephemeral; never written to the task queue or artifact store. */
  llmApiKey?: string;
  /** HotClip can fetch local models; explicit opt-in is required before dispatch. */
  allowModelDownload: true;
}

function invalid(): never {
  throw new ProductHighlightControllerError('invalid_configuration');
}

function regularFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}

function directory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}

function validateRunConfiguration(value: ProductHighlightRunConfiguration): ProductHighlightRunConfiguration {
  if (!value || typeof value !== 'object' ||
      typeof value.mediaRootDir !== 'string' || !isAbsolute(value.mediaRootDir) || !directory(value.mediaRootDir) ||
      typeof value.executable !== 'string' || !isAbsolute(value.executable) || !regularFile(value.executable) ||
      (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(value.executable).toLowerCase())) ||
      typeof value.cwd !== 'string' || !isAbsolute(value.cwd) || !directory(value.cwd) ||
      !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1_000 || value.timeoutMs > 21_600_000 ||
      !Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 4 ||
      !Number.isInteger(value.maxAttempts) || value.maxAttempts < 1 || value.maxAttempts > 5 ||
      value.allowModelDownload !== true ||
      typeof value.llmModel !== 'string' || !value.llmModel.trim() || value.llmModel.length > 256 ||
      typeof value.llmBaseUrl !== 'string' ||
      (value.llmApiKey !== undefined && (typeof value.llmApiKey !== 'string' || value.llmApiKey.length > 4096)) ||
      (value.argsPrefix !== undefined && (!Array.isArray(value.argsPrefix) ||
        value.argsPrefix.some((arg) => typeof arg !== 'string' || arg.includes('\0'))))) invalid();
  try {
    const url = new URL(value.llmBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid();
  } catch { invalid(); }
  return value;
}

export class ProductHighlightController {
  private readonly runtime: ProductHighlightRuntime;
  private readonly sidecarHome: string;
  private readonly subtitleStoreDir: string;
  private activeScheduler: HighlightBatchScheduler | null = null;
  private importController: AbortController | null = null;
  private importPromise: Promise<HighlightBatchTaskV1[]> | null = null;
  private stopping = false;

  constructor(options: { runtime: ProductHighlightRuntime; userDataPath: string }) {
    if (!options?.runtime || typeof options.userDataPath !== 'string' || !isAbsolute(options.userDataPath)) invalid();
    this.runtime = options.runtime;
    this.sidecarHome = join(options.userDataPath, 'highlights-v1', 'sidecar-home');
    this.subtitleStoreDir = join(options.userDataPath, 'highlights-v1', 'subtitles');
  }

  get hasActiveWork(): boolean {
    return this.importPromise !== null || this.activeScheduler !== null;
  }

  list(): HighlightBatchTaskV1[] {
    return this.runtime.queue.list();
  }

  importRecordings(input: Omit<AuthorizedRecordingImportOptions, 'queue' | 'subtitleStoreDir'>): Promise<HighlightBatchTaskV1[]> {
    if (this.stopping) return Promise.reject(new ProductHighlightControllerError('stopped'));
    if (this.importPromise || this.activeScheduler) return Promise.reject(new ProductHighlightControllerError('busy'));
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener('abort', onAbort, { once: true });
    this.importController = controller;
    const operation = importAuthorizedRecordings({
      ...input, queue: this.runtime.queue, signal: controller.signal,
      subtitleStoreDir: this.subtitleStoreDir,
    });
    const settled = operation.finally(() => {
      input.signal?.removeEventListener('abort', onAbort);
      if (this.importPromise === settled) this.importPromise = null;
      if (this.importController === controller) this.importController = null;
    });
    this.importPromise = settled;
    return settled;
  }

  readArtifact(id: string): HighlightArtifactBundle | null {
    const task = this.runtime.queue.get(id);
    return task?.state === 'completed' ? this.runtime.artifacts.read(task) : null;
  }

  cancel(id: string): HighlightBatchTaskV1 {
    if (this.stopping) throw new ProductHighlightControllerError('stopped');
    return this.activeScheduler ? this.activeScheduler.cancel(id) : this.runtime.queue.cancel(id);
  }

  retry(id: string, maxAttempts: number): HighlightBatchTaskV1 {
    if (this.stopping) throw new ProductHighlightControllerError('stopped');
    return this.runtime.queue.retry(id, maxAttempts);
  }

  runQueued(raw: ProductHighlightRunConfiguration): Promise<HighlightBatchTaskV1[]> {
    return this.run(raw, null);
  }

  /** Trusted caller must bind every selected ID to the active project before invoking this. */
  runSelected(raw: ProductHighlightRunConfiguration, taskIds: readonly string[]): Promise<HighlightBatchTaskV1[]> {
    return this.run(raw, taskIds);
  }

  private async run(raw: ProductHighlightRunConfiguration,
    taskIds: readonly string[] | null): Promise<HighlightBatchTaskV1[]> {
    if (this.stopping) throw new ProductHighlightControllerError('stopped');
    if (this.activeScheduler || this.importPromise) throw new ProductHighlightControllerError('busy');
    const config = validateRunConfiguration(raw);
    const env: Record<string, string> = {
      HOTCLIP_LLM_BASE_URL: config.llmBaseUrl,
      HOTCLIP_LLM_MODEL: config.llmModel,
      ...(config.llmApiKey === undefined ? {} : { HOTCLIP_LLM_API_KEY: config.llmApiKey }),
      ...(process.platform === 'win32'
        ? { APPDATA: this.sidecarHome }
        : { XDG_CONFIG_HOME: this.sidecarHome }),
    };
    const runner = createAuthorizedLocalHotClipRunner({
      artifacts: this.runtime.artifacts,
      mediaRootDir: config.mediaRootDir,
      createdAt: () => new Date().toISOString(),
      resolveRunOptions: async (task, signal) => {
        let subtitlesPath: string | undefined;
        if (task.recording.transcriptRef !== null) {
          try {
            subtitlesPath = await verifyStoredSrt(
              this.subtitleStoreDir, task.recording.transcriptRef, signal,
            );
          } catch { throw new HighlightBatchSourceError('source_unavailable'); }
        }
        return {
          executable: config.executable,
          argsPrefix: config.argsPrefix,
          cwd: config.cwd,
          videoPath: task.recording.sourceRef,
          subtitlesPath,
          timeoutMs: config.timeoutMs,
          env,
        };
      },
    });
    const scheduler = new HighlightBatchScheduler({
      queue: this.runtime.queue,
      concurrency: config.concurrency,
      maxAttempts: config.maxAttempts,
      runner,
    });
    this.activeScheduler = scheduler;
    try {
      return await (taskIds === null ? scheduler.runQueued() : scheduler.runSelected(taskIds));
    } finally {
      if (this.activeScheduler === scheduler) this.activeScheduler = null;
    }
  }

  /** Stop sidecars and leave running receipts for the next owner to reconcile. */
  async stopForShutdown(): Promise<void> {
    this.stopping = true;
    this.importController?.abort();
    const active = this.importPromise;
    await Promise.allSettled([
      ...(active ? [active] : []),
      ...(this.activeScheduler ? [this.activeScheduler.stopForShutdown()] : []),
    ]);
  }
}

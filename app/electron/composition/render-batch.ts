/** Bounded, recoverable rendering for reviewed R4 version projects. Main-process only. */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExportConfig } from '../../src/lib/export-settings';
import type { ProductionDocumentV1 } from '../../src/types/production-contracts';
import type { AssetUsageContext } from '../assets/asset-rights';
import { readCompositionVersion, type CompositionVersionLocation } from './version-projects';
import {
  resolveCompositionSources, type CompositionSourceServices, type ResolvedCompositionSources,
} from './source-resolver';
import type { RenderVideoArgs } from '../remotion/render-video-headless';

const STATE_FILE = 'render-state.json';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEVICE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const HASH = /^[a-f0-9]{64}$/;
const OUTPUT = /^render-[a-f0-9]{64}\.mp4$/;
const states = ['queued', 'rendering', 'completed', 'failed', 'cancelled', 'unknown'] as const;
type StateKind = typeof states[number];

export interface CompositionRenderState {
  schemaVersion: 1;
  batchId: string;
  planId: string;
  state: StateKind;
  attemptId: string;
  inputFingerprint: string;
  sourceIdentitySha256: string;
  timelineSha256: string;
  sources: ResolvedCompositionSources;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  outputSha256: string | null;
  outputFile: string | null;
}

export interface CompositionRenderBatchInput {
  projectDir: string;
  batchId: string;
  planIds: string[];
  exportConfig: ExportConfig;
  context: Omit<AssetUsageContext, 'usedAt'>;
  retryFailed?: boolean;
  /** Owner-held Agent grant check. Re-evaluated after queue waits and before output commit. */
  beforeCommit?: () => void;
}

export interface CompositionRenderBatchDeps {
  getDocument: (projectDir: string) => Promise<ProductionDocumentV1>;
  sourceServices: CompositionSourceServices;
  render?: (args: RenderVideoArgs, opts: { signal: AbortSignal; frameConcurrency: number }) => Promise<unknown>;
  nowIso?: () => string;
}

export interface CompositionRenderResult {
  planId: string;
  state: StateKind;
  reviewRequired: true;
  outputPath: string | null;
  errorCode: string | null;
}

export class CompositionRenderError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CompositionRenderError'; }
}

const fail = (code: string): never => { throw new CompositionRenderError(code); };
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && !DEVICE.test(value);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digestJson = (value: unknown) => digest(JSON.stringify(value));
const normalizedPath = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;

function sourceIdentity(sources: ResolvedCompositionSources): unknown {
  return { ...sources, context: { ...sources.context, usedAt: undefined } };
}

async function statOrNull(file: string) {
  try { return await fs.lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function regularFile(file: string): Promise<boolean> {
  const entry = await statOrNull(file);
  return !!entry && entry.isFile() && !entry.isSymbolicLink();
}

async function hashFile(file: string): Promise<string> {
  if (!await regularFile(file)) fail('unsafe_output');
  return digest(await fs.readFile(file));
}

async function readState(directory: string, batchId: string, planId: string): Promise<CompositionRenderState | null> {
  const file = path.join(directory, STATE_FILE);
  const entry = await statOrNull(file);
  if (!entry) return null;
  if (!entry.isFile() || entry.isSymbolicLink()) fail('unsafe_state');
  let parsed: unknown;
  try { parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown; }
  catch { fail('corrupt_state'); }
  const state = parsed as CompositionRenderState;
  if (!state || state.schemaVersion !== 1 || state.batchId !== batchId || state.planId !== planId ||
      !states.includes(state.state) || typeof state.attemptId !== 'string' || !validId(state.attemptId) ||
      !HASH.test(state.inputFingerprint) || !HASH.test(state.sourceIdentitySha256) ||
      !HASH.test(state.timelineSha256) || !state.sources ||
      state.sources.planId !== planId || !Array.isArray(state.sources.segments) ||
      state.sourceIdentitySha256 !== digestJson(sourceIdentity(state.sources)) ||
      typeof state.createdAt !== 'string' || typeof state.updatedAt !== 'string' ||
      (state.errorCode !== null && typeof state.errorCode !== 'string') ||
      (state.outputSha256 !== null && !HASH.test(state.outputSha256)) ||
      (state.outputFile !== null && !OUTPUT.test(state.outputFile)) ||
      (state.state === 'completed' && (state.outputFile !== `render-${state.inputFingerprint}.mp4` || !state.outputSha256))) {
    fail('corrupt_state');
  }
  return state;
}

async function writeState(directory: string, state: CompositionRenderState): Promise<void> {
  const file = path.join(directory, STATE_FILE);
  const entry = await statOrNull(file);
  if (entry && (!entry.isFile() || entry.isSymbolicLink())) fail('unsafe_state');
  const temporary = path.join(directory, `.render-state-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(state, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    // Windows can briefly deny replacement while a status reader has the old file open.
    for (let attempt = 0; ; attempt += 1) {
      try { await fs.rename(temporary, file); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    try {
      const directoryHandle = await fs.open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch { /* Windows can refuse directory fsync; the state file was synced. */ }
  } finally { await fs.rm(temporary, { force: true }); }
}

let runningRenders = 0;
const waiters: Array<() => void> = [];
async function acquire(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) fail('render_cancelled');
  if (runningRenders >= 2) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => { signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => {
        const index = waiters.indexOf(wake);
        if (index >= 0) waiters.splice(index, 1);
        reject(new CompositionRenderError('render_cancelled'));
      };
      waiters.push(wake);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  } else runningRenders += 1;
  if (signal.aborted) {
    releaseSlot();
    fail('render_cancelled');
  }
  return releaseSlot;
}
function releaseSlot(): void {
  const wake = waiters.shift();
  if (wake) wake();
  else runningRenders -= 1;
}

interface ActiveBatch { controller: AbortController; settled: Promise<void>; finish: () => void }
const activeBatches = new Map<string, ActiveBatch>();
const activeVersions = new Set<string>();
const batchKey = (root: string, batchId: string) => normalizedPath(path.join(root, 'compositions', batchId));
const result = (planId: string, state: StateKind, outputPath: string | null = null,
  errorCode: string | null = null): CompositionRenderResult =>
  ({ planId, state, reviewRequired: true, outputPath, errorCode });
const KNOWN_ERRORS = new Set([
  'invalid_input', 'unsafe_path', 'not_found', 'corrupt', 'conflict',
  'invalid_plan', 'invalid_context', 'review_required', 'source_mismatch', 'clip_unavailable',
  'invalid_timecode', 'asset_unavailable', 'rights_blocked', 'media_changed',
  'source_changed', 'input_changed', 'output_conflict', 'unsafe_output', 'unsafe_state',
  'corrupt_state', 'render_cancelled',
  'authorization_expired',
]);
const safeCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && KNOWN_ERRORS.has(code) ? code : 'render_failed';
};

/** One process owns each batch; a global two-slot semaphore applies across all instances. */
export function createCompositionRenderBatch(deps: CompositionRenderBatchDeps) {
  const now = deps.nowIso ?? deps.sourceServices.nowIso;
  const render = deps.render ?? (async (args: RenderVideoArgs,
    options: { signal: AbortSignal; frameConcurrency: number }) => {
    const { renderVideoHeadless } = await import('../remotion/render-video-headless');
    return renderVideoHeadless(args, options);
  });

  async function processVersion(input: CompositionRenderBatchInput, planId: string,
    root: string, controller: AbortController): Promise<CompositionRenderResult> {
    const location = { projectDir: root, batchId: input.batchId, planId };
    let directory: string | null = null;
    let prior: CompositionRenderState | null = null;
    let pending: CompositionRenderState | null = null;
    let linkedOutput: string | null = null;
    try {
      const record = await readCompositionVersion(location);
      directory = record.projectDir;
      prior = await readState(directory, input.batchId, planId);
      if (prior?.state === 'rendering' || prior?.state === 'queued') {
        const unknown = { ...prior, state: 'unknown' as const, updatedAt: now(), errorCode: 'interrupted' };
        await writeState(directory, unknown);
        return result(planId, 'unknown', null, 'interrupted');
      }
      if (prior?.state === 'unknown') return result(planId, 'unknown', null, prior.errorCode);
      if (record.timelineModified) fail('review_required');
      const verifySources = async () => {
        const document = await deps.getDocument(root);
        return resolveCompositionSources({
          document, plan: record.manifest.plan,
          clipSelections: record.manifest.sources.segments.map((segment) => ({
            segmentId: segment.segmentId, receiptId: segment.clip.receiptId,
          })),
          context: input.context,
        }, { ...deps.sourceServices, nowIso: now });
      };
      const sources = await verifySources();
      const sourceHash = digestJson(sourceIdentity(sources));
      if (sourceHash !== digestJson(sourceIdentity(record.manifest.sources))) fail('source_changed');
      const timelineHash = digestJson(record.project.timeline);
      const fingerprint = digestJson({ plan: record.manifest.planSha256, timelineHash,
        exportConfig: input.exportConfig, sources: sourceIdentity(sources) });
      if (prior?.state === 'completed') {
        if (prior.inputFingerprint !== fingerprint) fail('input_changed');
        const outputPath = path.join(directory, prior.outputFile!);
        if (await hashFile(outputPath) !== prior.outputSha256) fail('output_conflict');
        return result(planId, 'completed', outputPath);
      }
      if (prior && (prior.state === 'failed' || prior.state === 'cancelled') && !input.retryFailed) {
        return result(planId, prior.state, null, prior.errorCode);
      }
      if (controller.signal.aborted) fail('render_cancelled');
      input.beforeCommit?.();
      const attemptId = randomUUID();
      pending = {
        schemaVersion: 1, batchId: input.batchId, planId, state: 'queued', attemptId,
        inputFingerprint: fingerprint, sourceIdentitySha256: sourceHash, timelineSha256: timelineHash,
        sources, createdAt: now(), updatedAt: now(), errorCode: null,
        outputSha256: null, outputFile: null,
      };
      await writeState(directory, pending);
      const release = await acquire(controller.signal);
      const tempFile = path.join(directory, `.render-${attemptId}.mp4`);
      try {
        if (controller.signal.aborted) fail('render_cancelled');
        // Queued work may wait while an authorization expires or media changes.
        const latestSources = await verifySources();
        if (digestJson(sourceIdentity(latestSources)) !== sourceHash) fail('source_changed');
        if (controller.signal.aborted) fail('render_cancelled');
        input.beforeCommit?.();
        pending = { ...pending, sources: latestSources, state: 'rendering', updatedAt: now() };
        await writeState(directory, pending);
        await render({ timeline: JSON.stringify(record.project.timeline), outputPath: tempFile,
          exportConfig: input.exportConfig }, { signal: controller.signal, frameConcurrency: 2 });
        if (controller.signal.aborted) fail('render_cancelled');
        const outputSha256 = await hashFile(tempFile);
        const outputFile = `render-${fingerprint}.mp4`;
        const outputPath = path.join(directory, outputFile);
        if (await statOrNull(outputPath)) fail('output_conflict');
        input.beforeCommit?.();
        await fs.link(tempFile, outputPath);
        linkedOutput = outputPath;
        input.beforeCommit?.();
        pending = { ...pending, state: 'completed', outputFile, outputSha256,
          errorCode: null, updatedAt: now() };
        await writeState(directory, pending);
        input.beforeCommit?.();
        linkedOutput = null;
        return result(planId, 'completed', path.join(directory, outputFile));
      } finally {
        try { await fs.rm(tempFile, { force: true }); }
        finally { release(); }
      }
    } catch (error) {
      if (linkedOutput) {
        await fs.rm(linkedOutput, { force: true }).catch(() => undefined);
      }
      const code = controller.signal.aborted ? 'render_cancelled' : safeCode(error);
      const state = code === 'render_cancelled' ? 'cancelled' : 'failed';
      if (directory && pending && (pending.state !== 'completed' || linkedOutput)) {
        await writeState(directory, { ...pending, state, updatedAt: now(), errorCode: code })
          .catch(() => undefined);
      }
      return result(planId, state, null, code);
    }
  }

  return {
    async run(input: CompositionRenderBatchInput): Promise<{ batchId: string; versions: CompositionRenderResult[] }> {
      if (!input || !validId(input.batchId) || !Array.isArray(input.planIds) || !input.planIds.length ||
          input.planIds.some((id) => !validId(id)) || new Set(input.planIds).size !== input.planIds.length ||
          !['source', '720p', '540p', '480p'].includes(input.exportConfig?.resolution) ||
          !['speed', 'balanced', 'quality'].includes(input.exportConfig?.quality)) fail('invalid_input');
      let root: string | null = null;
      for (const planId of input.planIds) {
        try {
          const record = await readCompositionVersion({ projectDir: input.projectDir,
            batchId: input.batchId, planId });
          root = path.resolve(record.projectDir, '..', '..', '..');
          break;
        } catch { /* An invalid version is isolated in processVersion. */ }
      }
      if (!root) fail('not_found');
      const verifiedRoot = root as string;
      const key = batchKey(verifiedRoot, input.batchId);
      if (activeBatches.has(key)) fail('batch_busy');
      let finish!: () => void;
      const settled = new Promise<void>((resolve) => { finish = resolve; });
      const active: ActiveBatch = { controller: new AbortController(), settled, finish };
      activeBatches.set(key, active);
      try {
        const versions = await Promise.all(input.planIds.map(async (id) => {
          const versionKey = `${key}/${id}`;
          activeVersions.add(versionKey);
          try { return await processVersion(input, id, verifiedRoot, active.controller); }
          finally { activeVersions.delete(versionKey); }
        }));
        return { batchId: input.batchId, versions };
      } finally {
        activeBatches.delete(key);
        active.finish();
      }
    },

    async read(location: CompositionVersionLocation): Promise<CompositionRenderState | null> {
      const record = await readCompositionVersion(location);
      const state = await readState(record.projectDir, location.batchId, location.planId);
      if (state?.state === 'completed' &&
          await hashFile(path.join(record.projectDir, state.outputFile!)) !== state.outputSha256) {
        fail('output_conflict');
      }
      if (!state || (state.state !== 'queued' && state.state !== 'rendering')) return state;
      const key = `${batchKey(path.resolve(record.projectDir, '..', '..', '..'), location.batchId)}/${location.planId}`;
      if (activeVersions.has(key)) return state;
      const unknown = { ...state, state: 'unknown' as const, errorCode: 'interrupted', updatedAt: now() };
      await writeState(record.projectDir, unknown);
      return unknown;
    },

    async cancel(projectDir: string, batchId: string): Promise<boolean> {
      if (!validId(batchId) || !path.isAbsolute(projectDir)) fail('invalid_input');
      const root = await fs.realpath(projectDir).catch(() => fail('unsafe_path'));
      const active = activeBatches.get(batchKey(root, batchId));
      if (!active) return false;
      active.controller.abort();
      await active.settled;
      return true;
    },
  };
}

/** Owner-window-only product bridge for existing, reviewed composition version projects. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readCompositionVersion } from './version-projects';
import type { createCompositionRenderBatch, CompositionRenderBatchInput } from './render-batch';
import type { createCompositionReview, HumanReviewDecision } from './review';
import type { CreateCompositionBatchInput } from './create-batch';
import type { AgentActionGateDecision } from '../production/agent-action-gate';

export const COMPOSITION_V1_CHANNELS = {
  list: 'composition-v1:list',
  open: 'composition-v1:open',
  render: 'composition-v1:render',
  cancel: 'composition-v1:cancel',
  analyze: 'composition-v1:analyze',
  review: 'composition-v1:review',
  resources: 'composition-v1:resources',
  create: 'composition-v1:create',
  prepareAgentBuild: 'composition-v1:prepare-agent-build',
  prepareAgentRender: 'composition-v1:prepare-agent-render',
  recommend: 'composition-v1:recommend',
} as const;

type Handler = (event: unknown, input?: unknown) => unknown;
type RenderBatch = ReturnType<typeof createCompositionRenderBatch>;
type Review = ReturnType<typeof createCompositionReview>;

export interface CompositionIpcOptions {
  ipc: { handle(channel: string, handler: Handler): void };
  allowedSender(event: unknown): boolean;
  activeProjectDir(): string | null;
  renderBatch: Pick<RenderBatch, 'run' | 'read' | 'cancel'>;
  review: Pick<Review, 'analyze' | 'recordDecision'>;
  resources: (projectDir: string) => Promise<{ receipts: Array<{ id: string; highlightId: string;
    startMs: number; endMs: number; topic: string }>; assets: Array<{
      id: string; description: string; mediaType: 'video' | 'image' }> }>;
  createBatch: (input: CreateCompositionBatchInput, beforePersist?: () => void) => Promise<{ batchId: string;
    plans: Array<{ planId: string; narrativeSummary: string; centralQuestion: string; segmentCount: number }>;
    reviewFlags: Array<{ planIds: [string, string]; reason: string }>; reviewRequired: true }>;
  authorizeAgentBuild: (projectDir: string) => AgentActionGateDecision;
  authorizeAgentRender: (projectDir: string) => AgentActionGateDecision;
  recommend: (query: string, context: CreateCompositionBatchInput['context']) => Promise<{
    status: 'ok' | 'no_eligible_assets' | 'index_unavailable';
    recommendations: Array<{ assetId: string; similarity: number; reasons: string[] }> }>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEVICE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const SAFE_CODES = new Set([
  'invalid_input', 'unsafe_path', 'not_found', 'corrupt', 'conflict', 'invalid_plan',
  'invalid_context', 'review_required', 'source_mismatch', 'clip_unavailable',
  'invalid_timecode', 'asset_unavailable', 'rights_blocked', 'media_changed',
  'batch_busy', 'render_failed', 'cancelled', 'unknown', 'output_conflict', 'source_changed',
  'unsafe_state', 'corrupt_state', 'unsafe_output', 'render_not_complete',
  'stale_evidence', 'duplicate_reviewer', 'invalid_decision', 'media_probe_failed',
  'ffmpeg_unavailable', 'unsafe_review_file', 'corrupt_review_file',
  'unsafe_project', 'conflicting_source', 'invalid_catalog',
  'model_unavailable', 'invalid_model_output', 'insufficient_plans', 'duplicate_plans',
  'source_unavailable', 'duplicate_receipt', 'unsupported_voiceover',
  'authorization_expired',
]);

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && !DEVICE.test(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 3 && value.length <= 12 &&
    value.every(validId) && new Set(value).size === value.length;
}
function code(error: unknown): string {
  const value = (error as { code?: unknown })?.code;
  return typeof value === 'string' && SAFE_CODES.has(value) ? value : 'internal_error';
}

async function batches(projectDir: string, renderBatch: CompositionIpcOptions['renderBatch']) {
  const directory = path.join(projectDir, 'compositions');
  let entry;
  try { entry = await fs.lstat(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw Object.assign(new Error('unsafe_path'), { code: 'unsafe_path' });
  const names = (await fs.readdir(directory)).filter(validId).sort();
  if (names.length > 100) throw Object.assign(new Error('invalid_input'), { code: 'invalid_input' });
  const result = [];
  for (const batchId of names) {
    const child = path.join(directory, batchId);
    const childEntry = await fs.lstat(child);
    if (!childEntry.isDirectory() || childEntry.isSymbolicLink()) {
      throw Object.assign(new Error('unsafe_path'), { code: 'unsafe_path' });
    }
    const planIds = (await fs.readdir(child)).filter(validId).sort();
    if (planIds.length > 12) throw Object.assign(new Error('invalid_input'), { code: 'invalid_input' });
    const versions = [];
    let context: { platform: string; region: string; commercialShortVideo: boolean } | null = null;
    let contextMismatch = false;
    for (const planId of planIds) {
      const location = { projectDir, batchId, planId };
      const version = await readCompositionVersion(location);
      const state = await renderBatch.read(location);
      const sourceContext = version.manifest.sources.context;
      const nextContext = { platform: sourceContext.platform, region: sourceContext.region,
        commercialShortVideo: sourceContext.commercialShortVideo };
      if (context && JSON.stringify(context) !== JSON.stringify(nextContext)) contextMismatch = true;
      context ??= nextContext;
      versions.push({ planId, narrativeSummary: version.manifest.plan.narrativeSummary,
        createdAt: version.manifest.createdAt, timelineModified: version.timelineModified,
        renderState: state?.state ?? null,
        renderError: state?.errorCode && SAFE_CODES.has(state.errorCode) ? state.errorCode : null,
        outputSha256: state?.state === 'completed' ? state.outputSha256 : null });
    }
    if (versions.length) result.push({ batchId, versions, context, contextMismatch });
  }
  return result;
}

function createInput(projectDir: string, input: unknown): CreateCompositionBatchInput | null {
  if (!object(input) || !Array.isArray(input.selectedReceipts) ||
      !Array.isArray(input.selectedAssets) ||
      !['16:9', '9:16', '1:1', '4:3', '3:4'].includes(input.aspectRatio as string) ||
      !['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'].includes(input.platform as string) ||
      typeof input.region !== 'string' || !/^[a-z]{2}$/.test(input.region) ||
      typeof input.commercialShortVideo !== 'boolean') return null;
  return { projectDir,
    aspectRatio: input.aspectRatio as CreateCompositionBatchInput['aspectRatio'],
    context: { platform: input.platform as CreateCompositionBatchInput['context']['platform'],
      region: input.region, commercialShortVideo: input.commercialShortVideo },
    selectedReceipts: input.selectedReceipts as CreateCompositionBatchInput['selectedReceipts'],
    selectedAssets: input.selectedAssets as CreateCompositionBatchInput['selectedAssets'] };
}

function renderInput(projectDir: string, input: unknown): CompositionRenderBatchInput | null {
  if (!object(input) || !validId(input.batchId) || !ids(input.planIds) ||
      !['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'].includes(input.platform as string) ||
      typeof input.region !== 'string' || !/^[a-z]{2}$/.test(input.region) ||
      typeof input.commercialShortVideo !== 'boolean' ||
      !['source', '720p', '540p', '480p'].includes(input.resolution as string) ||
      !['speed', 'balanced', 'quality'].includes(input.quality as string) ||
      (input.retryFailed !== undefined && typeof input.retryFailed !== 'boolean')) return null;
  return { projectDir, batchId: input.batchId, planIds: [...input.planIds],
    exportConfig: { resolution: input.resolution as CompositionRenderBatchInput['exportConfig']['resolution'],
      quality: input.quality as CompositionRenderBatchInput['exportConfig']['quality'] },
    context: { platform: input.platform as CompositionRenderBatchInput['context']['platform'],
      region: input.region, commercialShortVideo: input.commercialShortVideo },
    retryFailed: input.retryFailed as boolean | undefined };
}

export interface PreparedCompositionAgentBridge {
  build(): Promise<{ ok: true; batchId: string; planIds: string[] } | { ok: false; code: string }>;
  render(): Promise<{ ok: true; batchId: string; versions: Array<{ planId: string; state: string;
    reviewRequired: true; errorCode: string | null }> } | { ok: false; code: string }>;
  clear(): void;
}

export function registerCompositionIpc(options: CompositionIpcOptions): PreparedCompositionAgentBridge {
  let prepared: CreateCompositionBatchInput | null = null;
  let preparedRender: CompositionRenderBatchInput | null = null;
  let running = false;
  let runningRender = false;
  let activeRender: { projectDir: string; batchId: string } | null = null;
  let generation = 0;
  const clear = () => {
    prepared = null; preparedRender = null; generation += 1;
    if (activeRender) void options.renderBatch.cancel(activeRender.projectDir, activeRender.batchId)
      .catch(() => undefined);
  };
  const authorized = (projectDir: string) => options.authorizeAgentBuild(projectDir).allowed;
  const renderAuthorized = (projectDir: string) => options.authorizeAgentRender(projectDir).allowed;
  const bridge: PreparedCompositionAgentBridge = {
    clear,
    async render() {
      if (runningRender) return { ok: false, code: 'batch_busy' };
      const input = preparedRender;
      preparedRender = null;
      if (!input) return { ok: false, code: 'not_prepared' };
      if (options.activeProjectDir() !== input.projectDir || !renderAuthorized(input.projectDir)) {
        return { ok: false, code: 'authorization_expired' };
      }
      const activeGeneration = generation;
      const beforeCommit = () => {
        if (generation !== activeGeneration || options.activeProjectDir() !== input.projectDir ||
            !renderAuthorized(input.projectDir)) {
          throw Object.assign(new Error('authorization_expired'), { code: 'authorization_expired' });
        }
      };
      runningRender = true;
      activeRender = { projectDir: input.projectDir, batchId: input.batchId };
      try {
        const done = await options.renderBatch.run({ ...input, beforeCommit });
        beforeCommit();
        return { ok: true, batchId: done.batchId, versions: done.versions.map((version) => ({
          planId: version.planId, state: version.state, reviewRequired: true as const,
          errorCode: version.errorCode && SAFE_CODES.has(version.errorCode) ? version.errorCode : null,
        })) };
      } catch (error) { return { ok: false, code: code(error) }; }
      finally { runningRender = false; activeRender = null; }
    },
    async build() {
      if (running) return { ok: false, code: 'batch_busy' };
      const input = prepared;
      prepared = null; // One trigger, including a failed or concurrent trigger.
      if (!input) return { ok: false, code: 'not_prepared' };
      if (options.activeProjectDir() !== input.projectDir || !authorized(input.projectDir)) {
        return { ok: false, code: 'authorization_expired' };
      }
      const activeGeneration = generation;
      const beforePersist = () => {
        if (generation !== activeGeneration || options.activeProjectDir() !== input.projectDir ||
            !authorized(input.projectDir)) {
          throw Object.assign(new Error('authorization_expired'), { code: 'authorization_expired' });
        }
      };
      running = true;
      try {
        const result = await options.createBatch(input, beforePersist);
        return { ok: true, batchId: result.batchId, planIds: result.plans.map((plan) => plan.planId) };
      } catch (error) { return { ok: false, code: code(error) }; }
      finally { running = false; }
    },
  };
  const handle = (channel: string, operation: (projectDir: string, input: unknown) => Promise<unknown>) => {
    options.ipc.handle(channel, async (event, input) => {
      if (!options.allowedSender(event)) return { ok: false, code: 'forbidden' };
      const projectDir = options.activeProjectDir();
      if (!projectDir) return { ok: false, code: 'no_project' };
      try { return await operation(projectDir, input); }
      catch (error) { return { ok: false, code: code(error) }; }
    });
  };

  handle(COMPOSITION_V1_CHANNELS.list, async (projectDir) =>
    ({ ok: true, batches: await batches(projectDir, options.renderBatch) }));

  handle(COMPOSITION_V1_CHANNELS.open, async (projectDir, input) => {
    if (!object(input) || !validId(input.batchId) || !validId(input.planId)) {
      return { ok: false, code: 'invalid_input' };
    }
    const version = await readCompositionVersion({ projectDir, batchId: input.batchId, planId: input.planId });
    return { ok: true, projectDir: version.projectDir, timelineModified: version.timelineModified };
  });

  handle(COMPOSITION_V1_CHANNELS.render, async (projectDir, input) => {
    const selected = renderInput(projectDir, input);
    if (!selected) return { ok: false, code: 'invalid_input' };
    const result = await options.renderBatch.run(selected);
    return { ok: true, batchId: result.batchId, versions: result.versions.map((version) => ({
      planId: version.planId, state: version.state, reviewRequired: true,
      errorCode: version.errorCode && SAFE_CODES.has(version.errorCode) ? version.errorCode : null,
    })) };
  });

  handle(COMPOSITION_V1_CHANNELS.prepareAgentRender, async (projectDir, input) => {
    preparedRender = null;
    if (runningRender) return { ok: false, code: 'batch_busy' };
    if (!object(input) || input.approvedForRender !== true) return { ok: false, code: 'invalid_input' };
    const selected = renderInput(projectDir, input);
    if (!selected) return { ok: false, code: 'invalid_input' };
    if (!renderAuthorized(projectDir)) return { ok: false, code: 'authorization_expired' };
    preparedRender = selected;
    return { ok: true, prepared: true };
  });

  handle(COMPOSITION_V1_CHANNELS.cancel, async (projectDir, input) => {
    if (!object(input) || !validId(input.batchId)) return { ok: false, code: 'invalid_input' };
    return { ok: true, cancelled: await options.renderBatch.cancel(projectDir, input.batchId) };
  });

  handle(COMPOSITION_V1_CHANNELS.analyze, async (projectDir, input) => {
    if (!object(input) || !validId(input.batchId) || !ids(input.planIds)) {
      return { ok: false, code: 'invalid_input' };
    }
    return { ok: true, report: await options.review.analyze(projectDir, input.batchId, input.planIds) };
  });

  handle(COMPOSITION_V1_CHANNELS.review, async (projectDir, input) => {
    if (!object(input) || !validId(input.batchId) || !object(input.decision)) {
      return { ok: false, code: 'invalid_input' };
    }
    return { ok: true, result: await options.review.recordDecision(projectDir, input.batchId,
      input.decision as unknown as Omit<HumanReviewDecision, 'submittedAt'>) };
  });

  handle(COMPOSITION_V1_CHANNELS.resources, async (projectDir) =>
    ({ ok: true, ...(await options.resources(projectDir)) }));

  handle(COMPOSITION_V1_CHANNELS.create, async (projectDir, input) => {
    const selected = createInput(projectDir, input);
    if (!selected) return { ok: false, code: 'invalid_input' };
    const result = await options.createBatch(selected);
    return { ok: true, ...result };
  });

  handle(COMPOSITION_V1_CHANNELS.prepareAgentBuild, async (projectDir, input) => {
    if (running) return { ok: false, code: 'batch_busy' };
    clear();
    if (!object(input) || input.approvedForModel !== true) {
      return { ok: false, code: 'invalid_input' };
    }
    const selected = createInput(projectDir, input);
    if (!selected || selected.selectedReceipts.length < 1 || selected.selectedReceipts.length > 12 ||
        selected.selectedAssets.length > 12 ||
        selected.selectedReceipts.some((item) => !object(item) ||
          typeof item.receiptId !== 'string' || !/^hclip_[a-f0-9]{64}$/.test(item.receiptId) ||
          typeof item.anonymousTopic !== 'string' || !item.anonymousTopic.trim() ||
          item.anonymousTopic.length > 500 || item.approvedTranscriptExcerpt !== null) ||
        selected.selectedAssets.some((item) => !object(item) ||
          typeof item.assetId !== 'string' || !/^asset_[a-f0-9]{64}$/.test(item.assetId) ||
          typeof item.anonymousDescription !== 'string' || !item.anonymousDescription.trim() ||
          item.anonymousDescription.length > 500) ||
        new Set(selected.selectedReceipts.map((item) => item.receiptId)).size !== selected.selectedReceipts.length ||
        new Set(selected.selectedAssets.map((item) => item.assetId)).size !== selected.selectedAssets.length) {
      return { ok: false, code: 'invalid_input' };
    }
    if (!authorized(projectDir)) return { ok: false, code: 'authorization_expired' };
    const available = await options.resources(projectDir);
    const receiptIds = new Set(available.receipts.map((item) => item.id));
    const assetIds = new Set(available.assets.map((item) => item.id));
    if (selected.selectedReceipts.some((item) => !receiptIds.has(item.receiptId)) ||
        selected.selectedAssets.some((item) => !assetIds.has(item.assetId))) {
      return { ok: false, code: 'source_unavailable' };
    }
    if (options.activeProjectDir() !== projectDir || !authorized(projectDir)) {
      return { ok: false, code: 'authorization_expired' };
    }
    prepared = { ...selected,
      selectedReceipts: selected.selectedReceipts.map((item) => ({ ...item })),
      selectedAssets: selected.selectedAssets.map((item) => ({ ...item })) };
    return { ok: true, prepared: true };
  });

  handle(COMPOSITION_V1_CHANNELS.recommend, async (_projectDir, input) => {
    if (!object(input) || typeof input.query !== 'string' ||
        !input.query.trim() || input.query.length > 2000 ||
        !['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'].includes(input.platform as string) ||
        typeof input.region !== 'string' || !/^[a-z]{2}$/.test(input.region) ||
        typeof input.commercialShortVideo !== 'boolean') {
      return { ok: false, code: 'invalid_input' };
    }
    return { ok: true, ...(await options.recommend(input.query, {
      platform: input.platform as CreateCompositionBatchInput['context']['platform'],
      region: input.region, commercialShortVideo: input.commercialShortVideo,
    })) };
  });
  return bridge;
}

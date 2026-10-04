/** Main-process preparation for account-v2 × reviewed composition version drafts. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { COMMERCE_KINDS, type CommerceRequestV1 } from '../../src/types/production-contracts';
import type { createCompositionReview } from '../composition/review';
import type { DurablePublishQueue, PublishMatrixInput, QueueJobMetadata,
  QueuePlatform } from './durable-queue';
import type { AccountVaultPlatform, AccountVaultStatus } from './accounts-v2';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const PREFIX = 'composition-v1:';
const platforms: Record<AccountVaultPlatform, QueuePlatform> = {
  douyin: 'douyin', kuaishou: 'kuaishou', tencent: 'wechat-channels',
  xiaohongshu: 'xiaohongshu',
};

export type ProductPublishDraftErrorCode = 'invalid_input' | 'no_project' |
  'account_missing' | 'account_not_ready' | 'platform_mismatch' | 'review_not_ready' |
  'video_ref_invalid' | 'video_ref_changed' | 'draft_not_found' | 'draft_not_cancellable';

export class ProductPublishDraftError extends Error {
  constructor(readonly code: ProductPublishDraftErrorCode) {
    super(code);
    this.name = 'ProductPublishDraftError';
  }
}

export interface ProductPublishDraftAssignment {
  accountId: string;
  batchId: string;
  planId: string;
  metadata: QueueJobMetadata;
  commerceRequest: CommerceRequestV1 | null;
}

export interface ProductPublishDraftDeps {
  activeProjectDir(): string | null;
  accounts: { getAccount(id: string): { id: string; platform: AccountVaultPlatform;
    status: AccountVaultStatus; sessionRef: string | null } };
  review: Pick<ReturnType<typeof createCompositionReview>, 'readPassingReviewEvidence'>;
  queue: Pick<DurablePublishQueue, 'enqueueDraftMatrices' | 'list' | 'get' | 'cancel'>;
}

export interface ProductPublishDraftPreview {
  entries: Array<{ accountId: string; platform: QueuePlatform; batchId: string;
    planId: string; videoVariantId: string; outputSha256: string; commerceBlocked: boolean }>;
  duplicateVersionRisks: Array<{ batchId: string; planId: string; accountIds: string[] }>;
}

/** Renderer-safe projection; no videoRef, account session, project path or queue internals. */
export interface ProductPublishDraftDto {
  taskId: string;
  accountId: string;
  platform: QueuePlatform;
  batchId: string;
  planId: string;
  title: string;
  createdAt: number;
}

type VideoRef = { schemaVersion: 1; projectDir: string; batchId: string; planId: string;
  outputSha256: string; evidenceSha256: string; videoVariantId: string };

function fail(code: ProductPublishDraftErrorCode): never { throw new ProductPublishDraftError(code); }
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const keysExactly = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizedPath = (value: string) => process.platform === 'win32'
  ? path.resolve(value).toLowerCase() : path.resolve(value);

function variantId(projectDir: string, batchId: string, planId: string): string {
  return `compv1_${sha256(`${normalizedPath(projectDir)}\u0000${batchId}\u0000${planId}`)}`;
}

function activeProject(deps: ProductPublishDraftDeps): string {
  const projectDir = deps.activeProjectDir();
  if (!projectDir || !path.isAbsolute(projectDir)) fail('no_project');
  return projectDir;
}

function metadataOf(value: unknown): QueueJobMetadata {
  if (!record(value) || !keysExactly(value, ['title', 'description', 'tags', 'coverRefs', 'scheduleAt']) ||
      typeof value.title !== 'string' || !value.title.trim() ||
      typeof value.description !== 'string' ||
      !Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string' || !tag.trim()) ||
      !Array.isArray(value.coverRefs) || value.coverRefs.some((ref) => typeof ref !== 'string' || !ref.trim()) ||
      (value.scheduleAt !== null && (typeof value.scheduleAt !== 'number' ||
        !Number.isFinite(value.scheduleAt) || value.scheduleAt < 0))) fail('invalid_input');
  return { title: value.title, description: value.description,
    tags: [...value.tags], coverRefs: [...value.coverRefs], scheduleAt: value.scheduleAt };
}

function commerceOf(value: unknown, accountId: string, platform: QueuePlatform): CommerceRequestV1 | null {
  if (value === null) return null;
  if (!record(value) || !keysExactly(value,
    ['platform', 'accountId', 'kind', 'platformProductId', 'required']) ||
      value.platform !== platform || value.accountId !== accountId ||
      typeof value.kind !== 'string' || !(COMMERCE_KINDS as readonly string[]).includes(value.kind) ||
      typeof value.platformProductId !== 'string' || !value.platformProductId.trim() ||
      typeof value.required !== 'boolean') fail('invalid_input');
  return value as unknown as CommerceRequestV1;
}

function decodeVideoRef(value: unknown): VideoRef {
  if (typeof value !== 'string' || !value.startsWith(PREFIX) || value.length > 4096) fail('video_ref_invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value.slice(PREFIX.length), 'base64url').toString('utf8')); }
  catch { fail('video_ref_invalid'); }
  if (!record(parsed) || !keysExactly(parsed,
    ['schemaVersion', 'projectDir', 'batchId', 'planId', 'outputSha256', 'evidenceSha256', 'videoVariantId']) ||
      parsed.schemaVersion !== 1 || typeof parsed.projectDir !== 'string' ||
      !path.isAbsolute(parsed.projectDir) || !validId(parsed.batchId) || !validId(parsed.planId) ||
      typeof parsed.outputSha256 !== 'string' || !SHA.test(parsed.outputSha256) ||
      typeof parsed.evidenceSha256 !== 'string' || !SHA.test(parsed.evidenceSha256) ||
      parsed.videoVariantId !== variantId(parsed.projectDir, parsed.batchId, parsed.planId)) {
    fail('video_ref_invalid');
  }
  return parsed as VideoRef;
}

export function createProductPublishDraftService(deps: ProductPublishDraftDeps) {
  async function prepare(input: unknown): Promise<{ matrices: PublishMatrixInput[];
    preview: ProductPublishDraftPreview }> {
    const projectDir = activeProject(deps);
    if (!Array.isArray(input) || input.length < 1 || input.length > 1000) fail('invalid_input');
    const seenAccounts = new Set<string>();
    const matrices: PublishMatrixInput[] = [];
    const entries: ProductPublishDraftPreview['entries'] = [];
    const byVersion = new Map<string, string[]>();
    for (const raw of input) {
      if (!record(raw) || !keysExactly(raw,
        ['accountId', 'batchId', 'planId', 'metadata', 'commerceRequest']) ||
          typeof raw.accountId !== 'string' || !raw.accountId.trim() ||
          !validId(raw.batchId) || !validId(raw.planId) ||
          seenAccounts.has(raw.accountId)) fail('invalid_input');
      seenAccounts.add(raw.accountId);
      const metadata = metadataOf(raw.metadata);
      let account: ReturnType<ProductPublishDraftDeps['accounts']['getAccount']>;
      try { account = deps.accounts.getAccount(raw.accountId); }
      catch { fail('account_missing'); }
      if (account.id !== raw.accountId || !own(platforms, account.platform)) fail('account_missing');
      const platform = platforms[account.platform];
      if (account.status !== 'valid' || !account.sessionRef) fail('account_not_ready');
      const commerceRequest = commerceOf(raw.commerceRequest, account.id, platform);
      let evidence: Awaited<ReturnType<ProductPublishDraftDeps['review']['readPassingReviewEvidence']>>;
      try { evidence = await deps.review.readPassingReviewEvidence(projectDir, raw.batchId, raw.planId); }
      catch { fail('review_not_ready'); }
      if (evidence.batchId !== raw.batchId || evidence.planId !== raw.planId ||
          !SHA.test(evidence.outputSha256) || !SHA.test(evidence.evidenceSha256)) fail('review_not_ready');
      if (evidence.platform !== platform) fail('platform_mismatch');
      const videoVariantId = variantId(projectDir, raw.batchId, raw.planId);
      const ref: VideoRef = { schemaVersion: 1, projectDir: path.resolve(projectDir),
        batchId: raw.batchId, planId: raw.planId, outputSha256: evidence.outputSha256,
        evidenceSha256: evidence.evidenceSha256, videoVariantId };
      matrices.push({ videoVariantId, videoRef: `${PREFIX}${Buffer.from(JSON.stringify(ref)).toString('base64url')}`,
        metadata, accounts: [{ accountId: account.id, platform }], commerceRequest });
      entries.push({ accountId: account.id, platform, batchId: raw.batchId,
        planId: raw.planId, videoVariantId, outputSha256: evidence.outputSha256,
        commerceBlocked: commerceRequest !== null });
      const group = `${raw.batchId}\u0000${raw.planId}`;
      byVersion.set(group, [...(byVersion.get(group) ?? []), account.id]);
    }
    const duplicateVersionRisks = [...byVersion].filter(([, accounts]) => accounts.length > 1)
      .map(([group, accountIds]) => {
        const [batchId, planId] = group.split('\u0000');
        return { batchId, planId, accountIds };
      });
    return { matrices, preview: { entries, duplicateVersionRisks } };
  }

  return {
    async listDrafts(): Promise<ProductPublishDraftDto[]> {
      const projectDir = activeProject(deps);
      return deps.queue.list().flatMap((task) => {
        if (task.state !== 'draft' || !task.videoRef.startsWith(PREFIX)) return [];
        try {
          const ref = decodeVideoRef(task.videoRef);
          if (normalizedPath(ref.projectDir) !== normalizedPath(projectDir) ||
              task.videoVariantId !== ref.videoVariantId) return [];
          return [{ taskId: task.id, accountId: task.accountId, platform: task.platform,
            batchId: ref.batchId, planId: ref.planId,
            title: task.metadata.title, createdAt: task.createdAt }];
        } catch { return []; }
      });
    },
    async cancelDraft(input: unknown): Promise<boolean> {
      if (!record(input) || !keysExactly(input, ['taskId']) ||
          typeof input.taskId !== 'string' || !/^pubjob_[a-f0-9]{24}$/.test(input.taskId)) {
        fail('invalid_input');
      }
      const projectDir = activeProject(deps);
      const task = deps.queue.get(input.taskId);
      if (!task || !task.videoRef.startsWith(PREFIX)) fail('draft_not_found');
      let ref: VideoRef;
      try { ref = decodeVideoRef(task.videoRef); }
      catch { fail('draft_not_found'); }
      if (normalizedPath(ref.projectDir) !== normalizedPath(projectDir) ||
          task.videoVariantId !== ref.videoVariantId) fail('draft_not_found');
      if (task.state !== 'draft') fail('draft_not_cancellable');
      return deps.queue.cancel(task.id);
    },
    async preview(input: unknown): Promise<ProductPublishDraftPreview> {
      return (await prepare(input)).preview;
    },
    async stage(input: unknown): Promise<{ created: number; existing: number;
      preview: ProductPublishDraftPreview }> {
      const prepared = await prepare(input);
      const result = deps.queue.enqueueDraftMatrices(prepared.matrices);
      return { created: result.created.length, existing: result.existing.length,
        preview: prepared.preview };
    },
    async resolveVideoRef(videoRef: string, context: { accountId: string; platform: QueuePlatform;
      videoVariantId: string }): Promise<string> {
      const ref = decodeVideoRef(videoRef);
      if (context.videoVariantId !== ref.videoVariantId) fail('video_ref_invalid');
      const activeProject = deps.activeProjectDir();
      if (!activeProject || normalizedPath(activeProject) !== normalizedPath(ref.projectDir)) fail('no_project');
      let account: ReturnType<ProductPublishDraftDeps['accounts']['getAccount']>;
      try { account = deps.accounts.getAccount(context.accountId); }
      catch { fail('account_missing'); }
      if (account.id !== context.accountId || !own(platforms, account.platform) ||
          platforms[account.platform] !== context.platform) fail('platform_mismatch');
      if (account.status !== 'valid' || !account.sessionRef) fail('account_not_ready');
      let evidence: Awaited<ReturnType<ProductPublishDraftDeps['review']['readPassingReviewEvidence']>>;
      try { evidence = await deps.review.readPassingReviewEvidence(ref.projectDir, ref.batchId, ref.planId); }
      catch { fail('review_not_ready'); }
      if (evidence.platform !== context.platform || evidence.outputSha256 !== ref.outputSha256 ||
          evidence.evidenceSha256 !== ref.evidenceSha256) fail('video_ref_changed');
      return evidence.outputPath;
    },
  };
}

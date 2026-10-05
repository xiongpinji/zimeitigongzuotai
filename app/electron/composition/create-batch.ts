/** Turn model proposals over explicitly approved inputs into independent editable projects. */
import type { ProductionDocumentV1, ProductionAspectRatio } from '../../src/types/production-contracts';
import type { AssetUsageContext } from '../assets/asset-rights';
import { proposePlans, type CompositionProposalBrief } from './plan-proposals';
import { resolveCompositionSources, type CompositionSourceServices } from './source-resolver';
import { buildCompositionTimeline } from './timeline-builder';
import { persistCompositionVersions } from './version-projects';

export interface CreateCompositionBatchInput {
  projectDir: string;
  aspectRatio: ProductionAspectRatio;
  context: Omit<AssetUsageContext, 'usedAt'>;
  selectedReceipts: Array<{ receiptId: string; anonymousTopic: string;
    approvedTranscriptExcerpt: string | null }>;
  selectedAssets: Array<{ assetId: string; anonymousDescription: string }>;
}

export interface CreateCompositionBatchDeps {
  getDocument: (projectDir: string) => Promise<ProductionDocumentV1>;
  sourceServices: CompositionSourceServices;
  generate: (brief: CompositionProposalBrief) => Promise<unknown>;
  model: string;
  promptVersion: string;
  nowIso?: () => string;
  /** Recheck the current project and grant after the asynchronous model and source checks. */
  beforePersist?: () => void;
}

export class CreateCompositionBatchError extends Error {
  constructor(readonly code: 'invalid_input' | 'duplicate_receipt' | 'source_unavailable') {
    super(code); this.name = 'CreateCompositionBatchError';
  }
}

const RECEIPT = /^hclip_[a-f0-9]{64}$/;
const ASSET = /^asset_[a-f0-9]{64}$/;
const shortText = (value: unknown) => typeof value === 'string' &&
  value.trim().length > 0 && value.length <= 500;

export function createCompositionBatch(deps: CreateCompositionBatchDeps) {
  return async (input: CreateCompositionBatchInput) => {
    if (!input || !Array.isArray(input.selectedReceipts) ||
        input.selectedReceipts.length < 1 || input.selectedReceipts.length > 12 ||
        input.selectedReceipts.some((item) => !item || !RECEIPT.test(item.receiptId) ||
          !shortText(item.anonymousTopic) ||
          !(item.approvedTranscriptExcerpt === null || shortText(item.approvedTranscriptExcerpt))) ||
        new Set(input.selectedReceipts.map((item) => item.receiptId)).size !== input.selectedReceipts.length ||
        !Array.isArray(input.selectedAssets) || input.selectedAssets.length > 12 ||
        input.selectedAssets.some((item) => !item || !ASSET.test(item.assetId) ||
          !shortText(item.anonymousDescription)) ||
        new Set(input.selectedAssets.map((item) => item.assetId)).size !== input.selectedAssets.length) {
      throw new CreateCompositionBatchError('invalid_input');
    }
    const document = await deps.getDocument(input.projectDir);
    const receipts = new Map<string, string>();
    const approvedHighlights = [];
    for (const item of input.selectedReceipts) {
      let verified: Awaited<ReturnType<CompositionSourceServices['exporter']['verifiedOutput']>>;
      try { verified = await deps.sourceServices.exporter.verifiedOutput(item.receiptId); }
      catch { throw new CreateCompositionBatchError('source_unavailable'); }
      if (receipts.has(verified.receipt.highlightId)) throw new CreateCompositionBatchError('duplicate_receipt');
      receipts.set(verified.receipt.highlightId, item.receiptId);
      approvedHighlights.push({ id: verified.receipt.highlightId,
        anonymousTopic: item.anonymousTopic,
        approvedTranscriptExcerpt: item.approvedTranscriptExcerpt });
    }
    for (const item of input.selectedAssets) {
      try { await deps.sourceServices.library.verifiedForUsage(item.assetId, {
        ...input.context, usedAt: deps.sourceServices.nowIso(),
      }); }
      catch { throw new CreateCompositionBatchError('source_unavailable'); }
    }
    const proposal = await proposePlans({ document, approvedHighlights,
      approvedAssets: input.selectedAssets.map((item) => ({ id: item.assetId,
        anonymousDescription: item.anonymousDescription })),
      aspectRatio: input.aspectRatio, model: deps.model, promptVersion: deps.promptVersion,
      nowIso: deps.nowIso?.() ?? new Date().toISOString(),
    }, deps.generate);
    const versions = [];
    for (const plan of proposal.plans) {
      const sources = await resolveCompositionSources({ document, plan,
        clipSelections: plan.segments.map((segment) => ({ segmentId: segment.id,
          receiptId: receipts.get(segment.source.sourceId) ?? '' })),
        context: input.context,
      }, deps.sourceServices);
      versions.push({ plan, sources, timeline: buildCompositionTimeline(plan, sources) });
    }
    deps.beforePersist?.();
    await persistCompositionVersions({ projectDir: input.projectDir, batchId: proposal.batchId,
      versions, beforeCommit: deps.beforePersist });
    return { batchId: proposal.batchId,
      plans: proposal.plans.map((plan) => ({ planId: plan.id,
        narrativeSummary: plan.narrativeSummary, centralQuestion: plan.editorial!.centralQuestion,
        segmentCount: plan.segments.length })),
      reviewFlags: proposal.reviewFlags, reviewRequired: true as const };
  };
}

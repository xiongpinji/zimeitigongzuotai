/** Resolve R4 plans only from verified reviewed clips and the rights-gated local asset store. */
import { isDeepStrictEqual } from 'node:util';
import { parseProductionDocument } from '../../src/lib/production-document';
import type {
  CompositionPlanV1, ProductionDocumentV1,
} from '../../src/types/production-contracts';
import {
  evaluateAssetEligibility, validateAssetUsageContext, type AssetUsageContext,
} from '../assets/asset-rights';
import type { LocalAssetLibrary } from '../assets/local-asset-library';
import type { ProductHighlightController } from '../highlights/product-highlight-controller';
import type { ReviewedClipExporter } from '../highlights/reviewed-clip-exporter';

export type CompositionSourceErrorCode =
  | 'invalid_plan' | 'invalid_context' | 'review_required' | 'source_mismatch' | 'clip_unavailable'
  | 'invalid_timecode' | 'asset_unavailable' | 'rights_blocked' | 'media_changed';

export class CompositionSourceError extends Error {
  constructor(readonly code: CompositionSourceErrorCode) {
    super(code);
    this.name = 'CompositionSourceError';
  }
}

export interface CompositionSourceServices {
  /** Main-process clock; callers cannot backdate rights checks. */
  nowIso: () => string;
  controller: Pick<ProductHighlightController, 'list' | 'readArtifact'>;
  exporter: Pick<ReviewedClipExporter, 'verifiedOutput'>;
  library: Pick<LocalAssetLibrary, 'get' | 'verifiedForUsage'>;
}

export interface CompositionSourceInput {
  document: ProductionDocumentV1;
  plan: CompositionPlanV1;
  /** One reviewed output per plan segment; no renderer-supplied media path. */
  clipSelections: Array<{ segmentId: string; receiptId: string }>;
  context: Omit<AssetUsageContext, 'usedAt'>;
}

export interface ResolvedCompositionSegment {
  segmentId: string;
  order: number;
  clip: {
    path: string;
    receiptId: string;
    highlightId: string;
    recordingId: string;
    sourceSha256: string;
    outputSha256: string;
    absoluteInMs: number;
    absoluteOutMs: number;
    sourceInMs: number;
    sourceOutMs: number;
    outputDurationMs: number;
    reviewedAt: string;
  };
  visualLayer: null | {
    path: string;
    assetId: string;
    sha256: string;
    mediaType: 'video' | 'image';
    sourceInMs: number;
    startAtMs: number;
    durationMs: number;
    purpose: string;
    evidenceRefs: string[];
    grantValidFrom: string | null;
    grantValidUntil: string | null;
  };
}

export interface ResolvedCompositionSources {
  planId: string;
  context: AssetUsageContext;
  segments: ResolvedCompositionSegment[];
}

function fail(code: CompositionSourceErrorCode): never {
  throw new CompositionSourceError(code);
}

function validatedPlan(input: CompositionSourceInput): {
  document: ProductionDocumentV1;
  plan: CompositionPlanV1;
} {
  try {
    const document = parseProductionDocument(input.document);
    const existing = document.compositionPlans.find((candidate) => candidate.id === input.plan.id);
    if (existing && !isDeepStrictEqual(existing, input.plan)) fail('invalid_plan');
    const checked = existing ? document : parseProductionDocument({
      ...document, compositionPlans: [...document.compositionPlans, input.plan],
    });
    const plan = checked.compositionPlans.find((candidate) => candidate.id === input.plan.id);
    if (!plan || !plan.editorial || plan.segments.length === 0
      || plan.segments.some((segment) => !segment.editorial || segment.source.kind !== 'highlight')) {
      fail('invalid_plan');
    }
    if (new Set(plan.segments.map((segment) => segment.order)).size !== plan.segments.length) {
      fail('invalid_plan');
    }
    return { document: checked, plan };
  } catch (error) {
    if (error instanceof CompositionSourceError) throw error;
    fail('invalid_plan');
  }
}

/** Call again immediately before timeline creation and rendering; paths are main-process-only. */
export async function resolveCompositionSources(
  input: CompositionSourceInput,
  services: CompositionSourceServices,
): Promise<ResolvedCompositionSources> {
  const { document, plan } = validatedPlan(input);
  let context: AssetUsageContext;
  try { context = validateAssetUsageContext({ ...input.context, usedAt: services.nowIso() }); }
  catch { fail('invalid_context'); }
  if (!Array.isArray(input.clipSelections)) fail('invalid_plan');
  const bySegment = new Map<string, string>();
  for (const selection of input.clipSelections) {
    if (!selection || typeof selection.segmentId !== 'string'
      || typeof selection.receiptId !== 'string' || bySegment.has(selection.segmentId)) {
      fail('invalid_plan');
    }
    bySegment.set(selection.segmentId, selection.receiptId);
  }
  if (bySegment.size !== plan.segments.length
    || plan.segments.some((segment) => !bySegment.has(segment.id))) {
    fail('review_required');
  }
  const recordings = new Map(document.recordings.map((recording) => [recording.id, recording]));
  const highlights = new Map(document.highlights.map((highlight) => [highlight.id, highlight]));
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const segments: ResolvedCompositionSegment[] = [];

  for (const segment of plan.segments.slice().sort((left, right) => left.order - right.order)) {
    let verified: Awaited<ReturnType<CompositionSourceServices['exporter']['verifiedOutput']>>;
    try { verified = await services.exporter.verifiedOutput(bySegment.get(segment.id)!); }
    catch { fail('clip_unavailable'); }
    const { path, receipt } = verified;
    if (receipt.id !== bySegment.get(segment.id) || receipt.highlightId !== segment.source.sourceId) {
      fail('source_mismatch');
    }
    let tasks: ReturnType<CompositionSourceServices['controller']['list']>;
    try { tasks = services.controller.list(); }
    catch { fail('source_mismatch'); }
    const task = tasks.find((item) => item.id === receipt.taskId);
    let artifact: ReturnType<CompositionSourceServices['controller']['readArtifact']>;
    try { artifact = services.controller.readArtifact(receipt.taskId); }
    catch { fail('source_mismatch'); }
    const highlight = artifact?.highlights.find((item) => item.id === receipt.highlightId);
    const declaredHighlight = highlights.get(receipt.highlightId);
    const recording = recordings.get(receipt.recordingId);
    if (!task || task.state !== 'completed' || !artifact || !highlight || !declaredHighlight || !recording
      || artifact.taskId !== receipt.taskId
      || !artifact.highlightIds.includes(receipt.highlightId)
      || highlight.recordingId !== receipt.recordingId
      || declaredHighlight.recordingId !== highlight.recordingId
      || declaredHighlight.startMs !== highlight.startMs
      || declaredHighlight.endMs !== highlight.endMs
      || receipt.startMs < highlight.startMs || receipt.endMs > highlight.endMs
      || task.recording.id !== receipt.recordingId
      || task.recording.sourceSha256.toLowerCase() !== receipt.sourceSha256.toLowerCase()
      || task.sourceSha256.toLowerCase() !== receipt.sourceSha256.toLowerCase()
      || recording.sourceSha256.toLowerCase() !== receipt.sourceSha256.toLowerCase()) {
      fail('source_mismatch');
    }
    if (segment.source.inMs < receipt.startMs || segment.source.outMs > receipt.endMs) {
      fail('invalid_timecode');
    }
    const sourceInMs = segment.source.inMs - receipt.startMs;
    const sourceOutMs = segment.source.outMs - receipt.startMs;
    if (sourceOutMs > receipt.outputDurationMs) fail('invalid_timecode');

    let visualLayer: ResolvedCompositionSegment['visualLayer'] = null;
    if (segment.visualLayer) {
      const layer = segment.visualLayer;
      const declared = assets.get(layer.assetId);
      if (!declared) fail('asset_unavailable');
      let assetPath: string;
      try { assetPath = await services.library.verifiedForUsage(layer.assetId, { ...context }); }
      catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === 'rights_blocked') fail('rights_blocked');
        if (code === 'media_changed') fail('media_changed');
        fail('asset_unavailable');
      }
      let record: ReturnType<CompositionSourceServices['library']['get']>;
      try { record = services.library.get(layer.assetId); }
      catch { fail('asset_unavailable'); }
      if (!record) fail('asset_unavailable');
      const asset = record.entry.asset;
      if (asset.sha256.toLowerCase() !== declared.sha256.toLowerCase()
        || asset.mediaType !== declared.mediaType || asset.durationMs !== declared.durationMs
        || (asset.mediaType !== 'video' && asset.mediaType !== 'image')) {
        fail('asset_unavailable');
      }
      let eligible: boolean;
      try { eligible = evaluateAssetEligibility(record.entry, context).eligible; }
      catch { fail('rights_blocked'); }
      if (!eligible) fail('rights_blocked');
      visualLayer = {
        path: assetPath,
        assetId: asset.id,
        sha256: asset.sha256,
        mediaType: asset.mediaType,
        sourceInMs: layer.sourceInMs,
        startAtMs: layer.startAtMs,
        durationMs: layer.durationMs,
        purpose: layer.purpose,
        evidenceRefs: record.entry.rightsGrant?.evidence.map((evidence) => evidence.ref) ?? [],
        grantValidFrom: record.entry.rightsGrant?.validFrom ?? null,
        grantValidUntil: record.entry.rightsGrant?.validUntil ?? null,
      };
    }
    segments.push({
      segmentId: segment.id,
      order: segment.order,
      clip: {
        path,
        receiptId: receipt.id,
        highlightId: receipt.highlightId,
        recordingId: receipt.recordingId,
        sourceSha256: receipt.sourceSha256,
        outputSha256: receipt.outputSha256,
        absoluteInMs: segment.source.inMs,
        absoluteOutMs: segment.source.outMs,
        sourceInMs,
        sourceOutMs,
        outputDurationMs: receipt.outputDurationMs,
        reviewedAt: receipt.reviewedAt,
      },
      visualLayer,
    });
  }
  return { planId: plan.id, context, segments };
}

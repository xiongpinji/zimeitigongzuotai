/** Revalidate source bytes and rights before analyzing or recording a version review. */
import { isDeepStrictEqual } from 'node:util';
import type { ProductionDocumentV1 } from '../../src/types/production-contracts';
import { CompositionReviewError } from './review';
import { readCompositionVersion, type CompositionVersionLocation } from './version-projects';
import { resolveCompositionSources, type CompositionSourceServices,
  type ResolvedCompositionSources } from './source-resolver';

function stableIdentity(sources: ResolvedCompositionSources): unknown {
  return { ...sources, context: { ...sources.context, usedAt: undefined } };
}

export function createCompositionReviewSourceGate(deps: {
  getDocument: (projectDir: string) => Promise<ProductionDocumentV1>;
  sourceServices: CompositionSourceServices;
}) {
  return async (location: CompositionVersionLocation): Promise<void> => {
    const record = await readCompositionVersion(location);
    if (record.timelineModified) throw new CompositionReviewError('review_required');
    const manifest = record.manifest;
    const sourceContext = manifest.sources.context;
    const current = await resolveCompositionSources({
      document: await deps.getDocument(location.projectDir),
      plan: manifest.plan,
      clipSelections: manifest.sources.segments.map((segment) => ({
        segmentId: segment.segmentId, receiptId: segment.clip.receiptId,
      })),
      context: { platform: sourceContext.platform, region: sourceContext.region,
        commercialShortVideo: sourceContext.commercialShortVideo },
    }, deps.sourceServices);
    if (!isDeepStrictEqual(stableIdentity(current), stableIdentity(manifest.sources))) {
      throw new CompositionReviewError('stale_evidence');
    }
  };
}

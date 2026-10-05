/** Project-gated MCP projection of the existing local, rights-checked asset search. */
import { recommendBrollFromEntries, validateAssetUsageContext, type AssetUsageContext } from '../assets/asset-rights';
import type { LocalAssetLibrary } from '../assets/local-asset-library';
import type { OllamaAssetIndex } from '../assets/ollama-asset-index';
import type { ProductionPlatform } from '../../src/types/production-contracts';

export interface ProductionAssetSearchInput {
  text: string;
  platform: ProductionPlatform;
  region: string;
  commercialShortVideo: boolean;
  maxResults: number;
}

export function createProductionAssetSearch(deps: {
  library: LocalAssetLibrary;
  index: OllamaAssetIndex;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  return async (input: ProductionAssetSearchInput) => {
    const context: AssetUsageContext = validateAssetUsageContext({
      platform: input.platform, region: input.region,
      usedAt: now().toISOString(), commercialShortVideo: input.commercialShortVideo,
    });
    const records = deps.library.list().filter((record) =>
      record.entry.asset.mediaType === 'video' || record.entry.asset.mediaType === 'image');
    const found = await recommendBrollFromEntries(records.map((record) => record.entry),
      { text: input.text, maxResults: input.maxResults }, context, deps.index.searchPort(records));
    if (found.status !== 'ok') return { status: found.status, assets: [] };
    const assets = [];
    for (const item of found.recommendations) {
      // Refresh the clock and media hash after model work; revocation or expiry fails closed.
      await deps.library.verifiedForUsage(item.assetId, {
        ...context, usedAt: now().toISOString(),
      });
      assets.push({ assetId: item.assetId, similarity: item.similarity, mediaType: item.mediaType });
    }
    return { status: 'ok' as const, assets };
  };
}

export type ProductionAssetSearch = ReturnType<typeof createProductionAssetSearch>;

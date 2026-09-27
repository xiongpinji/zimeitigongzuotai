/** Owner-window-only bridge; source paths stay in the main process until explicit editor use. */
import { lstatSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import {
  AssetRightsError, recommendBrollFromEntries, validateAssetUsageContext,
  type BrollQuery, type AssetUsageContext,
} from './asset-rights';
import {
  LocalAssetLibrary, LocalAssetLibraryError, type LocalAssetRecord,
} from './local-asset-library';
import { OllamaAssetIndex, OllamaAssetIndexError } from './ollama-asset-index';

export const ASSET_LIBRARY_CHANNELS = {
  choose: 'asset-library:choose',
  import: 'asset-library:import',
  list: 'asset-library:list',
  revoke: 'asset-library:revoke',
  index: 'asset-library:index',
  recommend: 'asset-library:recommend',
  use: 'asset-library:use',
} as const;

export type AssetLibraryIpcErrorCode =
  | 'forbidden' | 'busy' | 'invalid_request' | 'invalid_selection' | 'selection_required'
  | 'internal_error' | LocalAssetLibraryError['code'] | OllamaAssetIndexError['code'];
export type AssetLibraryIpcResult<T> = ({ ok: true } & T) | { ok: false; code: AssetLibraryIpcErrorCode };

export interface AssetLibraryRecordDto {
  id: string;
  sha256: string;
  mediaType: LocalAssetRecord['entry']['asset']['mediaType'];
  durationMs: number | null;
  semanticText: string;
  tags: string[];
  source: string;
  rightsHolder: string;
  license: string;
  usageScope: string;
  authorizedForAutoUse: boolean;
  rightsGrant: LocalAssetRecord['entry']['rightsGrant'];
}

type Handler = (event: unknown, input?: unknown) => unknown;
type DialogResult = { canceled: boolean; filePaths: string[] };
export interface AssetLibraryIpcOptions {
  ipc: { handle(channel: string, handler: Handler): void };
  library: LocalAssetLibrary;
  index: OllamaAssetIndex;
  allowedSender(event: unknown): boolean;
  pickFile(): Promise<DialogResult>;
}

const DISPLAY_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key));
}
function dto(record: LocalAssetRecord): AssetLibraryRecordDto {
  const { asset, rightsGrant } = record.entry;
  return {
    id: asset.id, sha256: asset.sha256, mediaType: asset.mediaType,
    durationMs: asset.durationMs, semanticText: record.semanticText, tags: [...asset.tags],
    source: asset.source, rightsHolder: asset.rightsHolder, license: asset.license,
    usageScope: asset.usageScope, authorizedForAutoUse: asset.authorizedForAutoUse,
    rightsGrant,
  };
}
function errorCode(error: unknown): AssetLibraryIpcErrorCode {
  if (error instanceof LocalAssetLibraryError || error instanceof OllamaAssetIndexError) return error.code;
  if (error instanceof AssetRightsError) return 'invalid_request';
  return 'internal_error';
}

export function registerAssetLibraryIpc(options: AssetLibraryIpcOptions): void {
  const { ipc, library, index } = options;
  let selectedPath: string | null = null;
  let choosing = false;

  function handle(channel: string, operation: (input: unknown) => Promise<unknown> | unknown): void {
    ipc.handle(channel, async (event, input): Promise<unknown> => {
      if (!options.allowedSender(event)) return { ok: false, code: 'forbidden' };
      try { return await operation(input); }
      catch (error) { return { ok: false, code: errorCode(error) }; }
    });
  }

  handle(ASSET_LIBRARY_CHANNELS.choose, async (input) => {
    if (input !== undefined) return { ok: false, code: 'invalid_request' };
    if (choosing) return { ok: false, code: 'busy' };
    selectedPath = null;
    choosing = true;
    try {
      const selected = await options.pickFile();
      if (selected.canceled) return { ok: false, code: 'selection_required' };
      const path = selected.filePaths.length === 1 ? selected.filePaths[0] : null;
      if (typeof path !== 'string' || !isAbsolute(path)) return { ok: false, code: 'invalid_selection' };
      try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, code: 'invalid_selection' };
      } catch { return { ok: false, code: 'invalid_selection' }; }
      selectedPath = path;
      return { ok: true, label: basename(path).slice(0, 160).replace(DISPLAY_UNSAFE, '\uFFFD') };
    } finally { choosing = false; }
  });

  handle(ASSET_LIBRARY_CHANNELS.import, async (input) => {
    if (!object(input) || !exact(input, ['metadata'])) return { ok: false, code: 'invalid_request' };
    if (!selectedPath) return { ok: false, code: 'selection_required' };
    const path = selectedPath;
    selectedPath = null;
    const record = await library.importFile(path, input.metadata);
    return { ok: true, record: dto(record) };
  });

  handle(ASSET_LIBRARY_CHANNELS.list, (input) => {
    if (input !== undefined) return { ok: false, code: 'invalid_request' };
    return { ok: true, records: library.list().map(dto) };
  });

  handle(ASSET_LIBRARY_CHANNELS.revoke, (input) => {
    if (!object(input) || !exact(input, ['id']) || typeof input.id !== 'string') {
      return { ok: false, code: 'invalid_request' };
    }
    return { ok: true, record: dto(library.revokeAutoUse(input.id)) };
  });

  handle(ASSET_LIBRARY_CHANNELS.index, async (input) => {
    if (input !== undefined) return { ok: false, code: 'invalid_request' };
    return { ok: true, ...await index.indexRecords(library.list()) };
  });

  handle(ASSET_LIBRARY_CHANNELS.recommend, async (input) => {
    if (!object(input) || !exact(input, ['query', 'context'])) return { ok: false, code: 'invalid_request' };
    const context = validateAssetUsageContext(input.context);
    const records = library.list();
    const result = await recommendBrollFromEntries(
      records.map((record) => record.entry), input.query as BrollQuery, context,
      index.searchPort(records),
    );
    for (const recommendation of result.recommendations) {
      await library.verifiedForUsage(recommendation.assetId, context);
    }
    return { ok: true, result };
  });

  handle(ASSET_LIBRARY_CHANNELS.use, async (input) => {
    if (!object(input) || !exact(input, ['id', 'context']) || typeof input.id !== 'string') {
      return { ok: false, code: 'invalid_request' };
    }
    const context: AssetUsageContext = validateAssetUsageContext(input.context);
    const path = await library.verifiedForUsage(input.id, context);
    const record = library.get(input.id)!;
    return {
      ok: true, path, mediaType: record.entry.asset.mediaType,
      durationMs: record.entry.asset.durationMs,
    };
  });
}

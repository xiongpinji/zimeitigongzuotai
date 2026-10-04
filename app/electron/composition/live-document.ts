/** Assemble the current project production contract from product-owned stores. */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createEmptyProductionDocument, parseProductionDocument } from '../../src/lib/production-document';
import type { ProductionDocumentV1, RecordingV1, HighlightV1, AssetV1 } from '../../src/types/production-contracts';
import type { ProductHighlightController } from '../highlights/product-highlight-controller';
import type { LocalAssetLibrary } from '../assets/local-asset-library';

export interface LiveCompositionDocumentDeps {
  controller: Pick<ProductHighlightController, 'list' | 'readArtifact'>;
  library: Pick<LocalAssetLibrary, 'list'>;
  nowIso?: () => string;
}

export class LiveCompositionDocumentError extends Error {
  constructor(readonly code: 'unsafe_project' | 'conflicting_source' | 'invalid_catalog') {
    super(code);
    this.name = 'LiveCompositionDocumentError';
  }
}

const fail = (code: LiveCompositionDocumentError['code']): never => { throw new LiveCompositionDocumentError(code); };

async function checkedProjectDir(projectDir: string): Promise<string> {
  if (typeof projectDir !== 'string' || !path.isAbsolute(projectDir)) fail('unsafe_project');
  const root = await fs.realpath(projectDir).catch(() => fail('unsafe_project'));
  const directory = await fs.lstat(root).catch(() => fail('unsafe_project'));
  const projectFile = await fs.lstat(path.join(root, 'project.json')).catch(() => fail('unsafe_project'));
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
      !projectFile.isFile() || projectFile.isSymbolicLink()) fail('unsafe_project');
  try {
    const project = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')) as { version?: unknown };
    if (project?.version !== 1) fail('unsafe_project');
  } catch { fail('unsafe_project'); }
  return root;
}

function addUnique<T extends { id: string }>(map: Map<string, T>, item: T): void {
  const previous = map.get(item.id);
  if (previous && JSON.stringify(previous) !== JSON.stringify(item)) fail('conflicting_source');
  map.set(item.id, item);
}

/**
 * The document is rebuilt on each call, so later source/rights changes are never hidden behind
 * an old serialized authorization snapshot. Version plans remain in their own project manifests.
 */
export async function buildLiveCompositionDocument(projectDir: string,
  deps: LiveCompositionDocumentDeps): Promise<ProductionDocumentV1> {
  const root = await checkedProjectDir(projectDir);
  const projectId = `project-${createHash('sha256').update(root).digest('hex')}`;
  const document = createEmptyProductionDocument(projectId, { nowIso: deps.nowIso?.() });
  const recordings = new Map<string, RecordingV1>();
  const highlights = new Map<string, HighlightV1>();
  try {
    for (const task of deps.controller.list()) {
      if (task.state !== 'completed') continue;
      addUnique(recordings, task.recording);
      const artifact = deps.controller.readArtifact(task.id);
      if (!artifact || artifact.taskId !== task.id || artifact.attempt !== task.attempt ||
          artifact.highlightIds.length !== artifact.highlights.length ||
          artifact.highlights.some((item) => item.recordingId !== task.recording.id ||
            !artifact.highlightIds.includes(item.id))) throw new LiveCompositionDocumentError('invalid_catalog');
      for (const highlight of artifact.highlights) addUnique(highlights, highlight);
    }
    const assets = new Map<string, AssetV1>();
    for (const record of deps.library.list()) addUnique(assets, record.entry.asset);
    document.recordings = [...recordings.values()];
    document.highlights = [...highlights.values()];
    document.assets = [...assets.values()];
    return parseProductionDocument(document);
  } catch (error) {
    if (error instanceof LiveCompositionDocumentError) throw error;
    throw new LiveCompositionDocumentError('invalid_catalog');
  }
}

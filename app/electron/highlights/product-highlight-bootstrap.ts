/** Product-owned highlight storage. Startup only: no media reads, sidecar, or auto-dispatch. */
import { isAbsolute, join } from 'node:path';
import { assertSingleInstanceOwner } from '../single-instance-gate';
import { HighlightBatchQueue } from './highlight-batch-queue';
import {
  HighlightArtifactStore,
  recoverHighlightBatch,
  type HighlightRecoverySummary,
} from './highlight-batch-artifacts';

export interface ProductHighlightPaths {
  queuePath: string;
  artifactRoot: string;
}

export interface ProductHighlightRuntime {
  queue: HighlightBatchQueue;
  artifacts: HighlightArtifactStore;
  recovery: HighlightRecoverySummary;
  close(): void;
}

/** Stable paths under Electron userData; no checkout or packaged HotClip path is inferred. */
export function resolveProductHighlightPaths(userDataPath: string): ProductHighlightPaths {
  if (typeof userDataPath !== 'string' || userDataPath.trim().length === 0) {
    throw new Error('userDataPath is required');
  }
  if (!isAbsolute(userDataPath)) throw new Error('userDataPath must be absolute');
  const root = join(userDataPath, 'highlights-v1');
  return { queuePath: join(root, 'queue.json'), artifactRoot: join(root, 'artifacts') };
}

/**
 * Only the Electron lock owner may recover and hold these writers. Recovery runs before
 * the first window and before any future scheduler could start. A failed recovery
 * releases both in-process writers and must stop product startup in the caller.
 */
export function bootstrapProductHighlights(userDataPath: string): ProductHighlightRuntime {
  assertSingleInstanceOwner();
  const paths = resolveProductHighlightPaths(userDataPath);
  const queue = new HighlightBatchQueue({ storePath: paths.queuePath, now: Date.now });
  let artifacts: HighlightArtifactStore | null = null;
  try {
    artifacts = new HighlightArtifactStore({ rootDir: paths.artifactRoot });
    const recovery = recoverHighlightBatch(queue, artifacts);
    const ownedArtifacts = artifacts;
    let closed = false;
    return {
      queue,
      artifacts: ownedArtifacts,
      recovery,
      close() {
        if (closed) return;
        closed = true;
        ownedArtifacts.close();
        queue.close();
      },
    };
  } catch (error) {
    artifacts?.close();
    queue.close();
    throw error;
  }
}

/** H1-S2c2: hash authorized local recording bytes immediately before sidecar execution. */
import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createDurableHotClipRunner,
  type DurableHotClipRunnerOptions,
} from './highlight-batch-artifacts';
import type { HighlightBatchRunner } from './highlight-batch-scheduler';

export interface LocalSourceObservationOptions {
  /** Explicitly authorized media directory, outside the Git checkout. */
  rootDir: string;
  videoPath: string;
  signal: AbortSignal;
}

export class HighlightSourceObservationError extends Error {
  readonly code = 'source_unavailable' as const;

  constructor() {
    super('Authorized recording source could not be read consistently');
    this.name = 'HighlightSourceObservationError';
  }
}

function unavailable(): never {
  throw new HighlightSourceObservationError();
}

function containedRelative(root: string, path: string): string {
  const child = relative(root, path);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) unavailable();
  return child;
}

function sameFile(before: BigIntStats, after: BigIntStats): boolean {
  return before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs;
}

/**
 * Only reads a regular file inside one authorized root. Rejects the root and
 * its descendant symlinks, checks the opened handle and path after hashing, and returns only
 * a digest. Callers must still prevent replacement between this read and the
 * separate sidecar's open; this is a pre-execution observation, not an OS lease.
 */
export async function observeAuthorizedLocalSourceSha256(
  options: LocalSourceObservationOptions,
): Promise<string> {
  try {
    if (!options || typeof options.rootDir !== 'string' || typeof options.videoPath !== 'string' ||
        !isAbsolute(options.rootDir) || !isAbsolute(options.videoPath) ||
        !options.signal || typeof options.signal.aborted !== 'boolean') unavailable();
    if (options.signal.aborted) unavailable();
    const root = resolve(options.rootDir);
    const target = resolve(options.videoPath);
    const child = containedRelative(root, target);
    const rootStat = await lstat(root, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) unavailable();
    let cursor = root;
    const parts = child.split(sep);
    for (let index = 0; index < parts.length; index += 1) {
      cursor = join(cursor, parts[index]);
      const stat = await lstat(cursor, { bigint: true });
      if (stat.isSymbolicLink() ||
          (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) unavailable();
    }
    const physicalRoot = await realpath(root);
    const physicalTarget = await realpath(target);
    containedRelative(physicalRoot, physicalTarget);
    const before = await lstat(target, { bigint: true });
    // O_NOFOLLOW is unavailable on Windows; lstat/open/fstat/path checks still
    // reject ordinary link traversal, but cannot replace an OS-level lock.
    const noFollow = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
    const file = await open(target, constants.O_RDONLY | noFollow);
    try {
      const opened = await file.stat({ bigint: true });
      if (!opened.isFile() || !sameFile(before, opened)) unavailable();
      const digest = createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        if (options.signal.aborted) unavailable();
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        digest.update(buffer.subarray(0, bytesRead));
      }
      if (options.signal.aborted) unavailable();
      const afterHandle = await file.stat({ bigint: true });
      const afterPath = await lstat(target, { bigint: true });
      const afterRealpath = await realpath(target);
      if (!sameFile(before, afterHandle) || !sameFile(before, afterPath) ||
          !afterPath.isFile() || afterPath.isSymbolicLink() ||
          afterRealpath !== physicalTarget) unavailable();
      return digest.digest('hex');
    } finally {
      await file.close();
    }
  } catch {
    unavailable();
  }
}

/**
 * The local-media variant of the durable runner. The media root is an explicit
 * caller authorization boundary; this never searches the file system for a
 * recording or downloads a model. The sidecar remains separately configured.
 */
export function createAuthorizedLocalHotClipRunner(
  options: Omit<DurableHotClipRunnerOptions, 'observeSourceSha256'> & { mediaRootDir: string },
): HighlightBatchRunner {
  return createDurableHotClipRunner({
    ...options,
    observeSourceSha256: (_task, videoPath, signal) =>
      observeAuthorizedLocalSourceSha256({ rootDir: options.mediaRootDir, videoPath, signal }),
  });
}

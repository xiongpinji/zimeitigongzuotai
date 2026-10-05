/** User-selected SRT bytes copied into a content-addressed, private local receipt. */
import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { observeAuthorizedLocalSourceSha256 } from './local-source-observer';

const MAX_SRT_BYTES = 16 * 1024 * 1024;
const RECEIPT_NAME = /^([0-9a-f]{64})\.srt$/;

function unavailable(): never { throw new Error('authorized_srt_unavailable'); }

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/** A bounded byte snapshot; the original path must stay under the selected media root. */
export async function snapshotAuthorizedSrt(input: {
  mediaRootDir: string; subtitlePath: string; storeDir: string; signal: AbortSignal;
}): Promise<string> {
  const { mediaRootDir, subtitlePath, storeDir, signal } = input;
  if (!isAbsolute(mediaRootDir) || !isAbsolute(subtitlePath) || !isAbsolute(storeDir) ||
      extname(subtitlePath).toLowerCase() !== '.srt' || signal.aborted) unavailable();
  const root = resolve(mediaRootDir);
  const source = resolve(subtitlePath);
  if (!within(root, source)) unavailable();
  const before = await lstat(source, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_SRT_BYTES)) unavailable();
  const sourceReal = await realpath(source);
  if (!within(await realpath(root), sourceReal)) unavailable();
  const observedBefore = await observeAuthorizedLocalSourceSha256({ rootDir: root, videoPath: source, signal });
  const noFollow = (constants as typeof constants & { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
  const handle = await open(source, constants.O_RDONLY | noFollow);
  let bytes: Buffer;
  try {
    if (!sameFile(before, await handle.stat({ bigint: true }))) unavailable();
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let size = 0;
    for (;;) {
      if (signal.aborted) unavailable();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_SRT_BYTES) unavailable();
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    bytes = Buffer.concat(chunks, size);
    if (!sameFile(before, await handle.stat({ bigint: true })) ||
        !sameFile(before, await lstat(source, { bigint: true })) ||
        await realpath(source) !== sourceReal || signal.aborted) unavailable();
  } finally { await handle.close(); }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== observedBefore || digest !== await observeAuthorizedLocalSourceSha256({
    rootDir: root, videoPath: source, signal,
  })) unavailable();

  const targetRoot = resolve(storeDir);
  await mkdir(targetRoot, { recursive: true });
  const rootStat = await lstat(targetRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) unavailable();
  const target = join(targetRoot, `${digest}.srt`);
  try {
    await lstat(target);
    return await verifyStoredSrt(targetRoot, target, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temp = join(targetRoot, `.${digest}-${randomUUID()}.tmp`);
  let tempCreated = false;
  try {
    const writer = await open(temp, 'wx', 0o600);
    tempCreated = true;
    try { await writer.writeFile(bytes); await writer.sync(); }
    finally { await writer.close(); }
    try { await link(temp, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await verifyStoredSrt(targetRoot, target, signal);
    return target;
  } finally {
    if (tempCreated) await unlink(temp).catch(() => undefined);
  }
}

/** Verify the durable snapshot immediately before starting HotClip. */
export async function verifyStoredSrt(storeDir: string, ref: string, signal: AbortSignal): Promise<string> {
  if (!isAbsolute(storeDir) || !isAbsolute(ref) || signal.aborted) unavailable();
  const root = resolve(storeDir);
  const target = resolve(ref);
  const expected = RECEIPT_NAME.exec(basename(target))?.[1];
  const sameDir = process.platform === 'win32'
    ? dirname(target).toLowerCase() === root.toLowerCase() : dirname(target) === root;
  if (!expected || !sameDir || target !== ref) unavailable();
  const stat = await lstat(target, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(MAX_SRT_BYTES)) unavailable();
  const observed = await observeAuthorizedLocalSourceSha256({ rootDir: root, videoPath: target, signal });
  if (observed !== expected) unavailable();
  return target;
}

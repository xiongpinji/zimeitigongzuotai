import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSingleInstanceGate } from '../../electron/single-instance-gate';
import { resolveFfmpegPath, resolveFfprobePath } from '../../electron/runtime-binaries';
import { bootstrapProductHighlights, type ProductHighlightRuntime } from '../../electron/highlights/product-highlight-bootstrap';
import { ProductHighlightController } from '../../electron/highlights/product-highlight-controller';
import { ReviewedClipExporter } from '../../electron/highlights/reviewed-clip-exporter';
import { buildReviewedClipReceipt } from '../../electron/highlights/reviewed-clip-receipts';

const appRoot = resolve(__dirname, '../..');
const runtimePaths = { appPath: appRoot, resourcesPath: '', cwd: appRoot, moduleDir: join(appRoot, 'dist-electron') };
const ffmpegPath = resolveFfmpegPath(runtimePaths);
const ffprobePath = resolveFfprobePath(runtimePaths);
const roots: string[] = [];
const runtimes: ProductHighlightRuntime[] = [];
const exporters: ReviewedClipExporter[] = [];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function fixture() {
  if (!ffmpegPath || !ffprobePath) throw new Error('Test setup: bundled FFmpeg and ffprobe required');
  const root = mkdtempSync(join(tmpdir(), 'lingji-reviewed-clip-'));
  roots.push(root);
  const media = join(root, 'media');
  mkdirSync(media);
  const source = join(media, 'authorized.mp4');
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '5',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source,
  ], { timeout: 30_000 });
  const runtime = bootstrapProductHighlights(root);
  runtimes.push(runtime);
  const controller = new ProductHighlightController({ runtime, userDataPath: root });
  const [task] = await controller.importRecordings({ mediaRootDir: media, videoPaths: [source], maxClips: 2 });
  const fakeSidecar = join(root, 'fake-hotclip.cjs');
  writeFileSync(fakeSidecar,
    'process.stdout.write(JSON.stringify([{id:"candidate-a",startSec:1,endSec:3,title:"Fixture",hook:"Hook",score:0.9,reason:"Test",recommended:true}]))');
  await controller.runQueued({
    mediaRootDir: media, executable: process.execPath, argsPrefix: [fakeSidecar], cwd: root,
    timeoutMs: 10_000, concurrency: 1, maxAttempts: 1,
    llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'synthetic', allowModelDownload: true,
  });
  const highlight = controller.readArtifact(task.id)?.highlights[0];
  if (!highlight) throw new Error('Test setup: highlight missing');
  const exporter = new ReviewedClipExporter({
    controller, userDataPath: root, ffmpegPath, ffprobePath,
  });
  exporters.push(exporter);
  const selection = { taskId: task.id, highlightId: highlight.id, startMs: 1100, endMs: 2900 };
  return { root, media, source, task, highlight, controller, exporter, selection };
}

beforeEach(async () => {
  await runSingleInstanceGate({
    app: { requestSingleInstanceLock: () => true, quit: () => undefined, on: () => undefined },
    loadMainRuntime: () => undefined,
  });
});

afterEach(async () => {
  for (const exporter of exporters.splice(0)) await exporter.stopForShutdown();
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-reviewed-clip-')) {
      throw new Error('Unsafe reviewed clip test cleanup');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

describe.skipIf(!ffmpegPath || !ffprobePath)('reviewed clip export with local synthetic video', () => {
  it('encodes a frame-accurate approved range, records provenance, and reuses the same verified output', async () => {
    const { root, media, source, exporter, selection } = await fixture();
    const first = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true, selections: [selection] });
    expect(first).toMatchObject([{ status: 'completed', reused: false, taskId: selection.taskId }]);
    const completed = first[0];
    if (completed.status !== 'completed') throw new Error('Expected completed export');
    expect(existsSync(completed.outputPath)).toBe(true);
    expect(sha256(completed.outputPath)).toBe(completed.outputSha256);
    const receipt = exporter.list()[0];
    expect(receipt).toMatchObject({
      id: completed.id, taskId: selection.taskId, highlightId: selection.highlightId,
      startMs: 1100, endMs: 2900, sourceSha256: sha256(source),
      outputSha256: completed.outputSha256, reviewedBy: 'local-owner',
    });
    expect(readFileSync(join(root, 'highlights-v1', 'reviewed-clips', `${completed.id}.json`), 'utf8'))
      .not.toContain(source);
    const second = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true, selections: [selection] });
    expect(second).toMatchObject([{ status: 'completed', reused: true, outputSha256: completed.outputSha256 }]);
  }, 45_000);

  it('refuses unreviewed, unknown, out-of-range, and changed-source selections before rendering', async () => {
    const { media, source, exporter, selection } = await fixture();
    await expect(exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: false, selections: [selection] }))
      .rejects.toMatchObject({ code: 'review_required' });
    const unknown = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true,
      selections: [{ ...selection, highlightId: `hlcv1-${'0'.repeat(64)}` }] });
    expect(unknown).toMatchObject([{ status: 'failed', code: 'candidate_not_found' }]);
    const outside = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true,
      selections: [{ ...selection, endMs: 99_000 }] });
    expect(outside).toMatchObject([{ status: 'failed', code: 'invalid_timecode' }]);
    writeFileSync(source, 'changed-source');
    const changed = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true, selections: [selection] });
    expect(changed).toMatchObject([{ status: 'failed', code: 'source_hash_mismatch' }]);
    expect(exporter.list()).toEqual([]);
  }, 45_000);

  it('detects tampered output instead of silently overwriting a previously reviewed clip', async () => {
    const { media, exporter, selection } = await fixture();
    const [first] = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true, selections: [selection] });
    if (first.status !== 'completed') throw new Error('Expected completed export');
    writeFileSync(first.outputPath, 'tampered');
    const [retry] = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true, selections: [selection] });
    expect(retry).toMatchObject({ status: 'failed', code: 'output_conflict' });
  }, 45_000);

  it('isolates invalid selections within a batch and reuses an export after service restart', async () => {
    const { root, media, exporter, selection, task } = await fixture();
    const results = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true,
      selections: [{ ...selection, highlightId: `hlcv1-${'0'.repeat(64)}` }, selection], concurrency: 2 });
    expect(results[0]).toMatchObject({ status: 'failed', code: 'candidate_not_found' });
    expect(results[1]).toMatchObject({ status: 'completed', reused: false });
    expect(exporter.list()).toHaveLength(1);
    const restarted = new ReviewedClipExporter({ controller: new ProductHighlightController({
      runtime: runtimes[runtimes.length - 1], userDataPath: root,
    }), userDataPath: root, ffmpegPath, ffprobePath });
    exporters.push(restarted);
    const repeat = await restarted.exportBatch({ mediaRootDir: media, reviewConfirmed: true, selections: [selection] });
    expect(repeat).toMatchObject([{ status: 'completed', reused: true, taskId: task.id }]);
  }, 45_000);

  it('rejects a receipt whose content-addressed id disagrees with its fixed filename before editor import', async () => {
    const { root, media, exporter, selection } = await fixture();
    const [result] = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true, selections: [selection] });
    if (result.status !== 'completed') throw new Error('Expected completed export');
    const receipt = exporter.list()[0];
    const { contentSha256: _ignored, ...body } = receipt;
    const changed = buildReviewedClipReceipt({ ...body, id: `hclip_${'0'.repeat(64)}` });
    writeFileSync(join(root, 'highlights-v1', 'reviewed-clips', `${result.id}.json`), JSON.stringify(changed));
    await expect(exporter.verifiedOutput(result.id)).rejects.toMatchObject({ code: 'receipt_corrupt' });
  }, 45_000);

  it('cancels an active batch without committing a partial clip', async () => {
    const { media, exporter, selection } = await fixture();
    const running = exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true,
      selections: [selection] });
    expect(exporter.cancelActive()).toBe(true);
    expect(await running).toMatchObject([{ status: 'cancelled', code: 'cancelled' }]);
    expect(exporter.list()).toEqual([]);
    expect(exporter.cancelActive()).toBe(false);
  }, 45_000);

  it('does not issue a receipt if the recording changes between preflight and completed render', async () => {
    const { root, media, source, controller, selection } = await fixture();
    const observed = vi.fn()
      .mockResolvedValueOnce(sha256(source))
      .mockResolvedValueOnce('0'.repeat(64));
    const exporter = new ReviewedClipExporter({ controller, userDataPath: root,
      ffmpegPath, ffprobePath, observeSourceSha256: observed });
    exporters.push(exporter);
    const [result] = await exporter.exportBatch({ mediaRootDir: media, reviewConfirmed: true,
      selections: [selection] });
    expect(result).toMatchObject({ status: 'failed', code: 'source_hash_mismatch' });
    expect(observed).toHaveBeenCalledTimes(2);
    expect(exporter.list()).toEqual([]);
  }, 45_000);
});

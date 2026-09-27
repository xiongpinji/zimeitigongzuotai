import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSingleInstanceGate } from '../../electron/single-instance-gate';
import { bootstrapProductHighlights, type ProductHighlightRuntime } from '../../electron/highlights/product-highlight-bootstrap';
import { ProductHighlightController } from '../../electron/highlights/product-highlight-controller';

const roots: string[] = [];
const runtimes: ProductHighlightRuntime[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lingji-highlight-controller-'));
  roots.push(root);
  const mediaRootDir = join(root, 'media');
  mkdirSync(mediaRootDir);
  const runtime = bootstrapProductHighlights(root);
  runtimes.push(runtime);
  return { root, mediaRootDir, runtime, controller: new ProductHighlightController({ runtime, userDataPath: root }) };
}

function fakeConfig(root: string, mediaRootDir: string, script: string) {
  return {
    mediaRootDir,
    executable: process.execPath,
    argsPrefix: [script],
    cwd: root,
    timeoutMs: 10_000,
    concurrency: 2,
    maxAttempts: 2,
    llmBaseUrl: 'http://127.0.0.1:11434/v1',
    llmModel: 'synthetic-model',
    llmApiKey: 'SYNTHETIC-SECRET-DO-NOT-STORE',
    allowModelDownload: true,
  };
}

async function waitForPidGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

beforeEach(async () => {
  await runSingleInstanceGate({
    app: { requestSingleInstanceLock: () => true, quit: () => undefined, on: () => undefined },
    loadMainRuntime: () => undefined,
  });
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-highlight-controller-')) {
      throw new Error('Unsafe highlight controller cleanup');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

describe('product highlight controller (synthetic sidecar, no LLM call)', () => {
  it('is retained by the owner main runtime before the first window and stopped before writer close', () => {
    const main = readFileSync(resolve(__dirname, '../../electron/main.ts'), 'utf8');
    const bootstrap = main.indexOf('productHighlights = bootstrapProductHighlights(');
    const controller = main.indexOf('productHighlightController = new ProductHighlightController(');
    const firstWindow = main.indexOf('createWindow();');
    expect(controller).toBeGreaterThan(bootstrap);
    expect(controller).toBeLessThan(firstWindow);
    expect(main).toMatch(/productHighlightController\.stopForShutdown\(\)/);
    expect(main.indexOf('productHighlights?.close();')).toBeGreaterThan(main.indexOf('productHighlightController.stopForShutdown()'));
  });

  it('serializes batch imports and aborts hashing before shutdown closes storage', async () => {
    const { mediaRootDir, runtime, controller } = fixture();
    const source = join(mediaRootDir, 'source.mp4');
    writeFileSync(source, 'synthetic-source', 'utf8');
    const first = controller.importRecordings({ mediaRootDir, videoPaths: [source] });
    await expect(controller.importRecordings({ mediaRootDir, videoPaths: [source] }))
      .rejects.toMatchObject({ code: 'busy' });
    await controller.stopForShutdown();
    await expect(first).rejects.toMatchObject({ code: 'source_unavailable' });
    expect(runtime.queue.list()).toEqual([]);
    await expect(controller.importRecordings({ mediaRootDir, videoPaths: [source] }))
      .rejects.toMatchObject({ code: 'stopped' });
  });

  it('imports two authorized recordings and explicitly dispatches both into verified artifacts', async () => {
    const { root, mediaRootDir, runtime, controller } = fixture();
    const first = join(mediaRootDir, 'first.mp4');
    const second = join(mediaRootDir, 'second.mp4');
    writeFileSync(first, 'synthetic-video-first', 'utf8');
    writeFileSync(second, 'synthetic-video-second', 'utf8');
    const script = join(root, 'fake-hotclip.cjs');
    writeFileSync(script, `process.stdout.write(JSON.stringify([{id:'upstream-private',startSec:1,endSec:3,title:'Synthetic',hook:'Hook',score:0.8,reason:'Synthetic reason',recommended:true}]));`, 'utf8');
    const tasks = await controller.importRecordings({ mediaRootDir, videoPaths: [first, second], maxClips: 2 });
    expect(tasks).toHaveLength(2);
    expect(runtime.queue.list().map((task) => task.state)).toEqual(['queued', 'queued']);
    const completed = await controller.runQueued(fakeConfig(root, mediaRootDir, script));
    expect(completed.map((task) => task.state)).toEqual(['completed', 'completed']);
    for (const task of completed) {
      expect(controller.readArtifact(task.id)).toMatchObject({ reviewRequired: true, taskId: task.id });
    }
    expect(readFileSync(join(root, 'highlights-v1', 'queue.json'), 'utf8')).not.toContain('SYNTHETIC-SECRET-DO-NOT-STORE');
  });

  it('rejects missing model-download consent before claiming a task', async () => {
    const { root, mediaRootDir, runtime, controller } = fixture();
    const source = join(mediaRootDir, 'source.mp4');
    writeFileSync(source, 'source', 'utf8');
    const script = join(root, 'fake-hotclip.cjs');
    writeFileSync(script, 'process.stdout.write("[]")', 'utf8');
    const [task] = await controller.importRecordings({ mediaRootDir, videoPaths: [source] });
    await expect(controller.runQueued({ ...fakeConfig(root, mediaRootDir, script), allowModelDownload: false }))
      .rejects.toMatchObject({ code: 'invalid_configuration' });
    expect(runtime.queue.get(task.id)?.state).toBe('queued');
  });

  it('keeps a zero-candidate recording as a valid completed negative sample', async () => {
    const { root, mediaRootDir, runtime, controller } = fixture();
    const source = join(mediaRootDir, 'quiet.mp4');
    writeFileSync(source, 'synthetic-quiet-recording', 'utf8');
    const script = join(root, 'empty-hotclip.cjs');
    writeFileSync(script, 'process.stdout.write("[]")', 'utf8');
    const [task] = await controller.importRecordings({ mediaRootDir, videoPaths: [source] });
    await controller.runQueued(fakeConfig(root, mediaRootDir, script));
    expect(runtime.queue.get(task.id)).toMatchObject({ state: 'completed', candidateIds: [], highlightIds: [] });
    expect(controller.readArtifact(task.id)).toMatchObject({
      reviewRequired: true, candidateIds: [], highlightIds: [], highlights: [],
    });
  });

  it('detects changed source bytes before sidecar launch and records a retryable failure', async () => {
    const { root, mediaRootDir, runtime, controller } = fixture();
    const source = join(mediaRootDir, 'source.mp4');
    writeFileSync(source, 'version-one', 'utf8');
    const marker = join(root, 'spawned.marker');
    const script = join(root, 'fake-hotclip.cjs');
    writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned');`, 'utf8');
    const [task] = await controller.importRecordings({ mediaRootDir, videoPaths: [source] });
    writeFileSync(source, 'version-two', 'utf8');
    await controller.runQueued(fakeConfig(root, mediaRootDir, script));
    expect(runtime.queue.get(task.id)).toMatchObject({ state: 'failed', lastErrorCode: 'source_hash_mismatch' });
    expect(existsSync(marker)).toBe(false);
  });

  it('stops a running sidecar for shutdown and lets the next owner reconcile it', async () => {
    const { root, mediaRootDir, runtime, controller } = fixture();
    const source = join(mediaRootDir, 'source.mp4');
    writeFileSync(source, 'shutdown-source', 'utf8');
    const pidFile = join(root, 'child.pid');
    const script = join(root, 'hanging-hotclip.cjs');
    writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`, 'utf8');
    const [task] = await controller.importRecordings({ mediaRootDir, videoPaths: [source] });
    const draining = controller.runQueued(fakeConfig(root, mediaRootDir, script));
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 10_000 });
    const pid = Number(readFileSync(pidFile, 'utf8'));
    await controller.stopForShutdown();
    await draining;
    expect(runtime.queue.get(task.id)?.state).toBe('running');
    expect(await waitForPidGone(pid)).toBe(true);
    runtime.close();
    const next = bootstrapProductHighlights(root);
    runtimes.push(next);
    expect(next.recovery.interrupted).toBe(1);
    expect(next.queue.get(task.id)?.state).toBe('interrupted');
  }, 45_000);
});

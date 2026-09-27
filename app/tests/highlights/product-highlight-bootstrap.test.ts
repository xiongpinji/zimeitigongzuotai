import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecordingV1 } from '../../src/types/production-contracts';
import { runSingleInstanceGate } from '../../electron/single-instance-gate';
import {
  bootstrapProductHighlights,
  resolveProductHighlightPaths,
  type ProductHighlightRuntime,
} from '../../electron/highlights/product-highlight-bootstrap';

const HASH = 'a'.repeat(64);
let root = '';
const runtimes: ProductHighlightRuntime[] = [];

function fakeApp(lockGranted: boolean) {
  return {
    requestSingleInstanceLock: () => lockGranted,
    quit: () => undefined,
    on: (_event: 'second-instance', _listener: () => void) => undefined,
  };
}

async function becomeOwner(): Promise<void> {
  await runSingleInstanceGate({ app: fakeApp(true), loadMainRuntime: () => undefined });
}

function open(): ProductHighlightRuntime {
  const runtime = bootstrapProductHighlights(root);
  runtimes.push(runtime);
  return runtime;
}

function recording(): RecordingV1 {
  return {
    id: 'synthetic-recording', sourceRef: 'media://synthetic-recording', sourceSha256: HASH,
    capturedAt: null, durationMs: 120_000, mimeType: 'video/mp4',
    transcriptRef: null, importedAt: '2026-09-26T00:00:00Z',
  };
}

function expectBootstrapError(code: string): void {
  let caught: unknown;
  try { bootstrapProductHighlights(root); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ code });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'lingji-highlight-product-'));
  await runSingleInstanceGate({ app: fakeApp(false), loadMainRuntime: () => undefined });
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  if (!root) return;
  const checked = resolve(root);
  if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-highlight-product-')) {
    throw new Error('Unsafe highlight product fixture cleanup');
  }
  rmSync(checked, { recursive: true, force: true });
});

describe('product highlight bootstrap (synthetic, no HotClip)', () => {
  it('wires startup recovery between ready and the first window, and closes on quit', () => {
    const main = readFileSync(resolve(__dirname, '../../electron/main.ts'), 'utf8');
    const ready = main.indexOf('app.whenReady()');
    const bootstrap = main.indexOf('productHighlights = bootstrapProductHighlights(');
    const firstWindow = main.indexOf('createWindow();');
    expect(ready).toBeGreaterThan(-1);
    expect(bootstrap).toBeGreaterThan(ready);
    expect(firstWindow).toBeGreaterThan(bootstrap);
    expect(main.split('productHighlights = bootstrapProductHighlights(')).toHaveLength(2);
    expect(main.slice(bootstrap, firstWindow)).toMatch(/app\.exit\(1\)/);
    expect(main.slice(main.indexOf("app.on('before-quit'"))).toMatch(/productHighlights\?\.close\(\)/);
  });

  it('rejects a process without the Electron single-instance lock before touching storage', () => {
    expect(() => bootstrapProductHighlights(root)).toThrow('Single-instance lock owner required');
    expect(existsSync(join(root, 'highlights-v1'))).toBe(false);
  });

  it('uses a stable private path, holds one writer and creates no file on an empty start', async () => {
    await becomeOwner();
    const paths = resolveProductHighlightPaths(root);
    expect(paths).toEqual({
      queuePath: join(root, 'highlights-v1', 'queue.json'),
      artifactRoot: join(root, 'highlights-v1', 'artifacts'),
    });
    const runtime = open();
    expect(runtime.queue.list()).toEqual([]);
    expect(runtime.recovery).toEqual({
      queued: 0, interrupted: 0, completedFromArtifact: 0,
      confirmedCompleted: 0, orphanedArtifacts: 0,
    });
    expect(existsSync(join(root, 'highlights-v1'))).toBe(false);
    expect(() => bootstrapProductHighlights(root)).toThrow();
    runtime.close();
    expect(open().queue.list()).toEqual([]);
  });

  it('recovers a claimed task without an artifact as interrupted, never dispatching it', async () => {
    await becomeOwner();
    const first = open();
    const [task] = first.queue.enqueueBatch([{
      recording: recording(), observedSourceSha256: HASH, options: { maxClips: 2 },
    }]);
    first.queue.claim(task.id, 2);
    first.close();
    const second = open();
    expect(second.recovery.interrupted).toBe(1);
    expect(second.queue.get(task.id)).toMatchObject({ state: 'interrupted', attempt: 1 });
    expect(second.queue.list()).toHaveLength(1);
    const persisted = JSON.parse(readFileSync(resolveProductHighlightPaths(root).queuePath, 'utf8'));
    expect(persisted.tasks).toHaveLength(1);
    expect(persisted.tasks[0].state).toBe('interrupted');
  });

  it('finishes a claimed task only when its committed artifact can be verified', async () => {
    await becomeOwner();
    const first = open();
    const [task] = first.queue.enqueueBatch([{
      recording: recording(), observedSourceSha256: HASH, options: { maxClips: 2 },
    }]);
    const claimed = first.queue.claim(task.id, 2);
    const receipt = first.artifacts.commit(claimed, [{
      id: 'synthetic-upstream', startSec: 12, endSec: 20,
      startMs: 12_000, endMs: 20_000, title: '合成高光', hook: '片段',
      score: 0.8, reason: '测试', recommended: true, reviewNote: null,
      visualEvidence: null,
    }], '2026-09-26T00:00:00Z');
    first.close();
    const second = open();
    expect(second.recovery.completedFromArtifact).toBe(1);
    expect(second.queue.get(task.id)).toMatchObject({
      state: 'completed', candidateIds: receipt.candidateIds, highlightIds: receipt.highlightIds,
    });
  });

  it('fails closed when a completed task has no artifact and releases both writers', async () => {
    await becomeOwner();
    const first = open();
    const [task] = first.queue.enqueueBatch([{
      recording: recording(), observedSourceSha256: HASH, options: { maxClips: 2 },
    }]);
    const claimed = first.queue.claim(task.id, 2);
    first.queue.complete(task.id, claimed.attempt, { candidateIds: [], highlightIds: [] });
    first.close();
    expectBootstrapError('artifact_missing');
    // Failure must not strand either in-process writer lock.
    expectBootstrapError('artifact_missing');
  });

  it('releases the queue writer when the artifact root is an unsafe file', async () => {
    await becomeOwner();
    const paths = resolveProductHighlightPaths(root);
    const first = open();
    first.queue.enqueueBatch([{
      recording: recording(), observedSourceSha256: HASH, options: { maxClips: 2 },
    }]);
    first.close();
    writeFileSync(paths.artifactRoot, 'not a directory', 'utf8');
    expectBootstrapError('invalid_root');
    expectBootstrapError('invalid_root');
  });

  it('rejects a relative userData path', async () => {
    await becomeOwner();
    expect(() => resolveProductHighlightPaths('relative')).toThrow('userDataPath must be absolute');
  });
});

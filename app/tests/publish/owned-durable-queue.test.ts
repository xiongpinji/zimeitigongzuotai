import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSingleInstanceGate } from '../../electron/single-instance-gate';
import { openOwnedDurableQueue } from '../../electron/publish/owned-durable-queue';
import type { DurableQueueOptions } from '../../electron/publish/durable-queue';

let tempDir: string;
let storePath: string;

function fakeApp(lockGranted: boolean) {
  return {
    requestSingleInstanceLock: () => lockGranted,
    quit: () => undefined,
    on: (_event: 'second-instance', _listener: () => void) => undefined,
  };
}

function options(): DurableQueueOptions {
  return {
    storePath,
    executor: vi.fn(async () => ({ kind: 'unknown' as const })),
    reconciler: vi.fn(async () => ({ finalState: 'unknown' as const })),
  };
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'owned-durable-queue-'));
  storePath = join(tempDir, 'queue.json');
  await runSingleInstanceGate({ app: fakeApp(false), loadMainRuntime: () => undefined });
});

afterEach(() => {
  if (existsSync(storePath)) unlinkSync(storePath);
  rmdirSync(tempDir);
});

describe('openOwnedDurableQueue', () => {
  it('denies before reading queue options or touching the store without lock ownership', () => {
    let optionReads = 0;
    const guardedOptions: DurableQueueOptions = {
      ...options(),
      get storePath() {
        optionReads += 1;
        return storePath;
      },
    };

    expect(() => openOwnedDurableQueue(guardedOptions)).toThrow('Single-instance lock owner required');
    expect(optionReads).toBe(0);
    expect(existsSync(storePath)).toBe(false);
    expect(guardedOptions.executor).not.toHaveBeenCalled();
    expect(guardedOptions.reconciler).not.toHaveBeenCalled();
  });

  it('opens an empty synthetic queue only inside the lock owner', async () => {
    let queue: ReturnType<typeof openOwnedDurableQueue> | null = null;
    const dependencies = options();
    await runSingleInstanceGate({
      app: fakeApp(true),
      loadMainRuntime: () => {
        queue = openOwnedDurableQueue(dependencies);
      },
    });

    expect(queue).not.toBeNull();
    expect(queue!.list()).toEqual([]);
    expect(dependencies.executor).not.toHaveBeenCalled();
    expect(dependencies.reconciler).not.toHaveBeenCalled();
    expect(existsSync(storePath)).toBe(false);
  });

  it('denies a new queue after a later loser gate call', async () => {
    await runSingleInstanceGate({ app: fakeApp(true), loadMainRuntime: () => undefined });
    await runSingleInstanceGate({ app: fakeApp(false), loadMainRuntime: () => undefined });

    expect(() => openOwnedDurableQueue(options())).toThrow('Single-instance lock owner required');
    expect(existsSync(storePath)).toBe(false);
  });
});

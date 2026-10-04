import { describe, expect, it, vi } from 'vitest';
import { createDefaultTimeline } from '../src/types';
import { createExactPreviewController } from '../electron/remotion/preview-still';

const input = () => ({ timeline: createDefaultTimeline(), srtEntries: [], projectDir: 'synthetic-project' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('exact paused preview session', () => {
  it('only the creating window can render valid frames and reuse a completed frame', async () => {
    const render = vi.fn(async (frame: number) => new Uint8Array([frame]));
    const dispose = vi.fn(async () => undefined);
    const controller = createExactPreviewController(async () => ({ durationInFrames: 100, fps: 30, render, dispose }));
    const { sessionId } = await controller.prepare(11, input());
    await expect(controller.render(12, sessionId, 42)).rejects.toThrow();
    await expect(controller.render(11, sessionId, -1)).rejects.toThrow();
    await expect(controller.render(11, sessionId, 100)).rejects.toThrow();
    expect((await controller.render(11, sessionId, 42)).png).toEqual(new Uint8Array([42]));
    expect((await controller.render(11, sessionId, 42)).png).toEqual(new Uint8Array([42]));
    expect(render).toHaveBeenCalledTimes(1);
    await controller.release(11, sessionId);
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(controller.render(11, sessionId, 42)).rejects.toThrow();
  });

  it('a newer requested frame invalidates a late result and release waits for rendering before disposal', async () => {
    const first = deferred<Uint8Array>();
    const render = vi.fn((frame: number) => frame === 42 ? first.promise : Promise.resolve(new Uint8Array([frame])));
    const dispose = vi.fn(async () => undefined);
    const controller = createExactPreviewController(async () => ({ durationInFrames: 100, fps: 30, render, dispose }));
    const { sessionId } = await controller.prepare(11, input());
    const older = controller.render(11, sessionId, 42);
    const newer = controller.render(11, sessionId, 43);
    expect(dispose).not.toHaveBeenCalled();
    first.resolve(new Uint8Array([42]));
    await expect(older).rejects.toThrow();
    expect((await newer).png).toEqual(new Uint8Array([43]));
    await controller.release(11, sessionId);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('switching projects invalidates prior sessions and window close releases the current one', async () => {
    const dispose = vi.fn(async () => undefined);
    const controller = createExactPreviewController(async () => ({
      durationInFrames: 100, fps: 30,
      render: async (frame: number) => new Uint8Array([frame]), dispose,
    }));
    const old = await controller.prepare(11, input());
    const current = await controller.prepare(11, input());
    expect(old.sessionId).not.toBe(current.sessionId);
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(controller.render(11, old.sessionId, 42)).rejects.toThrow();
    await controller.releaseOwner(11);
    expect(dispose).toHaveBeenCalledTimes(2);
    await expect(controller.render(11, current.sessionId, 42)).rejects.toThrow();
  });
});

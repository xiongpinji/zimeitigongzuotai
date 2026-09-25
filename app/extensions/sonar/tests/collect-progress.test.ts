import { describe, it, expect, vi } from 'vitest';
import { createCollectProgressHub, type CollectProgressInfo } from '@/background/collect-progress';

function makeHub() {
  let t = 1000;
  const persisted: Record<string, CollectProgressInfo>[] = [];
  const hub = createCollectProgressHub({
    now: () => (t += 1),
    persist: (all) => void persisted.push(all),
  });
  return { hub, persisted };
}

describe('createCollectProgressHub', () => {
  it('stores latest progress and persists each update', () => {
    const { hub, persisted } = makeHub();
    hub.update({ secUid: 'a', collected: 10, total: 100, round: 1, done: false });
    hub.update({ secUid: 'a', collected: 50, total: 100, round: 3, done: false });
    expect(hub.get('a')).toMatchObject({ collected: 50, round: 3, done: false });
    expect(hub.get('missing')).toBeNull();
    expect(persisted).toHaveLength(2);
    expect(persisted.at(-1)?.a.collected).toBe(50);
  });

  it('waitForDone resolves immediately if already done', async () => {
    const { hub } = makeHub();
    hub.update({ secUid: 'a', collected: 100, total: 100, round: 9, done: true });
    await expect(hub.waitForDone('a', 1000)).resolves.toMatchObject({ done: true, collected: 100 });
  });

  it('waitForDone resolves when a later done update arrives', async () => {
    const { hub } = makeHub();
    const p = hub.waitForDone('a', 10_000);
    hub.update({ secUid: 'a', collected: 20, total: 100, round: 1, done: false });
    hub.update({ secUid: 'a', collected: 100, total: 100, round: 5, done: true });
    await expect(p).resolves.toMatchObject({ done: true, collected: 100 });
  });

  it('waitForDone resolves to last-known (or null) on timeout', async () => {
    vi.useFakeTimers();
    try {
      const { hub } = makeHub();
      hub.update({ secUid: 'a', collected: 30, total: 100, round: 2, done: false });
      const p = hub.waitForDone('a', 5000);
      vi.advanceTimersByTime(5000);
      await expect(p).resolves.toMatchObject({ done: false, collected: 30 });

      const p2 = hub.waitForDone('never', 5000);
      vi.advanceTimersByTime(5000);
      await expect(p2).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createFullCollectRunner, profileUrlForSecUid } from '@/background/collect-tab';
import { createCollectProgressHub } from '@/background/collect-progress';

const noSleep = (_ms: number) => Promise.resolve();

function makeHub() {
  let t = 0;
  return createCollectProgressHub({ now: () => (t += 1), persist: () => {} });
}

describe('profileUrlForSecUid', () => {
  it('builds the douyin user url', () => {
    expect(profileUrlForSecUid('MS4wABC')).toBe('https://www.douyin.com/user/MS4wABC');
  });
});

describe('createFullCollectRunner (current-tab)', () => {
  it('drives the active tab and resolves on done (no tab open/close)', async () => {
    const hub = makeHub();
    const queryActiveTab = vi.fn(async () => ({ id: 42, url: 'https://www.douyin.com/user/a' }));
    // 模拟 Content Script：收到 start 后（runner 已重置进度）异步上报 done。
    const sendMessage = vi.fn(async (_id: number, _m: unknown) => {
      queueMicrotask(() => hub.update({ secUid: 'a', collected: 606, total: 607, round: 21, done: true }));
      return { ok: true };
    });
    const runner = createFullCollectRunner({ hub, queryActiveTab, sendMessage, sleep: noSleep });

    const r = await runner.collectCreatorFully({ secUid: 'a' });

    expect(queryActiveTab).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(42, { kind: 'sonar/start-full-collect', secUid: 'a' });
    expect(r).toMatchObject({ ok: true, collected: 606, total: 607 });
  });

  it('resets stale done before waiting (re-run after a previous collect)', async () => {
    const hub = makeHub();
    // 上一轮残留 done:true/20。
    hub.update({ secUid: 'a', collected: 20, total: 607, round: 7, done: true });
    const sendMessage = vi.fn(async () => {
      // 若 runner 未重置，waitForDone 会立刻命中旧 done(20)；重置后须等到新的 done(606)。
      queueMicrotask(() => hub.update({ secUid: 'a', collected: 606, total: 607, round: 21, done: true }));
      return { ok: true };
    });
    const runner = createFullCollectRunner({ hub, queryActiveTab: async () => ({ id: 1 }), sendMessage, sleep: noSleep });
    await expect(runner.collectCreatorFully({ secUid: 'a' })).resolves.toMatchObject({ ok: true, collected: 606 });
  });

  it('retries start message until content script acks', async () => {
    const hub = makeHub();
    let attempts = 0;
    const sendMessage = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('Receiving end does not exist');
      queueMicrotask(() => hub.update({ secUid: 'a', collected: 5, total: 5, round: 1, done: true }));
      return { ok: true };
    });
    const runner = createFullCollectRunner({ hub, queryActiveTab: async () => ({ id: 1 }), sendMessage, sleep: noSleep });
    const r = await runner.collectCreatorFully({ secUid: 'a' });
    expect(attempts).toBe(3);
    expect(r.ok).toBe(true);
  });

  it('fails with no_tab when there is no active tab', async () => {
    const runner = createFullCollectRunner({
      hub: makeHub(),
      queryActiveTab: async () => undefined,
      sendMessage: async () => ({ ok: true }),
      sleep: noSleep,
    });
    await expect(runner.collectCreatorFully({ secUid: 'a' })).resolves.toMatchObject({
      ok: false,
      reason: 'no_tab',
    });
  });

  it('returns not_ready when content script never acks', async () => {
    const runner = createFullCollectRunner({
      hub: makeHub(),
      queryActiveTab: async () => ({ id: 7 }),
      sendMessage: async () => ({ ok: false }),
      sleep: noSleep,
      readyTimeoutMs: 3,
    });
    await expect(runner.collectCreatorFully({ secUid: 'a' })).resolves.toMatchObject({
      ok: false,
      reason: 'not_ready',
    });
  });

  it('returns timeout with last-known progress when collect never completes', async () => {
    const hub = makeHub();
    const runner = createFullCollectRunner({
      hub,
      queryActiveTab: async () => ({ id: 9 }),
      // 上报中途进度但永不 done。
      sendMessage: async () => {
        queueMicrotask(() => hub.update({ secUid: 'a', collected: 300, total: 607, round: 10, done: false }));
        return { ok: true };
      },
      sleep: noSleep,
      collectTimeoutMs: 20,
    });
    const r = await runner.collectCreatorFully({ secUid: 'a' });
    expect(r).toMatchObject({ ok: false, reason: 'timeout', collected: 300 });
  });
});

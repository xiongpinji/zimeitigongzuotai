import { describe, it, expect } from 'vitest';
import { parseLock, isLockActive, type EditLock } from '../electron/ai-edit/lock-state';

const base: EditLock = { owner: 'codex', scope: 'video', startedAt: 1000, heartbeat: 1000, ttlMs: 30000 };

describe('parseLock', () => {
  it('合法 JSON 解析成 EditLock', () => {
    expect(parseLock(JSON.stringify(base))).toEqual(base);
  });
  it('非法 JSON 返回 null', () => {
    expect(parseLock('{bad')).toBeNull();
  });
  it('缺字段返回 null', () => {
    expect(parseLock(JSON.stringify({ owner: 'x' }))).toBeNull();
  });
});

describe('isLockActive', () => {
  it('心跳在 TTL 内为 active', () => {
    expect(isLockActive(base, 1000 + 29000)).toBe(true);
  });
  it('心跳超过 TTL 为 inactive（视为遗忘锁）', () => {
    expect(isLockActive(base, 1000 + 31000)).toBe(false);
  });
});

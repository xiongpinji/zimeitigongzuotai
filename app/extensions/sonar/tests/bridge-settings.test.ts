import { describe, it, expect } from 'vitest';
import {
  applyBridgeSettingsUpdate,
  defaultBridgeSettings,
  migrateBridgeSettings,
  toBridgeSettingsView,
  createMemoryBridgeSettingsStore,
} from '@/bridge/bridge-settings';

describe('bridge-settings 纯逻辑', () => {
  it('默认值：未启用、本地端点、无 token', () => {
    expect(defaultBridgeSettings()).toEqual({
      enabled: false,
      endpoint: 'http://127.0.0.1:19820',
      token: '',
    });
  });

  it('migrate 容错任意结构', () => {
    expect(migrateBridgeSettings(null)).toEqual(defaultBridgeSettings());
    expect(migrateBridgeSettings({ enabled: true, endpoint: 'http://x', token: 't' })).toEqual({
      enabled: true,
      endpoint: 'http://x',
      token: 't',
    });
    expect(migrateBridgeSettings({ endpoint: '' }).endpoint).toBe('http://127.0.0.1:19820');
  });

  it('update：省略 token 保留既有', () => {
    const cur = { enabled: false, endpoint: 'http://127.0.0.1:19820', token: 'old' };
    const next = applyBridgeSettingsUpdate(cur, { enabled: true });
    expect(next.token).toBe('old');
    expect(next.enabled).toBe(true);
  });

  it('update：空串 token 视为不变', () => {
    const cur = { enabled: true, endpoint: 'http://x', token: 'old' };
    expect(applyBridgeSettingsUpdate(cur, { token: '' }).token).toBe('old');
    expect(applyBridgeSettingsUpdate(cur, { token: 'new' }).token).toBe('new');
  });

  it('view 遮罩 token，不回读明文，configured 计算正确', () => {
    const v = toBridgeSettingsView({ enabled: true, endpoint: 'http://x', token: 'abcdef1234' });
    expect(v).toMatchObject({ enabled: true, endpoint: 'http://x', hasToken: true, configured: true });
    expect(v.tokenMasked).toBe('••••1234');
    expect((v as unknown as Record<string, unknown>).token).toBeUndefined();

    expect(toBridgeSettingsView({ enabled: false, endpoint: 'http://x', token: 't' }).configured).toBe(false);
    expect(toBridgeSettingsView({ enabled: true, endpoint: 'http://x', token: '' }).configured).toBe(false);
  });

  it('内存 store 读写', async () => {
    const store = createMemoryBridgeSettingsStore();
    await store.update({ enabled: true, endpoint: 'http://y', token: 'k' });
    expect(await store.get()).toEqual({ enabled: true, endpoint: 'http://y', token: 'k' });
  });
});

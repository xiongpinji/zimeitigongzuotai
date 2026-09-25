import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../electron/publish/accounts';

function freshStore() {
  const root = mkdtempSync(join(tmpdir(), 'pub-acc-'));
  return new AccountStore(root);
}

describe('AccountStore', () => {
  let store: AccountStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('storageState 路径为 accounts/<platform>_<account>.json', () => {
    const p = store.storageStatePath('douyin', '一叶知秋');
    expect(p.endsWith('accounts/douyin_一叶知秋.json')).toBe(true);
  });

  it('upsert 后 list 能读回，且 id 正确', () => {
    store.upsert({ platform: 'douyin', accountName: '一叶知秋', status: 'valid' });
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('douyin_一叶知秋');
    expect(list[0].storageStatePath).toBe(store.storageStatePath('douyin', '一叶知秋'));
  });

  it('remove 删除 registry 条目与 storageState 文件', () => {
    store.upsert({ platform: 'douyin', accountName: 'a', status: 'valid' });
    const sp = store.storageStatePath('douyin', 'a');
    writeFileSync(sp, '{}');
    store.remove('douyin_a');
    expect(store.list()).toHaveLength(0);
    expect(existsSync(sp)).toBe(false);
  });

  it('importCookie 把外部 storageState JSON 拷入并登记', () => {
    const ext = join(mkdtempSync(join(tmpdir(), 'ext-')), 'douyin_一叶知秋.json');
    writeFileSync(ext, JSON.stringify({ cookies: [], origins: [] }));
    const acc = store.importCookie('douyin', '一叶知秋', ext);
    expect(acc.id).toBe('douyin_一叶知秋');
    expect(existsSync(acc.storageStatePath)).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  it('upsert 更新已存在账号：不重复且保留旧字段', () => {
    store.upsert({ platform: 'douyin', accountName: 'a', status: 'unknown', lastCheckedAt: 111 });
    const updated = store.upsert({ platform: 'douyin', accountName: 'a', status: 'valid' });
    const list = store.list();
    expect(list).toHaveLength(1);                  // 未重复
    expect(list[0].status).toBe('valid');          // 新状态生效
    expect(list[0].lastCheckedAt).toBe(111);       // 旧字段保留
    expect(updated.status).toBe('valid');          // 返回值反映合并结果
    expect(updated.lastCheckedAt).toBe(111);       // 返回值保留旧字段（Fix 1 回归）
  });

  it('setStatus 更新状态与 lastCheckedAt', () => {
    store.upsert({ platform: 'douyin', accountName: 'a', status: 'unknown' });
    store.setStatus('douyin_a', 'valid', 999);
    const acc = store.list()[0];
    expect(acc.status).toBe('valid');
    expect(acc.lastCheckedAt).toBe(999);
  });

  it('setStatus 对未知 id 不报错也不改动', () => {
    store.upsert({ platform: 'douyin', accountName: 'a', status: 'valid' });
    expect(() => store.setStatus('douyin_missing', 'expired')).not.toThrow();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].status).toBe('valid');
  });

  it('getSettings 缺省返回无头登录默认值', () => {
    expect(store.getSettings()).toEqual({ headlessLogin: true });
  });

  it('setSettings 写入后可回读，且合并已有字段', () => {
    expect(store.setSettings({ headlessLogin: false })).toEqual({ headlessLogin: false });
    expect(store.getSettings()).toEqual({ headlessLogin: false });
    // 再次部分写入仍合并默认/已有键
    expect(store.setSettings({})).toEqual({ headlessLogin: false });
  });
});

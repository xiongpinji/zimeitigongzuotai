import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_MIGRATION_PREVIEW_CHANNEL,
  previewLegacyMigration,
  registerLegacyMigrationPreviewIpc,
} from '../../electron/publish/legacy-migration-preview';

const SECRET = 'SECRET-ACCOUNT-NAME-AND-SESSION-CONTENT';
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lingji-a2s4b-'));
  roots.push(root);
  const legacyRoot = join(root, 'publish');
  const newRoot = join(root, 'publish-v2');
  mkdirSync(legacyRoot);
  return { root, legacyRoot, newRoot, registry: join(legacyRoot, 'registry.json') };
}

function entry(platform: string, accountName: string, status = 'valid') {
  return { platform, accountName, status, lastCheckedAt: 100 };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-a2s4b-')) {
      throw new Error('unsafe test cleanup path');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

describe('legacy migration preview: read-only metadata boundary', () => {
  it('四平台计数、B 站排除、匿名序号；旧/新目录字节和目录项完全不变', () => {
    const { legacyRoot, newRoot, registry } = fixture();
    const rows = [
      entry('douyin', `${SECRET}-抖音`),
      entry('kuaishou', `${SECRET}-快手`, 'expired'),
      entry('tencent', `${SECRET}-视频号`, 'unknown'),
      entry('xiaohongshu', `${SECRET}-小红书`),
      entry('bilibili', `${SECRET}-B站`),
    ];
    writeFileSync(registry, JSON.stringify(rows), 'utf8');
    mkdirSync(join(legacyRoot, 'accounts'));
    const sessionPath = join(legacyRoot, 'accounts', `douyin_${SECRET}-抖音.json`);
    writeFileSync(sessionPath, SECRET, 'utf8');
    const oldRegistryBytes = readFileSync(registry);
    const oldSessionBytes = readFileSync(sessionPath);
    const oldEntries = readdirSync(legacyRoot).sort();
    expect(existsSync(newRoot)).toBe(false);

    const result = previewLegacyMigration(legacyRoot);
    expect(result).toMatchObject({
      ok: true,
      total: 5,
      eligible: 4,
      excluded: 1,
      byPlatform: { douyin: 1, kuaishou: 1, tencent: 1, xiaohongshu: 1, bilibili: 1 },
    });
    if (result.ok) {
      expect(result.accounts.map((account) => account.index)).toEqual([1, 2, 3, 4, 5]);
      expect(result.accounts[4].eligibility).toBe('unsupported_platform');
      expect(result.accounts[1].status).toBe('expired');
    }
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(legacyRoot);
    expect(readFileSync(registry)).toEqual(oldRegistryBytes);
    expect(readFileSync(sessionPath)).toEqual(oldSessionBytes);
    expect(readdirSync(legacyRoot).sort()).toEqual(oldEntries);
    expect(existsSync(newRoot)).toBe(false);
  });

  it('缺失与损坏注册表固定拒绝，不创建新旧账号仓', () => {
    const { legacyRoot, newRoot, registry } = fixture();
    expect(previewLegacyMigration(legacyRoot)).toMatchObject({ ok: false, code: 'registry_missing' });
    expect(readdirSync(legacyRoot)).toEqual([]);
    expect(existsSync(newRoot)).toBe(false);
    writeFileSync(registry, '{broken', 'utf8');
    const before = readFileSync(registry);
    expect(previewLegacyMigration(legacyRoot)).toMatchObject({ ok: false, code: 'registry_corrupt' });
    expect(readFileSync(registry)).toEqual(before);
    expect(existsSync(newRoot)).toBe(false);
  });

  it('重复旧 ID、未知平台、路径穿越昵称、非法状态整表 fail closed，且输出脱敏', () => {
    const { legacyRoot, registry } = fixture();
    const badRows = [
      [entry('douyin', '甲'), entry('douyin', '甲')],
      [entry('weibo', SECRET)],
      [entry('douyin', '../escape')],
      [entry('douyin', SECRET, 'not-a-status')],
      { unexpected: true },
    ];
    for (const bad of badRows) {
      writeFileSync(registry, JSON.stringify(bad), 'utf8');
      const result = previewLegacyMigration(legacyRoot);
      expect(result).toMatchObject({ ok: false, code: 'registry_corrupt' });
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain(legacyRoot);
    }
  });

  it('注册表不是普通文件、旧根不存在或非法路径时安全拒绝', () => {
    const { root, legacyRoot, registry } = fixture();
    mkdirSync(registry);
    expect(previewLegacyMigration(legacyRoot)).toMatchObject({ ok: false, code: 'registry_unsafe' });
    expect(previewLegacyMigration(join(root, 'absent'))).toMatchObject({ ok: false, code: 'registry_missing' });
    expect(previewLegacyMigration('relative/path')).toMatchObject({ ok: false, code: 'invalid_root' });
  });

  it('超过有界读取上限时固定拒绝且不修改旧文件', () => {
    const { legacyRoot, registry } = fixture();
    writeFileSync(registry, ' '.repeat(4 * 1024 * 1024 + 1), 'utf8');
    const before = readFileSync(registry);
    expect(previewLegacyMigration(legacyRoot)).toMatchObject({ ok: false, code: 'registry_too_large' });
    expect(readFileSync(registry).equals(before)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('注册表 symlink 直接拒绝（Windows 测试机无建链权限）', () => {
    const { legacyRoot, registry } = fixture();
    const target = join(legacyRoot, 'other.json');
    writeFileSync(target, JSON.stringify([entry('douyin', SECRET)]), 'utf8');
    symlinkSync(target, registry, 'file');
    const result = previewLegacyMigration(legacyRoot);
    expect(result).toMatchObject({ ok: false, code: 'registry_unsafe' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('IPC 使用封闭旧根，拒绝调用方传入路径；不实例化旧 AccountStore 或新 vault', async () => {
    const { legacyRoot, registry } = fixture();
    writeFileSync(registry, JSON.stringify([entry('douyin', SECRET)]), 'utf8');
    const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>();
    registerLegacyMigrationPreviewIpc({
      ipc: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      legacyRoot,
    });
    expect([...handlers.keys()]).toEqual([LEGACY_MIGRATION_PREVIEW_CHANNEL]);
    const invoke = handlers.get(LEGACY_MIGRATION_PREVIEW_CHANNEL)!;
    const valid = await invoke({ sender: {} });
    expect(valid).toMatchObject({ ok: true, total: 1 });
    expect(JSON.stringify(valid)).not.toContain(SECRET);
    const bad = await invoke({ sender: {} }, join(legacyRoot, 'other'));
    expect(bad).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(JSON.stringify(bad)).not.toContain(legacyRoot);
    expect(readdirSync(legacyRoot)).toEqual(['registry.json']);
  });
});

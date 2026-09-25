import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AccountVault,
  AccountVaultError,
  SESSION_FILE_EXT,
  type AccountVaultDeps,
  type SessionCipher,
} from '../../electron/publish/accounts-v2';
import { createSafeStorageCipher } from '../../electron/publish/session-cipher-electron';

// ─── node:fs 观测 / 故障注入 ──────────────────────────────────────────────────
// 透传真实实现，只额外记录 fsync / rename 的调用顺序（验证 rename 前 fsync），
// 并可按需注入一次性错误码（验证失败时原文件不被清空、tmp 被清理）。
const fsHooks = vi.hoisted(() => ({
  order: [] as string[],
  failFsyncCode: null as string | null,
  failRenameCode: null as string | null,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const injected = (code: string, op: string): NodeJS.ErrnoException => {
    const err = new Error(`INJECTED-${op}-FAILURE-RAW-TEXT`) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  };
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      fsHooks.order.push('fsync');
      if (fsHooks.failFsyncCode) throw injected(fsHooks.failFsyncCode, 'fsync');
      return actual.fsyncSync(fd);
    },
    renameSync: (
      from: Parameters<typeof actual.renameSync>[0],
      to: Parameters<typeof actual.renameSync>[1],
    ) => {
      fsHooks.order.push('rename');
      if (fsHooks.failRenameCode) throw injected(fsHooks.failRenameCode, 'rename');
      return actual.renameSync(from, to);
    },
  };
});

beforeEach(() => {
  fsHooks.order.length = 0;
  fsHooks.failFsyncCode = null;
  fsHooks.failRenameCode = null;
});

// ⚠️ 测试专用假加密器：只做可逆编码，没有任何安全性。
// 仅用于验证 AccountVault 的边界行为（fail closed、原子写、迁移核验），
// 严禁在生产路径使用；生产适配器是 session-cipher-electron.ts 的 safeStorage 实现。
class FakeCipher implements SessionCipher {
  available = true;
  failEncrypt = false;
  corruptDecrypt = false;

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(plaintext: Buffer): Buffer {
    if (this.failEncrypt) throw new Error('fake encrypt failure');
    return Buffer.from(`fake1:${plaintext.toString('base64')}`, 'utf-8');
  }

  decrypt(ciphertext: Buffer): Buffer {
    const text = ciphertext.toString('utf-8');
    if (!text.startsWith('fake1:')) throw new Error('not a fake cipher payload');
    const plain = Buffer.from(text.slice('fake1:'.length), 'base64');
    if (this.corruptDecrypt) return Buffer.concat([plain, Buffer.from('X')]);
    return plain;
  }
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_REF_RE = /^s1-[0-9a-f]{32}$/;

const SECRET_COOKIE_VALUE = 'SECRET-SESSIONID-VALUE-DO-NOT-PERSIST';

function storageStateFixture(tag: string): string {
  return JSON.stringify({
    cookies: [{ name: 'sessionid', value: `${SECRET_COOKIE_VALUE}-${tag}`, domain: '.example.test' }],
    origins: [],
  });
}

function makeVault(nowStart = 1_700_000_000_000, extraDeps: AccountVaultDeps = {}) {
  const root = mkdtempSync(join(tmpdir(), 'accounts-v2-'));
  const tmpBase = mkdtempSync(join(tmpdir(), 'accounts-v2-tmp-'));
  const cipher = new FakeCipher();
  let clock = nowStart;
  const vault = new AccountVault(root, cipher, {
    now: () => clock,
    tmpBaseDir: tmpBase,
    ...extraDeps,
  });
  return {
    root,
    tmpBase,
    cipher,
    vault,
    advanceClock(ms: number) {
      clock += ms;
    },
    registryText(): string {
      return readFileSync(join(root, 'registry.json'), 'utf-8');
    },
    sessionsDirEntries(): string[] {
      const dir = join(root, 'sessions');
      return existsSync(dir) ? readdirSync(dir) : [];
    },
  };
}

function expectVaultError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected a thrown error with code ${code}`).toBeInstanceOf(AccountVaultError);
  expect((caught as AccountVaultError).code).toBe(code);
}

function seedLegacyRoot(
  entries: Array<{
    platform: string;
    accountName: string;
    status: 'valid' | 'expired' | 'unknown';
    lastCheckedAt?: number;
    storageState?: string;
  }>,
): string {
  const root = mkdtempSync(join(tmpdir(), 'legacy-publish-'));
  mkdirSync(join(root, 'accounts'), { recursive: true });
  writeFileSync(
    join(root, 'registry.json'),
    JSON.stringify(
      entries.map(({ platform, accountName, status, lastCheckedAt }) => ({
        platform,
        accountName,
        status,
        ...(lastCheckedAt != null ? { lastCheckedAt } : {}),
      })),
      null,
      2,
    ),
  );
  for (const entry of entries) {
    if (entry.storageState != null) {
      writeFileSync(
        join(root, 'accounts', `${entry.platform}_${entry.accountName}.json`),
        entry.storageState,
      );
    }
  }
  return root;
}

function legacyRegistryEntries(root: string): Array<{ platform: string; accountName: string }> {
  return JSON.parse(readFileSync(join(root, 'registry.json'), 'utf-8'));
}

describe('AccountVault：UUID 元数据注册', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  it('同平台两个账号（即使昵称相同）拥有互不相同的 UUID，且 id 不由昵称拼出', () => {
    const a = ctx.vault.createAccount({ platform: 'douyin', displayName: '一叶知秋' });
    const b = ctx.vault.createAccount({ platform: 'douyin', displayName: '一叶知秋' });

    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(UUID_V4_RE);
    expect(b.id).toMatch(UUID_V4_RE);
    expect(a.id).not.toContain('一叶知秋');
    expect(b.id).not.toContain('douyin');
    expect(a.displayName).toBe('一叶知秋');
    expect(ctx.vault.listAccounts()).toHaveLength(2);
  });

  it('同名不同平台账号相互隔离：id、sessionRef、解密内容各自独立', async () => {
    const dy = ctx.vault.createAccount({ platform: 'douyin', displayName: '同名工作室' });
    const ks = ctx.vault.createAccount({ platform: 'kuaishou', displayName: '同名工作室' });
    expect(dy.id).not.toBe(ks.id);

    ctx.vault.saveStorageState(dy.id, storageStateFixture('dy'));
    ctx.vault.saveStorageState(ks.id, storageStateFixture('ks'));

    const dyRef = ctx.vault.getAccount(dy.id).sessionRef;
    const ksRef = ctx.vault.getAccount(ks.id).sessionRef;
    expect(dyRef).toBeTruthy();
    expect(ksRef).toBeTruthy();
    expect(dyRef).not.toBe(ksRef);

    let dyContent = '';
    let ksContent = '';
    await ctx.vault.withDecryptedStorageState(dy.id, (p) => {
      dyContent = readFileSync(p, 'utf-8');
    });
    await ctx.vault.withDecryptedStorageState(ks.id, (p) => {
      ksContent = readFileSync(p, 'utf-8');
    });
    expect(dyContent).toBe(storageStateFixture('dy'));
    expect(ksContent).toBe(storageStateFixture('ks'));
  });

  it('createAccount 拒绝阶段一范围外平台与空昵称', () => {
    expectVaultError(
      () => ctx.vault.createAccount({ platform: 'bilibili', displayName: 'x' }),
      'invalid_platform',
    );
    expectVaultError(
      () => ctx.vault.createAccount({ platform: 'douyin', displayName: '   ' }),
      'invalid_account',
    );
    expect(ctx.vault.listAccounts()).toHaveLength(0);
  });

  it('未知 accountId 的所有操作显式抛 account_not_found', () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expectVaultError(() => ctx.vault.getAccount(missing), 'account_not_found');
    expectVaultError(() => ctx.vault.saveStorageState(missing, '{}'), 'account_not_found');
    expectVaultError(() => ctx.vault.updateStatusFromProbe(missing, true), 'account_not_found');
    expectVaultError(() => ctx.vault.removeAccount(missing), 'account_not_found');
  });
});

describe('AccountVault：加密会话仓', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  it('sessionRef 为不可预测引用，会话文件仅以引用寻址，registry 不含会话内容', () => {
    const acc = ctx.vault.createAccount({ platform: 'xiaohongshu', displayName: '小红书号A' });
    const saved = ctx.vault.saveStorageState(acc.id, storageStateFixture('xhs'));

    expect(saved.sessionRef).toMatch(SESSION_REF_RE);
    expect(saved.sessionRef).not.toContain('小红书号A');

    const sessionFile = join(ctx.root, 'sessions', `${saved.sessionRef}${SESSION_FILE_EXT}`);
    expect(existsSync(sessionFile)).toBe(true);
    // 会话文件路径不含昵称
    expect(sessionFile).not.toContain('小红书号A');
    // 磁盘上的会话文件是密文，不是明文
    expect(readFileSync(sessionFile, 'utf-8')).not.toContain(SECRET_COOKIE_VALUE);

    // registry 只有元数据：不含 Cookie/Token/storageState 内容
    const registryText = ctx.registryText();
    expect(registryText).not.toContain(SECRET_COOKIE_VALUE);
    expect(registryText).not.toContain('cookies');
    expect(registryText).not.toContain('origins');
    expect(registryText).not.toContain('sessionid');

    // vault 目录里没有任何以昵称命名的文件
    const walked: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        walked.push(entry.name);
        if (entry.isDirectory()) walk(join(dir, entry.name));
      }
    };
    walk(ctx.root);
    expect(walked.some((name) => name.includes('小红书号A'))).toBe(false);
  });

  it('加密不可用时 fail closed：抛 cipher_unavailable，绝不落明文', () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '无加密环境' });
    ctx.cipher.available = false;

    expectVaultError(
      () => ctx.vault.saveStorageState(acc.id, storageStateFixture('nocipher')),
      'cipher_unavailable',
    );

    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
    expect(ctx.registryText()).not.toContain(SECRET_COOKIE_VALUE);
    // tmpBase 里也没有明文残留
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('回写核验失败（解密不一致）时不落库：显式抛错且无残留会话文件', () => {
    const acc = ctx.vault.createAccount({ platform: 'kuaishou', displayName: '核验账号' });
    ctx.cipher.corruptDecrypt = true;

    expectVaultError(
      () => ctx.vault.saveStorageState(acc.id, storageStateFixture('verify')),
      'session_verify_failed',
    );
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
  });

  it('重复保存轮换 sessionRef：旧密文文件删除，新引用可解密出最新内容', async () => {
    const acc = ctx.vault.createAccount({ platform: 'tencent', displayName: '视频号A' });
    const first = ctx.vault.saveStorageState(acc.id, storageStateFixture('v1'));
    const second = ctx.vault.saveStorageState(acc.id, storageStateFixture('v2'));

    expect(second.sessionRef).not.toBe(first.sessionRef);
    expect(existsSync(join(ctx.root, 'sessions', `${first.sessionRef}${SESSION_FILE_EXT}`))).toBe(false);
    expect(existsSync(join(ctx.root, 'sessions', `${second.sessionRef}${SESSION_FILE_EXT}`))).toBe(true);

    let content = '';
    await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
      content = readFileSync(p, 'utf-8');
    });
    expect(content).toBe(storageStateFixture('v2'));
    expect(ctx.vault.getAccount(acc.id).sessionRef).toBe(second.sessionRef);
  });

  it('registry 损坏时显式报错，不当作空账号列表', () => {
    ctx.vault.createAccount({ platform: 'douyin', displayName: 'a' });
    writeFileSync(join(ctx.root, 'registry.json'), '{ broken json !!!');
    expectVaultError(() => ctx.vault.listAccounts(), 'registry_corrupt');
  });

  it('registry schema 版本不支持时显式报错', () => {
    ctx.vault.createAccount({ platform: 'douyin', displayName: 'a' });
    writeFileSync(join(ctx.root, 'registry.json'), JSON.stringify({ schemaVersion: 99, accounts: [] }));
    expectVaultError(() => ctx.vault.listAccounts(), 'registry_unsupported_version');
  });

  it('会话文件缺失 / 无法解密时显式报错，错误信息不带会话内容', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '会话异常' });
    const saved = ctx.vault.saveStorageState(acc.id, storageStateFixture('missing'));
    const sessionFile = join(ctx.root, 'sessions', `${saved.sessionRef}${SESSION_FILE_EXT}`);

    rmSync(sessionFile);
    await expect(
      ctx.vault.withDecryptedStorageState(acc.id, async () => undefined),
    ).rejects.toMatchObject({ code: 'session_file_missing' });

    writeFileSync(sessionFile, 'GARBAGE-NOT-CIPHERTEXT-ZZZZ');
    let caught: unknown;
    try {
      await ctx.vault.withDecryptedStorageState(acc.id, async () => undefined);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AccountVaultError);
    expect((caught as AccountVaultError).code).toBe('session_decrypt_failed');
    expect((caught as Error).message).not.toContain('GARBAGE-NOT-CIPHERTEXT-ZZZZ');
    expect((caught as Error).message).not.toContain(SECRET_COOKIE_VALUE);
  });

  it('磁盘写入原子替换：操作后无 .tmp- 残留且 registry 始终可解析', () => {
    const a = ctx.vault.createAccount({ platform: 'douyin', displayName: 'a' });
    ctx.vault.saveStorageState(a.id, storageStateFixture('atomic'));
    ctx.vault.updateStatusFromProbe(a.id, false);
    ctx.vault.createAccount({ platform: 'kuaishou', displayName: 'b' });
    ctx.vault.removeAccount(a.id);

    const leftovers = readdirSync(ctx.root).filter((n) => n.includes('.tmp-'));
    expect(leftovers).toHaveLength(0);
    expect(() => JSON.parse(ctx.registryText())).not.toThrow();
    expect(ctx.vault.listAccounts()).toHaveLength(1);
  });
});

describe('AccountVault：短时明文临时文件', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  it('withDecryptedStorageState 在独立临时目录提供明文，返回后连同目录一并清理', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '临时明文' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('tmp'));

    let seenPath = '';
    const result = await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
      seenPath = p;
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf-8')).toBe(storageStateFixture('tmp'));
      // 位于专用临时基目录下
      expect(dirname(p).startsWith(ctx.tmpBase)).toBe(true);
      return 'done';
    });

    expect(result).toBe('done');
    expect(existsSync(seenPath)).toBe(false);
    expect(existsSync(dirname(seenPath))).toBe(false);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('回调抛错时 finally 仍清理临时明文，且错误原样传播', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '清理保证' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('cleanup'));

    let seenPath = '';
    await expect(
      ctx.vault.withDecryptedStorageState(acc.id, (p) => {
        seenPath = p;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(existsSync(seenPath)).toBe(false);
    expect(existsSync(dirname(seenPath))).toBe(false);
  });

  it('每次调用使用互不相同的临时目录', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '目录隔离' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('dirs'));

    const dirs: string[] = [];
    await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
      dirs.push(dirname(p));
    });
    await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
      dirs.push(dirname(p));
    });
    expect(dirs[0]).not.toBe(dirs[1]);
  });

  it('无会话（sessionRef 为 null）时显式抛 session_missing，不生成任何临时文件', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '未登录' });
    await expect(
      ctx.vault.withDecryptedStorageState(acc.id, async () => undefined),
    ).rejects.toMatchObject({ code: 'session_missing' });
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });
});

describe('AccountVault：单账号状态与删除隔离', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  function threeAccountsWithSessions() {
    const a = ctx.vault.createAccount({ platform: 'douyin', displayName: 'A' });
    const b = ctx.vault.createAccount({ platform: 'douyin', displayName: 'B' });
    const c = ctx.vault.createAccount({ platform: 'kuaishou', displayName: 'C' });
    ctx.vault.saveStorageState(a.id, storageStateFixture('A'));
    ctx.vault.saveStorageState(b.id, storageStateFixture('B'));
    ctx.vault.saveStorageState(c.id, storageStateFixture('C'));
    return { a, b, c };
  }

  it('探针更新只改目标账号：过期不波及同平台其他账号', () => {
    const { a, b, c } = threeAccountsWithSessions();
    ctx.advanceClock(5_000);

    const updated = ctx.vault.updateStatusFromProbe(a.id, false);
    expect(updated.status).toBe('expired');
    expect(updated.lastCheckedAt).toBe(1_700_000_005_000);

    expect(ctx.vault.getAccount(b.id).status).toBe('valid');
    expect(ctx.vault.getAccount(c.id).status).toBe('valid');
    expect(ctx.vault.getAccount(b.id).lastCheckedAt).toBe(1_700_000_000_000);
  });

  it('探针 ok=true 将过期账号恢复为 valid 并刷新时间戳', () => {
    const { a } = threeAccountsWithSessions();
    ctx.vault.updateStatusFromProbe(a.id, false);
    ctx.advanceClock(1_000);
    const updated = ctx.vault.updateStatusFromProbe(a.id, true);
    expect(updated.status).toBe('valid');
    expect(updated.lastCheckedAt).toBe(1_700_000_001_000);
  });

  it('删除账号连同其加密会话文件，其余账号元数据与会话完好', async () => {
    const { a, b, c } = threeAccountsWithSessions();
    const bRef = ctx.vault.getAccount(b.id).sessionRef as string;
    const bFile = join(ctx.root, 'sessions', `${bRef}${SESSION_FILE_EXT}`);

    ctx.vault.removeAccount(b.id);

    expect(ctx.vault.listAccounts().map((x) => x.id).sort()).toEqual([a.id, c.id].sort());
    expect(existsSync(bFile)).toBe(false);

    // a、c 会话仍可解密
    let aContent = '';
    let cContent = '';
    await ctx.vault.withDecryptedStorageState(a.id, (p) => {
      aContent = readFileSync(p, 'utf-8');
    });
    await ctx.vault.withDecryptedStorageState(c.id, (p) => {
      cContent = readFileSync(p, 'utf-8');
    });
    expect(aContent).toBe(storageStateFixture('A'));
    expect(cContent).toBe(storageStateFixture('C'));

    // 重复删除显式报错
    expectVaultError(() => ctx.vault.removeAccount(b.id), 'account_not_found');
  });

  it('listAccounts 返回副本：外部修改不污染 registry', () => {
    ctx.vault.createAccount({ platform: 'douyin', displayName: '副本' });
    const list = ctx.vault.listAccounts();
    list[0].displayName = '被篡改';
    list.push({ ...list[0], id: 'fake' });
    expect(ctx.vault.listAccounts()).toHaveLength(1);
    expect(ctx.vault.listAccounts()[0].displayName).toBe('副本');
  });

  it('损坏 registry 中的 sessionRef 必须拒绝，不能用路径跳出会话目录删除文件', () => {
    const account = ctx.vault.createAccount({ platform: 'douyin', displayName: '路径边界' });
    const outside = join(ctx.root, 'outside.bin');
    writeFileSync(outside, 'KEEP');
    const registry = JSON.parse(ctx.registryText());
    registry.accounts[0].sessionRef = '../outside';
    writeFileSync(join(ctx.root, 'registry.json'), JSON.stringify(registry));

    expectVaultError(() => ctx.vault.removeAccount(account.id), 'registry_corrupt');
    expect(readFileSync(outside, 'utf-8')).toBe('KEEP');
  });

  it('无效 storageState JSON 不进入加密会话仓，错误原因不暴露凭证', () => {
    const account = ctx.vault.createAccount({ platform: 'douyin', displayName: '输入校验' });
    expectVaultError(() => ctx.vault.saveStorageState(account.id, 'SECRET-not-json'), 'invalid_storage_state');
    expect(ctx.vault.getAccount(account.id).sessionRef).toBeNull();
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    const error = new AccountVaultError('session_encrypt_failed', 'safe', {
      cause: new Error('SECRET-cookie-value'),
    });
    expect(String(error.cause)).not.toContain('SECRET-cookie-value');
  });
});

describe('AccountVault：旧 registry 显式迁移', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  it('拒绝旧账号名中的路径分隔符，避免迁移读写越界', () => {
    const legacyRoot = mkdtempSync(join(tmpdir(), 'legacy-unsafe-'));
    writeFileSync(
      join(legacyRoot, 'registry.json'),
      JSON.stringify([{ platform: 'douyin', accountName: '../outside', status: 'valid' }]),
    );
    expectVaultError(() => ctx.vault.migrateFromLegacy(legacyRoot), 'legacy_registry_corrupt');
    expect(ctx.vault.listAccounts()).toHaveLength(0);
  });

  it('迁移成功：新 UUID + 加密会话；旧明文在写入并核验后才删除', async () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '一叶知秋', status: 'valid', lastCheckedAt: 123, storageState: storageStateFixture('legacy-dy') },
      { platform: 'tencent', accountName: '视频号老号', status: 'expired', storageState: storageStateFixture('legacy-tx') },
    ]);

    const report = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(report.migrated).toHaveLength(2);
    expect(report.failed).toHaveLength(0);
    const accounts = ctx.vault.listAccounts();
    expect(accounts).toHaveLength(2);

    for (const acc of accounts) {
      expect(acc.id).toMatch(UUID_V4_RE);
      expect(acc.sessionRef).toMatch(SESSION_REF_RE);
      expect(report.migrated.some((m) => m.accountId === acc.id)).toBe(true);
    }

    const dy = accounts.find((x) => x.platform === 'douyin');
    expect(dy?.displayName).toBe('一叶知秋');
    expect(dy?.status).toBe('valid');
    expect(dy?.lastCheckedAt).toBe(123);

    // 会话内容可解密还原
    let dyContent = '';
    await ctx.vault.withDecryptedStorageState(dy!.id, (p) => {
      dyContent = readFileSync(p, 'utf-8');
    });
    expect(dyContent).toBe(storageStateFixture('legacy-dy'));

    // 旧明文文件已删除，旧 registry 条目已移除
    expect(existsSync(join(legacyRoot, 'accounts', 'douyin_一叶知秋.json'))).toBe(false);
    expect(existsSync(join(legacyRoot, 'accounts', 'tencent_视频号老号.json'))).toBe(false);
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(0);

    // 新 registry 不含会话内容，但保留迁移溯源标记
    const registryText = ctx.registryText();
    expect(registryText).not.toContain(SECRET_COOKIE_VALUE);
    expect(registryText).toContain('douyin_一叶知秋');
  });

  it('加密失败：旧明文与旧 registry 原样保留，新仓无半成品', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: 'a', status: 'valid', storageState: storageStateFixture('fail-a') },
      { platform: 'kuaishou', accountName: 'b', status: 'valid', storageState: storageStateFixture('fail-b') },
    ]);
    ctx.cipher.failEncrypt = true;

    const report = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(report.migrated).toHaveLength(0);
    expect(report.failed).toHaveLength(2);
    expect(ctx.vault.listAccounts()).toHaveLength(0);
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    // 旧数据原样
    expect(readFileSync(join(legacyRoot, 'accounts', 'douyin_a.json'), 'utf-8')).toBe(storageStateFixture('fail-a'));
    expect(readFileSync(join(legacyRoot, 'accounts', 'kuaishou_b.json'), 'utf-8')).toBe(storageStateFixture('fail-b'));
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(2);
  });

  it('加密不可用时迁移 fail closed：整仓拒绝，不触碰旧数据', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: 'a', status: 'valid', storageState: storageStateFixture('nocipher') },
    ]);
    ctx.cipher.available = false;

    expectVaultError(() => ctx.vault.migrateFromLegacy(legacyRoot), 'cipher_unavailable');
    expect(ctx.vault.listAccounts()).toHaveLength(0);
    expect(readFileSync(join(legacyRoot, 'accounts', 'douyin_a.json'), 'utf-8')).toBe(storageStateFixture('nocipher'));
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(1);
  });

  it('核验失败（解密回读不一致）：删除新密文，旧明文保留', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: 'a', status: 'valid', storageState: storageStateFixture('verify-fail') },
    ]);
    ctx.cipher.corruptDecrypt = true;

    const report = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(report.failed).toHaveLength(1);
    expect(ctx.vault.listAccounts()).toHaveLength(0);
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(readFileSync(join(legacyRoot, 'accounts', 'douyin_a.json'), 'utf-8')).toBe(storageStateFixture('verify-fail'));
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(1);
  });

  it('范围外平台（bilibili）保守拒绝：跳过且旧文件不动', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'bilibili', accountName: 'bili号', status: 'valid', storageState: storageStateFixture('bili') },
      { platform: 'douyin', accountName: 'dy号', status: 'valid', storageState: storageStateFixture('dy') },
    ]);

    const report = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(report.skipped).toEqual([{ legacyId: 'bilibili_bili号', reason: 'unsupported_platform' }]);
    expect(report.migrated).toHaveLength(1);
    expect(existsSync(join(legacyRoot, 'accounts', 'bilibili_bili号.json'))).toBe(true);
    const legacyLeft = legacyRegistryEntries(legacyRoot);
    expect(legacyLeft).toHaveLength(1);
    expect(legacyLeft[0].platform).toBe('bilibili');
  });

  it('旧明文缺失：仅迁移元数据（无会话），不视为失败', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'xiaohongshu', accountName: '无会话号', status: 'unknown' },
    ]);

    const report = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(report.migratedWithoutSession).toHaveLength(1);
    const acc = ctx.vault.listAccounts()[0];
    expect(acc.sessionRef).toBeNull();
    expect(acc.status).toBe('unknown');
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(0);
  });

  it('幂等：旧 registry 因故障残留已迁移条目时，重跑不产生重复账号', async () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '幂等号', status: 'valid', storageState: storageStateFixture('idem') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(first.migrated).toHaveLength(1);

    // 模拟崩溃场景：把已迁移条目塞回旧 registry（明文文件已删）
    writeFileSync(
      join(legacyRoot, 'registry.json'),
      JSON.stringify([{ platform: 'douyin', accountName: '幂等号', status: 'valid' }]),
    );

    const second = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(second.migrated).toHaveLength(0);
    expect(second.skipped).toEqual([{ legacyId: 'douyin_幂等号', reason: 'already_migrated' }]);
    expect(ctx.vault.listAccounts()).toHaveLength(1);
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(0);
  });

  it('旧 registry 损坏：显式抛错，不做任何迁移', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: 'a', status: 'valid', storageState: storageStateFixture('corrupt') },
    ]);
    writeFileSync(join(legacyRoot, 'registry.json'), '### not json ###');

    expectVaultError(() => ctx.vault.migrateFromLegacy(legacyRoot), 'legacy_registry_corrupt');
    expect(ctx.vault.listAccounts()).toHaveLength(0);
    expect(existsSync(join(legacyRoot, 'accounts', 'douyin_a.json'))).toBe(true);
  });

  it('旧 registry 不存在：返回空报告，不抛错', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'legacy-empty-'));
    const report = ctx.vault.migrateFromLegacy(emptyRoot);
    expect(report).toEqual({
      migrated: [],
      migratedWithoutSession: [],
      skipped: [],
      failed: [],
      recovered: [],
      retainedResiduals: [],
    });
  });

  it('单条失败不阻断其他条目迁移', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: 'good', status: 'valid', storageState: storageStateFixture('good') },
      { platform: 'kuaishou', accountName: 'bad', status: 'valid', storageState: storageStateFixture('bad') },
    ]);
    // 只在加密包含 bad 夹具的内容时失败
    const originalEncrypt = ctx.cipher.encrypt.bind(ctx.cipher);
    ctx.cipher.encrypt = (plain: Buffer) => {
      if (plain.toString('utf-8').includes('PERSIST-bad')) throw new Error('selective failure');
      return originalEncrypt(plain);
    };

    const report = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(report.migrated).toHaveLength(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].legacyId).toBe('kuaishou_bad');
    expect(ctx.vault.listAccounts()).toHaveLength(1);
    // 失败条目的旧明文保留
    expect(readFileSync(join(legacyRoot, 'accounts', 'kuaishou_bad.json'), 'utf-8')).toBe(storageStateFixture('bad'));
    // 成功条目的旧明文已删
    expect(existsSync(join(legacyRoot, 'accounts', 'douyin_good.json'))).toBe(false);
  });
});

// ─── GLM 复审边界修复（P1-1 account-repair，输入 SHA 841763d） ─────────────────

describe('AccountVault：崩溃恢复的旧明文核验清理（边界修复）', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  function residualPath(legacyRoot: string, legacyId: string): string {
    return join(legacyRoot, 'accounts', `${legacyId}.json`);
  }

  it('崩溃续清理：旧 registry 条目已剔除但明文残留，重跑经新密文逐字节核验后才删除', async () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '崩溃号', status: 'valid', storageState: storageStateFixture('crash') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(first.migrated).toHaveLength(1);
    const accountId = first.migrated[0].accountId;
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(0);

    // 模拟崩溃：registry 重写已完成（条目已剔除），但旧明文删除前进程退出
    writeFileSync(residualPath(legacyRoot, 'douyin_崩溃号'), storageStateFixture('crash'));

    const second = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(existsSync(residualPath(legacyRoot, 'douyin_崩溃号'))).toBe(false);
    expect(second.recovered).toEqual([{ legacyId: 'douyin_崩溃号', accountId }]);
    expect(second.migrated).toHaveLength(0);
    // 不产生重复账号
    expect(ctx.vault.listAccounts()).toHaveLength(1);

    // 新仓会话不受影响，仍可解密回读
    let content = '';
    await ctx.vault.withDecryptedStorageState(accountId, (p) => {
      content = readFileSync(p, 'utf-8');
    });
    expect(content).toBe(storageStateFixture('crash'));
  });

  it('崩溃续清理：旧 registry 文件整体缺失时仍执行恢复清理', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'kuaishou', accountName: '丢表号', status: 'valid', storageState: storageStateFixture('lostreg') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(first.migrated).toHaveLength(1);
    rmSync(join(legacyRoot, 'registry.json'));
    writeFileSync(residualPath(legacyRoot, 'kuaishou_丢表号'), storageStateFixture('lostreg'));

    const second = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(existsSync(residualPath(legacyRoot, 'kuaishou_丢表号'))).toBe(false);
    expect(second.recovered).toEqual([
      { legacyId: 'kuaishou_丢表号', accountId: first.migrated[0].accountId },
    ]);
    expect(ctx.vault.listAccounts()).toHaveLength(1);
  });

  it('崩溃续清理：旧 registry 条目残留（already_migrated）且明文残留时，核验后才删除并计入 recovered', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '重跑号', status: 'valid', storageState: storageStateFixture('rerun') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(first.migrated).toHaveLength(1);

    // 模拟崩溃在任何清理之前：条目塞回旧 registry，明文也恢复
    writeFileSync(
      join(legacyRoot, 'registry.json'),
      JSON.stringify([{ platform: 'douyin', accountName: '重跑号', status: 'valid' }]),
    );
    writeFileSync(residualPath(legacyRoot, 'douyin_重跑号'), storageStateFixture('rerun'));

    const second = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(second.skipped).toEqual([{ legacyId: 'douyin_重跑号', reason: 'already_migrated' }]);
    expect(existsSync(residualPath(legacyRoot, 'douyin_重跑号'))).toBe(false);
    expect(second.recovered).toEqual([
      { legacyId: 'douyin_重跑号', accountId: first.migrated[0].accountId },
    ]);
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(0);
  });

  it('fail closed：新仓密文文件缺失时绝不删除残留旧明文', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '丢密文', status: 'valid', storageState: storageStateFixture('nospher') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    const acc = ctx.vault.getAccount(first.migrated[0].accountId);
    rmSync(join(ctx.root, 'sessions', `${acc.sessionRef}${SESSION_FILE_EXT}`)); // 模拟密文丢失
    writeFileSync(residualPath(legacyRoot, 'douyin_丢密文'), storageStateFixture('nospher'));

    const second = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(readFileSync(residualPath(legacyRoot, 'douyin_丢密文'), 'utf-8')).toBe(
      storageStateFixture('nospher'),
    );
    expect(second.recovered).toHaveLength(0);
  });

  it('旧 registry 条目仍在而新密文丢失时，不剔除旧条目也不删除旧明文', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '保留旧表', status: 'valid', storageState: storageStateFixture('keep-legacy') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    const acc = ctx.vault.getAccount(first.migrated[0].accountId);
    rmSync(join(ctx.root, 'sessions', `${acc.sessionRef}${SESSION_FILE_EXT}`));
    writeFileSync(
      join(legacyRoot, 'registry.json'),
      JSON.stringify([{ platform: 'douyin', accountName: '保留旧表', status: 'valid' }]),
    );
    writeFileSync(residualPath(legacyRoot, 'douyin_保留旧表'), storageStateFixture('keep-legacy'));

    const second = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(second.skipped).toEqual([{ legacyId: 'douyin_保留旧表', reason: 'already_migrated' }]);
    expect(second.recovered).toHaveLength(0);
    expect(legacyRegistryEntries(legacyRoot)).toHaveLength(1);
    expect(readFileSync(residualPath(legacyRoot, 'douyin_保留旧表'), 'utf-8')).toBe(
      storageStateFixture('keep-legacy'),
    );
  });

  it('fail closed：残留旧明文与新密文内容不一致（篡改/过期）时绝不删除', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '不匹配', status: 'valid', storageState: storageStateFixture('match-a') },
    ]);
    ctx.vault.migrateFromLegacy(legacyRoot);
    writeFileSync(
      residualPath(legacyRoot, 'douyin_不匹配'),
      storageStateFixture('match-B-different'),
    );

    const second = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(readFileSync(residualPath(legacyRoot, 'douyin_不匹配'), 'utf-8')).toBe(
      storageStateFixture('match-B-different'),
    );
    expect(second.recovered).toHaveLength(0);
  });

  it('fail closed：加密子系统不可用（无法核验）时绝不删除残留旧明文', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'tencent', accountName: '锁密钥', status: 'valid', storageState: storageStateFixture('locked') },
    ]);
    ctx.vault.migrateFromLegacy(legacyRoot);
    writeFileSync(residualPath(legacyRoot, 'tencent_锁密钥'), storageStateFixture('locked'));
    ctx.cipher.available = false;

    const second = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(readFileSync(residualPath(legacyRoot, 'tencent_锁密钥'), 'utf-8')).toBe(
      storageStateFixture('locked'),
    );
    expect(second.recovered).toHaveLength(0);
    expect(second.retainedResiduals).toEqual([
      { legacyId: 'tencent_锁密钥', accountId: ctx.vault.listAccounts()[0].id, reason: 'cannot_verify' },
    ]);
  });

  it('旧会话轮换后仍报告无法核验的旧明文，不把它静默当作已清理', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'douyin', accountName: '轮换号', status: 'valid', storageState: storageStateFixture('before') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    const accountId = first.migrated[0].accountId;
    writeFileSync(residualPath(legacyRoot, 'douyin_轮换号'), storageStateFixture('before'));
    ctx.vault.saveStorageState(accountId, storageStateFixture('after'));

    const report = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(report.recovered).toHaveLength(0);
    expect(report.retainedResiduals).toEqual([
      { legacyId: 'douyin_轮换号', accountId, reason: 'cannot_verify' },
    ]);
    expect(readFileSync(residualPath(legacyRoot, 'douyin_轮换号'), 'utf-8')).toBe(storageStateFixture('before'));
  });

  it('已迁移账号删除后仍报告无 marker 的旧明文，不能静默丢失清理线索', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'kuaishou', accountName: '已删除号', status: 'valid', storageState: storageStateFixture('before') },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    writeFileSync(residualPath(legacyRoot, 'kuaishou_已删除号'), storageStateFixture('before'));
    ctx.vault.removeAccount(first.migrated[0].accountId);

    const report = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(report.retainedResiduals).toEqual([
      { legacyId: 'kuaishou_已删除号', accountId: null, reason: 'untracked' },
    ]);
    expect(existsSync(residualPath(legacyRoot, 'kuaishou_已删除号'))).toBe(true);
  });

  it('fail closed：sessionRef 为 null 的账号（无会话迁移）不因 marker 存在而删除残留旧明文', () => {
    const legacyRoot = seedLegacyRoot([
      { platform: 'xiaohongshu', accountName: '无会话', status: 'unknown' },
    ]);
    const first = ctx.vault.migrateFromLegacy(legacyRoot);
    expect(first.migratedWithoutSession).toHaveLength(1);
    // 迁移后旧明文“重新出现”：新仓没有已核验副本，必须保留
    writeFileSync(
      residualPath(legacyRoot, 'xiaohongshu_无会话'),
      storageStateFixture('reappeared'),
    );

    const second = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(readFileSync(residualPath(legacyRoot, 'xiaohongshu_无会话'), 'utf-8')).toBe(
      storageStateFixture('reappeared'),
    );
    expect(second.recovered).toHaveLength(0);
  });

  it('marker 含路径穿越时不读取、不删除旧目录之外的文件', () => {
    const legacyRoot = seedLegacyRoot([]);
    const canary = join(legacyRoot, 'evil.json'); // accounts/../evil.json 的落点
    writeFileSync(canary, 'CANARY');

    // 构造被篡改的新仓 marker '../evil'，并配一份解密结果恰好等于 CANARY 的密文，
    // 证明阻止删除的是路径边界校验，而不是内容不匹配。
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '越界标记' });
    const ref = `s1-${'ab'.repeat(16)}`;
    writeFileSync(
      join(ctx.root, 'sessions', `${ref}${SESSION_FILE_EXT}`),
      ctx.cipher.encrypt(Buffer.from('CANARY', 'utf-8')),
    );
    const registry = JSON.parse(ctx.registryText());
    registry.accounts[0].migratedFrom = '../evil';
    registry.accounts[0].sessionRef = ref;
    writeFileSync(join(ctx.root, 'registry.json'), JSON.stringify(registry, null, 2));

    const report = ctx.vault.migrateFromLegacy(legacyRoot);

    expect(readFileSync(canary, 'utf-8')).toBe('CANARY');
    expect(report.recovered).toHaveLength(0);
    // registry 本身不被清理逻辑改写
    expect(ctx.vault.getAccount(acc.id).migratedFrom).toBe('../evil');
  });
});

describe('AccountVault：加密不可用的错误分类（边界修复）', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  it('保存后加密子系统不可用：解密入口抛 cipher_unavailable，不误报 session_decrypt_failed', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '钥匙串被锁' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('cipherdown'));
    ctx.cipher.available = false;

    let caught: unknown;
    try {
      await ctx.vault.withDecryptedStorageState(acc.id, async () => undefined);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AccountVaultError);
    expect((caught as AccountVaultError).code).toBe('cipher_unavailable');
    expect((caught as Error).message).not.toContain(SECRET_COOKIE_VALUE);
    // 不应生成任何临时明文目录
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('cipher.decrypt 抛 cipher_unavailable（可用性竞态）：分类保持，不被包装为 session_decrypt_failed', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '竞态解密' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('race-dec'));
    ctx.cipher.decrypt = (): Buffer => {
      throw new AccountVaultError('cipher_unavailable', 'safeStorage went down mid-call');
    };

    await expect(
      ctx.vault.withDecryptedStorageState(acc.id, async () => undefined),
    ).rejects.toMatchObject({ code: 'cipher_unavailable' });
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('cipher.encrypt 抛 cipher_unavailable（可用性竞态）：saveStorageState 分类保持，不误报 session_encrypt_failed', () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '竞态加密' });
    ctx.cipher.encrypt = (): Buffer => {
      throw new AccountVaultError('cipher_unavailable', 'safeStorage went down mid-call');
    };

    expectVaultError(
      () => ctx.vault.saveStorageState(acc.id, storageStateFixture('race-enc')),
      'cipher_unavailable',
    );
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
  });

  it('回读核验期 cipher_unavailable：不误报 session_verify_failed，未核验密文被清理', () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '核验期竞态' });
    // 加密成功，但回读解密（核验）时加密子系统失效
    ctx.cipher.decrypt = (): Buffer => {
      throw new AccountVaultError('cipher_unavailable', 'safeStorage went down during verify');
    };

    expectVaultError(
      () => ctx.vault.saveStorageState(acc.id, storageStateFixture('race-verify')),
      'cipher_unavailable',
    );
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
  });
});

describe('AccountVault：临时明文目录删除的有界重试（边界修复）', () => {
  function errnoError(message: string, code = 'EBUSY'): NodeJS.ErrnoException {
    const err = new Error(message) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  }

  it('首次 EBUSY 后重试成功：回调结果正常返回，目录被清理', async () => {
    let calls = 0;
    const ctx = makeVault(1_700_000_000_000, {
      removeDirSync: (dir) => {
        calls += 1;
        if (calls === 1) throw errnoError('INJECTED-RAW-TEXT resource busy or locked');
        rmSync(dir, { recursive: true, force: true });
      },
    });
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '重试清理' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('retry-ok'));

    let seenDir = '';
    const result = await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
      seenDir = dirname(p);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(existsSync(seenDir)).toBe(false);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('重试耗尽：回调成功也显式抛 temp_cleanup_failed，不静默返回成功，错误不含路径/Cookie/原始异常文本', async () => {
    const attempted: string[] = [];
    const ctx = makeVault(1_700_000_000_000, {
      removeDirSync: (dir) => {
        attempted.push(dir);
        throw errnoError(`RAW-SYSTEM-DETAIL cookie=${SECRET_COOKIE_VALUE}`);
      },
    });
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '清理耗尽' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('retry-exhaust'));

    let seenDir = '';
    let caught: unknown;
    try {
      await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
        seenDir = dirname(p);
        return 'ok';
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AccountVaultError);
    const vaultErr = caught as AccountVaultError;
    expect(vaultErr.code).toBe('temp_cleanup_failed');
    expect(vaultErr.accountId).toBe(acc.id);
    // 有界重试：不无限放大，也不止尝试一次
    expect(attempted.length).toBe(5);
    // 错误信息不含 Cookie、临时明文路径与原始异常文本；cause 只保留安全系统错误码
    expect(vaultErr.message).not.toContain(SECRET_COOKIE_VALUE);
    expect(vaultErr.message).not.toContain(seenDir);
    expect(vaultErr.message).not.toContain('RAW-SYSTEM-DETAIL');
    expect(vaultErr.cause).toEqual({ code: 'EBUSY' });

    rmSync(seenDir, { recursive: true, force: true }); // 清理测试产物
  });

  it('不可重试错误（EACCES）：立即显式报告 temp_cleanup_failed，不做无谓退避', async () => {
    let calls = 0;
    const ctx = makeVault(1_700_000_000_000, {
      removeDirSync: () => {
        calls += 1;
        throw errnoError('INJECTED permission denied', 'EACCES');
      },
    });
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '不可重试' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('nonretryable'));

    await expect(
      ctx.vault.withDecryptedStorageState(acc.id, async () => 'ok'),
    ).rejects.toMatchObject({ code: 'temp_cleanup_failed' });
    expect(calls).toBe(1);
    rmSync(ctx.tmpBase, { recursive: true, force: true }); // 清理测试产物（含残留临时目录）
  });

  it('回调抛错且清理耗尽：残留明文清理失败优先显式上报（fail closed）', async () => {
    const ctx = makeVault(1_700_000_000_000, {
      removeDirSync: () => {
        throw errnoError('INJECTED still busy');
      },
    });
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '双重失败' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('double-fail'));

    await expect(
      ctx.vault.withDecryptedStorageState(acc.id, () => {
        throw new Error('boom');
      }),
    ).rejects.toMatchObject({ code: 'temp_cleanup_failed' });
    rmSync(ctx.tmpBase, { recursive: true, force: true });
  });
});

describe('AccountVault：原子写持久性 fsync 先于 rename（边界修复）', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  function tmpLeftovers(): string[] {
    return [
      ...readdirSync(ctx.root).filter((n) => n.includes('.tmp-')),
      ...ctx.sessionsDirEntries().filter((n) => n.includes('.tmp-')),
    ];
  }

  it('registry 与密文写入都在 rename 前对 tmp 文件 fsync', () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '持久性' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('fsync-order'));

    // 每次原子写产生一对 fsync→rename，且 fsync 必须先于 rename
    expect(fsHooks.order.length).toBeGreaterThanOrEqual(2);
    expect(fsHooks.order.length % 2).toBe(0);
    for (let i = 0; i < fsHooks.order.length; i += 2) {
      expect(fsHooks.order[i]).toBe('fsync');
      expect(fsHooks.order[i + 1]).toBe('rename');
    }
  });

  it('fsync 失败：显式报错，原 registry 不被清空且内容不变，无 tmp 残留', () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '刷盘失败' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('fsync-fail'));
    const registryBefore = ctx.registryText();

    fsHooks.failFsyncCode = 'EIO';
    expectVaultError(() => ctx.vault.updateStatusFromProbe(acc.id, false), 'registry_write_failed');
    fsHooks.failFsyncCode = null;

    expect(ctx.registryText()).toBe(registryBefore); // 原文件完好，未被清空
    expect(tmpLeftovers()).toHaveLength(0);
    // 状态仍是写入前的值
    expect(ctx.vault.listAccounts()[0].status).toBe('valid');
  });

  it('rename 失败：显式报错，原 registry 不被清空，tmp 清理，错误不泄露原始异常文本', () => {
    const acc = ctx.vault.createAccount({ platform: 'kuaishou', displayName: '改名失败' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('rename-fail'));
    const registryBefore = ctx.registryText();

    fsHooks.failRenameCode = 'EACCES'; // 不可重试，立即失败
    let caught: unknown;
    try {
      ctx.vault.createAccount({ platform: 'douyin', displayName: 'second' });
    } catch (err) {
      caught = err;
    }
    fsHooks.failRenameCode = null;

    expect(caught).toBeInstanceOf(AccountVaultError);
    expect((caught as AccountVaultError).code).toBe('registry_write_failed');
    expect((caught as Error).message).not.toContain('INJECTED-rename-FAILURE-RAW-TEXT');
    expect((caught as AccountVaultError).cause).toEqual({ code: 'EACCES' });
    expect(ctx.registryText()).toBe(registryBefore);
    expect(tmpLeftovers()).toHaveLength(0);
    expect(ctx.vault.listAccounts()).toHaveLength(1);
    expect(ctx.vault.listAccounts()[0].id).toBe(acc.id);
  });

  it('密文写入 fsync 失败：报 session_verify_failed，会话目录无半成品，registry 不更新', () => {
    const acc = ctx.vault.createAccount({ platform: 'tencent', displayName: '密文刷盘' });
    const registryBefore = ctx.registryText();

    fsHooks.failFsyncCode = 'EIO';
    expectVaultError(
      () => ctx.vault.saveStorageState(acc.id, storageStateFixture('session-fsync-fail')),
      'session_verify_failed',
    );
    fsHooks.failFsyncCode = null;

    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(tmpLeftovers()).toHaveLength(0);
    expect(ctx.registryText()).toBe(registryBefore);
    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
  });
});

// ─── 生产适配器：Electron safeStorage（vi.mock，不加载真实 electron） ───────────

const electronMock = vi.hoisted(() => ({
  available: true,
  calls: [] as string[],
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => {
      electronMock.calls.push('isEncryptionAvailable');
      return electronMock.available;
    },
    encryptString: (text: string) => {
      electronMock.calls.push('encryptString');
      return Buffer.from(`enc(${text})`, 'utf-8');
    },
    decryptString: (buf: Buffer) => {
      electronMock.calls.push('decryptString');
      const text = buf.toString('utf-8');
      if (!text.startsWith('enc(') || !text.endsWith(')')) throw new Error('safeStorage decrypt failed');
      return text.slice(4, -1);
    },
  },
}));

describe('createSafeStorageCipher（生产适配器，mock safeStorage）', () => {
  beforeEach(() => {
    electronMock.available = true;
    electronMock.calls = [];
  });

  it('加密可用时委托 safeStorage，且经 AccountVault 全链路可存取', async () => {
    const cipher = createSafeStorageCipher();
    expect(cipher.isAvailable()).toBe(true);

    const encrypted = cipher.encrypt(Buffer.from('abc', 'utf-8'));
    expect(electronMock.calls).toContain('encryptString');
    expect(cipher.decrypt(encrypted).toString('utf-8')).toBe('abc');

    // 接入真实 vault：mock safeStorage 下保存 + 解密回读
    const root = mkdtempSync(join(tmpdir(), 'safe-storage-vault-'));
    const vault = new AccountVault(root, cipher);
    const acc = vault.createAccount({ platform: 'douyin', displayName: 'safeStorage账号' });
    vault.saveStorageState(acc.id, storageStateFixture('safe'));
    let content = '';
    await vault.withDecryptedStorageState(acc.id, (p) => {
      content = readFileSync(p, 'utf-8');
    });
    expect(content).toBe(storageStateFixture('safe'));
  });

  it('加密不可用时 fail closed：encrypt/decrypt 都抛 cipher_unavailable，绝不返回明文', () => {
    electronMock.available = false;
    const cipher = createSafeStorageCipher();
    expect(cipher.isAvailable()).toBe(false);
    expectVaultError(() => cipher.encrypt(Buffer.from('secret', 'utf-8')), 'cipher_unavailable');
    expectVaultError(() => cipher.decrypt(Buffer.from('whatever', 'utf-8')), 'cipher_unavailable');
    // 不可用时绝不能触碰 encryptString/decryptString 之外的明文回退路径
    expect(electronMock.calls).not.toContain('encryptString');
    expect(electronMock.calls).not.toContain('decryptString');
  });
});

// ─── P1-1 登录会话事务（withLoginStorageState，输入 SHA 3ab2fff） ───────────────
// 平台登录回调只能拿到一次性临时 storageState 路径；只有严格 success:true、
// 临时明文清理成功且 sessionRef 未被并发提交替换时才加密入仓。
// 全部使用合成夹具，不触网、不启动浏览器、不含任何真实凭证。

describe('AccountVault：withLoginStorageState 登录会话事务', () => {
  let ctx: ReturnType<typeof makeVault>;
  beforeEach(() => {
    ctx = makeVault();
  });

  function errnoError(message: string, code = 'EBUSY'): NodeJS.ErrnoException {
    const err = new Error(message) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  }

  function decryptedSessionBytes(root: string, sessionRef: string): string {
    return ctx.cipher
      .decrypt(readFileSync(join(root, 'sessions', `${sessionRef}${SESSION_FILE_EXT}`)))
      .toString('utf-8');
  }

  it('新账号登录成功：加密入仓、原样返回回调结果、状态 valid，且不留任何明文临时文件', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '新登录' });
    const callbackResult = { success: true, message: '登录成功' };

    let seenPath = '';
    const result = await ctx.vault.withLoginStorageState(acc.id, (p) => {
      seenPath = p;
      // 新登录：输出文件事先不存在，路径位于注入的临时基目录下
      expect(existsSync(p)).toBe(false);
      expect(p.endsWith('storageState.json')).toBe(true);
      expect(dirname(p).startsWith(ctx.tmpBase)).toBe(true);
      writeFileSync(p, storageStateFixture('login-new'));
      return callbackResult; // 同步（非 Promise）返回值也必须支持
    });

    expect(result).toBe(callbackResult); // 原对象原样返回，不被改写
    const saved = ctx.vault.getAccount(acc.id);
    expect(saved.status).toBe('valid');
    expect(saved.sessionRef).toMatch(SESSION_REF_RE);
    expect(saved.lastCheckedAt).toBe(1_700_000_000_000);

    let content = '';
    await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
      content = readFileSync(p, 'utf-8');
    });
    expect(content).toBe(storageStateFixture('login-new'));

    // 明文临时目录随事务清理
    expect(existsSync(seenPath)).toBe(false);
    expect(existsSync(dirname(seenPath))).toBe(false);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);

    // 临时路径与会话内容绝不进入 registry 或账号元数据
    const registryText = ctx.registryText();
    expect(registryText).not.toContain(seenPath);
    expect(registryText).not.toContain('storageState.json');
    expect(registryText).not.toContain(SECRET_COOKIE_VALUE);
    expect(JSON.stringify(saved)).not.toContain(seenPath);
  });

  it('既有会话刷新成功（异步回调）：种子为旧明文，只轮换目标账号的加密引用', async () => {
    const acc = ctx.vault.createAccount({ platform: 'kuaishou', displayName: '刷新号' });
    const other = ctx.vault.createAccount({ platform: 'kuaishou', displayName: '别的号' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('old'));
    ctx.vault.saveStorageState(other.id, storageStateFixture('other'));
    const oldRef = ctx.vault.getAccount(acc.id).sessionRef as string;
    const otherRef = ctx.vault.getAccount(other.id).sessionRef as string;

    let seenPath = '';
    const result = await ctx.vault.withLoginStorageState(acc.id, async (p) => {
      seenPath = p;
      // 既有会话：回调路径先被旧会话明文种子化
      expect(readFileSync(p, 'utf-8')).toBe(storageStateFixture('old'));
      writeFileSync(p, storageStateFixture('new'));
      return { success: true, message: 'ok' };
    });

    expect(result).toEqual({ success: true, message: 'ok' });
    const saved = ctx.vault.getAccount(acc.id);
    expect(saved.status).toBe('valid');
    expect(saved.sessionRef).toMatch(SESSION_REF_RE);
    expect(saved.sessionRef).not.toBe(oldRef);
    expect(existsSync(join(ctx.root, 'sessions', `${oldRef}${SESSION_FILE_EXT}`))).toBe(false);

    let content = '';
    await ctx.vault.withDecryptedStorageState(acc.id, (p) => {
      content = readFileSync(p, 'utf-8');
    });
    expect(content).toBe(storageStateFixture('new'));

    // 其他账号（哪怕同平台）完全不受影响
    expect(ctx.vault.getAccount(other.id).sessionRef).toBe(otherRef);
    expect(existsSync(join(ctx.root, 'sessions', `${otherRef}${SESSION_FILE_EXT}`))).toBe(true);
    let otherContent = '';
    await ctx.vault.withDecryptedStorageState(other.id, (p) => {
      otherContent = readFileSync(p, 'utf-8');
    });
    expect(otherContent).toBe(storageStateFixture('other'));

    expect(existsSync(seenPath)).toBe(false);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('刷新时登录返回 success:false：返回原结果，既有会话字节与元数据逐字段保留', async () => {
    const acc = ctx.vault.createAccount({ platform: 'tencent', displayName: '扫码超时' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('keep-old'));
    const before = ctx.vault.getAccount(acc.id);
    const registryBefore = ctx.registryText();
    const failResult = { success: false, message: '二维码超时' };

    let seenPath = '';
    const result = await ctx.vault.withLoginStorageState(acc.id, (p) => {
      seenPath = p;
      // 登录侧写了新内容但声明失败：候选一律不得入仓
      writeFileSync(p, storageStateFixture('rejected-new'));
      return failResult;
    });

    expect(result).toBe(failResult);
    expect(ctx.vault.getAccount(acc.id)).toEqual(before);
    expect(ctx.registryText()).toBe(registryBefore);
    expect(ctx.sessionsDirEntries()).toEqual([`${before.sessionRef}${SESSION_FILE_EXT}`]);
    expect(decryptedSessionBytes(ctx.root, before.sessionRef as string)).toBe(
      storageStateFixture('keep-old'),
    );
    expect(existsSync(seenPath)).toBe(false);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('新账号登录返回 success:false：不产生任何会话，状态保持 unknown', async () => {
    const acc = ctx.vault.createAccount({ platform: 'xiaohongshu', displayName: '新号取消' });
    const cancelResult = { success: false, message: '用户扫码后取消' };

    const result = await ctx.vault.withLoginStorageState(acc.id, (p) => {
      writeFileSync(p, storageStateFixture('abandoned'));
      return cancelResult;
    });

    expect(result).toBe(cancelResult);
    const after = ctx.vault.getAccount(acc.id);
    expect(after.sessionRef).toBeNull();
    expect(after.status).toBe('unknown');
    expect(after.lastCheckedAt).toBeNull();
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('回调抛异常：报 login_callback_failed，错误不泄露回调原文/路径/Cookie；旧会话保留', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '回调抛错' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('before-throw'));
    const oldRef = ctx.vault.getAccount(acc.id).sessionRef as string;

    let seenPath = '';
    let caught: unknown;
    try {
      await ctx.vault.withLoginStorageState(acc.id, (p) => {
        seenPath = p;
        throw new Error(`LOGIN-RAW-DETAIL path=${p} cookie=${SECRET_COOKIE_VALUE}`);
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AccountVaultError);
    const vaultErr = caught as AccountVaultError;
    expect(vaultErr.code).toBe('login_callback_failed');
    expect(vaultErr.accountId).toBe(acc.id);
    expect(vaultErr.message).not.toContain('LOGIN-RAW-DETAIL');
    expect(vaultErr.message).not.toContain(SECRET_COOKIE_VALUE);
    expect(vaultErr.message).not.toContain(seenPath);
    expect(vaultErr.cause).toBeUndefined();

    expect(ctx.vault.getAccount(acc.id).sessionRef).toBe(oldRef);
    expect(decryptedSessionBytes(ctx.root, oldRef)).toBe(storageStateFixture('before-throw'));
    expect(existsSync(seenPath)).toBe(false);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('回调结果畸形（非对象 / success 非严格布尔）：报 login_result_invalid，truthy 值绝不当成功', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '畸形结果' });
    const malformedResults: unknown[] = [
      undefined,
      null,
      'done',
      42,
      {},
      { success: 'true' },
      { success: 1 },
      [1, 2],
    ];

    for (const malformed of malformedResults) {
      await expect(
        ctx.vault.withLoginStorageState<{ success: boolean }>(acc.id, (p) => {
          writeFileSync(p, storageStateFixture('malformed'));
          return malformed as { success: boolean };
        }),
      ).rejects.toMatchObject({ code: 'login_result_invalid' });
    }

    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
    expect(ctx.vault.getAccount(acc.id).status).toBe('unknown');
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('success:true 但输出文件缺失：报 invalid_storage_state，不产生会话，明文目录已清理', async () => {
    const acc = ctx.vault.createAccount({ platform: 'kuaishou', displayName: '没写文件' });

    await expect(
      ctx.vault.withLoginStorageState(acc.id, async () => ({ success: true, message: '没写文件' })),
    ).rejects.toMatchObject({ code: 'invalid_storage_state' });

    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('success:true 但输出非法（非 JSON / 缺 cookies·origins）：invalid_storage_state，原文不进错误信息', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '非法输出' });

    let caught: unknown;
    try {
      await ctx.vault.withLoginStorageState(acc.id, (p) => {
        writeFileSync(p, `SECRET-not-json-${SECRET_COOKIE_VALUE}`);
        return { success: true, message: 'x' };
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AccountVaultError);
    expect((caught as AccountVaultError).code).toBe('invalid_storage_state');
    expect((caught as Error).message).not.toContain('SECRET-not-json');
    expect((caught as Error).message).not.toContain(SECRET_COOKIE_VALUE);

    await expect(
      ctx.vault.withLoginStorageState(acc.id, (p) => {
        writeFileSync(p, JSON.stringify({ hello: 'world' }));
        return { success: true, message: 'x' };
      }),
    ).rejects.toMatchObject({ code: 'invalid_storage_state' });

    expect(ctx.vault.getAccount(acc.id).sessionRef).toBeNull();
    expect(ctx.sessionsDirEntries()).toHaveLength(0);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('加密不可用：在回调之前拒绝 cipher_unavailable，不创建临时目录、不触碰既有会话', async () => {
    const fresh = ctx.vault.createAccount({ platform: 'douyin', displayName: '无加密-新号' });
    const withSession = ctx.vault.createAccount({ platform: 'douyin', displayName: '无加密-旧号' });
    ctx.vault.saveStorageState(withSession.id, storageStateFixture('cipher-off'));
    const savedRef = ctx.vault.getAccount(withSession.id).sessionRef as string;
    ctx.cipher.available = false;

    let called = 0;
    const cb = (p: string) => {
      called += 1;
      writeFileSync(p, storageStateFixture('must-not-run'));
      return { success: true, message: 'x' };
    };
    await expect(ctx.vault.withLoginStorageState(fresh.id, cb)).rejects.toMatchObject({
      code: 'cipher_unavailable',
    });
    await expect(ctx.vault.withLoginStorageState(withSession.id, cb)).rejects.toMatchObject({
      code: 'cipher_unavailable',
    });

    expect(called).toBe(0);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
    expect(ctx.vault.getAccount(withSession.id).sessionRef).toBe(savedRef);
    expect(ctx.vault.getAccount(fresh.id).sessionRef).toBeNull();
  });

  it('临时明文清理耗尽：登录成功也报 temp_cleanup_failed，新号与刷新都绝不提交密文', async () => {
    let attempted = 0;
    const failCtx = makeVault(1_700_000_000_000, {
      removeDirSync: (dir) => {
        attempted += 1;
        throw errnoError(`RAW-BUSY-DETAIL cookie=${SECRET_COOKIE_VALUE} dir=${dir}`);
      },
    });

    // 新账号：清理失败 → fail closed，不产生任何密文
    const fresh = failCtx.vault.createAccount({ platform: 'douyin', displayName: '清理失败-新' });
    let freshPath = '';
    let caught: unknown;
    try {
      await failCtx.vault.withLoginStorageState(fresh.id, (p) => {
        freshPath = p;
        writeFileSync(p, storageStateFixture('cleanup-fail'));
        return { success: true, message: 'ok' };
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AccountVaultError);
    const vaultErr = caught as AccountVaultError;
    expect(vaultErr.code).toBe('temp_cleanup_failed');
    expect(vaultErr.accountId).toBe(fresh.id);
    expect(vaultErr.message).not.toContain('RAW-BUSY-DETAIL');
    expect(vaultErr.message).not.toContain(SECRET_COOKIE_VALUE);
    expect(vaultErr.message).not.toContain(freshPath);
    expect(vaultErr.cause).toEqual({ code: 'EBUSY' });
    expect(failCtx.vault.getAccount(fresh.id).sessionRef).toBeNull();
    expect(failCtx.vault.getAccount(fresh.id).status).toBe('unknown');
    expect(failCtx.sessionsDirEntries()).toHaveLength(0);

    // 既有会话刷新：清理失败 → 旧引用与旧密文原样保留
    const existing = failCtx.vault.createAccount({ platform: 'douyin', displayName: '清理失败-旧' });
    failCtx.vault.saveStorageState(existing.id, storageStateFixture('cleanup-old'));
    const oldRef = failCtx.vault.getAccount(existing.id).sessionRef as string;
    await expect(
      failCtx.vault.withLoginStorageState(existing.id, (p) => {
        writeFileSync(p, storageStateFixture('cleanup-new'));
        return { success: true, message: 'ok' };
      }),
    ).rejects.toMatchObject({ code: 'temp_cleanup_failed' });
    expect(failCtx.vault.getAccount(existing.id).sessionRef).toBe(oldRef);
    expect(decryptedSessionBytes(failCtx.root, oldRef)).toBe(storageStateFixture('cleanup-old'));
    expect(failCtx.sessionsDirEntries()).toEqual([`${oldRef}${SESSION_FILE_EXT}`]);

    // 每个事务对清理做同样的有界重试（5 次）后显式失败
    expect(attempted).toBe(10);
    rmSync(failCtx.tmpBase, { recursive: true, force: true }); // 清理测试产物（含残留临时目录）
  });

  it('同平台同名两账号：独立 UUID/临时目录/加密引用，先后登录互不影响', async () => {
    const a = ctx.vault.createAccount({ platform: 'douyin', displayName: '同名工作室' });
    const b = ctx.vault.createAccount({ platform: 'douyin', displayName: '同名工作室' });
    expect(a.id).not.toBe(b.id);

    const dirs: string[] = [];
    const resA = await ctx.vault.withLoginStorageState(a.id, (p) => {
      dirs.push(dirname(p));
      writeFileSync(p, storageStateFixture('twin-a'));
      return { success: true, message: 'a' };
    });
    const resB = await ctx.vault.withLoginStorageState(b.id, (p) => {
      dirs.push(dirname(p));
      writeFileSync(p, storageStateFixture('twin-b'));
      return { success: true, message: 'b' };
    });
    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    expect(dirs[0]).not.toBe(dirs[1]);

    const aAcc = ctx.vault.getAccount(a.id);
    const bAcc = ctx.vault.getAccount(b.id);
    expect(aAcc.sessionRef).toMatch(SESSION_REF_RE);
    expect(bAcc.sessionRef).toMatch(SESSION_REF_RE);
    expect(aAcc.sessionRef).not.toBe(bAcc.sessionRef);

    let aContent = '';
    let bContent = '';
    await ctx.vault.withDecryptedStorageState(a.id, (p) => {
      aContent = readFileSync(p, 'utf-8');
    });
    await ctx.vault.withDecryptedStorageState(b.id, (p) => {
      bContent = readFileSync(p, 'utf-8');
    });
    expect(aContent).toBe(storageStateFixture('twin-a'));
    expect(bContent).toBe(storageStateFixture('twin-b'));
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('并发替换（新账号）：登录期间会话被更新提交，晚到者报 session_changed 且不覆盖', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '并发新登' });
    let releaseLogin!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });

    const pending = ctx.vault.withLoginStorageState(acc.id, async (p) => {
      writeFileSync(p, storageStateFixture('concurrent-late'));
      await gate;
      return { success: true, message: 'late' };
    });

    // 登录挂起期间，另一路提交已把会话写入（sessionRef: null → winner）
    ctx.vault.saveStorageState(acc.id, storageStateFixture('concurrent-winner'));
    const winnerRef = ctx.vault.getAccount(acc.id).sessionRef as string;

    releaseLogin();
    await expect(pending).rejects.toMatchObject({ code: 'session_changed' });

    expect(ctx.vault.getAccount(acc.id).sessionRef).toBe(winnerRef);
    expect(ctx.sessionsDirEntries()).toEqual([`${winnerRef}${SESSION_FILE_EXT}`]);
    expect(decryptedSessionBytes(ctx.root, winnerRef)).toBe(
      storageStateFixture('concurrent-winner'),
    );
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('并发替换（既有会话刷新）：登录期间会话被轮换，晚到候选不入仓，较新密文完好', async () => {
    const acc = ctx.vault.createAccount({ platform: 'tencent', displayName: '并发刷新' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('refresh-base'));
    let releaseLogin!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });

    let seeded = false;
    const pending = ctx.vault.withLoginStorageState(acc.id, async (p) => {
      seeded = readFileSync(p, 'utf-8') === storageStateFixture('refresh-base');
      writeFileSync(p, storageStateFixture('refresh-late'));
      await gate;
      return { success: true, message: 'late' };
    });

    ctx.vault.saveStorageState(acc.id, storageStateFixture('refresh-winner'));
    const winnerRef = ctx.vault.getAccount(acc.id).sessionRef as string;

    releaseLogin();
    await expect(pending).rejects.toMatchObject({ code: 'session_changed' });

    expect(seeded).toBe(true);
    expect(ctx.vault.getAccount(acc.id).sessionRef).toBe(winnerRef);
    expect(ctx.sessionsDirEntries()).toEqual([`${winnerRef}${SESSION_FILE_EXT}`]);
    expect(decryptedSessionBytes(ctx.root, winnerRef)).toBe(
      storageStateFixture('refresh-winner'),
    );
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('未知 accountId 在回调之前拒绝 account_not_found，不创建临时目录', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    let called = 0;
    await expect(
      ctx.vault.withLoginStorageState(missing, () => {
        called += 1;
        return { success: true, message: 'x' };
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' });
    expect(called).toBe(0);
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('既有会话回调声称成功却未写出新状态时不得把旧会话当作新登录', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '未写出新状态' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('old-session'));
    const before = ctx.vault.getAccount(acc.id);

    await expect(
      ctx.vault.withLoginStorageState(acc.id, () => ({ success: true, message: 'reported-success' })),
    ).rejects.toMatchObject({ code: 'invalid_storage_state' });

    expect(ctx.vault.getAccount(acc.id)).toEqual(before);
    expect(decryptedSessionBytes(ctx.root, before.sessionRef as string)).toBe(
      storageStateFixture('old-session'),
    );
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('回调抛出带原文的 AccountVaultError 也不得泄露原文或临时路径', async () => {
    const acc = ctx.vault.createAccount({ platform: 'kuaishou', displayName: '错误脱敏' });
    let tempPath = '';
    let caught: unknown;

    try {
      await ctx.vault.withLoginStorageState(acc.id, (path) => {
        tempPath = path;
        throw new AccountVaultError('invalid_storage_state', `raw=${SECRET_COOKIE_VALUE} path=${path}`);
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountVaultError);
    const vaultError = caught as AccountVaultError;
    expect(vaultError.code).toBe('login_callback_failed');
    expect(vaultError.message).not.toContain(SECRET_COOKIE_VALUE);
    expect(vaultError.message).not.toContain(tempPath);
    expect(vaultError.cause).toBeUndefined();
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });

  it('既有会话刷新：回调重写与种子逐字节一致的内容也无新输出证据，fail closed 不轮换引用', async () => {
    const acc = ctx.vault.createAccount({ platform: 'douyin', displayName: '同内容重写' });
    ctx.vault.saveStorageState(acc.id, storageStateFixture('same-seed'));
    const before = ctx.vault.getAccount(acc.id);
    const registryBefore = ctx.registryText();

    await expect(
      ctx.vault.withLoginStorageState(acc.id, (p) => {
        // 异常回调：把种子原样复制回输出路径并声称成功（同内容重写）。
        writeFileSync(p, readFileSync(p));
        return { success: true, message: 'echoed-seed' };
      }),
    ).rejects.toMatchObject({ code: 'invalid_storage_state' });

    expect(ctx.vault.getAccount(acc.id)).toEqual(before);
    expect(ctx.registryText()).toBe(registryBefore);
    expect(ctx.sessionsDirEntries()).toEqual([`${before.sessionRef}${SESSION_FILE_EXT}`]);
    expect(decryptedSessionBytes(ctx.root, before.sessionRef as string)).toBe(
      storageStateFixture('same-seed'),
    );
    expect(readdirSync(ctx.tmpBase)).toHaveLength(0);
  });
});

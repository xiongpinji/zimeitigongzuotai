import { expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import {
  AccountVault,
  SESSION_FILE_EXT,
  type AccountV2,
  type AccountVaultPlatform,
} from '../../electron/publish/accounts-v2';
import {
  ACCOUNT_V2_IPC_CHANNELS,
  registerAccountsV2Ipc,
  type AccountIpcEventLike,
  type AccountIpcMainLike,
  type AccountV2CheckResult,
  type AccountV2CreateResult,
  type AccountV2ListResult,
  type AccountV2LoginResult,
} from '../../electron/publish/accounts-v2-ipc';
import {
  SyntheticCipher,
  syntheticSessionValue,
  syntheticStorageState,
} from './fixtures/account-vault-cipher';

const PLATFORMS: AccountVaultPlatform[] = ['douyin', 'tencent', 'xiaohongshu', 'kuaishou'];
const ACCOUNT_COUNT = 100;
const NOW = 1_700_000_000_000;

it('100 个四平台同名模拟账号通过服务登录和探针后在新进程重开仍保持隔离', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingji-account-vault-load-'));
  const vaultRoot = join(dir, 'vault');
  const tmpBase = join(dir, 'plaintext');
  const probePath = join(dir, 'reopen-probe.cjs');
  mkdirSync(tmpBase);
  const startedAt = performance.now();

  try {
    let clock = NOW;
    const vault = new AccountVault(vaultRoot, new SyntheticCipher(), {
      tmpBaseDir: tmpBase,
      now: () => clock,
    });
    const handlers = new Map<string, (event: AccountIpcEventLike, ...args: unknown[]) => unknown>();
    const ipc: AccountIpcMainLike = {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    };
    const event: AccountIpcEventLike = { sender: { send: () => undefined } };
    const invoke = async <T>(channel: string, payload?: unknown): Promise<T> => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('missing synthetic IPC handler: ' + channel);
      return await Promise.resolve(handler(event, payload)) as T;
    };

    let loginCount = 0;
    let checkCount = 0;
    registerAccountsV2Ipc({
      ipc,
      vault,
      platformFactory: (platform) => ({
        login: async (options) => {
          const index = loginCount++;
          expect(platform).toBe(PLATFORMS[index % PLATFORMS.length]);
          writeFileSync(options.storageStatePath, syntheticStorageState(index));
          return { success: true, message: 'synthetic login only' };
        },
        checkCookie: async (storageStatePath) => {
          checkCount += 1;
          const state = JSON.parse(readFileSync(storageStatePath, 'utf8')) as {
            cookies: Array<{ value: string }>;
          };
          const value = state.cookies[0]?.value;
          const index = Number(value?.slice('synthetic-session-'.length));
          expect(value).toBe(syntheticSessionValue(index));
          expect(platform).toBe(PLATFORMS[index % PLATFORMS.length]);
          return index !== 7;
        },
      }),
    });

    const created: AccountV2[] = [];
    for (let index = 0; index < ACCOUNT_COUNT; index += 1) {
      const createdResult = await invoke<AccountV2CreateResult>(ACCOUNT_V2_IPC_CHANNELS.create, {
        platform: PLATFORMS[index % PLATFORMS.length],
        displayName: '同名负载号',
        owner: 'synthetic-' + String(index).padStart(3, '0'),
      });
      if (!createdResult.ok) throw new Error('synthetic create failed: ' + createdResult.code);
      const loginResult = await invoke<AccountV2LoginResult>(ACCOUNT_V2_IPC_CHANNELS.login, {
        accountId: createdResult.account.id,
        requestId: randomUUID(),
      });
      if (!loginResult.ok) throw new Error('synthetic login failed: ' + loginResult.code);
      expect(loginResult.account.hasSession).toBe(true);
      expect(loginResult.account.status).toBe('valid');
      created.push(vault.getAccount(createdResult.account.id));
    }
    expect(loginCount).toBe(ACCOUNT_COUNT);
    expect(new Set(created.map((account) => account.id)).size).toBe(ACCOUNT_COUNT);
    expect(new Set(created.map((account) => account.sessionRef)).size).toBe(ACCOUNT_COUNT);
    expect(readdirSync(join(vaultRoot, 'sessions')).filter((name) => name.endsWith(SESSION_FILE_EXT))).toHaveLength(ACCOUNT_COUNT);
    for (const account of created) {
      expect(account.sessionRef).toBeTruthy();
      expect(existsSync(join(vaultRoot, 'sessions', account.sessionRef + SESSION_FILE_EXT))).toBe(true);
    }
    expect(readFileSync(join(vaultRoot, 'registry.json'), 'utf8')).not.toContain('synthetic-session-');

    clock = NOW + 1000;
    for (const [index, account] of created.entries()) {
      const result = await invoke<AccountV2CheckResult>(ACCOUNT_V2_IPC_CHANNELS.check, {
        accountId: account.id,
      });
      if (!result.ok) throw new Error('synthetic probe failed: ' + result.code);
      expect(result.valid).toBe(index !== 7);
      expect(result.account.status).toBe(index === 7 ? 'expired' : 'valid');
    }
    expect(checkCount).toBe(ACCOUNT_COUNT);
    const list = await invoke<AccountV2ListResult>(ACCOUNT_V2_IPC_CHANNELS.list);
    if (!list.ok) throw new Error('synthetic list failed: ' + list.code);
    expect(list.accounts).toHaveLength(ACCOUNT_COUNT);
    expect(list.accounts.filter((account) => account.status === 'expired')).toHaveLength(1);
    expect(list.accounts.every((account) => account.hasSession)).toBe(true);
    expect(JSON.stringify(list)).not.toContain('sessionRef');
    expect(JSON.stringify(list)).not.toContain('synthetic-session-');

    const entry = fileURLToPath(new URL('./fixtures/account-vault-reopen.ts', import.meta.url));
    const bundle = buildSync({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      outfile: probePath,
      write: false,
    });
    writeFileSync(probePath, bundle.outputFiles[0]!.contents);
    const child = spawnSync(process.execPath, [probePath, vaultRoot, tmpBase, created[7]!.id], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 1_000_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout) as {
      accounts: number;
      expired: number;
      valid: number;
      byPlatform: Record<string, number>;
      temporaryPlaintextDirs: number;
    };
    expect(result).toEqual({
      accounts: 100,
      expired: 1,
      valid: 99,
      byPlatform: {
        douyin: 25,
        tencent: 25,
        xiaohongshu: 25,
        kuaishou: 25,
      },
      temporaryPlaintextDirs: 0,
    });
    console.info('account_vault_load', JSON.stringify({
      ...result,
      simulatedPlatformLogins: loginCount,
      simulatedPlatformChecks: checkCount,
      elapsedMs: Math.round(performance.now() - startedAt),
    }));
  } finally {
    const resolved = resolve(dir);
    if (dirname(resolved) !== resolve(tmpdir()) ||
        !basename(resolved).startsWith('lingji-account-vault-load-')) {
      throw new Error('Refusing to delete unexpected load test directory: ' + resolved);
    }
    rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
  }
});

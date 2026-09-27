import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { AccountVault, SESSION_FILE_EXT } from '../../../electron/publish/accounts-v2';
import { SyntheticCipher, syntheticSessionValue } from './account-vault-cipher';

const [vaultRoot, tmpBase, expiredId] = process.argv.slice(2);
if (!vaultRoot || !tmpBase || !expiredId) throw new Error('missing isolated test arguments');

async function main(): Promise<void> {
  const vault = new AccountVault(vaultRoot!, new SyntheticCipher(), {
    tmpBaseDir: tmpBase!,
    now: () => 1_700_000_000_000,
  });
  const accounts = vault.listAccounts();
  assert.equal(accounts.length, 100);
  assert.equal(new Set(accounts.map((account) => account.id)).size, 100);
  assert.equal(new Set(accounts.map((account) => account.sessionRef)).size, 100);
  const byPlatform = new Map<string, number>();
  let expiredCount = 0;

  for (const account of accounts) {
    byPlatform.set(account.platform, (byPlatform.get(account.platform) ?? 0) + 1);
    assert.equal(account.displayName, '同名负载号');
    assert.ok(account.sessionRef);
    const index = Number(account.owner.slice('synthetic-'.length));
    assert.ok(Number.isInteger(index) && index >= 0 && index < 100);
    if (account.id === expiredId) {
      assert.equal(account.status, 'expired');
      assert.equal(account.lastCheckedAt, 1_700_000_001_000);
      expiredCount += 1;
    } else {
      assert.equal(account.status, 'valid');
      assert.equal(account.lastCheckedAt, 1_700_000_001_000);
    }
    await vault.withDecryptedStorageState(account.id, (plaintextPath) => {
      assert.ok(resolve(plaintextPath).startsWith(resolve(tmpBase!) + sep));
      const state = JSON.parse(readFileSync(plaintextPath, 'utf8')) as {
        cookies: Array<{ value: string }>;
      };
      assert.equal(state.cookies[0]?.value, syntheticSessionValue(index));
    });
    assert.equal(readdirSync(tmpBase!).length, 0);
  }

  for (const platform of ['douyin', 'tencent', 'xiaohongshu', 'kuaishou']) {
    assert.equal(byPlatform.get(platform), 25);
  }
  assert.equal(expiredCount, 1);
  assert.equal(readdirSync(join(vaultRoot!, 'sessions')).filter((name) => name.endsWith(SESSION_FILE_EXT)).length, 100);
  process.stdout.write(JSON.stringify({
    accounts: accounts.length,
    expired: expiredCount,
    valid: accounts.length - expiredCount,
    byPlatform: Object.fromEntries(byPlatform),
    temporaryPlaintextDirs: readdirSync(tmpBase!).length,
  }));
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});

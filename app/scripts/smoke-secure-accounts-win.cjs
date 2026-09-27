const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source-build desktop smoke with synthetic account metadata only. Never log in or publish.
if (process.platform !== 'win32') throw new Error('Windows is required for this smoke test');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const { _electron } = require(path.join(appRoot, 'node_modules', 'playwright'));
const runDir = path.join(repoRoot, 'data', 'runtime', 'validation', `r1-accounts-${Date.now()}`);
const profile = path.join(runDir, 'profile');
const vaultDir = path.join(profile, 'publish-v2');
const cipherProbePath = path.join(runDir, 'safe-storage-probe.bin');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(profile, { recursive: true });

const pageErrors = [];

async function launch() {
  const app = await _electron.launch({
    executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [appRoot, `--user-data-dir=${profile}`], env, timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)));
  await page.waitForFunction(() => document.body.textContent?.includes('开始创作'), null, { timeout: 30_000 });
  const actualProfile = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  assert.equal(path.normalize(actualProfile).toLowerCase(), path.normalize(profile).toLowerCase());
  return { app, page };
}

async function openSettingsTab(app, page, tabName) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu-action', {
      type: 'command', action: 'open-settings',
    });
  });
  await page.getByRole('button', { name: tabName, exact: true }).click();
}

async function listAccounts(page) {
  const result = await page.evaluate(() => window.accountV2API.list());
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.accounts;
}

async function createAccount(page, owner) {
  await page.getByRole('textbox', { name: '新账号名称' }).fill('合成同名账号');
  await page.getByRole('textbox', { name: '归属人（可选）' }).fill(owner);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await page.getByText('已创建账号（ID', { exact: false }).waitFor({ timeout: 15_000 });
}

async function selectPlatform(page, currentLabel, nextLabel) {
  await page.getByRole('button', { name: currentLabel, exact: true }).click();
  await page.getByRole('option', { name: nextLabel, exact: true }).click();
}

async function waitForRows(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-account-id]').length === expected,
    count, { timeout: 15_000 },
  );
}

async function main() {
  let app;
  let page;
  let encryptedProbe;
  try {
    ({ app, page } = await launch());
    encryptedProbe = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString('synthetic-r1-safe-storage-probe').toString('base64')
      : null);
    if (encryptedProbe) fs.writeFileSync(cipherProbePath, Buffer.from(encryptedProbe, 'base64'));
    await openSettingsTab(app, page, '安全账号');
    await page.getByText('暂无安全账号，请先创建。').waitFor({ timeout: 15_000 });
    const platforms = [
      { key: 'douyin', label: '抖音' },
      { key: 'kuaishou', label: '快手' },
      { key: 'tencent', label: '视频号' },
      { key: 'xiaohongshu', label: '小红书' },
    ];
    let currentLabel = platforms[0].label;
    let created = 0;
    for (const platform of platforms) {
      if (platform.label !== currentLabel) {
        await selectPlatform(page, currentLabel, platform.label);
        currentLabel = platform.label;
      }
      for (const owner of ['运营 A', '运营 B']) {
        await createAccount(page, `${platform.label}${owner}`);
        created += 1;
        await waitForRows(page, created);
      }
    }

    const initial = await listAccounts(page);
    assert.equal(initial.length, 8);
    assert.equal(new Set(initial.map((account) => account.id)).size, 8);
    assert.deepEqual(initial.map((account) => account.platform), platforms.flatMap((p) => [p.key, p.key]));
    assert.ok(initial.every((account) => account.displayName === '合成同名账号'));
    assert.deepEqual(initial.map((account) => account.owner),
      platforms.flatMap((p) => [`${p.label}运营 A`, `${p.label}运营 B`]));
    assert.ok(initial.every((account) => !account.hasSession && account.status === 'unknown'));
    assert.equal(fs.existsSync(path.join(vaultDir, 'registry.json')), true);
    assert.deepEqual(fs.readdirSync(path.join(vaultDir, 'sessions')), []);
    await page.screenshot({ path: path.join(runDir, 'created.png') });
    await app.close();
    app = undefined;
    page = undefined;

    ({ app, page } = await launch());
    if (encryptedProbe) {
      const persistedCiphertext = fs.readFileSync(cipherProbePath).toString('base64');
      const decrypted = await app.evaluate(({ safeStorage }, encoded) =>
        safeStorage.decryptString(Buffer.from(encoded, 'base64')), persistedCiphertext);
      assert.equal(decrypted, 'synthetic-r1-safe-storage-probe');
    }
    await openSettingsTab(app, page, '安全账号');
    await waitForRows(page, 8);
    const reopened = await listAccounts(page);
    assert.deepEqual(reopened, initial);
    const firstRow = page.locator(`[data-account-id="${initial[0].id}"]`);
    await firstRow.getByRole('button', { name: '删除账号' }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await waitForRows(page, 7);
    const afterDelete = await listAccounts(page);
    assert.deepEqual(afterDelete, initial.slice(1));

    await page.getByRole('button', { name: '发布账号', exact: true }).click();
    await page.getByText('暂无发布账号，请在下方添加。').waitFor({ timeout: 15_000 });
    await page.getByText('这里仍使用旧账号体系', { exact: false }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(runDir, 'legacy-publish-isolated.png') });
    await app.close();
    app = undefined;
    page = undefined;

    ({ app, page } = await launch());
    await openSettingsTab(app, page, '安全账号');
    await waitForRows(page, 7);
    const finalAccounts = await listAccounts(page);
    assert.deepEqual(finalAccounts, initial.slice(1));
    assert.deepEqual(fs.readdirSync(path.join(vaultDir, 'sessions')), []);
    await page.screenshot({ path: path.join(runDir, 'after-reopen.png') });
    assert.deepEqual(pageErrors, []);
    const result = {
      profile, platforms: platforms.map((platform) => platform.key),
      sameNameAccountIds: initial.map((account) => account.id),
      created: 8, persistedAfterRestart: 8, preciseDelete: true,
      persistedAfterSecondRestart: 7, legacyPublishAccountCount: 0,
      sessionFiles: 0, safeStorageSyntheticReopen: encryptedProbe ? 'passed' : 'unavailable',
      realLoginAttempted: false, publicationAttempted: false, pageErrors,
    };
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${runDir}\n`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => undefined);
    throw error;
  } finally {
    if (app) await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

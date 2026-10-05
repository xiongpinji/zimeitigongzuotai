const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Source-build UI test only: generated videos, isolated profile, no HotClip/model/platform call.
if (process.platform !== 'win32') throw new Error('Windows is required for this smoke test');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const { _electron } = require(path.join(appRoot, 'node_modules', 'playwright'));
const ffmpeg = require(path.join(appRoot, 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
const runDir = path.join(repoRoot, 'data', 'runtime', 'validation', `r3-highlight-ui-${Date.now()}`);
const profile = path.join(runDir, 'profile');
const projectDir = path.join(runDir, 'project');
const recordingsDir = path.join(runDir, 'recordings');
const recordings = ['synthetic-red.mp4', 'synthetic-blue.mp4']
  .map((name) => path.join(recordingsDir, name));
const subtitle = path.join(recordingsDir, 'synthetic-red.srt');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(recordingsDir, { recursive: true });

function writeSyntheticRecording(color, target) {
  const created = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=10:d=4`,
    '-an', '-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p', target,
  ], { encoding: 'utf8', timeout: 30_000 });
  if (created.status !== 0) throw new Error(`synthetic recording failed: ${created.stderr}`);
}
for (const [index, color] of ['red', 'blue'].entries()) {
  writeSyntheticRecording(color, recordings[index]);
}
fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:02,000\nSynthetic first clip\n', 'utf8');

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

async function selectSyntheticRecordings(app) {
  await app.evaluate(({ dialog }, selected) => {
    const original = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = (...args) => {
      const options = args[args.length - 1];
      if (options.title === '选择已授权直播录屏目录') {
        return Promise.resolve({ canceled: false, filePaths: [selected.root] });
      }
      if (options.title === '选择直播录屏（最多 100 个）') {
        return Promise.resolve({ canceled: false, filePaths: selected.files });
      }
      if (options.title === '选择与录屏同名的 SRT 字幕（可选）') {
        return Promise.resolve({ canceled: false, filePaths: [selected.subtitle] });
      }
      return original(...args);
    };
  }, { root: recordingsDir, files: recordings, subtitle });
}

async function importThroughUi(page) {
  await page.getByRole('button', { name: '选择录屏目录' }).click();
  await page.getByText('recordings', { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '选择录屏文件' }).click();
  await page.getByText('已选择 2 个', { exact: false }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '选择已有 SRT 字幕' }).click();
  await page.getByText('已配对 1 份', { exact: false }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '导入录屏' }).click();
  await page.getByRole('status').getByText('已导入 2 个录屏任务。')
    .waitFor({ timeout: 20_000 });
}

async function listTasks(page) {
  const result = await page.evaluate(() => window.highlightV1API.list());
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.tasks;
}

async function main() {
  let app;
  let page;
  try {
    ({ app, page } = await launch());
    await selectSyntheticRecordings(app);
    await app.evaluate(({ ipcMain }, selectedDir) => {
      ipcMain.removeHandler('select-project-directory');
      ipcMain.handle('select-project-directory', () => selectedDir);
    }, projectDir);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu-action', {
        type: 'command', action: 'new-project',
      });
    });
    await page.getByRole('button', { name: '直播高光', exact: true }).click();
    await importThroughUi(page);
    const initial = await listTasks(page);
    assert.equal(initial.length, 2);
    assert.equal(new Set(initial.map((task) => task.id)).size, 2);
    assert.equal(new Set(initial.map((task) => task.sourceSha256)).size, 2);
    assert.deepEqual(initial.map((task) => task.name), recordings.map((file) => path.basename(file)));
    assert.ok(initial.every((task) => task.state === 'queued'));
    assert.equal(JSON.stringify(initial).includes(subtitle), false);
    const stored = JSON.parse(fs.readFileSync(path.join(profile, 'highlights-v1', 'queue.json'), 'utf8'));
    const snapshot = stored.tasks[0].recording.transcriptRef;
    assert.ok(snapshot.startsWith(path.join(profile, 'highlights-v1', 'subtitles')));
    assert.equal(fs.readFileSync(snapshot, 'utf8'), fs.readFileSync(subtitle, 'utf8'));
    assert.equal(stored.tasks[1].recording.transcriptRef, null);
    assert.equal(await page.getByTestId('run-highlights').isDisabled(), true);
    const deniedRun = await page.evaluate(() => window.highlightV1API.run({
      llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'synthetic',
      timeoutMs: 60_000, concurrency: 1, maxAttempts: 1, allowModelDownload: false,
    }));
    assert.deepEqual(deniedRun, { ok: false, code: 'consent_required' });
    await page.screenshot({ path: path.join(runDir, 'queued.png') });

    await page.getByRole('button', { name: '取消', exact: true }).first().click();
    await page.waitForFunction(() => document.body.textContent?.includes('已取消'), null, { timeout: 15_000 });
    const afterCancel = await listTasks(page);
    assert.deepEqual(afterCancel.map((task) => task.state), ['cancelled', 'queued']);
    await app.close();
    app = undefined;
    page = undefined;

    ({ app, page } = await launch());
    await page.getByRole('button', { name: '直播高光', exact: true }).click();
    const reopened = await listTasks(page);
    assert.deepEqual(reopened, afterCancel);
    await selectSyntheticRecordings(app);
    await importThroughUi(page);
    const deduplicated = await listTasks(page);
    assert.deepEqual(deduplicated, afterCancel);
    writeSyntheticRecording('green', recordings[0]);
    await importThroughUi(page);
    const changedSource = await listTasks(page);
    assert.equal(changedSource.length, 3);
    assert.deepEqual(changedSource.slice(0, 2), afterCancel);
    assert.equal(changedSource[2].name, path.basename(recordings[0]));
    assert.notEqual(changedSource[2].id, initial[0].id);
    assert.notEqual(changedSource[2].sourceSha256, initial[0].sourceSha256);
    assert.equal(changedSource[2].state, 'queued');
    await page.getByText('synthetic-red.mp4', { exact: true })
      .last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(runDir, 'after-reopen.png') });
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({
      profile, recordings, taskIds: initial.map((task) => task.id),
      imported: 2, cancelled: 1, persistedAfterRestart: true,
      duplicateImportAdded: 0, changedSourceAdded: 1, consentGuardDenied: true,
      subtitleSnapshotVerified: true,
      highlightAnalysisStarted: false, publicationAttempted: false, pageErrors,
    }, null, 2));
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

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Source-build desktop smoke: synthetic cover only, no provider call or packaging.
if (process.platform !== 'win32') throw new Error('Windows is required for this smoke test');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const { _electron } = require(path.join(appRoot, 'node_modules', 'playwright'));
const ffmpeg = require(path.join(appRoot, 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
const runDir = path.join(repoRoot, 'data', 'runtime', 'validation', `r2-cover-${Date.now()}`);
const projectDir = path.join(runDir, 'project');
const profile = path.join(runDir, 'profile');
const coverPath = path.join(projectDir, 'covers', 'cover-16x9.png');
const projectFile = path.join(projectDir, 'project.json');

fs.mkdirSync(path.dirname(coverPath), { recursive: true });
fs.mkdirSync(profile, { recursive: true });
const fixture = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1',
  '-frames:v', '1', '-update', '1', coverPath,
], { encoding: 'utf8', timeout: 30_000 });
if (fixture.status !== 0) throw new Error(`cover fixture failed: ${fixture.stderr}`);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const pageErrors = [];

async function launch() {
  const app = await _electron.launch({
    executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [appRoot, `--user-data-dir=${profile}`], env, timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)));
  return { app, page };
}

async function openCoverPanel(page) {
  await page.getByRole('button', { name: '视频编辑器' }).click();
  await page.getByRole('tab', { name: 'AI 助手' }).click();
  await page.locator('[data-ai-panel-tab]').getByRole('tab', { name: '封面' }).click();
  const card = page.locator('[data-ai-cover-grid] [data-draggable="true"]').first();
  await card.waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-ai-cover-grid] img');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }, null, { timeout: 30_000 });
  return card;
}

async function waitForBackground() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(projectFile)) {
      try {
        const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
        if (project.timeline?.overlays?.some((overlay) =>
          overlay.overlayRole === 'default-background' && overlay.assetPath === coverPath)) {
          return project;
        }
      } catch {
        // The app may be writing this isolated project file; retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('cover did not persist as timeline background');
}

async function waitForEditedCover() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(projectFile)) {
      try {
        const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
        const edited = project.aiAnalysis?.coverCandidates?.find((candidate) =>
          candidate.editedFrom && candidate.imageUrl !== coverPath);
        if (edited?.edits?.textOverlays?.some((text) => text.text === '标题')
          && fs.existsSync(edited.imageUrl) && fs.statSync(edited.imageUrl).size > 0) {
          return edited;
        }
      } catch {
        // The app may be writing this isolated project file; retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('edited cover did not persist');
}

async function main() {
  let app;
  let page;
  try {
    ({ app, page } = await launch());
    await page.waitForFunction(() => document.body.textContent?.includes('开始创作'), null, { timeout: 30_000 });
    await app.evaluate(({ ipcMain }, selectedDir) => {
      ipcMain.removeHandler('select-project-directory');
      ipcMain.handle('select-project-directory', () => selectedDir);
    }, projectDir);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu-action', { type: 'command', action: 'new-project' });
    });
    await page.waitForFunction(() => !document.body.textContent?.includes('未打开工程'), null, { timeout: 30_000 });
    const card = await openCoverPanel(page);
    if (await page.locator('[data-ai-cover-grid] [data-draggable="true"]').count() !== 1) {
      throw new Error('expected one scanned synthetic cover');
    }
    await card.click();
    await page.getByRole('button', { name: '设为整期背景' }).click();
    await waitForBackground();
    await page.locator('[data-ai-cover-grid] button[aria-label="编辑此封面"]').first().click();
    const editor = page.getByRole('dialog').filter({ hasText: '编辑封面' });
    await editor.waitFor({ timeout: 15_000 });
    await editor.getByRole('button', { name: '文字', exact: true }).click();
    await editor.getByRole('button', { name: '另存为新候选' }).click();
    await editor.waitFor({ state: 'hidden', timeout: 30_000 });
    const editedCover = await waitForEditedCover();
    await page.waitForFunction(() =>
      document.querySelectorAll('[data-ai-cover-grid] [data-draggable="true"]').length === 2,
    null, { timeout: 15_000 });
    await page.screenshot({ path: path.join(runDir, 'before-reopen.png') });
    await app.close();
    app = undefined;
    page = undefined;

    ({ app, page } = await launch());
    await page.waitForFunction(() => document.body.textContent?.includes('project'), null, { timeout: 30_000 });
    await openCoverPanel(page);
    await waitForBackground();
    await page.waitForFunction(() =>
      document.querySelectorAll('[data-ai-cover-grid] [data-draggable="true"]').length === 2,
    null, { timeout: 15_000 });
    const reopenedEditedCover = await waitForEditedCover();
    if (reopenedEditedCover.imageUrl !== editedCover.imageUrl) {
      throw new Error('edited cover path changed after reopening');
    }
    await page.screenshot({ path: path.join(runDir, 'after-reopen.png') });
    if (pageErrors.length > 0) throw new Error(`renderer errors: ${pageErrors.join('; ')}`);
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({
      projectDir, coverPath, editedCoverPath: editedCover.imageUrl,
      backgroundPersisted: true, editedCoverPersisted: true,
      editedTextPersisted: true, reopened: true, pageErrors,
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

const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

// Source-build smoke only. Runs against an isolated profile and synthetic image.
if (process.platform !== 'win32') throw new Error('Windows is required');
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..');
const runDir = path.join(repoRoot, 'data', 'runtime', 'validation', `r4-materials-${Date.now()}`);
const projectDir = path.join(runDir, 'project');
const profile = path.join(runDir, 'profile');
const source = path.join(runDir, 'selected.png');
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(source, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
  'base64',
));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

async function launch() {
  return _electron.launch({
    executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [appRoot, `--user-data-dir=${profile}`], env, timeout: 60_000,
  });
}

async function main() {
  let electron;
  const pageErrors = [];
  const stage = (name) => process.stdout.write(`stage: ${name}\n`);
  try {
    electron = await launch();
    let page = await electron.firstWindow({ timeout: 60_000 });
    page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)));
    await page.waitForFunction(() => document.body.textContent?.includes('开始创作'), null, { timeout: 30_000 });
    await electron.evaluate(({ ipcMain }, selectedDir) => {
      ipcMain.removeHandler('select-project-directory');
      ipcMain.handle('select-project-directory', () => selectedDir);
    }, projectDir);
    await electron.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu-action', { type: 'command', action: 'new-project' });
    });
    await page.waitForFunction(() => !document.body.textContent?.includes('未打开工程'), null, { timeout: 30_000 });
    await page.getByRole('button', { name: '授权素材' }).click();
    await page.getByRole('heading', { name: '授权素材库' }).waitFor();
    stage('material workbench opened');

    await electron.evaluate(({ dialog }, selectedFile) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFile] });
    }, source);
    await page.getByRole('button', { name: '选择本地文件' }).click();
    await page.getByText('已选择：selected.png').waitFor();
    await page.getByRole('textbox', { name: /画面描述/ }).fill('夜晚城市霓虹街道');
    await page.getByRole('textbox', { name: /标签/ }).fill('夜景，城市');
    await page.getByRole('textbox', { name: '素材来源' }).fill('合成测试图片');
    await page.getByRole('textbox', { name: '权利持有人' }).fill('测试用户');
    await page.getByRole('textbox', { name: '许可类型' }).fill('synthetic-test');
    await page.getByRole('textbox', { name: '使用范围说明' }).fill('测试范围');
    await page.getByRole('textbox', { name: '授权证据引用' }).fill('synthetic-approval-001');
    await page.getByRole('checkbox', { name: '抖音' }).check();
    await page.getByRole('checkbox', { name: /我确认上述平台/ }).check();
    if (!await page.getByRole('checkbox', { name: '抖音' }).isChecked() ||
        !await page.getByRole('checkbox', { name: /我确认上述平台/ }).isChecked()) {
      throw new Error('Rights confirmation controls did not toggle');
    }
    await page.getByRole('button', { name: '导入素材' }).click();
    await page.getByText(/已导入素材/).waitFor({ timeout: 30_000 });
    await page.getByText('夜晚城市霓虹街道', { exact: true }).last().waitFor();
    stage('synthetic asset imported');

    await page.getByRole('button', { name: '建立／更新索引' }).click();
    await page.getByText(/本地语义索引不可用/).waitFor({ timeout: 30_000 });
    stage('missing multilingual model fails closed');
    await page.screenshot({ path: path.join(runDir, 'before-restart.png') });
    await electron.close();
    electron = undefined;

    electron = await launch();
    page = await electron.firstWindow({ timeout: 60_000 });
    page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)));
    await page.waitForFunction(() => document.body.textContent?.includes('project'), null, { timeout: 30_000 });
    await page.getByRole('button', { name: '授权素材' }).click();
    await page.getByText('夜晚城市霓虹街道', { exact: true }).last().waitFor({ timeout: 30_000 });
    stage('asset persisted across restart');
    await page.getByRole('button', { name: '撤销自动使用' }).click();
    await page.getByText('已撤销该素材的自动使用资格。').waitFor();
    await page.screenshot({ path: path.join(runDir, 'after-revoke.png') });
    stage('authorization revoked');
    if (pageErrors.length) throw new Error(`Renderer exceptions: ${pageErrors.join(' | ')}`);
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({
      passed: true, pageErrors, source: 'synthetic-png', model: 'unavailable',
      build: 'electron-vite source',
    }, null, 2));
    process.stdout.write(`result: ${path.join(runDir, 'result.json')}\n`);
  } finally {
    if (electron) await electron.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

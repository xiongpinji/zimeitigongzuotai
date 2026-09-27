const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Source-build smoke: run after electron-vite build, without packaging.
if (process.platform !== 'win32') throw new Error('Windows is required for this smoke test');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const { _electron } = require(path.join(appRoot, 'node_modules', 'playwright'));
const ffmpeg = require(path.join(appRoot, 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
const ffprobe = require(path.join(appRoot, 'node_modules', '@ffprobe-installer', 'ffprobe')).path;
const runDir = path.join(repoRoot, 'data', 'runtime', 'validation', 'r2-subtitle-' + Date.now());
const projectDir = path.join(runDir, 'project');
const profile = path.join(runDir, 'profile');
const videoPath = path.join(projectDir, 'blue.mp4');
const srtPath = path.join(projectDir, 'captions.srt');
const projectFile = path.join(projectDir, 'project.json');
const outputPath = path.join(projectDir, 'project.mp4');
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

function command(binary, args, timeoutMs = 60_000, encoding = 'utf8') {
  const result = spawnSync(binary, args, { encoding, timeout: timeoutMs, maxBuffer: 16_000_000 });
  if (result.status !== 0) {
    throw new Error(path.basename(binary) + ' failed: ' + String(result.stderr));
  }
  return result.stdout;
}

function makeFixture() {
  command(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=blue:size=640x360:rate=15', '-t', '3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', videoPath,
  ]);
  fs.writeFileSync(srtPath, [
    '1', '00:00:00,500 --> 00:00:02,200', 'SUBTITLE_A7Q2', '',
    '2', '00:00:02,300 --> 00:00:02,900', 'TAIL_B9R4', '',
  ].join('\r\n'));
}

async function waitForProject(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(projectFile)) {
      const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      if (predicate(project)) return project;
    }
    if (Date.now() >= deadline) throw new Error('project.json did not reach ' + label);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function openEditor(page) {
  await page.getByRole('button', { name: '视频编辑器' }).click();
  await page.locator('[class*="stageFrame"]').first().waitFor({ timeout: 20_000 });
}

async function seek(page, timeMs) {
  const slider = page.getByRole('slider', { name: '播放进度' });
  const box = await slider.boundingBox();
  if (!box) throw new Error('preview progress slider is not visible');
  const durationMs = Number(await slider.getAttribute('aria-valuemax'));
  if (!Number.isFinite(durationMs) || durationMs <= timeMs) throw new Error('Invalid preview duration: ' + durationMs);
  await slider.click({ position: { x: box.width * (timeMs / durationMs), y: box.height / 2 } });
  await page.waitForFunction((target) => {
    const value = Number(document.querySelector('[role="slider"][aria-label="播放进度"]')?.getAttribute('aria-valuenow'));
    return Math.abs(value - target) < 180;
  }, timeMs, { timeout: 15_000 });
  await page.waitForTimeout(250);
}

function countBrightPixels(video, second, width, height) {
  const raw = command(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(second), '-i', video,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], 30_000, null);
  if (raw.length !== width * height * 3) {
    throw new Error('Unexpected decoded frame bytes: ' + raw.length);
  }
  let count = 0;
  for (let y = Math.floor(height * 0.6); y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      if (raw[i] > 160 && raw[i + 1] > 160 && raw[i + 2] > 160) count += 1;
    }
  }
  return count;
}

async function main() {
  makeFixture();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const pageErrors = [];
  let app;
  let page;
  const stage = (label) => process.stdout.write('stage: ' + label + '\n');
  try {
    app = await _electron.launch({
      executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [appRoot, '--user-data-dir=' + profile], env, timeout: 60_000,
    });
    page = await app.firstWindow({ timeout: 60_000 });
    page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)));
    await page.waitForFunction(() => document.body.textContent?.includes('开始创作'), null, { timeout: 30_000 });
    await app.evaluate(({ ipcMain }, selectedDir) => {
      ipcMain.removeHandler('select-project-directory');
      ipcMain.handle('select-project-directory', () => selectedDir);
    }, projectDir);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu-action', { type: 'command', action: 'new-project' });
    });
    await page.waitForFunction(() => !document.body.textContent?.includes('未打开工程'), null, { timeout: 30_000 });
    await openEditor(page);
    await page.waitForFunction(() => document.body.textContent?.includes('素材库 · 2 项'), null, { timeout: 30_000 });
    stage('video and SRT assets scanned');

    const videoCard = page.locator('[draggable="true"]').filter({ hasText: 'blue.mp4' }).first();
    const firstTrack = page.locator('[class*="trackDropLane"]').filter({ hasText: '拖入图片或视频到 轨道 1' }).first();
    await videoCard.dragTo(firstTrack);
    await page.waitForFunction(() => document.querySelectorAll('[data-overlay-block]').length === 1, null, { timeout: 15_000 });
    stage('video placed');

    await app.evaluate(({ ipcMain }, selectedSrt) => {
      ipcMain.removeHandler('select-media-file');
      ipcMain.handle('select-media-file', (_event, kind) => kind === 'srt' ? selectedSrt : null);
    }, srtPath);
    const podcast = page.locator('section[aria-label="口播资源"]');
    const toggle = podcast.getByRole('button', { name: '口播资源' });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await podcast.locator('[class*="podcastRow"]').filter({ hasText: '未设置字幕' })
      .getByRole('button', { name: '+ 添加' }).click();
    await page.getByRole('button', { name: '稍后再说' }).click();
    const saved = await waitForProject((project) =>
      project.timeline?.podcast?.srtPath === srtPath &&
      project.timeline?.overlays?.length === 1,
    'SRT and video saved');
    if (saved.timeline.podcast.durationMs !== 2900) {
      throw new Error('SRT duration was not saved: ' + saved.timeline.podcast.durationMs);
    }
    stage('SRT imported and project saved');

    const stageFrame = page.locator('[class*="stageFrame"]').first();
    await seek(page, 1200);
    await stageFrame.getByText('SUBTITLE_A7Q2', { exact: true }).waitFor({ timeout: 15_000 });
    await stageFrame.screenshot({ path: path.join(runDir, 'preview-before-reopen.png') });
    await seek(page, 200);
    if (await stageFrame.getByText('SUBTITLE_A7Q2', { exact: true }).count()) {
      throw new Error('SRT cue remained visible before its start time');
    }
    await seek(page, 3200);
    if (await stageFrame.getByText('TAIL_B9R4', { exact: true }).count()) {
      throw new Error('SRT cue remained visible after its end time');
    }
    stage('preview cue timing checked');

    await app.close();
    app = undefined;
    page = undefined;
    app = await _electron.launch({
      executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [appRoot, '--user-data-dir=' + profile], env, timeout: 60_000,
    });
    page = await app.firstWindow({ timeout: 60_000 });
    page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)));
    await page.waitForFunction(() => document.body.textContent?.includes('project'), null, { timeout: 30_000 });
    await openEditor(page);
    await seek(page, 1200);
    await page.locator('[class*="stageFrame"]').first()
      .getByText('SUBTITLE_A7Q2', { exact: true }).waitFor({ timeout: 15_000 });
    await page.locator('[class*="stageFrame"]').first()
      .screenshot({ path: path.join(runDir, 'preview-after-reopen.png') });
    stage('SRT preview preserved after reopen');

    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByText('导出设置', { exact: true }).waitFor({ timeout: 15_000 });
    if (!(await page.locator('body').innerText()).includes(outputPath)) {
      throw new Error('export path escaped the isolated project directory');
    }
    await page.getByRole('button', { name: '开始导出' }).click();
    await page.getByText('导出完成', { exact: true }).waitFor({ timeout: 180_000 });
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      throw new Error('subtitle MP4 is missing or too small');
    }
    command(ffmpeg, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], 60_000);
    const info = JSON.parse(command(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height',
      '-of', 'json', outputPath,
    ]));
    const videoStream = info.streams.find((stream) => stream.width && stream.height);
    if (!videoStream) throw new Error('No video stream in subtitle export');
    const brightPixels = {
      beforeCue: countBrightPixels(outputPath, 0.2, videoStream.width, videoStream.height),
      firstCue: countBrightPixels(outputPath, 1.2, videoStream.width, videoStream.height),
      secondCue: countBrightPixels(outputPath, 2.6, videoStream.width, videoStream.height),
      afterCue: countBrightPixels(outputPath, 3.2, videoStream.width, videoStream.height),
    };
    if (brightPixels.firstCue - brightPixels.afterCue < 200 ||
        brightPixels.secondCue - brightPixels.afterCue < 200 ||
        brightPixels.afterCue > 50) {
      throw new Error('Exported subtitle pixels missing: ' + JSON.stringify(brightPixels));
    }
    stage('export decoded and subtitle pixels found at both cue times');

    const report = {
      runDir, videoPath, srtPath, outputPath, brightPixels, exportInfo: info,
      savedDurationMs: saved.timeline.podcast.durationMs, pageErrors,
    };
    if (pageErrors.length) throw new Error('renderer errors: ' + JSON.stringify(pageErrors));
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => undefined);
    throw error;
  } finally {
    if (app) await app.close();
  }
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});

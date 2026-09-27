const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Source-build smoke: run after `electron-vite build`, without packaging.
if (process.platform !== 'win32') throw new Error('Windows is required for this smoke test');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const { _electron } = require(path.join(appRoot, 'node_modules', 'playwright'));
const ffmpeg = require(path.join(appRoot, 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
const ffprobe = require(path.join(appRoot, 'node_modules', '@ffprobe-installer', 'ffprobe')).path;
const validationDir = path.join(repoRoot, 'data', 'runtime', 'validation');
const sourceFps = Number(process.env.LINGJI_R2_SOURCE_FPS ?? '15');
if (!Number.isInteger(sourceFps) || sourceFps < 1 || sourceFps > 120) {
  throw new Error('LINGJI_R2_SOURCE_FPS must be an integer from 1 to 120');
}
const sourceKind = process.env.LINGJI_R2_SOURCE_KIND ?? 'cfr';
if (!['cfr', 'vfr'].includes(sourceKind)) {
  throw new Error('LINGJI_R2_SOURCE_KIND must be cfr or vfr');
}
const canvasKind = process.env.LINGJI_R2_CANVAS_KIND ?? 'landscape';
if (!['landscape', 'portrait'].includes(canvasKind)) {
  throw new Error('LINGJI_R2_CANVAS_KIND must be landscape or portrait');
}
if (sourceKind === 'vfr' && sourceFps !== 30) {
  throw new Error('VFR fixture uses a 30 fps source clock; set LINGJI_R2_SOURCE_FPS=30');
}
const runDir = path.join(validationDir, `r2-multitrack-${Date.now()}`);
const projectDir = path.join(runDir, 'project');
const profile = path.join(runDir, 'profile');
const sourceA = path.join(projectDir, 'r2-a.mp4');
const sourceB = path.join(projectDir, 'r2-b.mp4');
const projectFile = path.join(projectDir, 'project.json');
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(profile, { recursive: true });

function generate(output, filter) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', filter,
    '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', output,
  ], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`ffmpeg generation failed: ${result.stderr}`);
}

function generateVfr(output) {
  // Retain timestamps while dropping alternate frames in the first half:
  // ffprobe then sees both 1/15 s and 1/30 s frame intervals in one MP4.
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30:duration=3',
    '-vf', "select='if(lt(t,1.5),not(mod(n,2)),1)'",
    '-vsync', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-an', output,
  ], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`ffmpeg VFR generation failed: ${result.stderr}`);
}

function sourceFrameStepsMs(videoPath) {
  const result = spawnSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', videoPath,
  ], { encoding: 'utf8', timeout: 20_000 });
  if (result.status !== 0) throw new Error(`ffprobe source timing failed: ${result.stderr}`);
  const times = JSON.parse(result.stdout).frames.map((frame) => Number(frame.best_effort_timestamp_time));
  return [...new Set(times.slice(1).map((time, index) => Math.round((time - times[index]) * 1000)))].sort((a, b) => a - b);
}

async function waitForProject(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(projectFile)) {
      const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      if (predicate(project)) return project;
    }
    if (Date.now() >= deadline) throw new Error(`project.json did not reach ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function waitForClipCount(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-overlay-block]').length === expected,
    count,
    { timeout: 15_000 },
  );
}

async function main() {
  if (sourceKind === 'vfr') {
    generateVfr(sourceA);
  } else {
    generate(sourceA, `testsrc2=size=640x360:rate=${sourceFps}`);
  }
  generate(sourceB, `color=c=blue:size=640x360:rate=${sourceFps}`);
  const frameStepsMs = sourceFrameStepsMs(sourceA);
  if (sourceKind === 'vfr' && (!frameStepsMs.includes(33) || !frameStepsMs.includes(67))) {
    throw new Error(`VFR fixture lacks two frame intervals: ${frameStepsMs}`);
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let page;
  const pageErrors = [];
  const stage = (name) => process.stdout.write(`stage: ${name}\n`);
  try {
    app = await _electron.launch({
      executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [appRoot, `--user-data-dir=${profile}`], env, timeout: 60_000,
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
    await page.getByRole('button', { name: '视频编辑器' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('素材库 · 2 项'), null, { timeout: 30_000 });
    stage('two assets scanned');

    const assetA = page.locator('[draggable="true"]').filter({ hasText: 'r2-a.mp4' }).first();
    const firstTrack = page.locator('[class*="trackDropLane"]').filter({ hasText: '拖入图片或视频到 轨道 1' }).first();
    await assetA.dragTo(firstTrack);
    await waitForClipCount(page, 1);
    stage('first clip placed');

    await page.getByText('00:01.0', { exact: true }).first().click();
    await page.getByRole('button', { name: '分割', exact: true }).click();
    await waitForClipCount(page, 2);
    stage('split');
    await page.getByRole('button', { name: '撤销', exact: true }).last().click();
    await waitForClipCount(page, 1);
    await page.getByRole('button', { name: '重做', exact: true }).last().click();
    await waitForClipCount(page, 2);
    stage('undo and redo');

    await page.getByRole('button', { name: '添加轨道', exact: true }).click();
    const secondTrack = page.locator('[class*="trackDropLane"]').filter({ hasText: '拖入图片或视频到 轨道 2' }).first();
    await secondTrack.waitFor({ timeout: 15_000 });
    await page.locator('[draggable="true"]').filter({ hasText: 'r2-b.mp4' }).first().dragTo(secondTrack);
    await waitForClipCount(page, 3);
    stage('second track placed');

    const saved = await waitForProject((project) =>
      project.timeline.overlays.length === 3 &&
      project.timeline.tracks.filter((track) => track.kind === 'visual').length === 2,
      'three clips on two visual tracks',
    );
    fs.writeFileSync(path.join(runDir, 'before-reopen.json'), JSON.stringify(saved, null, 2));
    await page.screenshot({ path: path.join(runDir, 'before-reopen.png') });
    await app.close();
    app = undefined;
    page = undefined;
    stage('closed');

    if (canvasKind === 'portrait') {
      // Test the existing render pipeline with a vertical project loaded from disk.
      // This does not stand in for a user-facing canvas ratio control.
      const vertical = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      vertical.timeline.width = 1080;
      vertical.timeline.height = 1920;
      fs.writeFileSync(projectFile, JSON.stringify(vertical, null, 2));
    }

    app = await _electron.launch({
      executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [appRoot, `--user-data-dir=${profile}`], env, timeout: 60_000,
    });
    page = await app.firstWindow({ timeout: 60_000 });
    page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)));
    await page.waitForFunction(() => document.body.textContent?.includes('project'), null, { timeout: 30_000 });
    await page.getByRole('button', { name: '视频编辑器' }).click();
    await waitForClipCount(page, 3);
    const reopened = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    if (canvasKind === 'portrait' &&
        (reopened.timeline.width !== 1080 || reopened.timeline.height !== 1920)) {
      throw new Error('vertical timeline dimensions were not preserved on reopen');
    }
    if (reopened.timeline.tracks.filter((track) => track.kind === 'visual').length !== 2) {
      throw new Error('two visual tracks not preserved');
    }
    await page.screenshot({ path: path.join(runDir, 'after-reopen.png') });
    stage('reopened');

    const progress = page.getByRole('slider', { name: '播放进度' });
    const progressBox = await progress.boundingBox();
    if (!progressBox) throw new Error('preview progress slider is not visible');
    const endMs = Math.max(...reopened.timeline.overlays.map((item) => item.startMs + item.durationMs));
    const stageFrame = page.locator('[class*="stageFrame"]').first();
    const previewFrame = await stageFrame.boundingBox();
    if (!previewFrame ||
        (canvasKind === 'portrait'
          ? previewFrame.width < 80 || previewFrame.height < 180 || previewFrame.width >= previewFrame.height
          : previewFrame.width < 200 || previewFrame.height < 100)) {
      throw new Error(`preview stage remains too small: ${JSON.stringify(previewFrame)}`);
    }
    const previewSamples = [];
    for (const [timeMs, label] of [[1400, '1.4s'], [3000, '3s']]) {
      await progress.click({ position: { x: progressBox.width * (timeMs / endMs), y: progressBox.height / 2 } });
      await page.waitForFunction((target) => {
        const actual = Number(document.querySelector('[role="slider"][aria-label="播放进度"]')?.getAttribute('aria-valuenow'));
        return Math.abs(actual - target) < 200;
      }, timeMs, { timeout: 15_000 });
      await page.mouse.move(10, 10);
      await page.waitForTimeout(500);
      const sample = await page.evaluate(() => {
        const actualMs = Number(document.querySelector('[role="slider"][aria-label="播放进度"]')?.getAttribute('aria-valuenow'));
        const videos = Array.from(document.querySelector('[class*="stageFrame"]')?.querySelectorAll('video') ?? [])
          .map((video) => ({ src: video.currentSrc, currentTime: video.currentTime, readyState: video.readyState }));
        return { actualMs, videos };
      });
      if (!Number.isFinite(sample.actualMs) || sample.videos.length === 0) {
        throw new Error(`preview did not expose a video frame at ${timeMs}ms`);
      }
      previewSamples.push({ label, requestedMs: timeMs, ...sample, frameIndex: Math.round((sample.actualMs / 1000) * (reopened.timeline.fps ?? 30)) });
      await stageFrame.screenshot({ path: path.join(runDir, `preview-${label}.png`) });
    }
    stage('preview frames captured');

    const outputPath = path.join(projectDir, 'project.mp4');
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByText('导出设置', { exact: true }).waitFor({ timeout: 15_000 });
    if (!(await page.locator('body').innerText()).includes(outputPath)) {
      throw new Error('export path escaped the isolated project directory');
    }
    await page.getByRole('button', { name: '开始导出' }).click();
    await page.getByText('导出完成', { exact: true }).waitFor({ timeout: 180_000 });
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      throw new Error('multitrack MP4 is missing or too small');
    }
    const decode = spawnSync(ffmpeg, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], {
      encoding: 'utf8', timeout: 60_000,
    });
    if (decode.status !== 0) throw new Error(`multitrack MP4 did not decode: ${decode.stderr}`);
    const probe = spawnSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height',
      '-of', 'json', outputPath,
    ], { encoding: 'utf8', timeout: 20_000 });
    if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
    const exportInfo = JSON.parse(probe.stdout);
    const exportedVideo = exportInfo.streams.find((stream) => stream.codec_name === 'h264');
    if (!exportedVideo ||
        (canvasKind === 'portrait' && exportedVideo.width >= exportedVideo.height)) {
      throw new Error(`export did not retain vertical video geometry: ${JSON.stringify(exportInfo.streams)}`);
    }
    for (const { frameIndex, label } of previewSamples) {
      const frame = spawnSync(ffmpeg, [
        '-v', 'error', '-y', '-i', outputPath, '-vf', `select=eq(n\\,${frameIndex})`, '-vsync', '0',
        '-frames:v', '1', path.join(runDir, `export-${label}.png`),
      ], { encoding: 'utf8', timeout: 20_000 });
      if (frame.status !== 0) throw new Error(`export frame extraction failed: ${frame.stderr}`);
    }
    stage('multitrack export decoded');

    const report = {
      runDir,
      sourceFps,
      sourceKind,
      canvasKind,
      sourceFrameStepsMs: frameStepsMs,
      sourceA,
      sourceB,
      splitPieces: saved.timeline.overlays.filter((item) => item.assetPath === sourceA).length,
      visualTracks: reopened.timeline.tracks.filter((track) => track.kind === 'visual').length,
      overlays: reopened.timeline.overlays.length,
      previewFrame: { width: previewFrame.width, height: previewFrame.height },
      previewSamples,
      outputPath,
      exportInfo,
      pageErrors,
    };
    if (report.splitPieces !== 2 || report.visualTracks !== 2 || report.overlays !== 3 || pageErrors.length) {
      throw new Error(`multitrack assertions failed: ${JSON.stringify(report)}`);
    }
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
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});

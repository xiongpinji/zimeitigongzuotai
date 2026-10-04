const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Run after smoke-editor-multitrack-win.cjs with its isolated runDir.
// This is a strict acceptance gate: a nonzero exit means preview and export differ.
if (process.platform !== 'win32') throw new Error('Windows is required');
const runDir = path.resolve(process.argv[2] ?? '');
const projectFile = path.join(runDir, 'project', 'project.json');
const outputPath = path.join(runDir, 'project', 'project.mp4');
if (!fs.existsSync(projectFile) || !fs.existsSync(outputPath)) {
  throw new Error('Pass a completed isolated R2 multitrack smoke runDir');
}

const appRoot = path.resolve(__dirname, '..');
const { _electron } = require(path.join(appRoot, 'node_modules', 'playwright'));
const ffmpeg = require(path.join(appRoot, 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path;
const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
const subtitleFixture = path.basename(runDir).startsWith('r2-subtitle-');
const fps = project.timeline.fps ?? 30;
const portraitCanvas = project.timeline.height > project.timeline.width;
const endMs = Math.max(...project.timeline.overlays.map((item) => item.startMs + item.durationMs));
const targets = subtitleFixture ? [200, 1200, 2600, 1200] : [1400, 1433, 3000, 1400];
const threshold = 0.92;
const disableGpu = process.env.LINGJI_R2_DISABLE_GPU !== '0';
const browserFlags = [...(disableGpu ? ['--disable-gpu'] : []), '--force-color-profile=srgb'];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function runFfmpeg(args, label) {
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
}

async function main() {
  const app = await _electron.launch({
    executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [appRoot, `--user-data-dir=${path.join(runDir, 'profile')}`, ...browserFlags],
    env,
    timeout: 60_000,
  });
  const samples = [];
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await page.waitForFunction(() => document.body.textContent?.includes('project'), null, { timeout: 30_000 });
    await page.getByRole('button', { name: '视频编辑器' }).click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-overlay-block]').length === count,
      subtitleFixture ? 1 : 3, { timeout: 30_000 });
    await page.evaluate(() => {
      const stage = document.querySelector('[class*="stageFrame"]');
      if (!stage) return;
      const seen = new WeakSet();
      const attach = () => {
        for (const video of stage.querySelectorAll('video')) {
          if (seen.has(video)) continue;
          seen.add(video);
          video.addEventListener('seeked', () => {
            video.__r2LastSeeked = { currentTime: video.currentTime, at: performance.now() };
          });
          if (typeof video.requestVideoFrameCallback !== 'function') continue;
          const observeFrame = (_now, metadata) => {
            video.__r2LastPresented = {
              mediaTime: metadata.mediaTime,
              presentedFrames: metadata.presentedFrames,
              at: performance.now(),
            };
            video.requestVideoFrameCallback(observeFrame);
          };
          video.requestVideoFrameCallback(observeFrame);
        }
      };
      new MutationObserver(attach).observe(stage, { childList: true, subtree: true });
      attach();
    });
    const progress = page.getByRole('slider', { name: '播放进度' });
    const progressBox = await progress.boundingBox();
    if (!progressBox) throw new Error('Progress slider is missing');
    for (const [sampleIndex, requestedMs] of targets.entries()) {
      await progress.click({ position: { x: progressBox.width * (requestedMs / endMs), y: progressBox.height / 2 } });
      await page.waitForFunction((target) => {
        const actual = Number(document.querySelector('[role="slider"][aria-label="播放进度"]')?.getAttribute('aria-valuenow'));
        return Math.abs(actual - target) < 200;
      }, requestedMs, { timeout: 15_000 });
      await page.mouse.move(10, 10);
      const exactWaitStarted = Date.now();
      await page.waitForFunction((sourceFps) => {
        const stage = document.querySelector('[class*="stageFrame"]');
        const actual = Number(document.querySelector('[role="slider"][aria-label="播放进度"]')?.getAttribute('aria-valuenow'));
        if (stage?.getAttribute('data-exact-preview-status') === 'error') return true;
        const exact = stage?.querySelector('img[alt="当前精确预览帧"]');
        return stage?.getAttribute('data-exact-preview-status') === 'ready' &&
          Number(stage.getAttribute('data-exact-preview-frame')) === Math.round((actual / 1000) * sourceFps) &&
          exact?.complete && exact.naturalWidth > 0;
      }, fps, { timeout: 120_000 });
      const exactWaitMs = Date.now() - exactWaitStarted;
      const measured = await page.evaluate(() => {
        const stage = document.querySelector('[class*="stageFrame"]');
        const video = Array.from(stage?.querySelectorAll('video') ?? []).at(-1);
        const exact = stage?.querySelector('img[alt="当前精确预览帧"]');
        if (!stage || !exact) return null;
        const stageRect = stage.getBoundingClientRect();
        const videoRect = exact.getBoundingClientRect();
        const dpr = window.devicePixelRatio;
        return {
          actualMs: Number(document.querySelector('[role="slider"][aria-label="播放进度"]')?.getAttribute('aria-valuenow')),
          exactStatus: stage.getAttribute('data-exact-preview-status'),
          exactFrame: Number(stage.getAttribute('data-exact-preview-frame')),
          videoTime: video?.currentTime ?? null,
          videoReadyState: video?.readyState ?? null,
          videoSrc: video?.currentSrc ?? null,
          lastPresented: video?.__r2LastPresented ?? null,
          lastSeeked: video?.__r2LastSeeked ?? null,
          crop: {
            x: Math.round((videoRect.left - stageRect.left) * dpr),
            y: Math.round((videoRect.top - stageRect.top) * dpr),
            width: Math.round(videoRect.width * dpr),
            height: Math.round(videoRect.height * dpr),
          },
          stageSize: {
            width: Math.round(stageRect.width * dpr),
            height: Math.round(stageRect.height * dpr),
          },
        };
      });
      if (!measured || measured.exactStatus !== 'ready') {
        throw new Error(`Exact preview is not ready at ${requestedMs}ms`);
      }
      const frameIndex = measured.exactFrame;
      const previewPath = path.join(runDir, `parity-preview-${sampleIndex}-${frameIndex}.png`);
      await page.locator('[class*="stageFrame"]').first().screenshot({ path: previewPath });
      samples.push({ requestedMs, frameIndex, exactWaitMs, previewPath, ...measured });
    }
  } finally {
    await app.close();
  }

  for (const sample of samples) {
    const exportPath = path.join(runDir, `parity-export-${sample.frameIndex}.png`);
    runFfmpeg(['-v', 'error', '-y', '-i', outputPath, '-vf', `select=eq(n\\,${sample.frameIndex})`, '-vsync', '0', '-frames:v', '1', exportPath], `extract frame ${sample.frameIndex}`);
    const { x, y, width, height } = portraitCanvas
      ? { x: 0, y: 0, ...sample.stageSize }
      : sample.crop;
    const previewFilter = portraitCanvas ? 'format=yuv444p' : `crop=${width}:${height}:${x}:${y},format=yuv444p`;
    const graph = `[0:v]${previewFilter}[p];[1:v]scale=${width}:${height}:flags=bicubic,format=yuv444p[e];[p][e]ssim`;
    const log = runFfmpeg(['-hide_banner', '-v', 'info', '-i', sample.previewPath, '-i', exportPath, '-filter_complex', graph, '-frames:v', '1', '-f', 'null', 'NUL'], `compare frame ${sample.frameIndex}`);
    const match = log.match(/SSIM Y:[^\n]*All:([0-9.]+)/);
    if (!match) throw new Error(`SSIM result missing for frame ${sample.frameIndex}`);
    sample.exportPath = exportPath;
    sample.ssim = Number(match[1]);
    sample.passed = sample.ssim >= threshold;
  }

  const report = {
    runDir, fixtureKind: subtitleFixture ? 'subtitle' : 'multitrack', fps, threshold,
    comparisonRegion: 'exact-preview-overlay',
    flags: browserFlags,
    samples, passed: samples.every((sample) => sample.passed),
  };
  fs.writeFileSync(path.join(runDir, 'parity-result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});

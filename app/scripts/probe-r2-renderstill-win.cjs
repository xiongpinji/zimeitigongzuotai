// Probe exact paused-frame rendering against a synthetic R2 smoke export.
// This does not change or validate the editor's current preview UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const { bundle } = require('@remotion/bundler');
const { openBrowser, selectComposition, renderStill } = require('@remotion/renderer');
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

if (process.platform !== 'win32') throw new Error('Windows is required');
if (!process.argv[2]) throw new Error('Pass an isolated R2 multitrack smoke runDir');

const runDir = path.resolve(process.argv[2]);
assert.match(path.basename(runDir), /^r2-(?:multitrack|subtitle)-\d+$/,
  'Probe accepts only an isolated R2 multitrack or subtitle smoke directory');
const subtitleFixture = path.basename(runDir).startsWith('r2-subtitle-');
const projectDir = path.join(runDir, 'project');
const projectFile = path.join(projectDir, 'project.json');
const exportVideo = path.join(projectDir, 'project.mp4');
const smokeResultFile = path.join(runDir, 'result.json');
for (const file of [projectFile, exportVideo, smokeResultFile]) {
  if (!fs.existsSync(file)) throw new Error(`Synthetic smoke fixture is incomplete: ${file}`);
}

const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
const smokeResult = JSON.parse(fs.readFileSync(smokeResultFile, 'utf8'));
const exportStream = smokeResult.exportInfo?.streams?.find((stream) => stream.codec_name === 'h264');
assert.ok(exportStream?.width && exportStream?.height, 'Smoke export dimensions are missing');
assert.ok(project.timeline.overlays.every((overlay) => overlay.type === 'video'),
  'Probe accepts only the isolated video-overlay smoke project');
assert.ok(project.timeline.overlays.length > 0, 'Smoke project has no video overlays');
assert.ok(!project.timeline.podcast?.audioPath, 'Probe does not cover podcast audio');
if (subtitleFixture) {
  assert.equal(path.resolve(project.timeline.podcast?.srtPath ?? ''), path.join(projectDir, 'captions.srt'));
} else {
  assert.ok(!project.timeline.podcast?.srtPath, 'Multitrack probe does not cover subtitles');
}
const scale = exportStream.width / project.timeline.width;
assert.ok(Math.abs(exportStream.height / project.timeline.height - scale) < 0.000001,
  'Smoke export has nonuniform scaling');

// The smoke fixture keeps video assets beside project.json. Relative paths make
// both renderStill and renderMedia resolve them through the bundle public dir.
const timeline = {
  ...project.timeline,
  overlays: project.timeline.overlays.map((overlay) => ({
    ...overlay,
    assetPath: path.basename(overlay.assetPath),
  })),
};
let srtEntries = [];
if (subtitleFixture) {
  const parserOutput = path.join(runDir, 'probe-srt-parser.cjs');
  buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'lib', 'srt-parser.ts')],
    outfile: parserOutput, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  });
  const { parseSrt } = require(parserOutput);
  srtEntries = parseSrt(fs.readFileSync(project.timeline.podcast.srtPath, 'utf8'));
  assert.equal(srtEntries.length, 2, 'Subtitle smoke fixture must have two cues');
}
const inputProps = { timeline, srtEntries, compiledCards: {} };
const frameIndices = subtitleFixture ? [6, 36, 78, 96, 36] : [42, 43, 90, 42];
const samples = [];

function ffmpegRun(args, label) {
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${label}: ${result.error?.message ?? result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function extractExportFrame(frame) {
  const output = path.join(runDir, `probe-export-${frame}.png`);
  ffmpegRun([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', exportVideo,
    '-vf', `select=eq(n\\,${frame})`, '-vsync', '0', '-frames:v', '1', output,
  ], `Extract frame ${frame}`);
  return output;
}

function ssim(still, exported) {
  const log = ffmpegRun([
    '-hide_banner', '-v', 'info', '-i', still, '-i', exported,
    '-filter_complex', '[0:v]format=yuv444p[p];[1:v]format=yuv444p[e];[p][e]ssim',
    '-frames:v', '1', '-f', 'null', 'NUL',
  ], 'Compare still and export');
  const match = log.match(/SSIM Y:[^\n]*All:([0-9.]+)/);
  if (!match) throw new Error('FFmpeg did not report SSIM');
  return Number(match[1]);
}

async function main() {
  const bundleStarted = performance.now();
  const serveUrl = await bundle({
    entryPoint: path.join(__dirname, '..', 'src', 'remotion', 'index.ts'),
    publicDir: projectDir,
    webpackOverride: (config) => config,
    logLevel: 'error',
  });
  const bundleMs = performance.now() - bundleStarted;
  const browserStarted = performance.now();
  const browser = await openBrowser('chrome', { chromiumOptions: { gl: 'angle' }, logLevel: 'error' });
  const browserMs = performance.now() - browserStarted;
  try {
    const compositionStarted = performance.now();
    const composition = await selectComposition({
      serveUrl, id: 'lingji-composition', inputProps, puppeteerInstance: browser,
      chromiumOptions: { gl: 'angle' }, logLevel: 'error',
    });
    const compositionMs = performance.now() - compositionStarted;
    for (const frame of frameIndices) {
      assert.ok(frame < composition.durationInFrames, `Frame ${frame} exceeds composition`);
      const still = path.join(runDir, `probe-still-${frame}.png`);
      const renderedAt = performance.now();
      await renderStill({
        composition, serveUrl, frame, inputProps, puppeteerInstance: browser,
        imageFormat: 'png', output: still, overwrite: true, scale,
        chromiumOptions: { gl: 'angle' }, logLevel: 'error',
      });
      const renderMs = performance.now() - renderedAt;
      const exported = extractExportFrame(frame);
      samples.push({ frame, renderMs, ssim: ssim(still, exported), still, exported });
    }
    const result = {
      runDir, fixtureKind: subtitleFixture ? 'subtitle' : 'multitrack', bundleMs, browserMs, compositionMs,
      composition: {
        durationInFrames: composition.durationInFrames,
        width: composition.width, height: composition.height, fps: composition.fps,
      },
      exportSize: { width: exportStream.width, height: exportStream.height },
      samples,
      passed: samples.every((sample) => sample.ssim >= 0.92),
    };
    fs.writeFileSync(path.join(runDir, 'probe-renderstill-result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
  } finally {
    await browser.close({ silent: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

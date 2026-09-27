// Offline media smoke: prove that a source in-point changes the rendered frames.
// Outputs remain under ignored data/runtime/validation; no package or platform call.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { bundle } = require('@remotion/bundler');
const { selectComposition, renderMedia } = require('@remotion/renderer');

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: null, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed: ${result.error?.message ?? result.stderr?.toString('utf8').slice(-1500)}`);
  }
  return result.stdout;
}

function timeline(sourcePath, trimStartMs) {
  return {
    version: 2, fps: 10, width: 64, height: 64,
    podcast: { audioPath: '', srtPath: '', durationMs: 0 },
    tracks: [
      { id: 'audio', kind: 'audio', label: '口播轨', order: 0, locked: true },
      { id: 'subtitle', kind: 'subtitle', label: '字幕轨', order: 0, locked: true },
      { id: 'visual-1', kind: 'visual', label: '轨道 1', order: 1 },
    ],
    overlays: [{
      id: 'source-video', type: 'video', assetPath: sourcePath, trackId: 'visual-1',
      startMs: 0, durationMs: 1000,
      position: { x: 0, y: 0, width: 64, height: 64 },
      videoData: { trimStartMs, sourceDurationMs: 4000 },
    }],
    subtitle: {}, subtitleHighlights: [],
  };
}

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const validationRoot = path.join(appRoot, 'data', 'runtime', 'validation');
  fs.mkdirSync(validationRoot, { recursive: true });
  const evidenceDir = fs.mkdtempSync(path.join(validationRoot, 'source-trim-'));
  const publicDir = path.join(evidenceDir, 'public');
  fs.mkdirSync(publicDir);
  const input = path.join(publicDir, 'source.mp4');
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=2',
    '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input,
  ]);
  const serveUrl = await bundle({
    entryPoint: path.join(appRoot, 'src', 'remotion', 'index.ts'),
    publicDir,
    webpackOverride: (config) => config,
  });

  for (const [label, inPoint, expectedRed] of [
    ['frame-zero', 0, false], ['trimmed', 2500, true],
  ]) {
    const output = path.join(evidenceDir, `${label}.mp4`);
    const inputProps = {
      timeline: timeline('source.mp4', inPoint), srtEntries: [], compiledCards: {},
    };
    const composition = await selectComposition({ serveUrl, id: 'lingji-composition', inputProps });
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: output,
      inputProps, concurrency: 1, crf: 25,
      hardwareAcceleration: 'disable', x264Preset: 'ultrafast',
    });
    const pixel = run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', output,
      '-vf', 'scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-',
    ]);
    assert.equal(pixel.length, 3);
    assert.equal(pixel[0] > 120 && pixel[1] < 100 && pixel[2] < 100, expectedRed,
      `${label}: sampled RGB ${[...pixel].join(',')}`);
    console.log(`${label}: RGB ${[...pixel].join(',')}; ${output}`);
  }
  console.log(`PASS: source trim changed actual rendered video frames; evidence ${evidenceDir}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

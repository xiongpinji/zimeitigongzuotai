// Offline synthetic R4 smoke: actual Remotion frames and original audio beneath B-roll.
// Evidence stays in ignored app/data/runtime/validation; no packaging or platform I/O.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { bundle } = require('@remotion/bundler');
const { selectComposition, renderMedia } = require('@remotion/renderer');

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: null, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed: ${result.error?.message ?? result.stderr?.toString('utf8').slice(-1500)}`);
  }
  return result;
}

function fileSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sampleRgb(ffmpeg, output, time) {
  const pixel = run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output,
    '-vf', 'scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-',
  ]).stdout;
  assert.equal(pixel.length, 3);
  return [...pixel];
}

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const validationRoot = path.join(appRoot, 'data', 'runtime', 'validation');
  fs.mkdirSync(validationRoot, { recursive: true });
  const evidenceDir = fs.mkdtempSync(path.join(validationRoot, 'r4-composition-'));
  const publicDir = path.join(evidenceDir, 'public');
  fs.mkdirSync(publicDir);
  const source = path.join(publicDir, 'reviewed.mp4');
  const broll = path.join(publicDir, 'broll.mp4');

  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=0.3',
    '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=1.7',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-t', '2', source,
  ]);
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=green:s=64x64:r=10:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', broll,
  ]);

  const compiledBuilder = path.join(evidenceDir, 'timeline-builder.cjs');
  buildSync({
    entryPoints: [path.join(appRoot, 'electron', 'composition', 'timeline-builder.ts')],
    outfile: compiledBuilder, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  });
  const { buildCompositionTimeline } = require(compiledBuilder);
  const now = '2026-09-28T00:00:00.000Z';
  const plan = {
    id: 'synthetic-plan', narrativeSummary: '合成媒体验收', voiceoverKind: 'original-audio',
    aspectRatio: '1:1',
    editorial: {
      targetAudience: '测试', centralQuestion: '音画是否连续',
      openingClaim: '开场', endingMessage: '结尾',
    },
    segments: [{
      id: 'segment-1', order: 0, description: '审核切片',
      source: { kind: 'highlight', sourceId: 'highlight-1', inMs: 300, outMs: 1300 },
      editorial: { narrativeRole: 'evidence', visualIntent: '主镜头', audioIntent: '保留原声' },
      visualLayer: { assetId: 'asset-1', sourceInMs: 0, startAtMs: 200,
        durationMs: 500, purpose: '视觉覆盖' },
    }], timelineRef: null, createdAt: now, updatedAt: now,
  };
  const sources = {
    planId: plan.id,
    context: { platform: 'douyin', region: 'cn', usedAt: now, commercialShortVideo: true },
    segments: [{
      segmentId: 'segment-1', order: 0,
      clip: {
        path: source, receiptId: 'synthetic-receipt', highlightId: 'highlight-1',
        recordingId: 'synthetic-recording', sourceSha256: fileSha256(source),
        outputSha256: fileSha256(source), absoluteInMs: 300, absoluteOutMs: 1300,
        sourceInMs: 300, sourceOutMs: 1300, outputDurationMs: 2000, reviewedAt: now,
      },
      visualLayer: {
        path: broll, assetId: 'asset-1', sha256: fileSha256(broll),
        mediaType: 'video', sourceInMs: 0, startAtMs: 200, durationMs: 500,
        purpose: '视觉覆盖', evidenceRefs: ['synthetic-grant'],
        grantValidFrom: null, grantValidUntil: null,
      },
    }],
  };
  const built = buildCompositionTimeline(plan, sources);
  // Mirror render-video's public materialization at a tiny raster for a fast offline smoke.
  const timeline = {
    ...built, width: 64, height: 64, fps: 10,
    overlays: built.overlays.map((overlay) => ({
      ...overlay,
      assetPath: overlay.assetPath ? path.basename(overlay.assetPath) : '',
      position: overlay.type === 'text'
        ? { x: 100, y: 100, width: 1, height: 1 }
        : { x: 0, y: 0, width: 64, height: 64 },
    })),
  };
  const serveUrl = await bundle({
    entryPoint: path.join(appRoot, 'src', 'remotion', 'index.ts'),
    publicDir,
    webpackOverride: (config) => config,
  });
  const inputProps = { timeline, srtEntries: [], compiledCards: {} };
  const composition = await selectComposition({ serveUrl, id: 'lingji-composition', inputProps });
  const output = path.join(evidenceDir, 'rendered.mp4');
  await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: output, inputProps,
    concurrency: 1, crf: 25, hardwareAcceleration: 'disable', x264Preset: 'ultrafast',
  });

  const before = sampleRgb(ffmpeg, output, 0.1);
  const covered = sampleRgb(ffmpeg, output, 0.4);
  const after = sampleRgb(ffmpeg, output, 0.8);
  assert.ok(before[0] > 100 && before[1] < 110 && before[2] < 110, `before: ${before}`);
  assert.ok(covered[1] > 55 && covered[0] < 110 && covered[2] < 110, `B-roll: ${covered}`);
  assert.ok(after[0] > 100 && after[1] < 110 && after[2] < 110, `after: ${after}`);

  const audioCheck = run(ffmpeg, [
    '-hide_banner', '-ss', '0.3', '-t', '0.3', '-i', output,
    '-vn', '-af', 'volumedetect', '-f', 'null', '-',
  ]).stderr.toString('utf8');
  const meanVolume = Number(audioCheck.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
  assert.ok(Number.isFinite(meanVolume) && meanVolume > -35,
    `original audio missing during B-roll: ${audioCheck.slice(-1000)}`);
  console.log(JSON.stringify({ result: 'PASS', evidenceDir, outputSha256: fileSha256(output),
    before, covered, after, meanVolumeDb: meanVolume }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

/** Local-only product queue -> recovered task -> real HotClip CLI probe. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { runSingleInstanceGate } from '../electron/single-instance-gate';
import { bootstrapProductHighlights } from '../electron/highlights/product-highlight-bootstrap';
import { ProductHighlightController } from '../electron/highlights/product-highlight-controller';

if (process.platform !== 'win32') throw new Error('Windows local probe only');
const repo = resolve(__dirname, '..', '..');
const asrMode = process.argv.includes('--asr');
const selectedMode = process.argv.includes('--selected');
if (asrMode && selectedMode) throw new Error('Probe modes must be separate');
const media = asrMode
  ? join(repo, 'data', 'media', 'synthetic', 'asr-speech-2026-10-05')
  : join(repo, 'data', 'media', 'synthetic');
const video = join(media, asrMode ? 'synthetic-zh-30s.mp4' : 'highlight-trial-120s.mp4');
const srt = asrMode ? null : join(media, 'highlight-trial-120s.srt');
const unrelatedVideo = selectedMode ? join(media, 'synthetic-livestream.mp4') : null;
const unrelatedSrt = selectedMode ? join(media, 'synthetic-livestream.srt') : null;
const hotclip = join(repo, 'data', 'tools', 'hotclip');
const runDir = join(repo, 'data', 'runtime', 'validation',
  `${asrMode ? 'highlight-product-asr' : selectedMode ? 'highlight-product-selected' : 'highlight-product'}-${Date.now()}`);
const model = 'qwen3:4b-instruct';
const endpoint = 'http://127.0.0.1:11435/v1';

async function main(): Promise<void> {
  for (const path of [video, ...(srt ? [srt] : []),
    ...(unrelatedVideo ? [unrelatedVideo, unrelatedSrt!] : []),
    join(hotclip, 'src', 'cli', 'index.ts')]) {
    assert.ok(existsSync(path), 'Local probe prerequisite is missing');
  }
  const asrModelDir = process.env.LINGJI_ASR_MODELS_DIR;
  if (asrMode) assert.ok(asrModelDir && isAbsolute(asrModelDir) &&
    existsSync(join(asrModelDir, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', 'tokens.txt')),
  'ASCII model alias is unavailable');
  const tags = await fetch('http://127.0.0.1:11435/api/tags', {
    signal: AbortSignal.timeout(5_000),
  }).then((response) => response.json()) as { models: Array<{ name: string }> };
  assert.ok(tags.models.some((item) => item.name === model), 'Local model is unavailable');
  mkdirSync(runDir, { recursive: true });
  await runSingleInstanceGate({
    app: { requestSingleInstanceLock: () => true, quit: () => undefined, on: () => undefined },
    loadMainRuntime: () => undefined,
  });
  let runtime = bootstrapProductHighlights(runDir);
  try {
    let controller = new ProductHighlightController({ runtime, userDataPath: runDir });
    const [task, unrelatedTask] = await controller.importRecordings({
      mediaRootDir: media, videoPaths: unrelatedVideo ? [video, unrelatedVideo] : [video],
      subtitlePaths: unrelatedSrt ? [srt, unrelatedSrt] : [srt], maxClips: 3,
    });
    const receipt = task.recording.transcriptRef;
    const srtSha256 = srt ? createHash('sha256').update(readFileSync(srt)).digest('hex') : null;
    if (srt) {
      assert.ok(receipt && receipt.startsWith(join(runDir, 'highlights-v1', 'subtitles')));
      assert.equal(createHash('sha256').update(readFileSync(receipt)).digest('hex'), srtSha256);
    } else assert.equal(receipt, null);
    runtime.close();
    runtime = bootstrapProductHighlights(runDir);
    controller = new ProductHighlightController({ runtime, userDataPath: runDir });
    assert.equal(runtime.queue.get(task.id)?.state, 'queued');
    if (selectedMode) assert.equal(runtime.queue.get(unrelatedTask.id)?.state, 'queued');
    if (asrMode) {
      const settingsDir = join(runDir, 'highlights-v1', 'sidecar-home', 'hotclip');
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ modelsDir: asrModelDir }));
    }
    const started = Date.now();
    const config = {
      mediaRootDir: media,
      executable: process.execPath,
      argsPrefix: ['--import', 'tsx', 'src/cli/index.ts'],
      cwd: hotclip,
      timeoutMs: 600_000,
      concurrency: 1,
      maxAttempts: 1,
      llmBaseUrl: endpoint,
      llmModel: model,
      llmApiKey: 'ollama',
      allowModelDownload: true as const,
    };
    if (selectedMode) await controller.runSelected(config, [task.id]);
    else await controller.runQueued(config);
    const finalTask = runtime.queue.get(task.id);
    assert.ok(finalTask);
    const artifact = controller.readArtifact(task.id);
    const report = {
      kind: asrMode ? 'synthetic_product_highlight_asr_local' : 'synthetic_product_highlight_local', model,
      inputDurationSec: asrMode ? 30 : 120,
      subtitleSha256: srtSha256,
      elapsedMs: Date.now() - started,
      state: finalTask.state,
      failureCode: finalTask.lastErrorCode,
      candidateCount: artifact?.highlights.length ?? 0,
      candidateWindows: artifact?.highlights.map((item) => ({
        startMs: item.startMs, endMs: item.endMs, score: item.score,
      })) ?? [],
      recoveredQueueBeforeRun: true,
      selectedDispatchTested: selectedMode,
      unrelatedTaskState: unrelatedTask ? runtime.queue.get(unrelatedTask.id)?.state : null,
      realRecordingTested: false,
      humanReviewTested: false,
      platformActionAttempted: false,
    };
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(report, null, 2));
    assert.equal(finalTask.state, 'completed');
    if (selectedMode) assert.equal(runtime.queue.get(unrelatedTask.id)?.state, 'queued');
    assert.ok(artifact);
    process.stdout.write(JSON.stringify({ evidenceDir: runDir, ...report }) + '\n');
  } finally { runtime.close(); }
}

main().catch((error: unknown) => {
  if (existsSync(runDir)) writeFileSync(join(runDir, 'failure.json'), JSON.stringify({
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'probe_failed',
  }));
  process.stderr.write('product_highlight_probe_failed\n');
  process.exitCode = 1;
});

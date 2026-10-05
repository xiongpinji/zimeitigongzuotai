// Real HotClip CLI through Lingji's sidecar boundary, using only synthetic local media.
// Requires a separately running Ollama server on 127.0.0.1:11435 with qwen3:4b-instruct.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildSync } = require('esbuild');

if (process.platform !== 'win32') throw new Error('Windows probe only');
const repo = path.resolve(__dirname, '..', '..');
const app = path.join(repo, 'app');
const hotclip = path.join(repo, 'data', 'tools', 'hotclip');
const media = path.join(repo, 'data', 'media', 'synthetic');
const videoPath = path.join(media, 'highlight-trial-120s.mp4');
const subtitlesPath = path.join(media, 'highlight-trial-120s.srt');
const output = path.join(repo, 'data', 'runtime', 'validation', `hotclip-sidecar-${Date.now()}`);
const model = process.env.HOTCLIP_PROBE_MODEL ?? 'qwen3:4b-instruct';
assert.ok(['qwen3:4b', 'qwen3:4b-instruct'].includes(model), 'unsupported probe model');
const baseUrl = 'http://127.0.0.1:11435/v1';
const mode = process.argv[2] ?? 'complete';
const invocationStarted = Date.now();
assert.ok(['complete', 'cancel', 'timeout'].includes(mode), 'mode must be complete, cancel, or timeout');

function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function boundedFile(file) {
  assert.equal(fs.lstatSync(file).isFile(), true);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
}

async function main() {
  for (const file of [videoPath, subtitlesPath,
    path.join(hotclip, 'src', 'cli', 'index.ts'),
    path.join(hotclip, 'node_modules', 'tsx', 'package.json')]) boundedFile(file);
  assert.equal(fs.lstatSync(hotclip).isSymbolicLink(), false);
  const tagsResponse = await fetch('http://127.0.0.1:11435/api/tags', { signal: AbortSignal.timeout(5000) });
  assert.equal(tagsResponse.status, 200, 'Isolated local Ollama is unavailable');
  const tags = await tagsResponse.json();
  assert.ok(tags.models.some((entry) => entry.name === model), `${model} must be installed before this probe`);

  fs.mkdirSync(output, { recursive: true });
  const bundlePath = path.join(output, 'sidecar-bundle.cjs');
  buildSync({ entryPoints: [path.join(app, 'electron', 'highlights', 'hotclip-sidecar.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundlePath });
  const { runHotClipHighlights } = require(bundlePath);
  const isolatedAppData = path.join(output, 'appdata');
  const started = Date.now();
  const controller = new AbortController();
  const cancelTimer = mode === 'cancel' ? setTimeout(() => controller.abort(), 2_000) : null;
  const options = {
    executable: process.execPath,
    argsPrefix: ['--import', 'tsx', 'src/cli/index.ts'],
    cwd: hotclip,
    videoPath,
    subtitlesPath,
    maxClips: 3,
    timeoutMs: mode === 'timeout' ? 1_000 : 600_000,
    maxOutputBytes: 4 * 1024 * 1024,
    signal: controller.signal,
    env: { APPDATA: isolatedAppData, HOTCLIP_LLM_BASE_URL: baseUrl,
      HOTCLIP_LLM_MODEL: model, HOTCLIP_LLM_API_KEY: 'ollama' },
  };
  if (mode !== 'complete') {
    let failure;
    try { await runHotClipHighlights(options); } catch (error) { failure = error; }
    if (cancelTimer) clearTimeout(cancelTimer);
    assert.equal(failure?.code, mode === 'cancel' ? 'cancelled' : 'timeout');
    const report = { kind: 'synthetic_real_hotclip_sidecar', mode, model, baseUrl,
      elapsedMs: Date.now() - started, resultCode: failure.code,
      realRecordingTested: false, publicationAttempted: false };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ evidenceDir: output, ...report }) + '\n');
    return;
  }
  const candidates = await runHotClipHighlights(options);
  for (const item of candidates) {
    assert.ok(item.startSec >= 0 && item.endSec > item.startSec && item.endSec <= 120);
  }
  const report = { kind: 'synthetic_real_hotclip_sidecar', mode, model, baseUrl,
    videoSha256: hash(videoPath), subtitlesSha256: hash(subtitlesPath),
    elapsedMs: Date.now() - started, candidateCount: candidates.length,
    candidates: candidates.map((item) => ({ id: item.id, startSec: item.startSec,
      endSec: item.endSec, score: item.score, recommended: item.recommended })),
    llmModelDownloadAttemptedByProbe: false, asrDownloadAttemptedByProbe: false,
    upstreamMayFetchOptionalAuxiliaryVisionModels: true,
    realRecordingTested: false, humanReviewTested: false, publicationAttempted: false };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ evidenceDir: output, ...report }) + '\n');
}

main().catch((error) => {
  if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'failure.json'),
    JSON.stringify({ code: error?.code ?? 'probe_failed', name: error?.name ?? 'Error',
      mode, model, elapsedMs: Date.now() - invocationStarted }, null, 2));
  process.stderr.write(`${error?.code ?? error?.name ?? 'probe_failed'}\n`);
  process.exitCode = 1;
});

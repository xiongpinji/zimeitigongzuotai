// Strict offline cancellation-port gate. No browser, codec, media or platform I/O.
// Bundles the current render.ts and replaces only @remotion/renderer with a local probe.
// Exit 1 means cancellation is not connected; this is not a real-process termination test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const appRoot = path.resolve(__dirname, '..');
const evidenceRoot = path.join(appRoot, 'data', 'runtime', 'validation');
fs.mkdirSync(evidenceRoot, { recursive: true });
const evidenceDir = fs.mkdtempSync(path.join(evidenceRoot, 'r4-abort-port-'));
const modulePath = path.join(evidenceDir, 'render-probe.cjs');
buildSync({
  entryPoints: [path.join(appRoot, 'electron', 'remotion', 'render.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: modulePath,
  external: ['@remotion/renderer'], logLevel: 'silent',
});

let current;
const renderer = {
  async selectComposition() {
    current.selected++;
    current.onSelected?.();
    return { id: 'probe', fps: 30, durationInFrames: 1, width: 64, height: 64 };
  },
  makeCancelSignal() {
    const callbacks = [];
    let cancelled = false;
    return {
      cancelSignal(callback) {
        if (cancelled) callback();
        else callbacks.push(callback);
      },
      cancel() {
        if (cancelled) return;
        cancelled = true;
        current.cancelCalls++;
        for (const callback of callbacks) callback();
      },
    };
  },
  renderMedia(options) {
    current.rendered++;
    current.cancelSignalConnected = typeof options.cancelSignal === 'function';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 60);
      options.cancelSignal?.(() => {
        clearTimeout(timer);
        current.encoderCancelled = true;
        reject(new Error('synthetic render cancelled'));
      });
      current.onRender?.();
    });
  },
};

const originalLoad = Module._load;
let renderRemotionVideo;
try {
  Module._load = function (request, parent, isMain) {
    if (request === '@remotion/renderer') return renderer;
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ renderRemotionVideo } = require(modulePath));
} finally {
  Module._load = originalLoad;
}

const params = {
  serveUrl: 'http://127.0.0.1/synthetic-unused',
  outputPath: path.join(evidenceDir, 'unused.mp4'),
  timeline: {}, srtEntries: [], compiledCards: {},
  renderPlan: { scale: 1, needsFinalScale: false },
  x264Preset: 'ultrafast', videoBitrate: '1000k', audioBitrate: '128k',
  concurrency: 1, hardwareAcceleration: 'disable',
};

async function probe(name, setup) {
  const controller = new AbortController();
  current = {
    name, selected: 0, rendered: 0, cancelCalls: 0,
    cancelSignalConnected: false, encoderCancelled: false,
  };
  setup?.(controller, current);
  try {
    await renderRemotionVideo({ ...params, signal: controller.signal });
    current.resolved = true;
  } catch {
    current.resolved = false;
  }
  const { onSelected, onRender, ...report } = current;
  return report;
}

async function main() {
  const beforeStart = await probe('before_start', (controller) => controller.abort());
  beforeStart.passed = !beforeStart.resolved && beforeStart.selected === 0 && beforeStart.rendered === 0;

  const afterSelection = await probe('after_selection', (controller, state) => {
    state.onSelected = () => controller.abort();
  });
  afterSelection.passed = !afterSelection.resolved && afterSelection.selected === 1 && afterSelection.rendered === 0;

  const duringEncoding = await probe('during_encoding', (controller, state) => {
    state.onRender = () => controller.abort();
  });
  duringEncoding.passed = !duringEncoding.resolved && duringEncoding.rendered === 1
    && duringEncoding.cancelSignalConnected && duringEncoding.encoderCancelled && duringEncoding.cancelCalls === 1;

  current = { name: 'legacy_without_signal', selected: 0, rendered: 0, cancelCalls: 0 };
  await renderRemotionVideo(params);
  const legacy = { ...current, passed: current.selected === 1 && current.rendered === 1 && current.cancelCalls === 0 };
  assert.equal(fs.existsSync(params.outputPath), false, 'local probe must never create media');

  const report = {
    kind: 'offline_remotion_abort_port',
    browserStarted: false, mediaEncoded: false, publicationAttempted: false,
    beforeStart, afterSelection, duringEncoding, legacy,
    passed: [beforeStart, afterSelection, duringEncoding, legacy].every((entry) => entry.passed),
    evidenceDir,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

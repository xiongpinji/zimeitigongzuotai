// Real Electron + production MCP render of three synthetic, locally reviewed versions.
// All media, receipts, profile data and evidence stay in the ignored project data directory.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildSync } = require('esbuild');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { _electron } = require('playwright');

if (process.platform !== 'win32') throw new Error('Windows is required for this probe');
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..');
const appPackage = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const mainPath = path.join(appRoot, appPackage.main);
assert.ok(fs.existsSync(mainPath), 'Run npm run build before this probe');
const runDir = path.join(repoRoot, 'data', 'runtime', 'validation', `r5-agent-render-${Date.now()}`);
const profile = path.join(runDir, 'profile');
const isolatedHome = path.join(runDir, 'home');
const projectPath = path.join(runDir, 'project');
const mediaDir = path.join(runDir, 'media');
const batchId = 'synthetic-render-batch';
const planIds = ['synthetic-plan-1', 'synthetic-plan-2', 'synthetic-plan-3'];
const variantSeconds = Number(process.env.LINGJI_RENDER_PROBE_DURATION_SECONDS || '1');
assert.ok(Number.isInteger(variantSeconds) && variantSeconds >= 1 && variantSeconds <= 60,
  'Synthetic variant duration must be an integer from 1 to 60 seconds');
const reviewedSeconds = Math.max(3, variantSeconds + 1);
const recordingSeconds = reviewedSeconds + 1;
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const discoveryNames = ['mcp-endpoint.json', 'sonar-token', 'production-mcp-token',
  'sonar-inbox.json', 'agent-config.json'];
function realDiscoveryMetadata() {
  return discoveryNames.map((name) => {
    try {
      const stat = fs.statSync(path.join(os.homedir(), '.lingji', name));
      return { name, exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { name, exists: false };
    }
  });
}

function ffmpegRun(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
    windowsHide: true, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `Synthetic FFmpeg step failed: ${String(result.stderr).slice(-500)}`);
}

async function until(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(intervalMs);
  }
  throw new Error('probe_condition_timeout');
}

async function portFree(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function fixtureModule() {
  const entry = path.join(runDir, 'fixture-entry.ts');
  const exports = [
    ['HighlightBatchQueue', 'electron/highlights/highlight-batch-queue.ts'],
    ['HighlightArtifactStore', 'electron/highlights/highlight-batch-artifacts.ts'],
    ['ProductionActivityStore', 'electron/production/activity-store.ts'],
    ['buildLiveCompositionDocument', 'electron/composition/live-document.ts'],
    ['persistCompositionVersions', 'electron/composition/version-projects.ts'],
    ['resolveCompositionSources', 'electron/composition/source-resolver.ts'],
    ['buildReviewedClipReceipt', 'electron/highlights/reviewed-clip-receipts.ts'],
    ['expectedReviewedClipId', 'electron/highlights/reviewed-clip-receipts.ts'],
    ['writeReviewedClipReceipt', 'electron/highlights/reviewed-clip-receipts.ts'],
    ['createDefaultProjectData', 'src/lib/project-persistence.ts'],
    ['createDefaultTimeline', 'src/types.ts'],
  ];
  fs.writeFileSync(entry, exports.map(([name, file]) =>
    `export { ${name} } from ${JSON.stringify(path.join(appRoot, file).replaceAll('\\', '/'))};`).join('\n'));
  const bundled = path.join(runDir, 'fixture-entry.cjs');
  buildSync({ entryPoints: [entry], bundle: true, packages: 'external', platform: 'node',
    format: 'cjs', outfile: bundled, define: { 'import.meta.url': JSON.stringify(pathToFileURL(bundled).href) },
    logLevel: 'silent' });
  const originalLoad = Module._load;
  try {
    Module._load = function(request, parent, isMain) {
      if (request === 'electron') return { app: { isPackaged: false, getAppPath: () => appRoot } };
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(bundled);
  } finally { Module._load = originalLoad; }
}

async function prepareFixture() {
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(isolatedHome, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  const api = fixtureModule();
  fs.writeFileSync(path.join(projectPath, 'project.json'), JSON.stringify(api.createDefaultProjectData()));
  const recordingFile = path.join(mediaDir, 'synthetic-recording.mp4');
  ffmpegRun(['-y', '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=10:d=${recordingSeconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${recordingSeconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', String(recordingSeconds), recordingFile]);
  const sourceSha256 = sha256(recordingFile);
  const nowIso = new Date().toISOString();
  const recording = { id: '00000000-0000-4000-8000-000000000001',
    sourceRef: recordingFile, sourceSha256, capturedAt: null, durationMs: recordingSeconds * 1000,
    mimeType: 'video/mp4', transcriptRef: null, importedAt: nowIso };
  const queue = new api.HighlightBatchQueue({
    storePath: path.join(profile, 'highlights-v1', 'queue.json'), now: Date.now });
  const artifacts = new api.HighlightArtifactStore({
    rootDir: path.join(profile, 'highlights-v1', 'artifacts') });
  let task;
  let bundle;
  try {
    [task] = queue.enqueueBatch([{ recording, observedSourceSha256: sourceSha256,
      options: { maxClips: 1 } }]);
    const claimed = queue.claim(task.id, 1);
    bundle = artifacts.commit(claimed, [{ id: 'synthetic-upstream', startSec: 0, endSec: reviewedSeconds,
      startMs: 0, endMs: reviewedSeconds * 1000, title: '合成片段', hook: '合成开场', score: 0.8,
      reason: '离线合成测试', recommended: true, reviewNote: null, visualEvidence: null }], nowIso);
    queue.complete(task.id, claimed.attempt, { candidateIds: bundle.candidateIds,
      highlightIds: bundle.highlightIds });
    const activity = new api.ProductionActivityStore(path.join(profile, 'production-v1'));
    activity.bindOwnerImportedRecordings(projectPath, [{ id: task.id, sourceSha256 }]);
    const reviewedRoot = path.join(profile, 'highlights-v1', 'reviewed-clips');
    fs.mkdirSync(reviewedRoot, { recursive: true });
    const receiptId = api.expectedReviewedClipId({ taskId: task.id,
      highlightId: bundle.highlightIds[0], sourceSha256, startMs: 0,
      endMs: reviewedSeconds * 1000 });
    const receiptBody = { schemaVersion: 1, id: receiptId,
      taskId: task.id, highlightId: bundle.highlightIds[0],
      recordingId: recording.id, sourceSha256, startMs: 0, endMs: reviewedSeconds * 1000,
      reviewedBy: 'local-owner', reviewedAt: nowIso, renderedAt: nowIso,
      outputSha256: '', outputDurationMs: reviewedSeconds * 1000 };
    const reviewedPath = path.join(reviewedRoot, `${receiptBody.id}.mp4`);
    ffmpegRun(['-y', '-i', recordingFile, '-t', String(reviewedSeconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', reviewedPath]);
    receiptBody.outputSha256 = sha256(reviewedPath);
    const receipt = api.buildReviewedClipReceipt(receiptBody);
    api.writeReviewedClipReceipt(path.join(reviewedRoot, `${receipt.id}.json`), receipt);
    const controller = { list: () => queue.list(), readArtifact: (id) => {
      const current = queue.get(id);
      return current ? artifacts.read(current) : null;
    } };
    const document = await api.buildLiveCompositionDocument(projectPath, {
      controller, library: { list: () => [] },
      boundRecordings: (dir) => activity.boundRecordings(dir), nowIso: () => nowIso });
    const services = { nowIso: () => nowIso, controller,
      exporter: { verifiedOutput: async () => ({ path: reviewedPath, receipt }) },
      library: { get: () => null, verifiedForUsage: async () => { throw new Error('unused'); } } };
    const context = { platform: 'douyin', region: 'cn', commercialShortVideo: false };
    const versions = [];
    for (let index = 0; index < planIds.length; index += 1) {
      const planId = planIds[index];
      const inMs = index * 250;
      const plan = { id: planId, narrativeSummary: `合成版本 ${index + 1}`,
        voiceoverKind: 'original-audio', aspectRatio: '16:9', editorial: {
          targetAudience: '内部测试', centralQuestion: `问题 ${index + 1}`,
          openingClaim: `开场 ${index + 1}`, endingMessage: `结尾 ${index + 1}` },
        segments: [{ id: `segment-${index + 1}`, order: 0, description: '合成审核片段',
          source: { kind: 'highlight', sourceId: bundle.highlightIds[0],
            inMs, outMs: inMs + variantSeconds * 1000 }, editorial: { narrativeRole: 'evidence',
            visualIntent: '合成画面', audioIntent: '保留原声' } }],
        timelineRef: null, createdAt: nowIso, updatedAt: nowIso };
      const sources = await api.resolveCompositionSources({ document, plan,
        clipSelections: [{ segmentId: `segment-${index + 1}`, receiptId: receipt.id }], context }, services);
      const timeline = api.createDefaultTimeline();
      timeline.width = 640; timeline.height = 360; timeline.fps = 10;
      timeline.overlays.push({ id: `clip-${index + 1}`, type: 'video', assetPath: reviewedPath,
        trackId: 'visual-1', startMs: 0, durationMs: variantSeconds * 1000,
        position: { x: 0, y: 0, width: 640, height: 360 },
        videoData: { trimStartMs: inMs, sourceDurationMs: reviewedSeconds * 1000 } });
      versions.push({ plan, sources, timeline });
    }
    await api.persistCompositionVersions({ projectDir: projectPath, batchId, versions });
    return { taskId: task.id, receiptId: receipt.id, sourceSha256,
      protectedPaths: [path.join(projectPath, 'project.json'),
        ...planIds.flatMap((id) => [path.join(projectPath, 'compositions', batchId, id, 'project.json'),
          path.join(projectPath, 'compositions', batchId, id, 'composition-manifest.json')])] };
  } finally { artifacts.close(); queue.close(); }
}

function mcpJson(result) {
  const item = result.content.find((entry) => entry.type === 'text');
  assert.ok(item, 'Expected MCP text content');
  return JSON.parse(item.text);
}

async function main() {
  const discoveryBefore = realDiscoveryMetadata();
  await portFree(19820);
  const fixture = await prepareFixture();
  const bootstrapPath = path.join(runDir, 'bootstrap.cjs');
  fs.writeFileSync(bootstrapPath, [
    "const os = require('node:os');",
    `os.homedir = () => ${JSON.stringify(isolatedHome)};`,
    "const { app } = require('electron');",
    `app.setPath('home', ${JSON.stringify(isolatedHome)});`,
    `app.setPath('userData', ${JSON.stringify(profile)});`,
    `app.getAppPath = () => ${JSON.stringify(appRoot)};`,
    `require(${JSON.stringify(mainPath)});`,
  ].join('\n'));
  let electronApp;
  let client;
  let transport;
  let phase = 'launch';
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await _electron.launch({
      executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [bootstrapPath, `--user-data-dir=${profile}`], env, timeout: 45_000,
    });
    const page = await electronApp.firstWindow({ timeout: 30_000 });
    await page.waitForFunction(() => !!window.compositionV1API && !!window.mcpAPI, null, { timeout: 20_000 });
    const owned = await electronApp.evaluate(({ app }) => ({
      userData: app.getPath('userData'), home: app.getPath('home'), pid: process.pid }));
    assert.equal(path.normalize(owned.userData).toLowerCase(), path.normalize(profile).toLowerCase());
    assert.equal(path.normalize(owned.home).toLowerCase(), path.normalize(isolatedHome).toLowerCase());
    await until(async () => (await page.evaluate(() => window.mcpAPI.getStatus())).running, 20_000);
    const status = await page.evaluate(() => window.mcpAPI.getStatus());
    assert.equal(status.port, 19820);
    phase = 'open-project';
    const endpoint = JSON.parse(fs.readFileSync(path.join(isolatedHome, '.lingji', 'mcp-endpoint.json'), 'utf8'));
    assert.equal(endpoint.pid, owned.pid);
    const localFetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      assert.equal(url.origin, 'http://127.0.0.1:19820');
      const signals = [init?.signal, AbortSignal.timeout(120_000)].filter(Boolean);
      return fetch(input, { ...init, signal: AbortSignal.any(signals) });
    };
    const legacy = new Client({ name: 'synthetic-agent-render-setup', version: '1.0.0' }, { capabilities: {} });
    const legacyTransport = new StreamableHTTPClientTransport(new URL(status.url), { fetch: localFetch });
    try {
      await legacy.connect(legacyTransport, { timeout: 15_000 });
      assert.equal(mcpJson(await legacy.callTool({ name: 'lingji_open_project',
        arguments: { path: projectPath } }, undefined, { timeout: 15_000 })).ok, true);
    } finally {
      await legacyTransport.terminateSession().catch(() => undefined);
      await legacy.close().catch(() => undefined);
    }
    await until(async () => (await page.evaluate(() => window.compositionV1API.list())).ok, 10_000);
    const listed = await page.evaluate(() => window.compositionV1API.list());
    assert.equal(listed.ok, true);
    assert.ok(JSON.stringify(listed).includes(batchId));
    const beforeHashes = fixture.protectedPaths.map(sha256);
    fs.copyFileSync(path.join(projectPath, 'project.json'), path.join(runDir, 'root-project-before-render.json'));
    phase = 'production-connect';
    const productionTokenFile = path.join(isolatedHome, '.lingji', 'production-mcp-token');
    await until(() => fs.existsSync(productionTokenFile), 5_000);
    const token = fs.readFileSync(productionTokenFile, 'utf8').trim();
    const productionUrl = new URL(status.url);
    productionUrl.pathname = '/production-mcp';
    client = new Client({ name: 'synthetic-agent-render', version: '1.0.0' }, { capabilities: {} });
    transport = new StreamableHTTPClientTransport(productionUrl, { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('x-lingji-production-token', token);
      return localFetch(input, { ...init, headers });
    } });
    await client.connect(transport, { timeout: 15_000 });
    phase = 'prepare-render';
    await electronApp.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    const grant = await page.evaluate(() => window.productionActivityAPI.issueRenderVariants());
    assert.equal(grant.ok, true);
    assert.ok(grant.status.allowedActions.includes('render_variants'));
    const prepared = await page.evaluate((selection) => window.compositionV1API.prepareAgentRender(selection), {
      batchId, planIds, platform: 'douyin', region: 'cn', commercialShortVideo: false,
      resolution: '480p', quality: 'speed', approvedForRender: true,
    });
    assert.deepEqual(prepared, { ok: true, prepared: true });
    phase = 'mcp-render';
    const startedAt = Date.now();
    const invoked = await client.callTool({ name: 'lingji_production_render_variants', arguments: {} },
      undefined, { timeout: 15_000 });
    const started = mcpJson(invoked);
    assert.notEqual(invoked.isError, true);
    assert.deepEqual(started, { batchId, planIds, status: 'running', reviewRequired: true });
    const startLatencyMs = Date.now() - startedAt;
    assert.ok(startLatencyMs < 15_000, 'MCP start must return within the normal tool timeout');
    assert.ok(planIds.some((planId) => {
      const statePath = path.join(projectPath, 'compositions', batchId, planId, 'render-state.json');
      return !fs.existsSync(statePath) || JSON.parse(fs.readFileSync(statePath, 'utf8')).state !== 'completed';
    }), 'MCP start must return before the whole batch finishes');
    phase = 'mcp-poll';
    let rendered;
    await until(async () => {
      const polled = await client.callTool({ name: 'lingji_production_get_render_status',
        arguments: { batchId, planIds } }, undefined, { timeout: 15_000 });
      rendered = mcpJson(polled);
      assert.notEqual(polled.isError, true);
      return rendered.jobStatus === 'failed' ||
        (rendered.jobStatus === 'settled' &&
          rendered.versions.every((item) => ['completed', 'failed', 'cancelled', 'unknown']
            .includes(item.state)));
    }, variantSeconds > 1 ? 240_000 : 120_000, 1_000);
    const statusSettledMs = Date.now() - startedAt;
    fs.writeFileSync(path.join(runDir, 'render-tool-result.json'), JSON.stringify(rendered, null, 2));
    assert.equal(rendered.jobStatus, 'settled');
    assert.equal(rendered.batchId, batchId);
    assert.deepEqual(rendered.versions.map((item) => item.planId), planIds);
    assert.deepEqual(rendered.versions.map((item) => item.state), ['completed', 'completed', 'completed']);
    assert.equal(JSON.stringify(rendered).includes(runDir), false, 'MCP result must not expose local paths');
    phase = 'verify-files';
    const outputs = planIds.map((planId) => {
      const directory = path.join(projectPath, 'compositions', batchId, planId);
      const state = JSON.parse(fs.readFileSync(path.join(directory, 'render-state.json'), 'utf8'));
      assert.equal(state.state, 'completed');
      assert.equal(state.planId, planId);
      const output = path.join(directory, state.outputFile);
      assert.equal(sha256(output), state.outputSha256);
      ffmpegRun(['-i', output, '-f', 'null', '-']);
      return { planId, bytes: fs.statSync(output).size, sha256: state.outputSha256 };
    });
    assert.equal(new Set(outputs.map((item) => item.sha256)).size, 3);
    const afterHashes = fixture.protectedPaths.map(sha256);
    assert.deepEqual(afterHashes.slice(1), beforeHashes.slice(1),
      'Version projects and manifests must remain byte-for-byte unchanged');
    const rootBefore = JSON.parse(fs.readFileSync(path.join(runDir, 'root-project-before-render.json'), 'utf8'));
    const rootAfter = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.json'), 'utf8'));
    const { updatedAt: initialUpdatedAt, ...rootBeforeContent } = rootBefore;
    const { updatedAt: finalUpdatedAt, ...rootAfterContent } = rootAfter;
    assert.deepEqual(rootAfterContent, rootBeforeContent,
      'The editor may autosave its timestamp but must not change root project content');
    const second = await client.callTool({ name: 'lingji_production_render_variants', arguments: {} },
      undefined, { timeout: 15_000 });
    assert.deepEqual(mcpJson(second), { code: 'not_prepared' });
    const report = { probePassed: true, kind: 'synthetic_electron_mcp_render',
      sourceBuildSha256: sha256(mainPath), batchId, planIds, outputs,
      versionFilesByteUnchanged: true,
      rootProjectContentUnchangedExceptUpdatedAt: true,
      rootAutosaveTimestampChanged: initialUpdatedAt !== finalUpdatedAt,
      oneShotVerified: true,
      mcpStartReturnedBeforeEncoding: true, statusPollingVerified: true, startLatencyMs,
      variantSeconds, statusSettledMs,
      realDiscoveryMetadataUnchanged: true,
      realLoginAttempted: false, publicationAttempted: false, modelInvoked: false };
    assert.deepEqual(realDiscoveryMetadata(), discoveryBefore);
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify({ evidenceDir: runDir, ...report }, null, 2)}\n`);
  } catch (error) {
    fs.writeFileSync(path.join(runDir, 'failure.json'), JSON.stringify({ phase,
      code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 500) }, null, 2));
    throw error;
  } finally {
    if (transport) await transport.terminateSession().catch(() => undefined);
    if (client) await client.close().catch(() => undefined);
    if (electronApp) await electronApp.close();
    assert.deepEqual(realDiscoveryMetadata(), discoveryBefore,
      'The real account discovery files must remain unchanged');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

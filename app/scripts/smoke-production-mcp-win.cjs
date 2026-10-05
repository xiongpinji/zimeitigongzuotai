// Real local MCP protocol + source-build desktop probe with synthetic project data.
// Verifies the legacy surface and a separately authenticated, activity-gated production surface.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { buildSync } = require('esbuild');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { _electron } = require('playwright');

if (process.platform !== 'win32') throw new Error('Windows is required for this probe');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const appPackage = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const mainPath = path.join(appRoot, appPackage.main);
assert.equal(fs.existsSync(mainPath), true, 'Run the source build before this probe');
const runDir = path.join(repoRoot, 'data', 'runtime', 'validation', `r5-mcp-${Date.now()}`);
const profile = path.join(runDir, 'profile');
const isolatedHome = path.join(runDir, 'home');
const projectPath = path.join(runDir, 'project');
const fixtureTokenAclPrepared = process.argv.includes('--prepare-token-fixture');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(isolatedHome, { recursive: true });

// Optional diagnostic precondition only. The default probe leaves first-run ACL handling untouched.
// This lets protocol checks proceed separately from a failing first-run token initialization.
function prepareOwnTokenFixture() {
  const tokenDir = path.join(isolatedHome, '.lingji');
  const tokenFile = path.join(tokenDir, 'sonar-token');
  assert.ok(tokenFile.startsWith(`${runDir}${path.sep}`));
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(tokenFile, '', { flag: 'wx' });
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$file = $env:ZMT_MCP_PROBE_TOKEN_FILE',
    '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
    '$before = [System.IO.File]::GetAccessControl($file)',
    'if ($before.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $identity.Value) { throw "fixture_owner_mismatch" }',
    '$acl = New-Object System.Security.AccessControl.FileSecurity',
    '$acl.SetAccessRuleProtection($true, $false)',
    '$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)',
    '$acl.AddAccessRule($rule)',
    '[System.IO.File]::SetAccessControl($file, $acl)',
    '$after = [System.IO.File]::GetAccessControl($file)',
    '$allowed = @($after.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq "Allow" })',
    '[pscustomobject]@{ ownerPreserved = ($before.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $after.GetOwner([System.Security.Principal.SecurityIdentifier]).Value); protectedDacl = $after.AreAccessRulesProtected; onlyCurrentUserAllowed = ($allowed.Count -eq 1 -and $allowed[0].IdentityReference.Value -eq $identity.Value) } | ConvertTo-Json -Compress',
  ].join('; ');
  const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ZMT_MCP_PROBE_TOKEN_FILE: tokenFile },
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
  }).trim());
  assert.deepEqual(result, { ownerPreserved: true, protectedDacl: true, onlyCurrentUserAllowed: true });
  assert.equal(fs.statSync(tokenFile).size, 0);
  fs.writeFileSync(path.join(runDir, 'fixture-acl-precondition.json'), JSON.stringify(result, null, 2));
}

// Observe discovery-file metadata only; never read real tokens or user configuration.
const realDiscoveryDir = path.join(os.homedir(), '.lingji');
const discoveryNames = ['mcp-endpoint.json', 'sonar-token', 'production-mcp-token',
  'sonar-inbox.json', 'agent-config.json'];
function discoveryMetadata() {
  return discoveryNames.map((name) => {
    const file = path.join(realDiscoveryDir, name);
    try {
      const stat = fs.statSync(file);
      return { name, exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { name, exists: false };
    }
  });
}

const bootstrapPath = path.join(runDir, 'bootstrap.cjs');
fs.writeFileSync(bootstrapPath, [
  "const fs = require('node:fs');",
  "const os = require('node:os');",
  `os.homedir = () => ${JSON.stringify(isolatedHome)};`,
  "const { app } = require('electron');",
  `app.setPath('home', ${JSON.stringify(isolatedHome)});`,
  `app.setPath('userData', ${JSON.stringify(profile)});`,
  `app.getAppPath = () => ${JSON.stringify(appRoot)};`,
  "const childProcess = require('node:child_process');",
  "const { promisify } = require('node:util');",
  "const originalExecFile = childProcess.execFile;",
  "const originalExecFileAsync = promisify(originalExecFile);",
  "childProcess.execFile = (...args) => originalExecFile(...args);",
  "childProcess.execFile[promisify.custom] = async (...args) => {",
  `  const tracingSonar = args[0] === 'powershell.exe' && String(args[2]?.env?.SONAR_TOKEN_ACL_FILE ?? '').startsWith(${JSON.stringify(`${isolatedHome}${path.sep}`)});`,
  "  try {",
  "    return await originalExecFileAsync(...args);",
  "  } catch (error) {",
  "    if (tracingSonar) {",
  `      fs.writeFileSync(${JSON.stringify(path.join(runDir, 'sonar-acl-process-error.json'))}, JSON.stringify({`,
  "        code: error.code ?? null, signal: error.signal ?? null, killed: error.killed ?? false,",
  "        stderr: String(error.stderr ?? '').slice(0, 6000),",
  "      }, null, 2));",
  "    }",
  "    throw error;",
  "  }",
  "};",
  "const originalConsoleError = console.error;",
  "console.error = (...args) => {",
  "  if (args[0] === '[MCP] Failed to start server:') {",
  "    const error = args[1];",
  `    fs.writeFileSync(${JSON.stringify(path.join(runDir, 'mcp-startup-error.json'))}, JSON.stringify({`,
  "      name: error?.name ?? null, code: error?.code ?? null,",
  "      reason: error?.message === 'sonar_token_acl_failed' ? 'sonar_token_acl_failed' : 'other_startup_error',",
  "    }, null, 2));",
  "  }",
  "  originalConsoleError(...args);",
  "};",
  `require(${JSON.stringify(mainPath)});`,
].join('\n'));

const gatePath = path.join(runDir, 'agent-action-gate.cjs');
buildSync({
  entryPoints: [path.join(appRoot, 'electron', 'production', 'agent-action-gate.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: gatePath, logLevel: 'silent',
});
const { AGENT_PRODUCTION_ACTIONS } = require(gatePath);

async function ensurePortFree(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('probe_condition_timeout');
}

function parseResult(result) {
  assert.notEqual(result.isError, true, 'MCP tool must return a successful result');
  const content = result.content.find((item) => item.type === 'text');
  assert.ok(content, 'Expected an MCP text result');
  return JSON.parse(content.text);
}

async function main() {
  const discoveryBefore = discoveryMetadata();
  await ensurePortFree(19820); // Never connect to, stop or reuse another application's service.
  if (fixtureTokenAclPrepared) prepareOwnTokenFixture();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let electronApp;
  let page;
  let client;
  let transport;
  let productionClient;
  let productionTransport;
  let report;
  let phase = 'launch';
  const pageErrors = [];
  try {
    electronApp = await _electron.launch({
      executablePath: path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [bootstrapPath, `--user-data-dir=${profile}`], env, timeout: 45_000,
    });
    page = await electronApp.firstWindow({ timeout: 30_000 });
    page.on('pageerror', () => pageErrors.push('renderer_page_error'));
    await page.waitForFunction(() => document.body.textContent?.includes('开始创作'), null, { timeout: 20_000 });
    const paths = await electronApp.evaluate(({ app }) => ({
      userData: app.getPath('userData'), home: app.getPath('home'), appPath: app.getAppPath(), pid: process.pid,
    }));
    assert.equal(path.normalize(paths.userData).toLowerCase(), path.normalize(profile).toLowerCase());
    assert.equal(path.normalize(paths.home).toLowerCase(), path.normalize(isolatedHome).toLowerCase());
    assert.equal(path.normalize(paths.appPath).toLowerCase(), path.normalize(appRoot).toLowerCase());
    await waitUntil(async () => (await page.evaluate(() => window.mcpAPI.getStatus())).running, 20_000);
    const status = await page.evaluate(() => window.mcpAPI.getStatus());
    assert.equal(status.port, 19820);
    const discoveryFile = path.join(isolatedHome, '.lingji', 'mcp-endpoint.json');
    await waitUntil(() => fs.existsSync(discoveryFile), 5000);
    const endpoint = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));
    assert.equal(endpoint.pid, paths.pid, 'The MCP server must belong to this isolated Electron process');
    assert.equal(endpoint.url, status.url);

    const localFetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      assert.equal(url.origin, 'http://127.0.0.1:19820', 'Protocol traffic must remain on the owned loopback service');
      const signals = [init?.signal, AbortSignal.timeout(15_000)].filter(Boolean);
      return fetch(input, { ...init, signal: AbortSignal.any(signals) });
    };
    client = new Client({ name: 'zimeiti-offline-mcp-probe', version: '1.0.0' }, { capabilities: {} });
    transport = new StreamableHTTPClientTransport(new URL(status.url), { fetch: localFetch });
    await client.connect(transport, { timeout: 15_000 });
    const tools = [];
    let cursor;
    do {
      const listed = await client.listTools(cursor ? { cursor } : {}, { timeout: 15_000 });
      tools.push(...listed.tools);
      cursor = listed.nextCursor;
      assert.ok(tools.length <= 200, 'Unexpected tool-list pagination');
    } while (cursor);
    const names = tools.map((tool) => tool.name).sort();
    assert.equal(new Set(names).size, names.length);
    for (const name of ['lingji_create_project', 'lingji_open_project', 'lingji_get_project_state',
      'lingji_get_active_project', 'lingji_get_editor_state', 'lingji_list_tasks', 'lingji_export_video']) {
      assert.ok(names.includes(name), `Missing existing baseline tool ${name}`);
    }
    fs.writeFileSync(path.join(runDir, 'advertised-tools.json'), JSON.stringify(tools, null, 2));
    const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 });
    const created = parseResult(await call('lingji_create_project', { path: projectPath }));
    assert.equal(created.projectPath, projectPath);
    assert.equal(fs.existsSync(path.join(projectPath, 'project.json')), true);
    const state = parseResult(await call('lingji_get_project_state', { projectPath }));
    const opened = parseResult(await call('lingji_open_project', { path: projectPath }));
    assert.equal(opened.ok, true);
    await waitUntil(async () => parseResult(await call('lingji_get_active_project')).projectPath === projectPath, 10_000);
    await waitUntil(async () => parseResult(await call('lingji_get_editor_state')).projectDir === projectPath, 10_000);
    const editorState = parseResult(await call('lingji_get_editor_state'));
    assert.equal(editorState.projectDir, projectPath, 'The Renderer must report the same synthetic project opened through MCP');
    const tasks = parseResult(await call('lingji_list_tasks', { projectPath }));
    assert.deepEqual(tasks, [], 'No production task should start during the read/create/open probe');
    const productionUrl = new URL(status.url);
    productionUrl.pathname = '/production-mcp';
    phase = 'production-token';
    const productionTokenFile = path.join(isolatedHome, '.lingji', 'production-mcp-token');
    await waitUntil(() => fs.existsSync(productionTokenFile), 5000);
    const productionToken = fs.readFileSync(productionTokenFile, 'utf8').trim();
    assert.match(productionToken, /^[a-f0-9]{48}$/);
    for (const headers of [{}, { 'x-lingji-production-token': 'b'.repeat(48) },
      { 'x-lingji-production-token': productionToken, Origin: 'http://localhost:3000' }]) {
      phase = 'production-denied';
      const denied = await localFetch(productionUrl, { method: 'POST', headers });
      assert.equal(denied.status, 401, 'Production route must deny missing, wrong or browser-origin credentials');
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
    }
    phase = 'production-invalid-session';
    const invalidSession = await localFetch(productionUrl, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-lingji-production-token': productionToken,
      'mcp-session-id': '__proto__',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    assert.equal(invalidSession.status, 404, 'Prototype-like session IDs must never resolve to a transport');
    phase = 'production-oversized';
    const oversized = await localFetch(productionUrl, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-lingji-production-token': productionToken,
    }, body: 'x'.repeat(1024 * 1024 + 1) });
    assert.equal(oversized.status, 413, 'Production requests must have a bounded body');
    phase = 'production-connect';
    productionClient = new Client({ name: 'zimeiti-production-read-probe', version: '1.0.0' }, { capabilities: {} });
    productionTransport = new StreamableHTTPClientTransport(productionUrl, {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('x-lingji-production-token', productionToken);
        return localFetch(input, { ...init, headers });
      },
    });
    await productionClient.connect(productionTransport, { timeout: 15_000 });
    phase = 'production-tools';
    const productionTools = await productionClient.listTools({}, { timeout: 15_000 });
    assert.deepEqual(productionTools.tools.map((tool) => tool.name).sort(),
      ['lingji_production_import_recordings', 'lingji_production_list_drafts',
        'lingji_production_list_recordings',
        'lingji_production_preview_publish',
        'lingji_production_search_authorized_assets']);
    phase = 'production-list';
    const listedDrafts = parseResult(await productionClient.callTool({
      name: 'lingji_production_list_drafts', arguments: {},
    }, undefined, { timeout: 15_000 }));
    assert.deepEqual(listedDrafts, { drafts: [] });
    phase = 'production-preview';
    const previewError = await productionClient.callTool({
      name: 'lingji_production_preview_publish', arguments: { assignments: [{
        accountId: 'missing-account', batchId: 'batch-1', planId: 'plan-1',
        metadata: { title: '合成测试', description: '', tags: [], coverRefs: [], scheduleAt: null },
        commerceRequest: null,
      }] },
    }, undefined, { timeout: 15_000 });
    assert.equal(previewError.isError, true);
    assert.deepEqual(JSON.parse(previewError.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    const searchInput = { text: '夜晚街景', platform: 'douyin', region: 'cn',
      commercialShortVideo: true, maxResults: 5 };
    const searchBefore = await productionClient.callTool({
      name: 'lingji_production_search_authorized_assets', arguments: searchInput,
    }, undefined, { timeout: 15_000 });
    assert.equal(searchBefore.isError, true);
    assert.deepEqual(JSON.parse(searchBefore.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    const importInput = { maxClips: 2 };
    const importBefore = await productionClient.callTool({
      name: 'lingji_production_import_recordings', arguments: importInput,
    }, undefined, { timeout: 15_000 });
    assert.equal(importBefore.isError, true);
    assert.deepEqual(JSON.parse(importBefore.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    const listBefore = await productionClient.callTool({
      name: 'lingji_production_list_recordings', arguments: {},
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(listBefore.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    phase = 'production-activity-issue';
    assert.deepEqual(await page.evaluate(() => window.productionActivityAPI.status()),
      { ok: true, status: { active: false } });
    // Only in this disposable process: model the user's affirmative native-dialog response.
    // The production IPC still performs its own sender, project and duration checks.
    await electronApp.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    const issued = await page.evaluate(() => window.productionActivityAPI.issueQualityCheck());
    assert.equal(issued.ok, true);
    assert.equal(issued.status.active, true);
    assert.deepEqual(issued.status.allowedActions, ['quality_check']);
    const searchQualityOnly = await productionClient.callTool({
      name: 'lingji_production_search_authorized_assets', arguments: searchInput,
    }, undefined, { timeout: 15_000 });
    assert.equal(searchQualityOnly.isError, true);
    assert.deepEqual(JSON.parse(searchQualityOnly.content.find((item) => item.type === 'text').text),
      { code: 'action_not_allowed' });
    const importQualityOnly = await productionClient.callTool({
      name: 'lingji_production_import_recordings', arguments: importInput,
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(importQualityOnly.content.find((item) => item.type === 'text').text),
      { code: 'action_not_allowed' });
    phase = 'production-activity-allowed';
    const allowedPreview = await productionClient.callTool({
      name: 'lingji_production_preview_publish', arguments: { assignments: [{
        accountId: 'missing-account', batchId: 'batch-1', planId: 'plan-1',
        metadata: { title: '合成测试', description: '', tags: [], coverRefs: [], scheduleAt: null },
        commerceRequest: null,
      }] },
    }, undefined, { timeout: 15_000 });
    assert.equal(allowedPreview.isError, true);
    assert.deepEqual(JSON.parse(allowedPreview.content.find((item) => item.type === 'text').text),
      { code: 'account_missing' });
    phase = 'production-analysis-issue';
    const analysis = await page.evaluate(() => window.productionActivityAPI.issueAnalysis());
    assert.equal(analysis.ok, true);
    assert.deepEqual(analysis.status.allowedActions,
      ['quality_check', 'search_authorized_assets']);
    phase = 'production-search-allowed';
    const emptySearch = parseResult(await productionClient.callTool({
      name: 'lingji_production_search_authorized_assets', arguments: searchInput,
    }, undefined, { timeout: 15_000 }));
    assert.deepEqual(emptySearch, { status: 'no_eligible_assets', assets: [] });
    const importAnalysisOnly = await productionClient.callTool({
      name: 'lingji_production_import_recordings', arguments: importInput,
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(importAnalysisOnly.content.find((item) => item.type === 'text').text),
      { code: 'action_not_allowed' });
    phase = 'production-import-issue';
    const importGrant = await page.evaluate(() => window.productionActivityAPI.issueRecordingImport());
    assert.equal(importGrant.ok, true);
    assert.deepEqual(importGrant.status.allowedActions,
      ['quality_check', 'search_authorized_assets', 'import_recordings']);
    const missingSelection = await productionClient.callTool({
      name: 'lingji_production_import_recordings', arguments: importInput,
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(missingSelection.content.find((item) => item.type === 'text').text),
      { code: 'selection_required' });
    const mediaDir = path.join(runDir, 'synthetic-recordings');
    const recordingFile = path.join(mediaDir, 'synthetic-session.mp4');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(recordingFile, 'synthetic authorized recording bytes');
    await electronApp.evaluate(({ dialog }, selection) => {
      const files = [selection.mediaDir, selection.recordingFile];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.shift()] });
    }, { mediaDir, recordingFile });
    phase = 'production-import-selection';
    assert.equal((await page.evaluate(() => window.highlightV1API.chooseRoot())).ok, true);
    assert.equal((await page.evaluate(() => window.highlightV1API.chooseRecordings())).ok, true);
    phase = 'production-import-allowed';
    const imported = parseResult(await productionClient.callTool({
      name: 'lingji_production_import_recordings', arguments: importInput,
    }, undefined, { timeout: 15_000 }));
    assert.equal(imported.recordings.length, 1);
    assert.match(imported.recordings[0].id, /^hbatch_[a-f0-9]{64}$/);
    assert.equal(imported.recordings[0].state, 'queued');
    assert.equal(JSON.stringify(imported).includes(recordingFile), false);
    phase = 'production-recording-status';
    const recordingStatus = parseResult(await productionClient.callTool({
      name: 'lingji_production_list_recordings', arguments: {},
    }, undefined, { timeout: 15_000 }));
    assert.deepEqual(recordingStatus, { recordings: [{
      id: imported.recordings[0].id, sourceSha256: imported.recordings[0].sourceSha256,
      state: 'queued', candidateCount: 0, highlightCount: 0, lastErrorCode: null,
    }] });
    assert.equal(JSON.stringify(recordingStatus).includes(recordingFile), false);
    const importedAgain = await productionClient.callTool({
      name: 'lingji_production_import_recordings', arguments: importInput,
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(importedAgain.content.find((item) => item.type === 'text').text),
      { code: 'selection_required' });
    phase = 'production-activity-revoke';
    assert.deepEqual(await page.evaluate(() => window.productionActivityAPI.revoke()),
      { ok: true, status: { active: false } });
    const revokedPreview = await productionClient.callTool({
      name: 'lingji_production_preview_publish', arguments: { assignments: [{
        accountId: 'missing-account', batchId: 'batch-1', planId: 'plan-1',
        metadata: { title: '合成测试', description: '', tags: [], coverRefs: [], scheduleAt: null },
        commerceRequest: null,
      }] },
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(revokedPreview.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    const searchRevoked = await productionClient.callTool({
      name: 'lingji_production_search_authorized_assets', arguments: searchInput,
    }, undefined, { timeout: 15_000 });
    assert.equal(searchRevoked.isError, true);
    assert.deepEqual(JSON.parse(searchRevoked.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    const importRevoked = await productionClient.callTool({
      name: 'lingji_production_import_recordings', arguments: importInput,
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(importRevoked.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    const listRevoked = await productionClient.callTool({
      name: 'lingji_production_list_recordings', arguments: {},
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(listRevoked.content.find((item) => item.type === 'text').text),
      { code: 'grant_missing' });
    const activities = fs.readFileSync(path.join(profile, 'production-v1', 'activities.json'), 'utf8');
    assert.equal(activities.includes(projectPath), false);
    assert.ok(activities.includes('quality_check'));
    assert.ok(activities.includes(imported.recordings[0].id));
    assert.equal(activities.includes(recordingFile), false);
    assert.deepEqual(pageErrors, []);
    await page.screenshot({ path: path.join(runDir, 'project-opened.png') });
    const productionIdFields = ['recordingIds', 'highlightId', 'compositionPlanId', 'videoVariantId', 'activityGrantId', 'accountIds'];
    report = {
      kind: 'real_local_mcp_surface', sourceBuildSha256: createHash('sha256').update(fs.readFileSync(mainPath)).digest('hex'),
      mainRuntimeSha256: createHash('sha256').update(fs.readFileSync(path.join(path.dirname(mainPath), 'app-main.js'))).digest('hex'),
      isolatedProfile: profile, isolatedHome, ownedServerVerified: true,
      fixtureTokenAclPrepared,
      toolCount: names.length, toolNames: names, productionActions: [...AGENT_PRODUCTION_ACTIONS],
      advertisedActionIdentifiers: names.filter((name) => AGENT_PRODUCTION_ACTIONS.some((action) => name.includes(action))),
      productionIdFieldsInSchemas: productionIdFields.filter((field) => tools.some((tool) => JSON.stringify(tool.inputSchema).includes(`"${field}"`))),
      createProject: true, openProject: true, activeProject: true, editorIpcRoundTrip: true,
      authenticatedProductionRead: true, productionToolNames: productionTools.tools.map((tool) => tool.name),
      simulatedNativeConfirmation: true, activityIssuePreviewRevoke: true,
      syntheticRecordingImport: true,
      projectState: state, editorState, taskList: tasks, pageErrors,
      productionAcceptanceTested: false, realLoginAttempted: false,
      publicationAttempted: false, modelInvoked: false, mediaEncoded: false,
    };
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => undefined);
    const status = page ? await page.evaluate(() => window.mcpAPI?.getStatus()).catch(() => null) : null;
    const startupFile = path.join(runDir, 'mcp-startup-error.json');
    const startup = fs.existsSync(startupFile) ? JSON.parse(fs.readFileSync(startupFile, 'utf8')) : null;
    fs.writeFileSync(path.join(runDir, 'failure.json'), JSON.stringify({
      probePassed: false, evidenceDir: runDir, status, startup,
      fixtureTokenAclPrepared,
      error: error.message === 'probe_condition_timeout' ? 'probe_condition_timeout' : 'probe_failed', phase,
      productionAcceptanceTested: false, publicationAttempted: false, modelInvoked: false,
    }, null, 2));
    process.stdout.write(`${JSON.stringify({ evidenceDir: runDir, status, startup, probePassed: false }, null, 2)}\n`);
    throw error;
  } finally {
    if (productionTransport) await productionTransport.terminateSession().catch(() => undefined);
    if (productionClient) await productionClient.close().catch(() => undefined);
    if (transport) await transport.terminateSession().catch(() => undefined);
    if (client) await client.close().catch(() => undefined);
    if (electronApp) await electronApp.close();
    const discoveryAfter = discoveryMetadata();
    assert.deepEqual(discoveryAfter, discoveryBefore, 'Real discovery/configuration file metadata must remain unchanged');
    if (report) {
      report.realDiscoveryMetadataUnchanged = true;
      report.probePassed = true;
      fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(report, null, 2));
      process.stdout.write(`${JSON.stringify({ evidenceDir: runDir, toolCount: report.toolCount, toolNames: report.toolNames,
        fixtureTokenAclPrepared,
        authenticatedProductionRead: report.authenticatedProductionRead,
        productionToolNames: report.productionToolNames,
        advertisedActionIdentifiers: report.advertisedActionIdentifiers, productionIdFieldsInSchemas: report.productionIdFieldsInSchemas,
        editorIpcRoundTrip: true, realDiscoveryMetadataUnchanged: true, productionAcceptanceTested: false }, null, 2)}\n`);
    } else {
      const failurePath = path.join(runDir, 'failure.json');
      if (fs.existsSync(failurePath)) {
        const failure = JSON.parse(fs.readFileSync(failurePath, 'utf8'));
        failure.realDiscoveryMetadataUnchanged = true;
        fs.writeFileSync(failurePath, JSON.stringify(failure, null, 2));
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

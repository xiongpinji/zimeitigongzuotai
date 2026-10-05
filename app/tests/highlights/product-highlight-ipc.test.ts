import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSingleInstanceGate } from '../../electron/single-instance-gate';
import { bootstrapProductHighlights } from '../../electron/highlights/product-highlight-bootstrap';
import { ProductHighlightController } from '../../electron/highlights/product-highlight-controller';
import { HIGHLIGHT_V1_CHANNELS, registerProductHighlightIpc } from '../../electron/highlights/product-highlight-ipc';
import type { ReviewedClipExporter } from '../../electron/highlights/reviewed-clip-exporter';

const roots: string[] = [];
const runtimes: ReturnType<typeof bootstrapProductHighlights>[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lingji-highlight-ipc-'));
  roots.push(root);
  const media = join(root, 'media');
  const outside = join(root, 'outside');
  const hotclip = join(root, 'hotclip');
  mkdirSync(media);
  mkdirSync(outside);
  mkdirSync(join(hotclip, 'src', 'cli'), { recursive: true });
  mkdirSync(join(hotclip, 'node_modules', 'tsx'), { recursive: true });
  writeFileSync(join(hotclip, 'node_modules', 'tsx', 'package.json'), '{"type":"module","exports":"./index.mjs"}');
  writeFileSync(join(hotclip, 'node_modules', 'tsx', 'index.mjs'), '');
  const source = join(media, 'session.mp4');
  writeFileSync(source, 'synthetic recording');
  const outsider = join(outside, 'elsewhere.mp4');
  writeFileSync(outsider, 'outside recording');
  writeFileSync(join(hotclip, 'src', 'cli', 'index.ts'), 'process.stdout.write("[]")');
  const runtime = bootstrapProductHighlights(root);
  runtimes.push(runtime);
  const controller = new ProductHighlightController({ runtime, userDataPath: root, modelAliasBaseDir: root });
  const clipId = `hclip_${'c'.repeat(64)}`;
  const exporter = {
    exportBatch: vi.fn(async () => [{ status: 'completed', id: clipId,
      taskId: `hbatch_${'a'.repeat(64)}`, highlightId: `hlcv1-${'b'.repeat(64)}`,
      outputPath: join(root, 'highlights-v1', 'reviewed-clips', `${clipId}.mp4`),
      outputSha256: 'd'.repeat(64), outputDurationMs: 1800, reused: false }]),
    list: vi.fn(() => []),
    verifiedOutput: vi.fn(async () => ({ path: join(root, 'highlights-v1', 'reviewed-clips', `${clipId}.mp4`),
      receipt: { id: clipId, outputDurationMs: 1800 } })),
    cancelActive: vi.fn(() => true),
    hasActiveWork: false,
  };
  const handlers = new Map<string, (_event: unknown, input?: unknown) => unknown>();
  const choices: string[][] = [];
  const bindings = new Map<string, Array<{ id: string; sourceSha256: string }>>();
  const bindImportedTasks = vi.fn((projectDir: string, tasks: Array<{ id: string; sourceSha256: string }>) => {
    bindings.set(projectDir, [...(bindings.get(projectDir) ?? []), ...tasks]);
  });
  const ipc = {
    handle: (channel: string, handler: (_event: unknown, input?: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
  };
  let activeProject = join(root, 'project-a');
  let agentRunAllowed = false;
  const bridge = registerProductHighlightIpc({
    ipc,
    controller,
    exporter: exporter as unknown as ReviewedClipExporter,
    allowedSender: (event) => event === 'owner',
    pickDirectory: async () => ({ canceled: false, filePaths: choices.shift() ?? [] }),
    pickFiles: async () => ({ canceled: false, filePaths: choices.shift() ?? [] }),
    activeProjectDir: () => activeProject,
    authorizeAgentRun: () => agentRunAllowed,
    bindImportedTasks,
    boundRecordings: (projectDir) => bindings.get(projectDir) ?? [],
  });
  const invoke = (channel: string, input?: unknown, sender: unknown = 'owner') => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing test channel ${channel}`);
    return handler(sender, input);
  };
  return { root, media, hotclip, source, outsider, choices, handlers, invoke, controller, exporter, clipId,
    bridge, bindImportedTasks, setActiveProject: (value: string) => { activeProject = value; },
    setAgentRunAllowed: (value: boolean) => { agentRunAllowed = value; } };
}

beforeEach(async () => {
  await runSingleInstanceGate({
    app: { requestSingleInstanceLock: () => true, quit: () => undefined, on: () => undefined },
    loadMainRuntime: () => undefined,
  });
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) {
    const checked = resolve(root);
    if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('lingji-highlight-ipc-')) {
      throw new Error('Unsafe IPC fixture cleanup');
    }
    rmSync(checked, { recursive: true, force: true });
  }
});

describe('owner-only highlight IPC', () => {
  it('registers fixed channels before the first window and rejects other senders', async () => {
    const { handlers, invoke } = fixture();
    expect([...handlers.keys()].sort()).toEqual(Object.values(HIGHLIGHT_V1_CHANNELS).sort());
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.list, undefined, 'foreign')).toEqual({ ok: false, code: 'forbidden' });
    const main = readFileSync(resolve(__dirname, '../../electron/main.ts'), 'utf8');
    const registered = main.indexOf('registerProductHighlightIpc(');
    expect(registered).toBeGreaterThan(main.indexOf('productHighlightController = new ProductHighlightController('));
    expect(registered).toBeLessThan(main.indexOf('createWindow();'));
  });

  it('imports only OS-selected files within the selected root and never serializes source paths', async () => {
    const { media, source, outsider, choices, invoke } = fixture();
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.import)).toEqual({ ok: false, code: 'selection_required' });
    choices.push([media], [outsider]);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot)).toMatchObject({ ok: true });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings)).toEqual({ ok: false, code: 'invalid_selection' });
    choices.push([source]);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings)).toMatchObject({ ok: true, names: ['session.mp4'] });
    choices.push([outsider]);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings)).toEqual({ ok: false, code: 'invalid_selection' });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 2 }))
      .toEqual({ ok: false, code: 'selection_required' });
    choices.push([source]);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings)).toMatchObject({ ok: true });
    const imported = await invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 2 });
    expect(imported).toMatchObject({ ok: true });
    expect(JSON.stringify(imported)).not.toContain(media);
    const listed = await invoke(HIGHLIGHT_V1_CHANNELS.list);
    expect(listed).toMatchObject({ ok: true, tasks: [{ name: 'session.mp4', state: 'queued' }] });
    expect(JSON.stringify(listed)).not.toContain(source);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.import)).toEqual({ ok: false, code: 'selection_required' });
  });

  it('manual import binds tasks only to the project that selected the recording root', async () => {
    const f = fixture();
    f.choices.push([f.media], [f.source]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    f.setActiveProject(join(f.root, 'project-b'));
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }))
      .toEqual({ ok: false, code: 'project_changed' });
    expect(f.controller.list()).toEqual([]);
    f.setActiveProject(join(f.root, 'project-a'));
    const imported = await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }) as
      { ok: true; tasks: Array<{ id: string; sourceSha256: string }> };
    expect(imported.ok).toBe(true);
    expect(f.bindImportedTasks).toHaveBeenCalledWith(join(f.root, 'project-a'),
      [{ id: imported.tasks[0].id, sourceSha256: imported.tasks[0].sourceSha256 }]);
  });

  it('reports an existing project binding without exposing the other project path', async () => {
    const f = fixture();
    f.choices.push([f.media], [f.source]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    f.bindImportedTasks.mockImplementation(() => { throw new Error('recording_already_bound'); });
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }))
      .toEqual({ ok: false, code: 'recording_already_bound' });
  });

  it('does not list, read or run another project\'s queued highlighter task', async () => {
    const f = fixture();
    const second = join(f.media, 'session-b.mp4');
    writeFileSync(second, 'another project recording');
    f.choices.push([f.media], [f.source]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const own = await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }) as
      { tasks: Array<{ id: string }> };
    f.setActiveProject(join(f.root, 'project-b'));
    f.choices.push([f.media], [second]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const foreign = await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }) as
      { tasks: Array<{ id: string }> };
    f.setActiveProject(join(f.root, 'project-a'));
    const listed = await f.invoke(HIGHLIGHT_V1_CHANNELS.list) as { tasks: Array<{ id: string }> };
    expect(listed.tasks.map((task) => task.id)).toEqual([own.tasks[0].id]);
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.read, { id: foreign.tasks[0].id }))
      .toEqual({ ok: false, code: 'task_not_found' });
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.cancel, { id: foreign.tasks[0].id }))
      .toEqual({ ok: false, code: 'task_not_found' });
    f.choices.push([f.media], [process.execPath], [f.hotclip]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseNode);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseHotClip);
    const run = await f.invoke(HIGHLIGHT_V1_CHANNELS.run, {
      llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'synthetic-model',
      concurrency: 1, maxAttempts: 1, timeoutMs: 10_000, allowModelDownload: true,
    }) as { ok: true; tasks: Array<{ id: string }> };
    expect(run.tasks.map((task) => task.id)).toEqual([own.tasks[0].id]);
    expect(f.controller.list().find((task) => task.id === foreign.tasks[0].id)?.state).toBe('queued');
  });

  it('agent import consumes only files selected for the active project and rechecks authorization before queue write', async () => {
    const f = fixture();
    const projectA = join(f.root, 'project-a');
    const projectB = join(f.root, 'project-b');
    f.choices.push([f.media], [f.source]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    f.setActiveProject(projectB);
    await expect(f.bridge.importSelectedForAgent(projectA, 2, () => true))
      .rejects.toMatchObject({ code: 'project_changed' });
    f.setActiveProject(projectA);
    await expect(f.bridge.importSelectedForAgent(projectA, 2, () => false))
      .rejects.toMatchObject({ code: 'authorization_expired' });
    expect(f.controller.list()).toEqual([]);
    f.choices.push([f.source]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    await expect(f.bridge.importSelectedForAgent(projectA, 2, () => {
      f.setActiveProject(projectB);
      return true;
    })).rejects.toMatchObject({ code: 'authorization_expired' });
    expect(f.controller.list()).toEqual([]);
    f.setActiveProject(projectA);
    f.choices.push([f.source]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const imported = await f.bridge.importSelectedForAgent(projectA, 2, () => true);
    expect(imported).toMatchObject([{ id: expect.stringMatching(/^hbatch_/), state: 'queued' }]);
    expect(JSON.stringify(imported)).not.toContain(f.source);
    await expect(f.bridge.importSelectedForAgent(projectA, 2, () => true))
      .rejects.toMatchObject({ code: 'selection_required' });
  });

  it('pairs explicitly selected same-name SRT files without exposing paths to the renderer', async () => {
    const { media, source, outsider, choices, invoke, controller } = fixture();
    const subtitle = join(media, 'session.srt');
    const wrong = join(media, 'unpaired.srt');
    writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:02,000\nFirst\n');
    writeFileSync(wrong, 'unpaired');
    choices.push([media], [source], [wrong]);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseSubtitles)).toEqual({ ok: false, code: 'invalid_selection' });
    choices.push([join(dirname(outsider), 'outside.srt')]);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseSubtitles)).toEqual({ ok: false, code: 'invalid_selection' });
    choices.push([subtitle]);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseSubtitles)).toMatchObject({ ok: true, names: ['session.srt'] });
    const imported = await invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 2 });
    expect(imported).toMatchObject({ ok: true });
    expect(JSON.stringify(imported)).not.toContain(subtitle);
    expect(controller.list()[0].recording.transcriptRef).toContain('highlights-v1');
  });

  it('rejects ambiguous same-stem recordings for one selected SRT', async () => {
    const { media, source, choices, invoke } = fixture();
    const second = join(media, 'session.mov');
    const subtitle = join(media, 'session.srt');
    writeFileSync(second, 'another synthetic recording');
    writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:02,000\nFirst\n');
    choices.push([media], [source, second], [subtitle]);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseSubtitles)).toEqual({ ok: false, code: 'invalid_selection' });
  });

  it('requires explicit runtime selections and model-download consent before dispatch', async () => {
    const { media, source, outsider, hotclip, choices, invoke } = fixture();
    choices.push([media], [source]);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    await invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 2 });
    const request = {
      llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'synthetic-model',
      llmApiKey: 'SYNTHETIC-SECRET', concurrency: 1, maxAttempts: 1, timeoutMs: 10_000,
      allowModelDownload: true,
    };
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.run, request)).toEqual({ ok: false, code: 'selection_required' });
    choices.push([process.execPath], [hotclip]);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseNode)).toMatchObject({ ok: true });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.chooseHotClip)).toMatchObject({ ok: true });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.run, { ...request, allowModelDownload: false }))
      .toEqual({ ok: false, code: 'consent_required' });
    choices.push([dirname(outsider)]);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.run, request)).toEqual({ ok: false, code: 'root_mismatch' });
    expect((await invoke(HIGHLIGHT_V1_CHANNELS.list) as { tasks: { state: string }[] }).tasks[0].state).toBe('queued');
  });

  it('prepares model settings only from the owner and runs only selected current-project IDs once', async () => {
    const f = fixture();
    const another = join(f.media, 'other.mp4');
    writeFileSync(another, 'synthetic second recording');
    f.choices.push([f.media], [f.source, another], [process.execPath], [f.hotclip]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const imported = await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 2 }) as
      { tasks: { id: string }[] };
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseNode);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseHotClip);
    const config = { llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'synthetic-model',
      llmApiKey: 'PRIVATE-MODEL-KEY', concurrency: 1, maxAttempts: 1,
      timeoutMs: 10_000, allowModelDownload: true };
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.prepareAgentRun, config, 'foreign'))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.prepareAgentRun, config))
      .toEqual({ ok: false, code: 'authorization_expired' });
    f.setAgentRunAllowed(true);
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.prepareAgentRun,
      { ...config, allowModelDownload: false })).toEqual({ ok: false, code: 'consent_required' });
    const prepared = await f.invoke(HIGHLIGHT_V1_CHANNELS.prepareAgentRun, config);
    expect(prepared).toMatchObject({ ok: true });
    expect(JSON.stringify(prepared)).not.toContain(config.llmApiKey);
    f.setActiveProject(join(f.root, 'project-b'));
    await expect(Promise.resolve().then(() => f.bridge.runSelectedForAgent(
      join(f.root, 'project-a'), [imported.tasks[0].id], () => true)))
      .rejects.toMatchObject({ code: 'project_changed' });
    f.setActiveProject(join(f.root, 'project-a'));
    await expect(Promise.resolve().then(() => f.bridge.runSelectedForAgent(
      join(f.root, 'project-a'), [imported.tasks[0].id], () => false)))
      .rejects.toMatchObject({ code: 'authorization_expired' });
    const completed = await f.bridge.runSelectedForAgent(join(f.root, 'project-a'),
      [imported.tasks[0].id], () => true);
    expect(completed).toMatchObject([{ id: imported.tasks[0].id, state: 'completed' }]);
    expect(f.controller.list().find((task) => task.id === imported.tasks[1].id)).toMatchObject({ state: 'queued' });
    await expect(Promise.resolve().then(() => f.bridge.runSelectedForAgent(
      join(f.root, 'project-a'), [imported.tasks[1].id], () => true)))
      .rejects.toMatchObject({ code: 'selection_required' });
    expect(readFileSync(join(f.root, 'highlights-v1', 'queue.json'), 'utf8')).not.toContain(config.llmApiKey);
  });

  it('invalid replacement preparation clears the previous one-time model settings', async () => {
    const f = fixture();
    f.choices.push([f.media], [f.source], [process.execPath], [f.hotclip]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const imported = await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }) as
      { tasks: { id: string }[] };
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseNode);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseHotClip);
    f.setAgentRunAllowed(true);
    const config = { llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'synthetic-model',
      concurrency: 1, maxAttempts: 1, timeoutMs: 10_000, allowModelDownload: true };
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.prepareAgentRun, config))
      .toEqual({ ok: true, ready: true });
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.prepareAgentRun,
      { ...config, allowModelDownload: false }))
      .toEqual({ ok: false, code: 'consent_required' });
    await expect(Promise.resolve().then(() => f.bridge.runSelectedForAgent(
      join(f.root, 'project-a'), [imported.tasks[0].id], () => true)))
      .rejects.toMatchObject({ code: 'selection_required' });
    expect(f.controller.list()[0].state).toBe('queued');
  });

  it('passes a synthetic selected sidecar through the queue, keeping candidates review-only', async () => {
    const { media, source, hotclip, root, choices, invoke } = fixture();
    // Use a no-op loader in a synthetic Node fixture; no real HotClip model or network call.
    writeFileSync(join(hotclip, 'src', 'cli', 'index.ts'),
      'process.stdout.write(JSON.stringify([{id:"candidate",startSec:1,endSec:3,title:"Synthetic",hook:"Hook",score:0.8,reason:"Fixture",recommended:true}]))');
    choices.push([media], [source], [process.execPath], [hotclip]);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const imported = await invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }) as { tasks: { id: string }[] };
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseNode);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseHotClip);
    const result = await invoke(HIGHLIGHT_V1_CHANNELS.run, {
      llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'synthetic-model',
      llmApiKey: 'SYNTHETIC-SECRET', concurrency: 1, maxAttempts: 1, timeoutMs: 10_000,
      allowModelDownload: true,
    });
    expect(result).toMatchObject({ ok: true, tasks: [{ state: 'completed', candidateCount: 1 }] });
    const artifact = await invoke(HIGHLIGHT_V1_CHANNELS.read, { id: imported.tasks[0].id });
    expect(artifact).toMatchObject({ ok: true, artifact: { reviewRequired: true, highlights: [{ startMs: 1000, endMs: 3000 }] } });
    expect(JSON.stringify(result) + JSON.stringify(artifact)).not.toContain('SYNTHETIC-SECRET');
    expect(readFileSync(join(root, 'highlights-v1', 'queue.json'), 'utf8')).not.toContain('SYNTHETIC-SECRET');
  });

  it('requires owner, selected root and explicit review before exporting; never returns source paths', async () => {
    const { root, media, source, choices, invoke, exporter, clipId } = fixture();
    const selection = { taskId: `hbatch_${'a'.repeat(64)}`, highlightId: `hlcv1-${'b'.repeat(64)}`,
      startMs: 1100, endMs: 2900 };
    const request = { reviewConfirmed: true, selections: [selection], concurrency: 1,
      mediaRootDir: root };
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.exportReviewed, request, 'foreign'))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.exportReviewed, request))
      .toEqual({ ok: false, code: 'selection_required' });
    choices.push([media]);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.exportReviewed, { ...request, reviewConfirmed: false }))
      .toEqual({ ok: false, code: 'review_required' });
    expect(exporter.exportBatch).not.toHaveBeenCalled();
    choices.push([source]);
    await invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const imported = await invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }) as
      { tasks: Array<{ id: string }> };
    selection.taskId = imported.tasks[0].id;
    exporter.list.mockReturnValue([{ id: clipId, taskId: selection.taskId }] as never);
    exporter.verifiedOutput.mockResolvedValue({ path: join(root, 'highlights-v1', 'reviewed-clips', `${clipId}.mp4`),
      receipt: { id: clipId, taskId: selection.taskId, outputDurationMs: 1800 } });
    const result = await invoke(HIGHLIGHT_V1_CHANNELS.exportReviewed, request);
    expect(result).toMatchObject({ ok: true, results: [{ status: 'completed', id: clipId }] });
    expect(exporter.exportBatch).toHaveBeenCalledWith({ mediaRootDir: media,
      reviewConfirmed: true, selections: [selection], concurrency: 1 });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.listReviewed))
      .toMatchObject({ ok: true, clips: [{ id: clipId, taskId: selection.taskId }], busy: false });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.verifiedOutput, { id: clipId }, 'foreign'))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.verifiedOutput, { id: 'malicious' }))
      .toEqual({ ok: false, code: 'invalid_request' });
    expect(await invoke(HIGHLIGHT_V1_CHANNELS.verifiedOutput, { id: clipId }))
      .toMatchObject({ ok: true, path: expect.stringContaining(`${clipId}.mp4`), durationMs: 1800 });
  });

  it('cannot cancel or receive another project\'s in-flight reviewed export', async () => {
    const f = fixture();
    f.choices.push([f.media], [f.source]);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRoot);
    await f.invoke(HIGHLIGHT_V1_CHANNELS.chooseRecordings);
    const imported = await f.invoke(HIGHLIGHT_V1_CHANNELS.import, { maxClips: 1 }) as
      { tasks: Array<{ id: string }> };
    let finish!: (value: unknown) => void;
    f.exporter.exportBatch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }) as never);
    const pending = f.invoke(HIGHLIGHT_V1_CHANNELS.exportReviewed, {
      reviewConfirmed: true, concurrency: 1,
      selections: [{ taskId: imported.tasks[0].id, highlightId: `hlcv1-${'b'.repeat(64)}`,
        startMs: 1000, endMs: 2000 }],
    }) as Promise<unknown>;
    await Promise.resolve();
    f.setActiveProject(join(f.root, 'project-b'));
    expect(await f.invoke(HIGHLIGHT_V1_CHANNELS.cancelExport))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(f.exporter.cancelActive).not.toHaveBeenCalled();
    finish([]);
    expect(await pending).toEqual({ ok: false, code: 'project_changed' });
  });
});

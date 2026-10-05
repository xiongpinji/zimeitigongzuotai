import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProjectData } from '../src/lib/project-persistence';
import type { HighlightBatchTaskV1 } from '../electron/highlights/highlight-batch-queue';
import type { HighlightArtifactBundle } from '../electron/highlights/highlight-batch-artifacts';
import { buildLiveCompositionDocument, type LiveCompositionDocumentDeps } from '../electron/composition/live-document';

const NOW = '2026-10-05T00:00:00.000Z';
let root: string;
let projectDir: string;

function fixture() {
  const recording = { id: '00000000-0000-4000-8000-000000000001',
    sourceRef: path.join(root, 'private-live.mp4'), sourceSha256: 'a'.repeat(64),
    capturedAt: null, durationMs: 60_000, mimeType: 'video/mp4',
    transcriptRef: null, importedAt: NOW };
  const highlight = { id: `hlcv1-${'b'.repeat(64)}`, recordingId: recording.id,
    startMs: 1_000, endMs: 3_000, score: null, topic: '本地演示', context: null,
    evidence: [] as [], boundaryOrigin: 'auto' as const, adjustedAt: null, createdAt: NOW };
  const task: HighlightBatchTaskV1 = { id: `hbatch_${'c'.repeat(64)}`, recording,
    sourceSha256: recording.sourceSha256, options: { maxClips: 3 }, state: 'completed',
    attempt: 1, candidateIds: [], highlightIds: [highlight.id], lastErrorCode: null,
    createdAt: 1, updatedAt: 2 };
  const artifact: HighlightArtifactBundle = { taskId: task.id, attempt: task.attempt,
    candidateIds: [], highlightIds: [highlight.id], highlights: [highlight], reviewRequired: true };
  const deps: LiveCompositionDocumentDeps = {
    controller: { list: () => [task], readArtifact: () => artifact },
    library: { list: () => [] }, nowIso: () => NOW,
    boundRecordings: () => [{ id: task.id, sourceSha256: task.sourceSha256 }],
  };
  return { deps, task, artifact };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-live-document-'));
  projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(createDefaultProjectData()));
});
afterEach(async () => {
  if (!root.startsWith(path.join(os.tmpdir(), 'r4-live-document-'))) throw new Error('unsafe fixture root');
  await fs.rm(root, { recursive: true, force: true });
});

describe('R4 live production document from owner stores', () => {
  it('maps only completed owned recording artifacts to a valid stable project document', async () => {
    const { deps, task } = fixture();
    const first = await buildLiveCompositionDocument(projectDir, deps);
    const second = await buildLiveCompositionDocument(projectDir, deps);
    expect(first.projectId).toBe(second.projectId);
    expect(first.recordings).toEqual([task.recording]);
    expect(first.highlights).toHaveLength(1);
    expect(first.compositionPlans).toEqual([]);
    task.state = 'failed';
    const changed = await buildLiveCompositionDocument(projectDir, deps);
    expect(changed.recordings).toEqual([]);
    expect(changed.highlights).toEqual([]);
  });

  it('refuses conflicting source IDs and missing or mismatched artifacts', async () => {
    const { deps, task, artifact } = fixture();
    const duplicate = { ...task, id: `hbatch_${'d'.repeat(64)}`,
      recording: { ...task.recording, sourceSha256: 'd'.repeat(64) },
      sourceSha256: 'd'.repeat(64) };
    deps.boundRecordings = () => [
      { id: task.id, sourceSha256: task.sourceSha256 },
      { id: duplicate.id, sourceSha256: duplicate.sourceSha256 },
    ];
    deps.controller.list = () => [task, duplicate];
    await expect(buildLiveCompositionDocument(projectDir, deps))
      .rejects.toMatchObject({ code: 'conflicting_source' });
    deps.controller.list = () => [task];
    deps.controller.readArtifact = () => null;
    await expect(buildLiveCompositionDocument(projectDir, deps))
      .rejects.toMatchObject({ code: 'invalid_catalog' });
    deps.controller.readArtifact = () => ({ ...artifact, attempt: 2 });
    await expect(buildLiveCompositionDocument(projectDir, deps))
      .rejects.toMatchObject({ code: 'invalid_catalog' });
  });

  it('excludes completed highlighter tasks from another project and rejects a mismatched binding', async () => {
    const { deps, task, artifact } = fixture();
    const foreign = { ...task, id: `hbatch_${'d'.repeat(64)}`,
      recording: { ...task.recording, id: '00000000-0000-4000-8000-000000000002',
        sourceSha256: 'e'.repeat(64) }, sourceSha256: 'e'.repeat(64) };
    deps.controller.list = () => [task, foreign];
    deps.controller.readArtifact = (id) => id === task.id ? artifact : {
      ...artifact, taskId: foreign.id,
      highlights: artifact.highlights.map((highlight) => ({
        ...highlight, id: `hlcv1-${'f'.repeat(64)}`, recordingId: foreign.recording.id })),
      highlightIds: [`hlcv1-${'f'.repeat(64)}`],
    };
    const own = await buildLiveCompositionDocument(projectDir, deps);
    expect(own.recordings).toEqual([task.recording]);
    expect(own.highlights).toEqual(artifact.highlights);
    deps.boundRecordings = () => [{ id: task.id, sourceSha256: foreign.sourceSha256 }];
    await expect(buildLiveCompositionDocument(projectDir, deps))
      .rejects.toMatchObject({ code: 'invalid_catalog' });
  });

  it('refuses a missing project and malformed project data before reading global stores', async () => {
    const { deps } = fixture();
    await expect(buildLiveCompositionDocument(path.join(root, 'missing'), deps))
      .rejects.toMatchObject({ code: 'unsafe_project' });
    await fs.writeFile(path.join(projectDir, 'project.json'), '{bad');
    await expect(buildLiveCompositionDocument(projectDir, deps))
      .rejects.toMatchObject({ code: 'unsafe_project' });
  });
});

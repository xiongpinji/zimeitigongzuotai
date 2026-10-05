import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  persistCompositionVersions,
  readCompositionVersion,
} from '../electron/composition/version-projects';
import { createDefaultProjectData } from '../src/lib/project-persistence';
import { createDefaultTimeline, type TimelineData } from '../src/types';
import type { CompositionPlanV1 } from '../src/types/production-contracts';
import type { ResolvedCompositionSources } from '../electron/composition/source-resolver';

const BATCH_ID = 'batch-20260928';
const NOW = '2026-09-28T01:00:00.000Z';

let testRoot: string;
let projectDir: string;

function version(number: number): {
  plan: CompositionPlanV1;
  timeline: TimelineData;
  sources: ResolvedCompositionSources;
} {
  const id = `plan-${number}`;
  const timeline = createDefaultTimeline();
  timeline.width = 1080;
  timeline.height = 1920;
  timeline.overlays.push({
    id: `clip-${number}`,
    type: 'video',
    assetPath: path.join(projectDir, `reviewed-${number}.mp4`),
    trackId: 'visual-1',
    startMs: 0,
    durationMs: 1000,
    position: { x: 0, y: 0, width: 1080, height: 1920 },
    videoData: { trimStartMs: 300, sourceDurationMs: 2000 },
  });
  const plan: CompositionPlanV1 = {
    id,
    narrativeSummary: `叙事 ${number}`,
    voiceoverKind: 'original-audio',
    aspectRatio: '9:16',
    editorial: {
      targetAudience: '用户', centralQuestion: `问题 ${number}`,
      openingClaim: `开场 ${number}`, endingMessage: `结尾 ${number}`,
    },
    segments: [{
      id: `segment-${number}`, order: 0, description: '审核片段',
      source: { kind: 'highlight', sourceId: `highlight-${number}`, inMs: 1300, outMs: 2300 },
      editorial: { narrativeRole: 'evidence', visualIntent: '演示', audioIntent: '保留原声' },
    }],
    timelineRef: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const sources: ResolvedCompositionSources = {
    planId: id,
    context: { platform: 'douyin', region: 'cn', usedAt: NOW, commercialShortVideo: true },
    segments: [{
      segmentId: `segment-${number}`,
      order: 0,
      clip: {
        path: path.join(projectDir, `reviewed-${number}.mp4`),
        receiptId: `receipt-${number}`,
        highlightId: `highlight-${number}`,
        recordingId: `recording-${number}`,
        sourceSha256: number.toString(16).repeat(64),
        outputSha256: (number + 3).toString(16).repeat(64),
        absoluteInMs: 1300,
        absoluteOutMs: 2300,
        sourceInMs: 300,
        sourceOutMs: 1300,
        outputDurationMs: 2000,
        reviewedAt: NOW,
      },
      visualLayer: null,
    }],
  };
  return { plan, timeline, sources };
}

function threeVersions() {
  return [version(1), version(2), version(3)];
}

async function rootProjectBytes(): Promise<string> {
  return fs.readFile(path.join(projectDir, 'project.json'), 'utf8');
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-versions-'));
  projectDir = path.join(testRoot, 'project');
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(createDefaultProjectData()));
});

afterEach(async () => {
  if (!testRoot.startsWith(path.join(os.tmpdir(), 'r4-versions-'))) {
    throw new Error('unsafe test cleanup path');
  }
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('R4 independent composition version projects', () => {
  it('persists three ordinary subprojects and reopens their timelines and source hashes without touching the root project', async () => {
    const versions = threeVersions();
    const originalRoot = await rootProjectBytes();
    const records = await persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions });

    expect(records).toHaveLength(3);
    expect(new Set(records.map((record) => record.projectDir)).size).toBe(3);
    expect(await rootProjectBytes()).toBe(originalRoot);
    for (const [index, record] of records.entries()) {
      expect(record.projectDir).toBe(path.join(projectDir, 'compositions', BATCH_ID, `plan-${index + 1}`));
      const reopened = await readCompositionVersion({ projectDir, batchId: BATCH_ID, planId: `plan-${index + 1}` });
      expect(reopened.project.timeline).toEqual(versions[index].timeline);
      expect(reopened.manifest.sources.segments[0].clip.sourceSha256)
        .toBe(versions[index].sources.segments[0].clip.sourceSha256);
      expect(reopened.manifest.sources.segments[0].clip.outputSha256)
        .toBe(versions[index].sources.segments[0].clip.outputSha256);
      expect(reopened.timelineModified).toBe(false);
    }
  });

  it('resumes a partial batch and keeps completed version bytes unchanged', async () => {
    const versions = threeVersions();
    const records = await persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions });
    const firstBytes = await fs.readFile(path.join(records[0].projectDir, 'project.json'), 'utf8');
    for (const record of records.slice(1)) {
      if (!record.projectDir.startsWith(path.join(projectDir, 'compositions', BATCH_ID))) throw new Error('unsafe fixture');
      await fs.rm(record.projectDir, { recursive: true });
    }
    const staleStage = path.join(projectDir, 'compositions', BATCH_ID, '.plan-2-tmp-stale');
    await fs.mkdir(staleStage);
    await fs.writeFile(path.join(staleStage, 'project.json'), '{');

    const retried = await persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions });
    expect(retried).toHaveLength(3);
    expect(await fs.readFile(path.join(records[0].projectDir, 'project.json'), 'utf8')).toBe(firstBytes);
    expect(await fs.stat(staleStage)).toBeTruthy();
    expect((await readCompositionVersion({ projectDir, batchId: BATCH_ID, planId: 'plan-3' })).project.timeline)
      .toEqual(versions[2].timeline);
  });

  it('stops committing later versions when an Agent grant is revoked during persistence', async () => {
    let checks = 0;
    await expect(persistCompositionVersions({ projectDir, batchId: BATCH_ID,
      versions: threeVersions(), beforeCommit: () => {
        checks += 1;
        if (checks === 2) throw Object.assign(new Error('authorization_expired'),
          { code: 'authorization_expired' });
      } })).rejects.toMatchObject({ code: 'authorization_expired' });
    expect(checks).toBe(2);
    expect(await fs.stat(path.join(projectDir, 'compositions', BATCH_ID, 'plan-1'))).toBeTruthy();
    await expect(fs.stat(path.join(projectDir, 'compositions', BATCH_ID, 'plan-2')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(projectDir, 'compositions', BATCH_ID, 'plan-3')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects same-name changed content without altering the saved version', async () => {
    const versions = threeVersions();
    const records = await persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions });
    const original = await fs.readFile(path.join(records[0].projectDir, 'project.json'), 'utf8');
    versions[0].timeline.width = 720;

    await expect(persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(await fs.readFile(path.join(records[0].projectDir, 'project.json'), 'utf8')).toBe(original);
  });

  it('detects manifest corruption and permits a later manual timeline edit as an explicit modified state', async () => {
    const versions = threeVersions();
    const records = await persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions });
    const projectPath = path.join(records[0].projectDir, 'project.json');
    const edited = JSON.parse(await fs.readFile(projectPath, 'utf8')) as { timeline: TimelineData };
    edited.timeline.width = 720;
    await fs.writeFile(projectPath, JSON.stringify(edited));
    const reopened = await readCompositionVersion({ projectDir, batchId: BATCH_ID, planId: 'plan-1' });
    expect(reopened.timelineModified).toBe(true);
    expect(reopened.project.timeline?.width).toBe(720);
    await expect(persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions }))
      .rejects.toMatchObject({ code: 'conflict' });

    const manifestPath = path.join(records[1].projectDir, 'composition-manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { sources: ResolvedCompositionSources };
    manifest.sources.segments[0].clip.sourceSha256 = 'f'.repeat(64);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readCompositionVersion({ projectDir, batchId: BATCH_ID, planId: 'plan-2' }))
      .rejects.toMatchObject({ code: 'corrupt' });
  });

  it('rejects an unreadable edited timeline instead of returning a broken Lingji project', async () => {
    const records = await persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions: threeVersions() });
    const projectPath = path.join(records[0].projectDir, 'project.json');
    const broken = JSON.parse(await fs.readFile(projectPath, 'utf8')) as { timeline: TimelineData };
    broken.timeline.tracks = null as unknown as TimelineData['tracks'];
    await fs.writeFile(projectPath, JSON.stringify(broken));
    await expect(readCompositionVersion({ projectDir, batchId: BATCH_ID, planId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'corrupt' });
  });

  it('rejects invalid IDs and source mismatches before writing a version', async () => {
    const versions = threeVersions();
    await expect(persistCompositionVersions({ projectDir, batchId: '../outside', versions }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(persistCompositionVersions({ projectDir, batchId: 'CON', versions }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    versions[2].sources.planId = 'wrong-plan';
    await expect(persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(fs.stat(path.join(projectDir, 'compositions'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a symlinked compositions directory before writing outside the project', async () => {
    const outside = path.join(testRoot, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(projectDir, 'compositions'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(persistCompositionVersions({ projectDir, batchId: BATCH_ID, versions: threeVersions() }))
      .rejects.toMatchObject({ code: 'unsafe_path' });
    expect(await fs.readdir(outside)).toEqual([]);
  });
});

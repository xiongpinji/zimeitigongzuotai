/** Persist R4 versions as independent editable Lingji projects within one project data root. */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDefaultProjectData, type ProjectData } from '../../src/lib/project-persistence';
import type { TimelineData } from '../../src/types';
import type { CompositionPlanV1 } from '../../src/types/production-contracts';
import type { ResolvedCompositionSources } from './source-resolver';

const MANIFEST_FILE = 'composition-manifest.json';
const PROJECT_FILE = 'project.json';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const DEVICE_NAME_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export type CompositionVersionErrorCode =
  | 'invalid_input' | 'unsafe_path' | 'not_found' | 'corrupt' | 'conflict';

export class CompositionVersionError extends Error {
  constructor(readonly code: CompositionVersionErrorCode, message: string = code) {
    super(message);
    this.name = 'CompositionVersionError';
  }
}

export interface CompositionVersionInput {
  projectDir: string;
  batchId: string;
  versions: Array<{
    plan: CompositionPlanV1;
    timeline: TimelineData;
    sources: ResolvedCompositionSources;
  }>;
}

export interface CompositionVersionManifest {
  schemaVersion: 1;
  batchId: string;
  planId: string;
  createdAt: string;
  plan: CompositionPlanV1;
  sources: ResolvedCompositionSources;
  planSha256: string;
  sourcesSha256: string;
  initialTimelineSha256: string;
}

export interface CompositionVersionRecord {
  projectDir: string;
  project: ProjectData;
  manifest: CompositionVersionManifest;
  /** Editing a saved version is allowed; callers must re-review before rendering it. */
  timelineModified: boolean;
}

export interface CompositionVersionLocation {
  projectDir: string;
  batchId: string;
  planId: string;
}

function fail(code: CompositionVersionErrorCode, message?: string): never {
  throw new CompositionVersionError(code, message);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value) && !DEVICE_NAME_PATTERN.test(value);
}

function stableJson(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, current: unknown) => {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        return Object.fromEntries(
          Object.entries(current as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
        );
      }
      return current;
    });
  } catch {
    fail('invalid_input', 'composition data cannot be serialized');
  }
  if (typeof serialized !== 'string') fail('invalid_input', 'invalid composition data');
  return serialized;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function lstatOrNull(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function assertRealDirectory(directory: string): Promise<void> {
  const entry = await lstatOrNull(directory);
  if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) {
    fail('unsafe_path', `unsafe composition directory: ${directory}`);
  }
  if (!samePath(await fs.realpath(directory), directory)) {
    fail('unsafe_path', `composition directory escapes project: ${directory}`);
  }
}

async function ensureRealChildDirectory(parent: string, name: string): Promise<string> {
  const child = path.join(parent, name);
  try {
    await fs.mkdir(child);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertRealDirectory(child);
  return child;
}

async function realProjectRoot(projectDir: string): Promise<string> {
  if (typeof projectDir !== 'string' || !path.isAbsolute(projectDir)) {
    fail('invalid_input', 'projectDir must be absolute');
  }
  let root: string;
  try {
    root = await fs.realpath(projectDir);
  } catch {
    fail('unsafe_path', 'project directory does not exist');
  }
  await assertRealDirectory(root);
  const rootFile = path.join(root, PROJECT_FILE);
  const entry = await lstatOrNull(rootFile);
  if (!entry || !entry.isFile() || entry.isSymbolicLink()) {
    fail('unsafe_path', 'root project.json must be a regular file');
  }
  try {
    const project = JSON.parse(await fs.readFile(rootFile, 'utf8')) as ProjectData;
    if (project.version !== 1) fail('corrupt', 'root project.json is not v1');
  } catch (error) {
    if (error instanceof CompositionVersionError) throw error;
    fail('corrupt', 'root project.json is unreadable');
  }
  return root;
}

function validateSources(plan: CompositionPlanV1, sources: ResolvedCompositionSources): void {
  if (!sources || sources.planId !== plan.id || !Array.isArray(sources.segments)
    || sources.segments.length === 0 || sources.segments.length !== plan.segments.length) {
    fail('invalid_input', 'plan and verified sources differ');
  }
  const byId = new Map(sources.segments.map((segment) => [segment.segmentId, segment]));
  if (byId.size !== sources.segments.length) fail('invalid_input', 'duplicate source segments');
  for (const segment of plan.segments) {
    const resolved = byId.get(segment.id);
    if (!resolved || resolved.order !== segment.order
      || resolved.clip.absoluteInMs !== segment.source.inMs
      || resolved.clip.absoluteOutMs !== segment.source.outMs
      || !SHA256_PATTERN.test(resolved.clip.sourceSha256)
      || !SHA256_PATTERN.test(resolved.clip.outputSha256)
      || (resolved.visualLayer && !SHA256_PATTERN.test(resolved.visualLayer.sha256))) {
      fail('invalid_input', 'plan and verified source segment differ');
    }
  }
}

function validateVersions(input: CompositionVersionInput): void {
  if (!input || !validId(input.batchId)
    || !Array.isArray(input.versions) || input.versions.length < 3) {
    fail('invalid_input', 'at least three versions and a safe batch ID are required');
  }
  const ids = new Set<string>();
  for (const candidate of input.versions) {
    if (!candidate || !candidate.plan || !validId(candidate.plan.id)
      || ids.has(candidate.plan.id) || !candidate.plan.editorial
      || !Array.isArray(candidate.plan.segments) || candidate.plan.segments.length === 0
      || !candidate.timeline || !Array.isArray(candidate.timeline.overlays)
      || candidate.timeline.overlays.length === 0) {
      fail('invalid_input', 'invalid or duplicate version');
    }
    ids.add(candidate.plan.id);
    validateSources(candidate.plan, candidate.sources);
    sha256(candidate.plan);
    sha256(candidate.timeline);
    sha256(candidate.sources);
  }
}

async function readRegularJson(filePath: string): Promise<unknown> {
  const entry = await lstatOrNull(filePath);
  if (!entry) fail('corrupt', `missing version file: ${path.basename(filePath)}`);
  if (!entry.isFile() || entry.isSymbolicLink()) fail('unsafe_path', `unsafe version file: ${filePath}`);
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch {
    fail('corrupt', `invalid version file: ${path.basename(filePath)}`);
  }
}

async function versionDirectory(root: string, batchId: string, planId: string): Promise<string> {
  if (!validId(batchId) || !validId(planId)) fail('invalid_input', 'unsafe batch or plan ID');
  const compositions = path.join(root, 'compositions');
  const batch = path.join(compositions, batchId);
  await assertRealDirectory(compositions);
  await assertRealDirectory(batch);
  const versionDir = path.join(batch, planId);
  if (!await lstatOrNull(versionDir)) fail('not_found', 'version does not exist');
  await assertRealDirectory(versionDir);
  return versionDir;
}

async function readVersionFromRoot(root: string, batchId: string, planId: string): Promise<CompositionVersionRecord> {
  const versionDir = await versionDirectory(root, batchId, planId);
  const manifest = await readRegularJson(path.join(versionDir, MANIFEST_FILE)) as CompositionVersionManifest;
  const project = await readRegularJson(path.join(versionDir, PROJECT_FILE)) as ProjectData;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.batchId !== batchId
    || manifest.planId !== planId || !manifest.plan || manifest.plan.id !== planId
    || !manifest.sources || manifest.sources.planId !== planId
    || !project || project.version !== 1 || !project.timeline
    || manifest.planSha256 !== sha256(manifest.plan)
    || manifest.sourcesSha256 !== sha256(manifest.sources)
    || !SHA256_PATTERN.test(manifest.initialTimelineSha256)) {
    fail('corrupt', 'version project or provenance manifest is corrupt');
  }
  try {
    validateSources(manifest.plan, manifest.sources);
  } catch {
    fail('corrupt', 'version source provenance is corrupt');
  }
  return {
    projectDir: versionDir,
    project,
    manifest,
    timelineModified: sha256(project.timeline) !== manifest.initialTimelineSha256,
  };
}

/** Read without migrating or writing: a user-edited timeline is returned with timelineModified=true. */
export async function readCompositionVersion(input: CompositionVersionLocation): Promise<CompositionVersionRecord> {
  if (!input || !validId(input.batchId) || !validId(input.planId)) {
    fail('invalid_input', 'unsafe batch or plan ID');
  }
  const root = await realProjectRoot(input.projectDir);
  return readVersionFromRoot(root, input.batchId, input.planId);
}

async function removeOwnStage(stage: string, batch: string): Promise<void> {
  const entry = await lstatOrNull(stage);
  if (!entry) return;
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || !samePath(path.dirname(stage), batch)
    || !samePath(await fs.realpath(stage), stage)) {
    fail('unsafe_path', 'refusing to remove an unsafe staging directory');
  }
  await fs.rm(stage, { recursive: true });
}

async function existingMatches(
  root: string,
  batchId: string,
  plan: CompositionPlanV1,
  timeline: TimelineData,
  sources: ResolvedCompositionSources,
): Promise<CompositionVersionRecord> {
  const existing = await readVersionFromRoot(root, batchId, plan.id);
  if (existing.manifest.planSha256 !== sha256(plan)
    || existing.manifest.sourcesSha256 !== sha256(sources)
    || existing.manifest.initialTimelineSha256 !== sha256(timeline)
    || existing.timelineModified) {
    fail('conflict', `composition version ${plan.id} has different content`);
  }
  return existing;
}

/**
 * A version directory is committed atomically. The whole batch is resumable, not atomic:
 * an interrupted call may leave complete earlier versions and ignored staging directories.
 */
export async function persistCompositionVersions(input: CompositionVersionInput): Promise<CompositionVersionRecord[]> {
  validateVersions(input);
  const root = await realProjectRoot(input.projectDir);
  const compositions = await ensureRealChildDirectory(root, 'compositions');
  const batch = await ensureRealChildDirectory(compositions, input.batchId);
  const records: CompositionVersionRecord[] = [];

  for (const { plan, timeline, sources } of input.versions) {
    const finalDir = path.join(batch, plan.id);
    if (await lstatOrNull(finalDir)) {
      records.push(await existingMatches(root, input.batchId, plan, timeline, sources));
      continue;
    }
    const stage = await fs.mkdtemp(path.join(batch, `.${plan.id}-tmp-`));
    await assertRealDirectory(stage);
    try {
      const project: ProjectData = { ...createDefaultProjectData(), timeline };
      const manifest: CompositionVersionManifest = {
        schemaVersion: 1,
        batchId: input.batchId,
        planId: plan.id,
        createdAt: new Date().toISOString(),
        plan,
        sources,
        planSha256: sha256(plan),
        sourcesSha256: sha256(sources),
        initialTimelineSha256: sha256(timeline),
      };
      await fs.writeFile(path.join(stage, PROJECT_FILE), JSON.stringify(project, null, 2), { flag: 'wx' });
      await fs.writeFile(path.join(stage, MANIFEST_FILE), JSON.stringify(manifest, null, 2), { flag: 'wx' });
      // Existing nonempty destinations cannot be replaced by a directory rename on supported OSes.
      if (await lstatOrNull(finalDir)) fail('conflict', `composition version ${plan.id} already exists`);
      try {
        await fs.rename(stage, finalDir);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'ENOTEMPTY') {
          records.push(await existingMatches(root, input.batchId, plan, timeline, sources));
          continue;
        }
        throw error;
      }
      records.push(await readVersionFromRoot(root, input.batchId, plan.id));
    } finally {
      await removeOwnStage(stage, batch);
    }
  }
  return records;
}

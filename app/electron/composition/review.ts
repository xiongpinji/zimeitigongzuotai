/** Offline similarity evidence and human review for R4. Scores only trigger review. */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readCompositionVersion, type CompositionVersionLocation } from './version-projects';
import type { CompositionRenderState } from './render-batch';
import { resolveFfmpegPath } from '../runtime-binaries';

const REPORT_FILE = 'review-report.json';
const DECISIONS_FILE = 'review-decisions.json';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEVICE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const SHA = /^[a-f0-9]{64}$/;
const RATING_KEYS = ['independentClarity', 'appeal', 'boundaries', 'audiovisual', 'factual'] as const;
const VETO_REASONS = ['rights', 'misleading', 'privacy', 'incorrect_product', 'broken_clip'] as const;
const reviewWrites = new Map<string, Promise<void>>();

export interface MediaFingerprint {
  visualHashes: string[];
  audioEnergy: number[];
}

export interface PairEvidence {
  planIds: [string, string];
  textSimilarity: number;
  sourceOverlap: number;
  visualSimilarity: number | null;
  audioSimilarity: number | null;
  flags: string[];
}

export interface CompositionReviewReport {
  schemaVersion: 1;
  batchId: string;
  generatedAt: string;
  versions: Array<{ planId: string; outputSha256: string; planSha256: string; sourcesSha256: string }>;
  pairs: PairEvidence[];
  evidenceSha256: string;
  reviewRequired: true;
  platformOriginality: 'unverified';
}

export interface HumanReviewDecision {
  planId: string;
  reviewerId: string;
  evidenceSha256: string;
  ratings: {
    independentClarity: number;
    appeal: number;
    boundaries: number;
    audiovisual: number;
    factual: number;
  };
  vetoReasons: Array<'rights' | 'misleading' | 'privacy' | 'incorrect_product' | 'broken_clip'>;
  submittedAt: string;
}

export interface CompositionReviewDeps {
  renderState: { read: (location: CompositionVersionLocation) => Promise<CompositionRenderState | null> };
  mediaProbe?: (absolutePath: string) => Promise<MediaFingerprint>;
  nowIso?: () => string;
}

export class CompositionReviewError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CompositionReviewError'; }
}
const fail = (code: string): never => { throw new CompositionReviewError(code); };
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && !DEVICE.test(value);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hashJson = (value: unknown) => sha256(JSON.stringify(value));
const rounded = (value: number) => Math.max(0, Math.min(1, Math.round(value * 10000) / 10000));

async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = reviewWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  reviewWrites.set(key, next);
  await previous;
  try { return await action(); }
  finally {
    if (reviewWrites.get(key) === next) reviewWrites.delete(key);
    release();
  }
}

function grams(value: string): Set<string> {
  const text = value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
  if (!text) return new Set();
  if (text.length === 1) return new Set([text]);
  return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size && !right.size) return 0;
  const overlap = [...left].filter((item) => right.has(item)).length;
  return rounded(overlap / (left.size + right.size - overlap));
}

function sourceOverlap(left: Array<{ recordingId: string; inMs: number; outMs: number }>,
  right: Array<{ recordingId: string; inMs: number; outMs: number }>): number {
  const union = (ranges: typeof left) => {
    const byRecording = new Map<string, Array<[number, number]>>();
    for (const item of ranges) {
      const intervals = byRecording.get(item.recordingId) ?? [];
      intervals.push([item.inMs, item.outMs]);
      byRecording.set(item.recordingId, intervals);
    }
    for (const [id, intervals] of byRecording) {
      intervals.sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      for (const [start, end] of intervals) {
        const previous = merged[merged.length - 1];
        if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
        else merged.push([start, end]);
      }
      byRecording.set(id, merged);
    }
    return byRecording;
  };
  const a = union(left);
  const b = union(right);
  const duration = (ranges: Map<string, Array<[number, number]>>) => [...ranges.values()]
    .flat().reduce((sum, [start, end]) => sum + end - start, 0);
  let intersection = 0;
  for (const [id, ranges] of a) {
    const others = b.get(id) ?? [];
    for (const [start, end] of ranges) for (const [otherStart, otherEnd] of others) {
      intersection += Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
    }
  }
  const denominator = duration(a) + duration(b) - intersection;
  return denominator > 0 ? rounded(intersection / denominator) : 0;
}

function visualSimilarity(left: string[], right: string[]): number | null {
  if (!left.length || !right.length) return null;
  const bits = (hex: string) => BigInt(`0x${hex}`);
  const hamming = (a: string, b: string) => {
    let difference = bits(a) ^ bits(b);
    let count = 0;
    while (difference) { count += Number(difference & 1n); difference >>= 1n; }
    return count;
  };
  const nearest = (a: string[], b: string[]) => a.reduce((sum, hash) =>
    sum + Math.max(...b.map((other) => 1 - hamming(hash, other) / 64)), 0) / a.length;
  return rounded((nearest(left, right) + nearest(right, left)) / 2);
}

function audioSimilarity(left: number[], right: number[]): number | null {
  if (!left.length || !right.length) return null;
  const length = Math.min(left.length, right.length);
  const dot = left.slice(0, length).reduce((sum, value, index) => sum + value * right[index], 0);
  const normLeft = Math.sqrt(left.slice(0, length).reduce((sum, value) => sum + value * value, 0));
  const normRight = Math.sqrt(right.slice(0, length).reduce((sum, value) => sum + value * value, 0));
  return normLeft && normRight ? rounded(dot / (normLeft * normRight)) : null;
}

async function ffmpegBytes(binary: string, args: string[], maxBytes: number,
  allowMissingAudio = false): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4096); });
    child.on('error', () => { clearTimeout(timer); reject(new CompositionReviewError('media_probe_failed')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (allowMissingAudio && code !== 0 && size === 0 &&
          stderr.includes('Output file #0 does not contain any stream')) resolve(Buffer.alloc(0));
      else if (code !== 0 || size > maxBytes) reject(new CompositionReviewError('media_probe_failed'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

/** Decode bounded local samples; no extracted frame or audio is written to disk. */
export async function probeCompositionMedia(outputPath: string): Promise<MediaFingerprint> {
  const { app } = await import('electron');
  const binary = app && resolveFfmpegPath({ appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath, cwd: process.cwd(), moduleDir: __dirname });
  if (!app || !binary) fail('ffmpeg_unavailable');
  return probeCompositionMediaWithBinary(outputPath, binary as string);
}

/** Injectable FFmpeg entrypoint, also used to verify the real native decoder with synthetic media. */
export async function probeCompositionMediaWithBinary(outputPath: string, executable: string): Promise<MediaFingerprint> {
  const [video, audio] = await Promise.all([
    ffmpegBytes(executable, ['-t', '30', '-i', outputPath, '-an', '-vf', 'fps=3,scale=9:8:flags=fast_bilinear,format=gray',
      '-frames:v', '90', '-f', 'rawvideo', 'pipe:1'], 90 * 72 + 72),
    ffmpegBytes(executable, ['-t', '30', '-i', outputPath, '-vn', '-map', '0:a:0?',
      '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], 30 * 8000 * 2 + 8000, true),
  ]);
  const visualHashes: string[] = [];
  for (let offset = 0; offset + 72 <= video.length; offset += 72) {
    let hash = 0n;
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        hash = (hash << 1n) | BigInt(Number(video[offset + row * 9 + column] > video[offset + row * 9 + column + 1]));
      }
    }
    visualHashes.push(hash.toString(16).padStart(16, '0'));
  }
  const audioEnergy: number[] = [];
  for (let offset = 0; offset + 1600 <= audio.length; offset += 1600) {
    let energy = 0;
    for (let index = offset; index < offset + 1600; index += 2) {
      const sample = audio.readInt16LE(index) / 32768;
      energy += sample * sample;
    }
    audioEnergy.push(Math.round(Math.sqrt(energy / 800) * 10000) / 10000);
  }
  return { visualHashes, audioEnergy };
}

async function readRegularJson(file: string): Promise<unknown | null> {
  let entry;
  try { entry = await fs.lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!entry.isFile() || entry.isSymbolicLink()) fail('unsafe_review_file');
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as unknown; }
  catch { fail('corrupt_review_file'); }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await readRegularJson(file);
  const temporary = path.join(path.dirname(file), `.review-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

export function createCompositionReview(deps: CompositionReviewDeps) {
  const now = deps.nowIso ?? (() => new Date().toISOString());
  const probe = deps.mediaProbe ?? probeCompositionMedia;
  return {
    async analyze(projectDir: string, batchId: string, planIds: string[]): Promise<CompositionReviewReport> {
      if (!validId(batchId) || !Array.isArray(planIds) || planIds.length < 3 || planIds.length > 12 ||
          planIds.some((id) => !validId(id)) || new Set(planIds).size !== planIds.length) fail('invalid_input');
      const loaded = await Promise.all(planIds.map(async (planId) => {
        const location = { projectDir, batchId, planId };
        const record = await readCompositionVersion(location);
        const state = await deps.renderState.read(location);
        if (!state || state.state !== 'completed' || !state.outputFile || !state.outputSha256) fail('render_not_complete');
        const completed = state as CompositionRenderState & { outputFile: string; outputSha256: string };
        if (record.timelineModified) fail('review_required');
        const fingerprint = await probe(path.join(record.projectDir, completed.outputFile));
        if (!Array.isArray(fingerprint.visualHashes) || !Array.isArray(fingerprint.audioEnergy) ||
            fingerprint.visualHashes.some((hash) => !/^[a-f0-9]{16}$/.test(hash)) ||
            fingerprint.audioEnergy.some((energy) => !Number.isFinite(energy) || energy < 0)) fail('media_probe_failed');
        const plan = record.manifest.plan;
        const text = [plan.narrativeSummary, plan.editorial?.centralQuestion, plan.editorial?.openingClaim,
          plan.editorial?.endingMessage, ...plan.segments.map((segment) => segment.description)].join(' ');
        const intervals = record.manifest.sources.segments.map((segment) => ({
          recordingId: segment.clip.recordingId,
          inMs: segment.clip.absoluteInMs, outMs: segment.clip.absoluteOutMs,
        }));
        return { planId, planSha256: record.manifest.planSha256,
          sourcesSha256: record.manifest.sourcesSha256, outputSha256: completed.outputSha256,
          text, intervals, fingerprint, directory: record.projectDir };
      }));
      const batchDir = path.dirname(loaded[0].directory);
      if (loaded.some((item) => path.dirname(item.directory) !== batchDir)) fail('unsafe_path');
      const pairs: PairEvidence[] = [];
      for (let first = 0; first < loaded.length; first += 1) {
        for (let second = first + 1; second < loaded.length; second += 1) {
          const left = loaded[first];
          const right = loaded[second];
          const textSimilarity = jaccard(grams(left.text), grams(right.text));
          const overlap = sourceOverlap(left.intervals, right.intervals);
          const visual = visualSimilarity(left.fingerprint.visualHashes, right.fingerprint.visualHashes);
          const audio = audioSimilarity(left.fingerprint.audioEnergy, right.fingerprint.audioEnergy);
          const flags = [
            ...(textSimilarity >= 0.85 ? ['similar_text'] : []),
            ...(overlap >= 0.8 ? ['same_source_ranges'] : []),
            ...(visual === null ? ['visual_unavailable'] : visual >= 0.9 ? ['similar_visuals'] : []),
            ...(audio === null ? ['audio_unavailable'] : audio >= 0.9 ? ['similar_audio'] : []),
          ];
          pairs.push({ planIds: [left.planId, right.planId], textSimilarity,
            sourceOverlap: overlap, visualSimilarity: visual, audioSimilarity: audio, flags });
        }
      }
      const versions = loaded.map(({ planId, outputSha256, planSha256, sourcesSha256 }) =>
        ({ planId, outputSha256, planSha256, sourcesSha256 }));
      const evidenceSha256 = hashJson({ batchId, versions, pairs });
      const report: CompositionReviewReport = { schemaVersion: 1, batchId, generatedAt: now(),
        versions, pairs, evidenceSha256, reviewRequired: true, platformOriginality: 'unverified' };
      await locked(batchDir, () => writeJson(path.join(batchDir, REPORT_FILE), report));
      return report;
    },

    async recordDecision(projectDir: string, batchId: string, decision: Omit<HumanReviewDecision, 'submittedAt'>) {
      const ratings = decision?.ratings;
      if (!validId(batchId) || !validId(decision?.planId) || !validId(decision?.reviewerId) ||
          !SHA.test(decision.evidenceSha256) || !ratings ||
          Object.keys(ratings).length !== RATING_KEYS.length ||
          RATING_KEYS.some((key) => !Number.isInteger(ratings[key]) || ratings[key] < 1 || ratings[key] > 5) ||
          !Array.isArray(decision.vetoReasons) ||
          decision.vetoReasons.some((veto) => !VETO_REASONS.includes(veto))) {
        fail('invalid_decision');
      }
      const record = await readCompositionVersion({ projectDir, batchId, planId: decision.planId });
      const batchDir = path.dirname(record.projectDir);
      return locked(batchDir, async () => {
        const report = await readRegularJson(path.join(batchDir, REPORT_FILE)) as CompositionReviewReport | null;
        if (!report || report.schemaVersion !== 1 || report.batchId !== batchId ||
            !Array.isArray(report.versions) || report.versions.length < 3 ||
            new Set(report.versions.map((version) => version.planId)).size !== report.versions.length ||
            report.versions.some((version) => !validId(version.planId) ||
              !SHA.test(version.outputSha256) || !SHA.test(version.planSha256) ||
              !SHA.test(version.sourcesSha256)) || !Array.isArray(report.pairs) ||
            report.evidenceSha256 !== hashJson({ batchId, versions: report.versions, pairs: report.pairs }) ||
            report.reviewRequired !== true || report.platformOriginality !== 'unverified' ||
            report.evidenceSha256 !== decision.evidenceSha256 ||
            !report.versions.some((version) => version.planId === decision.planId)) {
          throw new CompositionReviewError('stale_evidence');
        }
        for (const version of report.versions) {
          const location = { projectDir, batchId, planId: version.planId };
          const current = await readCompositionVersion(location);
          const state = await deps.renderState.read(location);
          if (current.timelineModified || state?.state !== 'completed' ||
              state.outputSha256 !== version.outputSha256 ||
              current.manifest.planSha256 !== version.planSha256 ||
              current.manifest.sourcesSha256 !== version.sourcesSha256) fail('stale_evidence');
        }
        const file = path.join(batchDir, DECISIONS_FILE);
        const prior = await readRegularJson(file) as { schemaVersion: 1; decisions: HumanReviewDecision[] } | null;
        if (prior && (prior.schemaVersion !== 1 || !Array.isArray(prior.decisions))) fail('corrupt_review_file');
        const decisions = prior?.decisions ?? [];
        if (decisions.some((item) => item.planId === decision.planId && item.reviewerId === decision.reviewerId &&
            item.evidenceSha256 === decision.evidenceSha256)) fail('duplicate_reviewer');
        const submitted = { ...decision, submittedAt: now() };
        await writeJson(file, { schemaVersion: 1, decisions: [...decisions, submitted] });
        const current = [...decisions, submitted].filter((item) => item.planId === decision.planId &&
          item.evidenceSha256 === decision.evidenceSha256);
        const vetoed = current.some((item) => item.vetoReasons.length > 0);
        const lowRating = current.some((item) => RATING_KEYS.some((key) => item.ratings[key] < 4));
        const disagreement = current.length >= 2 && RATING_KEYS.some((key) =>
          Math.max(...current.map((item) => item.ratings[key])) -
          Math.min(...current.map((item) => item.ratings[key])) > 1);
        const reviewStatus = vetoed ? 'vetoed' : current.length < 2 ? 'awaiting_second_reviewer'
          : lowRating || disagreement ? 'needs_resolution' : 'ratings_agree';
        return { planId: decision.planId, distinctReviewerIds: new Set(current.map((item) => item.reviewerId)).size,
          reviewStatus, reviewRequired: true as const, platformOriginality: 'unverified' as const };
      });
    },
  };
}

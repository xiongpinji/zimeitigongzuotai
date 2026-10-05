/** Main-process production authorization. The on-disk file lives under userData, outside Git. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { evaluateAgentProductionAction, type AgentActionGateDecision, type ProductionActivityGrantV1 } from './agent-action-gate';

type ActivityAction = 'quality_check' | 'search_authorized_assets' | 'import_recordings' | 'detect_highlights';
type AuditEntry = { atMs: number; projectId: string; action: ActivityAction; decision: 'allowed' | 'denied'; code?: string };
type BoundRecording = { id: string; sourceSha256: string };
type Snapshot = { version: 1; grants: Record<string, ProductionActivityGrantV1>; audit: AuditEntry[];
  recordingBindings: Record<string, Record<string, string>> };
export type ActivityStatus = { active: boolean; expiresAtMs?: number; allowedActions?: string[] };
const SHA = /^[a-f0-9]{64}$/;
const TASK = /^hbatch_[a-f0-9]{64}$/;

function projectId(projectDir: string): string {
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir)) throw new Error('project_unavailable');
  const normalized = process.platform === 'win32' ? resolve(projectDir).toLowerCase() : resolve(projectDir);
  return createHash('sha256').update(normalized).digest('hex');
}

export class ProductionActivityStore {
  private readonly file: string;
  constructor(private readonly rootDir: string, private readonly now: () => number = Date.now) {
    this.file = join(rootDir, 'activities.json');
  }

  private read(): Snapshot {
    if (!existsSync(this.file)) return { version: 1, grants: {}, audit: [], recordingBindings: {} };
    if (!lstatSync(this.file).isFile()) throw new Error('activity_store_invalid');
    const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('activity_store_invalid');
    const data = value as Partial<Snapshot>;
    if (data.version !== 1 || !data.grants || typeof data.grants !== 'object' || Array.isArray(data.grants) || !Array.isArray(data.audit)) {
      throw new Error('activity_store_invalid');
    }
    const bindings = data.recordingBindings ?? {};
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) ||
        Object.entries(bindings).some(([id, tasks]) => !SHA.test(id) || !tasks ||
          typeof tasks !== 'object' || Array.isArray(tasks) ||
          Object.entries(tasks).some(([taskId, sourceSha]) => !TASK.test(taskId) || !SHA.test(sourceSha)))) {
      throw new Error('activity_store_invalid');
    }
    return { ...data, recordingBindings: bindings } as Snapshot;
  }

  private write(snapshot: Snapshot): void {
    mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    const temp = join(this.rootDir, `.activities-${randomUUID()}.tmp`);
    let fd: number | null = null;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(snapshot));
      fsyncSync(fd);
      closeSync(fd); fd = null;
      renameSync(temp, this.file);
    } finally {
      if (fd !== null) closeSync(fd);
      if (existsSync(temp)) unlinkSync(temp);
    }
  }

  status(projectDir: string): ActivityStatus {
    const id = projectId(projectDir);
    const grant = this.read().grants[id];
    const nowMs = this.now();
    if (!grant || !Number.isFinite(nowMs) || nowMs < grant.issuedAtMs || nowMs >= grant.expiresAtMs) return { active: false };
    const decision = evaluateAgentProductionAction({ action: 'quality_check', projectId: id }, grant, { nowMs, usedQueuedJobs: 0 });
    return decision.allowed ? { active: true, expiresAtMs: grant.expiresAtMs,
      allowedActions: grant.allowedActions.filter((action) =>
        action === 'quality_check' || action === 'search_authorized_assets' ||
        action === 'import_recordings' || action === 'detect_highlights') } : { active: false };
  }

  issueQualityCheck(projectDir: string, durationMinutes: number): ActivityStatus {
    return this.issue(projectDir, durationMinutes, ['quality_check']);
  }

  issueAnalysis(projectDir: string, durationMinutes: number): ActivityStatus {
    return this.issue(projectDir, durationMinutes, ['quality_check', 'search_authorized_assets']);
  }

  issueRecordingImport(projectDir: string, durationMinutes: number): ActivityStatus {
    return this.issue(projectDir, durationMinutes,
      ['quality_check', 'search_authorized_assets', 'import_recordings']);
  }

  issueHighlightDetection(projectDir: string, durationMinutes: number): ActivityStatus {
    return this.issue(projectDir, durationMinutes,
      ['quality_check', 'search_authorized_assets', 'import_recordings', 'detect_highlights']);
  }

  private issue(projectDir: string, durationMinutes: number, allowedActions: ActivityAction[]): ActivityStatus {
    if (![15, 30, 60].includes(durationMinutes)) throw new Error('duration_invalid');
    const id = projectId(projectDir);
    const nowMs = this.now();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('clock_invalid');
    const snapshot = this.read();
    snapshot.grants[id] = { projectId: id, issuedAtMs: nowMs, expiresAtMs: nowMs + durationMinutes * 60_000,
      allowedActions, accountIds: [], platforms: [], autoPublish: false, maxQueuedJobs: 0 };
    this.write(snapshot);
    return this.status(projectDir);
  }

  revoke(projectDir: string): ActivityStatus {
    const snapshot = this.read();
    delete snapshot.grants[projectId(projectDir)];
    this.write(snapshot);
    return { active: false };
  }

  authorizeQualityCheck(projectDir: string): AgentActionGateDecision {
    return this.authorize(projectDir, 'quality_check');
  }

  authorizeAssetSearch(projectDir: string): AgentActionGateDecision {
    return this.authorize(projectDir, 'search_authorized_assets');
  }

  authorizeRecordingImport(projectDir: string): AgentActionGateDecision {
    return this.authorize(projectDir, 'import_recordings');
  }

  authorizeHighlightDetection(projectDir: string): AgentActionGateDecision {
    return this.authorize(projectDir, 'detect_highlights');
  }

  bindImportedRecordings(projectDir: string, tasks: BoundRecording[]): void {
    if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 100 ||
        tasks.some((task) => !task || !TASK.test(task.id) || !SHA.test(task.sourceSha256))) {
      throw new Error('invalid_recording_binding');
    }
    const decision = this.authorizeRecordingImport(projectDir);
    if (!decision.allowed) throw new Error('authorization_expired');
    const snapshot = this.read();
    const id = projectId(projectDir);
    const bound = snapshot.recordingBindings[id] ?? {};
    for (const task of tasks) bound[task.id] = task.sourceSha256;
    snapshot.recordingBindings[id] = bound;
    this.write(snapshot);
  }

  boundRecordings(projectDir: string): BoundRecording[] {
    return Object.entries(this.read().recordingBindings[projectId(projectDir)] ?? {})
      .map(([id, sourceSha256]) => ({ id, sourceSha256 }));
  }

  private authorize(projectDir: string, action: ActivityAction): AgentActionGateDecision {
    const id = projectId(projectDir);
    const snapshot = this.read();
    const nowMs = this.now();
    const decision = evaluateAgentProductionAction({ action, projectId: id }, snapshot.grants[id],
      { nowMs, usedQueuedJobs: 0 });
    snapshot.audit.push({ atMs: nowMs, projectId: id, action,
      decision: decision.allowed ? 'allowed' : 'denied', ...(!decision.allowed ? { code: decision.reason } : {}) });
    if (snapshot.audit.length > 1000) snapshot.audit.splice(0, snapshot.audit.length - 1000);
    this.write(snapshot); // Audit persistence is required: a failed write must fail the tool call closed.
    return decision;
  }
}

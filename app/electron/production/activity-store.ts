/** Main-process production authorization. The on-disk file lives under userData, outside Git. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { evaluateAgentProductionAction, type AgentActionGateDecision, type ProductionActivityGrantV1 } from './agent-action-gate';

type ReadAction = 'quality_check' | 'search_authorized_assets';
type AuditEntry = { atMs: number; projectId: string; action: ReadAction; decision: 'allowed' | 'denied'; code?: string };
type Snapshot = { version: 1; grants: Record<string, ProductionActivityGrantV1>; audit: AuditEntry[] };
export type ActivityStatus = { active: boolean; expiresAtMs?: number; allowedActions?: string[] };

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
    if (!existsSync(this.file)) return { version: 1, grants: {}, audit: [] };
    if (!lstatSync(this.file).isFile()) throw new Error('activity_store_invalid');
    const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('activity_store_invalid');
    const data = value as Partial<Snapshot>;
    if (data.version !== 1 || !data.grants || typeof data.grants !== 'object' || Array.isArray(data.grants) || !Array.isArray(data.audit)) {
      throw new Error('activity_store_invalid');
    }
    return data as Snapshot;
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
        action === 'quality_check' || action === 'search_authorized_assets') } : { active: false };
  }

  issueQualityCheck(projectDir: string, durationMinutes: number): ActivityStatus {
    return this.issue(projectDir, durationMinutes, ['quality_check']);
  }

  issueAnalysis(projectDir: string, durationMinutes: number): ActivityStatus {
    return this.issue(projectDir, durationMinutes, ['quality_check', 'search_authorized_assets']);
  }

  private issue(projectDir: string, durationMinutes: number, allowedActions: ReadAction[]): ActivityStatus {
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

  private authorize(projectDir: string, action: ReadAction): AgentActionGateDecision {
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

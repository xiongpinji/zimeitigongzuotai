import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductionActivityStore } from '../electron/production/activity-store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'production-activity-')); roots.push(root);
  let now = 1000;
  const project = join(root, 'project');
  const store = new ProductionActivityStore(join(root, 'state'), () => now);
  return { root, project, store, advance: (ms: number) => { now += ms; },
    reopen: () => new ProductionActivityStore(join(root, 'state'), () => now) };
}

describe('受信任生产活动授权', () => {
  it('默认拒绝；用户确认后仅在当前工程和有效期内允许质检，重启可恢复并撤销', () => {
    const f = fixture();
    expect(f.store.authorizeQualityCheck(f.project)).toEqual({ allowed: false, reason: 'grant_missing' });
    const issued = f.store.issueQualityCheck(f.project, 30);
    expect(issued).toMatchObject({ active: true, allowedActions: ['quality_check'] });
    expect(f.reopen().authorizeQualityCheck(f.project)).toEqual({ allowed: true });
    expect(f.store.authorizeQualityCheck(join(f.root, 'other'))).toEqual({ allowed: false,
      reason: 'grant_missing' });
    const saved = readFileSync(join(f.root, 'state', 'activities.json'), 'utf8');
    expect(saved).not.toContain(f.project);
    expect(saved).toContain('quality_check');
    expect(saved).not.toContain('autoPublish":true');
    f.store.revoke(f.project);
    expect(f.reopen().authorizeQualityCheck(f.project)).toEqual({ allowed: false,
      reason: 'grant_missing' });
  });

  it('到期和损坏都拒绝；无效时长不得写入授权', () => {
    const f = fixture();
    expect(() => f.store.issueQualityCheck(f.project, 120)).toThrow();
    expect(f.store.status(f.project).active).toBe(false);
    f.store.issueQualityCheck(f.project, 15);
    f.advance(15 * 60_000);
    expect(f.store.authorizeQualityCheck(f.project)).toEqual({ allowed: false,
      reason: 'grant_expired' });
    writeFileSync(join(f.root, 'state', 'activities.json'), '{bad json');
    expect(() => f.store.authorizeQualityCheck(f.project)).toThrow();
  });

  it('素材检索必须单独明确授权，并在工程切换、撤销和到期后拒绝', () => {
    const f = fixture();
    f.store.issueQualityCheck(f.project, 30);
    expect(f.store.authorizeAssetSearch(f.project)).toEqual({ allowed: false,
      reason: 'action_not_allowed' });
    expect(f.store.issueAnalysis(f.project, 30)).toMatchObject({ active: true,
      allowedActions: ['quality_check', 'search_authorized_assets'] });
    expect(f.reopen().authorizeAssetSearch(f.project)).toEqual({ allowed: true });
    expect(f.store.authorizeAssetSearch(join(f.root, 'other'))).toEqual({ allowed: false,
      reason: 'grant_missing' });
    f.advance(30 * 60_000);
    expect(f.store.authorizeAssetSearch(f.project)).toEqual({ allowed: false,
      reason: 'grant_expired' });
    f.store.issueAnalysis(f.project, 30);
    f.store.revoke(f.project);
    expect(f.store.authorizeAssetSearch(f.project)).toEqual({ allowed: false,
      reason: 'grant_missing' });
  });

  it('录屏导入授权独立于质检，绑定的任务只对选定工程可见并可重启恢复', () => {
    const f = fixture();
    const taskId = `hbatch_${'a'.repeat(64)}`;
    const sourceSha256 = 'b'.repeat(64);
    f.store.issueAnalysis(f.project, 30);
    expect(f.store.authorizeRecordingImport(f.project)).toEqual({ allowed: false,
      reason: 'action_not_allowed' });
    expect(f.store.issueRecordingImport(f.project, 30)).toMatchObject({ active: true,
      allowedActions: ['quality_check', 'search_authorized_assets', 'import_recordings'] });
    expect(f.store.authorizeRecordingImport(f.project)).toEqual({ allowed: true });
    f.store.bindImportedRecordings(f.project, [{ id: taskId, sourceSha256 }]);
    expect(f.reopen().boundRecordings(f.project)).toEqual([{ id: taskId, sourceSha256 }]);
    expect(f.store.boundRecordings(join(f.root, 'other'))).toEqual([]);
    expect(readFileSync(join(f.root, 'state', 'activities.json'), 'utf8')).not.toContain(f.project);
    f.store.revoke(f.project);
    expect(f.store.authorizeRecordingImport(f.project)).toEqual({ allowed: false,
      reason: 'grant_missing' });
    expect(f.store.boundRecordings(f.project)).toEqual([{ id: taskId, sourceSha256 }]);
  });

  it('桌面手动导入无需智能体授权仍绑定工程，并拒绝把同一任务绑定到其他工程', () => {
    const f = fixture();
    const task = { id: `hbatch_${'a'.repeat(64)}`, sourceSha256: 'b'.repeat(64) };
    f.store.bindOwnerImportedRecordings(f.project, [task]);
    expect(f.reopen().boundRecordings(f.project)).toEqual([task]);
    expect(f.store.boundRecordings(join(f.root, 'other'))).toEqual([]);
    expect(() => f.store.bindOwnerImportedRecordings(f.project, [task,
      { ...task, sourceSha256: 'c'.repeat(64) }])).toThrow('invalid_recording_binding');
    expect(() => f.store.bindOwnerImportedRecordings(join(f.root, 'other'), [task]))
      .toThrow('recording_already_bound');
  });

  it('真实模型高光动作必须单独授权，限当前工程与 30 分钟且不开放发布', () => {
    const f = fixture();
    f.store.issueRecordingImport(f.project, 30);
    expect(f.store.authorizeHighlightDetection(f.project)).toEqual({ allowed: false,
      reason: 'action_not_allowed' });
    expect(f.store.issueHighlightDetection(f.project, 30)).toMatchObject({ active: true,
      allowedActions: ['quality_check', 'search_authorized_assets', 'import_recordings', 'detect_highlights'] });
    expect(f.reopen().authorizeHighlightDetection(f.project)).toEqual({ allowed: true });
    expect(f.store.authorizeHighlightDetection(join(f.root, 'other'))).toEqual({ allowed: false,
      reason: 'grant_missing' });
    const saved = readFileSync(join(f.root, 'state', 'activities.json'), 'utf8');
    expect(saved).not.toContain(f.project);
    expect(saved).toContain('"autoPublish":false');
    expect(saved).toContain('"maxQueuedJobs":0');
    f.advance(30 * 60_000);
    expect(f.store.authorizeHighlightDetection(f.project)).toEqual({ allowed: false,
      reason: 'grant_expired' });
    f.store.issueHighlightDetection(f.project, 30);
    f.store.revoke(f.project);
    expect(f.store.authorizeHighlightDetection(f.project)).toEqual({ allowed: false,
      reason: 'grant_missing' });
  });

  it('混剪生成有独立授权，工程切换、撤销和到期后拒绝', () => {
    const f = fixture();
    f.store.issueHighlightDetection(f.project, 30);
    expect(f.store.authorizeCompositionBuild(f.project)).toEqual({ allowed: false,
      reason: 'action_not_allowed' });
    expect(f.store.issueCompositionBuild(f.project, 30).allowedActions).toContain('build_compositions');
    expect(f.reopen().authorizeCompositionBuild(f.project)).toEqual({ allowed: true });
    expect(f.store.authorizeCompositionBuild(join(f.root, 'other'))).toEqual({ allowed: false,
      reason: 'grant_missing' });
    f.advance(30 * 60_000);
    expect(f.store.authorizeCompositionBuild(f.project)).toEqual({ allowed: false,
      reason: 'grant_expired' });
    f.store.issueCompositionBuild(f.project, 30);
    f.store.revoke(f.project);
    expect(f.store.authorizeCompositionBuild(f.project)).toEqual({ allowed: false,
      reason: 'grant_missing' });
  });
});

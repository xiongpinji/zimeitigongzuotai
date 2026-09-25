import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPersistedScriptState,
  isSavingFile,
  migratePersistedState,
  parsePersistedScriptState,
  saveAllDirtyFiles,
} from '../src/lib/script-persistence';

describe('script persistence helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      electronAPI: {
        saveScriptFile: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('saves only dirty files during save all', async () => {
    const getText = vi.fn((file: string) => `content:${file}`);

    await saveAllDirtyFiles(
      '/tmp/script-project',
      {
        'original.md': true,
        'script.md': false,
        'notes.md': true,
      },
      getText,
    );

    expect(getText).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.saveScriptFile).toHaveBeenNthCalledWith(
      1,
      '/tmp/script-project',
      'original.md',
      'content:original.md',
    );
    expect(window.electronAPI.saveScriptFile).toHaveBeenNthCalledWith(
      2,
      '/tmp/script-project',
      'notes.md',
      'content:notes.md',
    );
  });

  it('marks files as saving until the ignore window elapses', async () => {
    await saveAllDirtyFiles(
      '/tmp/script-project',
      { 'original.md': true },
      () => '# hello',
    );

    expect(isSavingFile('original.md')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);

    expect(isSavingFile('original.md')).toBe(false);
  });

  it('migrates persisted v1 step 0 state to v2 during parsing', () => {
    const parsed = parsePersistedScriptState({
      version: 1,
      currentStep: 0,
      templateId: 'news-broadcast',
      annotations: [],
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T00:00:00.000Z',
    });

    expect(parsed?.version).toBe(2);
    expect(parsed?.reviewState).toBe('idle');
    expect(parsed?.templateId).toBe('news-broadcast');
  });

  it('parses v2 state directly', () => {
    const parsed = parsePersistedScriptState({
      version: 2,
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'clean',
      lastReviewedDocVersion: 3,
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T00:00:00.000Z',
    });

    expect(parsed?.version).toBe(2);
    expect(parsed?.reviewState).toBe('clean');
    expect(parsed?.lastReviewedDocVersion).toBe(3);
  });

  it('returns null for unknown version', () => {
    const parsed = parsePersistedScriptState({
      version: 99,
      templateId: 'news-broadcast',
    });

    expect(parsed).toBeNull();
  });
});

describe('v1 → v2 migration', () => {
  it('step 0/1/2 without annotations migrates to idle', () => {
    for (const step of [0, 1, 2]) {
      const result = migratePersistedState({
        version: 1,
        currentStep: step,
        templateId: 'news-broadcast',
        annotations: [],
      });
      expect(result.reviewState).toBe('idle');
      expect(result.lastReviewedDocVersion).toBe(0);
    }
  });

  it('step 3 without annotations migrates to idle', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 3,
      templateId: 'news-broadcast',
      annotations: [],
    });
    expect(result.reviewState).toBe('idle');
    expect(result.lastReviewedDocVersion).toBe(0);
  });

  it('step 3 with pending annotations migrates to issues', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 3,
      templateId: 'news-broadcast',
      annotations: [{ id: '1', status: 'pending' }],
    });
    expect(result.reviewState).toBe('issues');
    expect(result.lastReviewedDocVersion).toBe(1);
  });

  it('step 4 with fully resolved annotations migrates to clean', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 4,
      templateId: 'news-broadcast',
      annotations: [{ id: '1', status: 'accepted' }],
    });
    expect(result.reviewState).toBe('clean');
    expect(result.lastReviewedDocVersion).toBe(1);
  });

  it('step 4 with pending annotations migrates to issues', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 4,
      templateId: 'news-broadcast',
      annotations: [
        { id: '1', status: 'accepted' },
        { id: '2', status: 'pending' },
      ],
    });
    expect(result.reviewState).toBe('issues');
    expect(result.lastReviewedDocVersion).toBe(1);
  });

  it('step 4 with all dismissed annotations migrates to clean', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 4,
      templateId: 'news-broadcast',
      annotations: [{ id: '1', status: 'dismissed' }],
    });
    expect(result.reviewState).toBe('clean');
    expect(result.lastReviewedDocVersion).toBe(1);
  });

  it('v2 input passes through unchanged', () => {
    const v2State = {
      version: 2,
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'clean',
      lastReviewedDocVersion: 5,
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T00:00:00.000Z',
    };
    const result = migratePersistedState(v2State as Record<string, unknown>);
    expect(result).toEqual(v2State);
  });

  it('preserves createdAt and updatedAt from v1 data', () => {
    const result = migratePersistedState({
      version: 1,
      currentStep: 0,
      templateId: 'news-broadcast',
      annotations: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('fileTreeView persistence', () => {
  it('defaults to "resources" when option not provided', () => {
    const state = createPersistedScriptState('idle', 0, 'news-broadcast', []);
    expect(state.fileTreeView).toBe('resources');
  });

  it('persists explicit fileTreeView option', () => {
    const state = createPersistedScriptState('idle', 0, 'news-broadcast', [], {
      fileTreeView: 'resources',
    });
    expect(state.fileTreeView).toBe('resources');
  });

  it('parses and preserves fileTreeView from saved json', () => {
    const saved = {
      version: 2,
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'idle',
      lastReviewedDocVersion: 0,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
      fileTreeView: 'resources',
    };
    const parsed = parsePersistedScriptState(saved);
    expect(parsed?.fileTreeView).toBe('resources');
  });
});

import type { Annotation, ReviewState } from '../store/script';
import type { WorkbenchStage } from './script-workbench-stage';

// v2 持久化格式
export interface PersistedScriptState {
  version: 2;
  templateId: string;
  annotations: Annotation[];
  reviewState: ReviewState;
  lastReviewedDocVersion: number;
  manualStageOverride?: WorkbenchStage | null;
  createdAt: string;
  updatedAt: string;
  lastOperation?: string;
  /** 文件树当前视图：'all' 显示完整文件树，'resources' 显示稿件资源过滤视图 */
  fileTreeView?: 'all' | 'resources';
}

// --- v1 → v2 迁移 ---

function deriveReviewStateFromV1(
  currentStep: number,
  annotations: Annotation[],
): ReviewState {
  const pending = annotations.some((a) => a.status === 'pending');
  const resolved = annotations.length > 0 && annotations.every((a) => a.status !== 'pending');

  if (currentStep === 4 && resolved) return 'clean';
  if ((currentStep === 3 || currentStep === 4) && pending) return 'issues';
  return 'idle';
}

export function migratePersistedState(raw: Record<string, unknown>): PersistedScriptState {
  if (raw.version === 2) return raw as unknown as PersistedScriptState;

  const annotations = Array.isArray(raw.annotations) ? (raw.annotations as Annotation[]) : [];
  const reviewState = deriveReviewStateFromV1((raw.currentStep as number) ?? 0, annotations);

  return {
    version: 2,
    templateId: (raw.templateId as string) ?? 'news-broadcast',
    annotations,
    reviewState,
    lastReviewedDocVersion: reviewState === 'idle' ? 0 : 1,
    createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (raw.updatedAt as string) ?? new Date().toISOString(),
  };
}

export function createPersistedScriptState(
  reviewState: ReviewState,
  scriptDocVersion: number,
  templateId: string,
  annotations: Annotation[],
  options?: {
    createdAt?: string;
    manualStageOverride?: WorkbenchStage | null;
    fileTreeView?: 'all' | 'resources';
  },
): PersistedScriptState {
  return {
    version: 2,
    templateId,
    annotations,
    reviewState,
    lastReviewedDocVersion: scriptDocVersion,
    manualStageOverride: options?.manualStageOverride ?? null,
    createdAt: options?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fileTreeView: options?.fileTreeView ?? 'resources',
  };
}

export function parsePersistedScriptState(raw: unknown): PersistedScriptState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // v2 格式直接返回
  if (obj.version === 2) return obj as unknown as PersistedScriptState;

  // v1 格式迁移到 v2
  if (obj.version === 1) return migratePersistedState(obj);

  return null;
}

// --- projectDir 持久化 (localStorage) ---
// 与 timeline store 共享同一个 key，统一工作目录

const SHARED_PROJECT_DIR_KEY = 'podcast-editor-project-dir';
const LEGACY_SCRIPT_DIR_KEY = 'podcast-editor-script-project-dir';

export function persistScriptProjectDir(dir: string | null): void {
  if (dir) {
    localStorage.setItem(SHARED_PROJECT_DIR_KEY, dir);
    // 清理遗留 key
    localStorage.removeItem(LEGACY_SCRIPT_DIR_KEY);
  }
  // dir 为 null 时不清除共享 key（Editor 侧可能仍在使用）
}

export function loadPersistedScriptProjectDir(): string | null {
  // 优先读共享 key，兼容读取遗留 key 后自动迁移
  const shared = localStorage.getItem(SHARED_PROJECT_DIR_KEY);
  if (shared) return shared;

  const legacy = localStorage.getItem(LEGACY_SCRIPT_DIR_KEY);
  if (legacy) {
    localStorage.setItem(SHARED_PROJECT_DIR_KEY, legacy);
    localStorage.removeItem(LEGACY_SCRIPT_DIR_KEY);
    return legacy;
  }
  return null;
}

// --- 保存所有 dirty 文件 ---

const savingFiles = new Set<string>();

export function isSavingFile(file: string): boolean {
  return savingFiles.has(file);
}

/** 标记文件为"正在保存"状态，抑制文件监听器的冲突检测 */
export function markFileSaving(file: string, durationMs = 1000): void {
  savingFiles.add(file);
  setTimeout(() => savingFiles.delete(file), durationMs);
}

export async function saveAllDirtyFiles(
  projectDir: string,
  fileDirtyMap: Record<string, boolean>,
  getText: (file: string) => string,
): Promise<void> {
  const dirtyFiles = Object.entries(fileDirtyMap)
    .filter(([, dirty]) => dirty)
    .map(([file]) => file);

  for (const file of dirtyFiles) {
    savingFiles.add(file);
    const content = getText(file);
    try {
      await window.electronAPI.saveScriptFile(projectDir, file, content);
      // 为 script.md 创建版本快照
      if (file === 'script.md' && typeof window !== 'undefined' && window.scriptHistoryAPI) {
        void window.scriptHistoryAPI.create({
          projectId: projectDir,
          fileName: file,
          content,
          source: 'manual',
        });
      }
    } finally {
      setTimeout(() => savingFiles.delete(file), 500);
    }
  }
}

// --- script-state.json 防抖保存 ---

let stateTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedSaveState(
  projectDir: string,
  state: PersistedScriptState,
  delayMs = 300,
): void {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    void saveScriptState(projectDir, state);
  }, delayMs);
}

// --- project.json script 段防抖保存 ---

let scriptSectionTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedSaveScriptSection(
  projectDir: string,
  scriptSection: unknown,
  delayMs = 300,
): void {
  if (scriptSectionTimer) clearTimeout(scriptSectionTimer);
  scriptSectionTimer = setTimeout(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      void window.electronAPI.saveProjectSection(
        projectDir,
        'script',
        JSON.stringify(scriptSection),
      );
    }
  }, delayMs);
}

export async function saveScriptState(
  projectDir: string,
  state: PersistedScriptState,
): Promise<void> {
  await window.electronAPI.saveScriptState(projectDir, JSON.stringify(state, null, 2));
}

export async function loadScriptState(
  projectDir: string,
): Promise<PersistedScriptState | null> {
  const raw = await window.electronAPI.loadScriptState(projectDir);
  if (raw) {
    try {
      return parsePersistedScriptState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  try {
    const projectRaw = await window.electronAPI.loadProject(projectDir);
    if (!projectRaw) return null;

    const project = JSON.parse(projectRaw) as {
      createdAt?: string;
      updatedAt?: string;
      script?: {
        templateId?: string;
        annotations?: Annotation[];
        reviewState?: ReviewState;
        lastReviewedDocVersion?: number;
        manualStageOverride?: WorkbenchStage | null;
      };
    };

    if (!project.script) return null;

    return {
      version: 2,
      templateId: project.script.templateId ?? 'news-broadcast',
      annotations: project.script.annotations ?? [],
      reviewState: project.script.reviewState ?? 'idle',
      lastReviewedDocVersion: project.script.lastReviewedDocVersion ?? 0,
      manualStageOverride: project.script.manualStageOverride ?? null,
      createdAt: project.createdAt ?? new Date().toISOString(),
      updatedAt: project.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// --- 全量恢复：从磁盘加载状态 + 文本文件 ---

export async function loadFullScriptState(projectDir: string): Promise<{
  persisted: PersistedScriptState;
  originalText: string;
  scriptText: string;
} | null> {
  const persisted = await loadScriptState(projectDir);
  if (!persisted) return null;

  const [originalText, scriptText] = await Promise.all([
    window.electronAPI.loadScriptFile(projectDir, 'original.md'),
    window.electronAPI.loadScriptFile(projectDir, 'script.md'),
  ]);

  return {
    persisted,
    originalText: originalText ?? '',
    scriptText: scriptText ?? '',
  };
}

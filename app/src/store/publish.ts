import { create } from 'zustand';
import type { PublishAccount, PublishPlatform, PublishSettings } from '../lib/electron-api';
import type { PublishShared, PublishTarget, PublishProgressPayload } from '../lib/electron-api';
import { useTaskProgressStore } from './task-progress';

/** 账号终态：进度计数与落盘历史据此判断「该账号本次已结束」。 */
const TERMINAL_STATES = new Set(['success', 'failed', 'login-expired']);

/** Fixed UI fallback for an IPC-level whole-job failure; never includes raw errors. */
export const PUBLISH_JOB_FAILED_MESSAGE = '发布任务未完成，请检查账号或任务配置';

export interface PublishResult {
  state: 'pending' | 'running' | 'success' | 'failed' | 'login-expired';
  percent?: number;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ActivePublishJob {
  id: string;
  filePath: string;
  shared: PublishShared;
  targets: PublishTarget[];
}

interface PublishState {
  accounts: PublishAccount[];
  job: ActivePublishJob | null;
  results: Record<string, PublishResult>;
  /** 发布全局设置（无头登录等）。 */
  settings: PublishSettings;
  /** 编辑器最近一次成功导出的 MP4 路径；供发布选项卡联动预填视频文件。 */
  lastExportPath: string | null;
  setLastExportPath: (path: string | null) => void;

  loadAccounts: () => Promise<void>;
  loadSettings: () => Promise<void>;
  setHeadlessLogin: (headless: boolean) => Promise<void>;
  addAccount: (
    platform: PublishPlatform,
    accountName: string,
  ) => Promise<{ success: boolean; message: string }>;
  checkAccount: (id: string) => Promise<boolean>;
  removeAccount: (id: string) => Promise<void>;

  startPublish: (
    filePath: string,
    shared: PublishShared,
    targets: PublishTarget[],
    headless?: boolean,
  ) => Promise<void>;
  cancelPublish: () => void;
}

export const usePublishStore = create<PublishState>((set, get) => ({
  accounts: [],
  job: null,
  results: {},
  settings: { headlessLogin: true },
  lastExportPath: null,
  setLastExportPath: (path) => set({ lastExportPath: path }),

  loadAccounts: async () => {
    const accounts = await window.publishAPI.listAccounts();
    set({ accounts });
  },

  loadSettings: async () => {
    const settings = await window.publishAPI.getSettings();
    set({ settings });
  },

  setHeadlessLogin: async (headless) => {
    const settings = await window.publishAPI.setSettings({ headlessLogin: headless });
    set({ settings });
  },

  addAccount: async (platform, accountName) => {
    const res = await window.publishAPI.login(platform, accountName, get().settings.headlessLogin);
    await get().loadAccounts();
    return res;
  },

  checkAccount: async (id) => {
    const ok = await window.publishAPI.check(id);
    await get().loadAccounts();
    return ok;
  },

  removeAccount: async (id) => {
    await window.publishAPI.deleteAccount(id);
    await get().loadAccounts();
  },

  startPublish: async (filePath, shared, targets, headless = true) => {
    const jobId = crypto.randomUUID();
    const job: ActivePublishJob = { id: jobId, filePath, shared, targets };

    // Initialise results to pending for each target
    const initResults: Record<string, PublishResult> = {};
    for (const t of targets) {
      initResults[t.accountId] = { state: 'pending', startedAt: Date.now() };
    }
    set({ job, results: initResults });

    // ── Unified bottom progress bar ──
    const taskId = `publish-job-${jobId}`;
    const taskStore = useTaskProgressStore.getState();
    taskStore.startTask({
      id: taskId,
      category: 'publish',
      label: `发布视频 (${targets.length} 个账号)`,
      mode: 'indeterminate',
      progress: 0,
      phase: '准备发布…',
      level: 0,
      canCancel: true,
      onCancel: () => get().cancelPublish(),
    });

    // ── Subscribe to per-target progress events ──
    const unsubscribe = window.publishAPI.onProgress((payload: PublishProgressPayload) => {
      if (payload.jobId !== jobId || get().job?.id !== jobId) return;
      const now = Date.now();
      set((s) => {
        const prev = s.results[payload.accountId] ?? { state: 'pending' };
        const next: PublishResult = {
          ...prev,
          state:
            payload.state === 'success'
              ? 'success'
              : payload.state === 'failed'
                ? 'failed'
                : payload.state === 'login-expired'
                  ? 'login-expired'
                  : payload.state === 'running'
                    ? 'running'
                    : prev.state,
          percent: payload.percent,
          message: payload.message,
          finishedAt: TERMINAL_STATES.has(payload.state) ? now : prev.finishedAt,
        };
        return { results: { ...s.results, [payload.accountId]: next } };
      });

      // Update unified progress bar phase（login-expired 同样视为该账号终态）
      const currentResults = { ...get().results, [payload.accountId]: { state: payload.state } };
      const total = targets.length;
      const done = Object.values(currentResults).filter((r) => TERMINAL_STATES.has(r.state)).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      useTaskProgressStore.getState().updateTask(taskId, {
        progress: pct,
        phase: `发布中 ${done}/${total}`,
        mode: 'determinate',
      });
    });

    // ── Run publish job ──
    try {
      await window.publishAPI.run(
        {
          id: jobId,
          filePath,
          shared,
          targets,
        },
        headless,
      );
      // Complete the parent task
      useTaskProgressStore.getState().completeTask(taskId);
    } catch {
      const finishedAt = Date.now();
      set((state) => {
        if (state.job?.id !== jobId) return state;
        const results = { ...state.results };
        for (const target of targets) {
          const current = results[target.accountId];
          if (current && TERMINAL_STATES.has(current.state)) continue;
          results[target.accountId] = {
            ...current,
            state: 'failed',
            message: PUBLISH_JOB_FAILED_MESSAGE,
            finishedAt,
          };
        }
        return { results };
      });
      useTaskProgressStore.getState().failTask(taskId, PUBLISH_JOB_FAILED_MESSAGE);
    } finally {
      unsubscribe();
      set((state) => (state.job?.id === jobId ? { job: null } : state));
    }
  },

  cancelPublish: () => {
    window.publishAPI.cancel().catch(() => {});
  },
}));

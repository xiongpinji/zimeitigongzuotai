/**
 * 依赖运行时下载的统一 IPC 工厂。
 *
 * biliup（B 站上传组件）与 chromium（自动化浏览器组件）此前各写一套孪生的
 * status / download / progress / cancel IPC，仅文案与下载实现不同。这里抽出统一
 * 工厂：调用方只提供 name + getStatus + download，channel 命名与并发锁/取消逻辑共用。
 *
 * channel 命名保持与历史一致（不破坏 preload / renderer 契约）：
 *   status   = `publish:<name>-status`
 *   download = `publish:download-<name>`
 *   progress = `publish:<name>-download-progress`
 *   cancel   = `publish:cancel-<name>-download`
 */
import { ipcMain as defaultIpcMain } from 'electron';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';

export interface DownloadChannels {
  status: string;
  download: string;
  progress: string;
  cancel: string;
}

/** 由依赖名推导四个 IPC channel 名（纯函数，便于单测锁定兼容命名）。 */
export function downloadChannels(name: string): DownloadChannels {
  return {
    status: `publish:${name}-status`,
    download: `publish:download-${name}`,
    progress: `publish:${name}-download-progress`,
    cancel: `publish:cancel-${name}-download`,
  };
}

export interface DependencyDownloadResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface DependencyDownloadSpec<P> {
  /** 依赖标识（biliup | chromium），决定 IPC channel 名。 */
  name: string;
  /** 同步返回安装状态。 */
  getStatus: () => unknown;
  /** 执行下载；onProgress 回报阶段进度，signal 用于取消。始终 resolve（失败经 result.error）。 */
  download: (onProgress: (p: P) => void, signal: AbortSignal) => Promise<DependencyDownloadResult>;
}

/**
 * 注册某依赖的下载相关 IPC：status（query）+ download（带并发锁与进度转发）+ cancel。
 * @param ipc 注入点，默认 electron ipcMain（测试可传入 fake）。
 */
export function registerDownloadIpc<P>(
  spec: DependencyDownloadSpec<P>,
  ipc: IpcMain = defaultIpcMain,
): void {
  const ch = downloadChannels(spec.name);
  let abort: AbortController | null = null;

  ipc.handle(ch.status, () => spec.getStatus());

  ipc.handle(ch.download, async (e: IpcMainInvokeEvent) => {
    if (abort) {
      return { success: false, error: '正在下载中，请稍候' } satisfies DependencyDownloadResult;
    }
    abort = new AbortController();
    try {
      return await spec.download((p) => e.sender.send(ch.progress, p), abort.signal);
    } finally {
      abort = null;
    }
  });

  ipc.handle(ch.cancel, () => {
    abort?.abort();
  });
}

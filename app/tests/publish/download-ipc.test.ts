import { describe, it, expect, vi } from 'vitest';

// download-ipc.ts 顶层 import { ipcMain } from 'electron'；node 环境下需 mock（实际用注入的 fake ipc）。
vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }));

import { downloadChannels, registerDownloadIpc } from '../../electron/publish/download-ipc';

describe('downloadChannels', () => {
  it('biliup 命名与历史 channel 一致（兼容契约）', () => {
    expect(downloadChannels('biliup')).toEqual({
      status: 'publish:biliup-status',
      download: 'publish:download-biliup',
      progress: 'publish:biliup-download-progress',
      cancel: 'publish:cancel-biliup-download',
    });
  });

  it('chromium 命名与历史 channel 一致（兼容契约）', () => {
    expect(downloadChannels('chromium')).toEqual({
      status: 'publish:chromium-status',
      download: 'publish:download-chromium',
      progress: 'publish:chromium-download-progress',
      cancel: 'publish:cancel-chromium-download',
    });
  });
});

interface FakeIpc {
  handle: (ch: string, fn: (...args: unknown[]) => unknown) => void;
  _get: (ch: string) => (...args: unknown[]) => unknown;
  _has: (ch: string) => boolean;
}

function fakeIpc(): FakeIpc {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: (ch, fn) => handlers.set(ch, fn),
    _get: (ch) => handlers.get(ch)!,
    _has: (ch) => handlers.has(ch),
  };
}

const senderEvent = (send: (ch: string, p: unknown) => void = () => {}) => ({ sender: { send } });

describe('registerDownloadIpc', () => {
  it('注册 status / download / cancel 三个 handler', () => {
    const ipc = fakeIpc();
    registerDownloadIpc(
      { name: 'biliup', getStatus: () => ({ installed: true, path: '/x' }), download: async () => ({ success: true }) },
      ipc as never,
    );
    expect(ipc._has('publish:biliup-status')).toBe(true);
    expect(ipc._has('publish:download-biliup')).toBe(true);
    expect(ipc._has('publish:cancel-biliup-download')).toBe(true);
  });

  it('status handler 同步返回 getStatus()', () => {
    const ipc = fakeIpc();
    registerDownloadIpc(
      { name: 'biliup', getStatus: () => ({ installed: false, path: '/p' }), download: async () => ({ success: true }) },
      ipc as never,
    );
    expect(ipc._get('publish:biliup-status')()).toEqual({ installed: false, path: '/p' });
  });

  it('下载进行中并发再次调用返回 busy', async () => {
    const ipc = fakeIpc();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    registerDownloadIpc(
      {
        name: 'biliup',
        getStatus: () => ({}),
        download: async () => {
          await gate;
          return { success: true };
        },
      },
      ipc as never,
    );
    const first = ipc._get('publish:download-biliup')(senderEvent());
    const second = await ipc._get('publish:download-biliup')(senderEvent());
    expect(second).toEqual({ success: false, error: '正在下载中，请稍候' });
    release();
    expect(await first).toEqual({ success: true });
  });

  it('完成后锁释放，可再次下载', async () => {
    const ipc = fakeIpc();
    const download = vi.fn(async () => ({ success: true }));
    registerDownloadIpc({ name: 'biliup', getStatus: () => ({}), download }, ipc as never);
    await ipc._get('publish:download-biliup')(senderEvent());
    await ipc._get('publish:download-biliup')(senderEvent());
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('cancel 使 download 收到的 signal 进入 aborted', async () => {
    const ipc = fakeIpc();
    let captured: AbortSignal | null = null;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    registerDownloadIpc(
      {
        name: 'chromium',
        getStatus: () => ({}),
        download: async (_onProgress, signal) => {
          captured = signal;
          await gate;
          return { success: false, error: '已取消' };
        },
      },
      ipc as never,
    );
    const p = ipc._get('publish:download-chromium')(senderEvent());
    ipc._get('publish:cancel-chromium-download')();
    expect(captured!.aborted).toBe(true);
    release();
    await p;
  });

  it('progress 经 ch.progress 转发到 sender', async () => {
    const ipc = fakeIpc();
    const sent: Array<[string, unknown]> = [];
    registerDownloadIpc(
      {
        name: 'biliup',
        getStatus: () => ({}),
        download: async (onProgress) => {
          onProgress({ phase: 'download', received: 1, total: 2 });
          return { success: true };
        },
      },
      ipc as never,
    );
    await ipc._get('publish:download-biliup')(senderEvent((ch, p) => sent.push([ch, p])));
    expect(sent).toEqual([['publish:biliup-download-progress', { phase: 'download', received: 1, total: 2 }]]);
  });
});

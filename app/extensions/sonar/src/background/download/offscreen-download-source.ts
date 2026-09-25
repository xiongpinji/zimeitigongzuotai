import { ensureOffscreenDocument } from '@/offscreen/client';
import {
  OFFSCREEN_PREPARE_DOWNLOAD,
  OFFSCREEN_RELEASE_DOWNLOAD,
  OFFSCREEN_START_DOWNLOAD,
  type OffscreenPrepareDownloadResponse,
} from '@/offscreen/protocol';

export interface PreparedDownloadSource {
  url: string;
  start: (filename: string) => Promise<number>;
  release: () => Promise<void>;
}

async function findCreatedDownload(blobUrl: string, timeoutMs = 5_000): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onCreated.removeListener(onCreated);
      reject(new Error('Chrome 未创建下载任务'));
    }, timeoutMs);
    const onCreated = (item: chrome.downloads.DownloadItem) => {
      if (item.url !== blobUrl) return;
      clearTimeout(timeout);
      chrome.downloads.onCreated.removeListener(onCreated);
      resolve(item.id);
    };
    chrome.downloads.onCreated.addListener(onCreated);
  });
}

export async function prepareOffscreenDownloadSource(url: string): Promise<PreparedDownloadSource> {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    kind: OFFSCREEN_PREPARE_DOWNLOAD,
    url,
  }) as OffscreenPrepareDownloadResponse | undefined;
  if (!response?.ok) throw new Error(response?.error || 'Offscreen Document 未响应');

  return {
    url: response.blobUrl,
    start: async (filename) => {
      const created = findCreatedDownload(response.blobUrl);
      const result = await chrome.runtime.sendMessage({
        kind: OFFSCREEN_START_DOWNLOAD,
        token: response.token,
        filename,
      }) as { ok?: boolean; error?: string } | undefined;
      if (!result?.ok) throw new Error(result?.error || 'Offscreen Document 未启动下载');
      return created;
    },
    release: async () => {
      await chrome.runtime.sendMessage({
        kind: OFFSCREEN_RELEASE_DOWNLOAD,
        token: response.token,
      }).catch(() => {});
    },
  };
}

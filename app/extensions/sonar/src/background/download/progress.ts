/**
 * 把 chrome.downloads 的 DownloadItem 状态映射到领域 DownloadTask（纯逻辑，可单测）。
 *
 * onChanged 只给 state；字节进度需经 chrome.downloads.search 查询当前 DownloadItem 得到。
 * 这里只做纯映射，不触碰 chrome API。
 */
import type { DownloadTask } from '@/domain/models';
import { makeError } from '@/domain/errors';

/** chrome.downloads.DownloadItem 的子集（仅取本模块需要的字段）。 */
export interface DownloadItemLike {
  state?: 'in_progress' | 'complete' | 'interrupted';
  bytesReceived?: number;
  totalBytes?: number;
  filename?: string;
  error?: string;
}

export function downloadItemToTask(existing: DownloadTask, item: DownloadItemLike): DownloadTask {
  const next: DownloadTask = { ...existing };

  if (typeof item.bytesReceived === 'number' && item.bytesReceived >= 0) {
    next.receivedBytes = item.bytesReceived;
  }
  if (typeof item.totalBytes === 'number' && item.totalBytes > 0) {
    next.totalBytes = item.totalBytes;
  } else {
    delete next.totalBytes;
  }
  if (item.filename) next.filename = item.filename;

  switch (item.state) {
    case 'complete':
      next.status = 'completed';
      delete next.error;
      break;
    case 'interrupted':
      next.status = 'failed';
      next.error = makeError('DOWNLOAD_FAILED', '下载中断', {
        retryable: true,
        ...(item.error ? { detail: item.error } : {}),
      });
      break;
    case 'in_progress':
      next.status = 'downloading';
      break;
    default:
      break;
  }
  return next;
}

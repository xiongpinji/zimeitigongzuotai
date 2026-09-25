import { describe, it, expect } from 'vitest';
import { downloadItemToTask } from '@/background/download/progress';
import type { DownloadTask } from '@/domain/models';

const base: DownloadTask = {
  id: 'd1',
  videoId: 'v1',
  status: 'downloading',
  chromeDownloadId: 42,
};

describe('downloadItemToTask', () => {
  it('maps an in-progress item to downloading with byte counts', () => {
    const task = downloadItemToTask(base, {
      state: 'in_progress',
      bytesReceived: 500,
      totalBytes: 1000,
    });
    expect(task.status).toBe('downloading');
    expect(task.receivedBytes).toBe(500);
    expect(task.totalBytes).toBe(1000);
    expect(task.id).toBe('d1');
    expect(task.chromeDownloadId).toBe(42);
  });

  it('maps a complete item to completed and carries the filename', () => {
    const task = downloadItemToTask(base, {
      state: 'complete',
      bytesReceived: 1000,
      totalBytes: 1000,
      filename: '/Users/me/Downloads/灵机剪影/抖音/x.mp4',
    });
    expect(task.status).toBe('completed');
    expect(task.filename).toBe('/Users/me/Downloads/灵机剪影/抖音/x.mp4');
  });

  it('maps an interrupted item to a standardized failure', () => {
    const task = downloadItemToTask(base, {
      state: 'interrupted',
      error: 'NETWORK_FAILED',
    });
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('DOWNLOAD_FAILED');
    expect(task.error?.detail).toContain('NETWORK_FAILED');
  });

  it('omits unknown total bytes (chrome reports 0 or -1)', () => {
    const task = downloadItemToTask(base, {
      state: 'in_progress',
      bytesReceived: 100,
      totalBytes: -1,
    });
    expect(task.receivedBytes).toBe(100);
    expect(task.totalBytes).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChromeDownloadService } from '@/background/download/chrome-download-service';
import { createMemoryRepository } from '@/background/repository';
import type { DownloadRequest } from '@/background/services';
import type { Creator, Video, VideoSource } from '@/domain/models';

const video: Video = {
  id: '7300000000000000001',
  creatorId: 'c1',
  description: '标题',
  publishedAt: Date.UTC(2026, 5, 19),
  sourcePageUrl: 'https://www.douyin.com/video/7300000000000000001',
};
const creator: Creator = {
  id: 'c1',
  secUid: 'MS4w',
  nickname: '博主',
  profileUrl: 'https://www.douyin.com/user/MS4w',
  updatedAt: 0,
};
const source: VideoSource = {
  url: 'https://v3-web.douyinvod.com/fake/h264.mp4?sign=X',
  mimeType: 'video/mp4',
  watermark: 'none',
  watermarkConfidence: 'high',
  watermarkEvidence: [],
};
const req: DownloadRequest = { video, creator, source };

type ChangeListener = (delta: { id: number }) => void;
let listeners: ChangeListener[];
let searchResult: unknown[];
let downloadMock: ReturnType<typeof vi.fn>;
let cancelMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listeners = [];
  searchResult = [];
  downloadMock = vi.fn(async () => 100);
  cancelMock = vi.fn(async () => {});
  (globalThis as Record<string, unknown>).chrome = {
    downloads: {
      download: downloadMock,
      cancel: cancelMock,
      search: vi.fn(async () => searchResult),
      onChanged: { addListener: (l: ChangeListener) => listeners.push(l) },
    },
  };
});

function makeService() {
  let seq = 0;
  const repo = createMemoryRepository({ now: () => 0, newId: () => `d-${++seq}` });
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 206,
    url: 'https://v5-se-cold.douyinvod.com/final/video.mp4?sign=FRESH',
    headers: new Headers({ 'content-type': 'video/mp4' }),
    body: { cancel: vi.fn(async () => {}) },
  } as unknown as Response));
  const release = vi.fn(async () => {});
  const start = vi.fn(async () => 100);
  const prepareDownload = vi.fn(async () => ({
    url: 'blob:chrome-extension://sonar/video',
    start,
    release,
  }));
  const service = createChromeDownloadService({
    repo,
    newId: () => `d-${++seq}`,
    fetchImpl,
    prepareDownload,
  });
  return { repo, service, fetchImpl, prepareDownload, start, release };
}

describe('createChromeDownloadService', () => {
  it('starts a chrome download with the planned filename and persists the task', async () => {
    const { repo, service, fetchImpl, prepareDownload, start } = makeService();
    const task = await service.download(req);

    expect(fetchImpl).toHaveBeenCalledWith(
      source.url,
      expect.objectContaining({ headers: { Range: 'bytes=0-0' }, redirect: 'follow' }),
    );
    expect(prepareDownload).toHaveBeenCalledWith(
      'https://v5-se-cold.douyinvod.com/final/video.mp4?sign=FRESH',
    );
    expect(start).toHaveBeenCalledWith(
      '灵机剪影/抖音/博主/20260619_标题_7300000000000000001.mp4',
    );
    expect(downloadMock).not.toHaveBeenCalled();
    expect(task.chromeDownloadId).toBe(100);
    expect(task.status).toBe('downloading');
    expect((await repo.getDownloadTask(task.id))?.chromeDownloadId).toBe(100);
  });

  it('rejects an HTML response before handing it to Chrome downloads', async () => {
    let seq = 0;
    const repo = createMemoryRepository({ now: () => 0, newId: () => `d-${++seq}` });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: source.url,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: { cancel: vi.fn(async () => {}) },
    } as unknown as Response));
    const service = createChromeDownloadService({ repo, newId: () => `d-${++seq}`, fetchImpl });

    await expect(service.download(req)).rejects.toMatchObject({
      error: { code: 'DOWNLOAD_FAILED', message: '视频源返回的不是媒体文件' },
    });
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('writes back progress when chrome fires onChanged', async () => {
    const { repo, service, release } = makeService();
    service.attachListeners();
    const task = await service.download(req);

    searchResult = [{ state: 'complete', bytesReceived: 1000, totalBytes: 1000, filename: '/d/x.mp4' }];
    listeners[0]({ id: 100 });

    await vi.waitFor(async () => {
      expect((await repo.getDownloadTask(task.id))?.status).toBe('completed');
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('cancels a chrome download and marks the task cancelled', async () => {
    const { repo, service } = makeService();
    const task = await service.download(req);
    await service.cancel(task.id);
    expect(cancelMock).toHaveBeenCalledWith(100);
    expect((await repo.getDownloadTask(task.id))?.status).toBe('cancelled');
  });
});

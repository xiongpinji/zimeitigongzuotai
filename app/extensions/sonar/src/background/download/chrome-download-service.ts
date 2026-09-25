/**
 * 基于 chrome.downloads 的 DownloadService 实现（设计文档 5.7）。
 *
 * - download：按计划文件名调用 chrome.downloads.download，去重落盘，记录 chromeId↔taskId 映射。
 * - onChanged + search：把下载进度/完成/中断回写到 Repository（持续报告任务状态）。
 * - cancel：取消 chrome 下载并置任务为 cancelled。
 * - 映射持久化在 Repository，Service Worker 重启后可由 onChanged 重新关联。
 *
 * 这是浏览器胶水（依赖 chrome.downloads），纯逻辑已在 plan.ts / progress.ts 单测覆盖。
 */
import { SonarException, makeError } from '@/domain/errors';
import type { DownloadService, DownloadRequest } from '../services';
import type { Repository } from '../repository';
import type { DownloadTask } from '@/domain/models';
import { planDownload } from './plan';
import { downloadItemToTask } from './progress';
import {
  prepareOffscreenDownloadSource,
  type PreparedDownloadSource,
} from './offscreen-download-source';

export interface ChromeDownloadDeps {
  repo: Repository;
  newId: () => string;
  fetchImpl?: typeof fetch;
  prepareDownload?: (url: string) => Promise<PreparedDownloadSource>;
}

export interface AttachableDownloadService extends DownloadService {
  /** 在 Service Worker 启动时调用一次，注册 onChanged 进度监听。 */
  attachListeners(): void;
}

export function createChromeDownloadService(deps: ChromeDownloadDeps): AttachableDownloadService {
  const { repo, newId } = deps;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const prepareDownload = deps.prepareDownload ?? prepareOffscreenDownloadSource;
  const preparedSources = new Map<number, PreparedDownloadSource>();

  async function resolveDownloadUrl(url: string): Promise<string> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Range: 'bytes=0-0' },
        redirect: 'follow',
        credentials: 'omit',
      });
    } catch (error) {
      throw new SonarException(makeError('DOWNLOAD_FAILED', '视频源连接失败', {
        retryable: true,
        detail: error instanceof Error ? error.message : String(error),
      }));
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    void response.body?.cancel().catch(() => {});
    if (!response.ok) {
      throw new SonarException(makeError('DOWNLOAD_FAILED', `视频源不可用（HTTP ${response.status}）`, {
        retryable: true,
      }));
    }
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      throw new SonarException(makeError('DOWNLOAD_FAILED', '视频源返回的不是媒体文件', {
        retryable: true,
      }));
    }
    return response.url || url;
  }

  async function syncFromChrome(chromeDownloadId: number): Promise<void> {
    const task = await repo.findDownloadTaskByChromeId(chromeDownloadId);
    const [item] = await chrome.downloads.search({ id: chromeDownloadId });
    if (!item) return;
    if (task) await repo.putDownloadTask(downloadItemToTask(task, item));
    if (item.state === 'complete' || item.state === 'interrupted') {
      const prepared = preparedSources.get(chromeDownloadId);
      preparedSources.delete(chromeDownloadId);
      await prepared?.release();
    }
  }

  return {
    async download(req: DownloadRequest): Promise<DownloadTask> {
      const plan = planDownload(req);
      const resolvedUrl = await resolveDownloadUrl(plan.url);
      let prepared: PreparedDownloadSource;
      try {
        prepared = await prepareDownload(resolvedUrl);
      } catch (e) {
        throw new SonarException(makeError('DOWNLOAD_FAILED', '抓取视频文件失败', {
          retryable: true,
          detail: e instanceof Error ? e.message : String(e),
        }));
      }
      let chromeDownloadId: number;
      try {
        chromeDownloadId = await prepared.start(plan.filename);
      } catch (e) {
        await prepared.release();
        throw new SonarException(
          makeError('DOWNLOAD_FAILED', '发起下载失败', {
            retryable: true,
            detail: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      preparedSources.set(chromeDownloadId, prepared);
      const task: DownloadTask = {
        id: newId(),
        videoId: req.video.id,
        status: 'downloading',
        chromeDownloadId,
        filename: plan.filename,
      };
      await repo.putDownloadTask(task);
      await syncFromChrome(chromeDownloadId);
      return task;
    },

    async cancel(taskId: string): Promise<void> {
      const task = await repo.getDownloadTask(taskId);
      if (task?.chromeDownloadId !== undefined) {
        try {
          await chrome.downloads.cancel(task.chromeDownloadId);
        } catch {
          /* 已结束的下载取消会报错，忽略 */
        }
        const prepared = preparedSources.get(task.chromeDownloadId);
        preparedSources.delete(task.chromeDownloadId);
        await prepared?.release();
      }
      if (task) {
        await repo.putDownloadTask({ ...task, status: 'cancelled' });
      }
    },

    attachListeners(): void {
      chrome.downloads.onChanged.addListener((delta) => {
        void syncFromChrome(delta.id);
      });
    },
  };
}

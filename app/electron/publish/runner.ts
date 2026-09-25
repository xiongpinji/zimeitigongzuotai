import type { WebContents } from 'electron';
import type { PublishJob } from './types';
import { getPlatform } from './platforms';
import { parseAccountId } from './account-id';
import { AccountStore } from './accounts';
import { LoginExpiredError } from './errors';

export async function runPublishJob(
  job: PublishJob,
  store: AccountStore,
  sender: WebContents,
  isCancelled: () => boolean,
  headless: boolean,
): Promise<void> {
  for (const target of job.targets) {
    if (isCancelled()) break;
    const acc = store.list().find((a) => a.id === target.accountId);
    if (!acc) continue;
    const send = (state: string, percent?: number, message?: string) =>
      sender.send('publish:progress', {
        jobId: job.id,
        accountId: target.accountId,
        state,
        percent,
        message,
      });
    send('running', 0);
    try {
      const { platform } = parseAccountId(target.accountId);
      await getPlatform(platform).uploadVideo({
        storageStatePath: acc.storageStatePath,
        filePath: job.filePath,
        title: target.overrides?.title ?? job.shared.title,
        desc: target.overrides?.desc ?? job.shared.desc,
        tags: target.overrides?.tags ?? job.shared.tags,
        thumbnail: job.shared.thumbnail,
        covers: job.shared.covers,
        scheduleAt: job.shared.scheduleAt,
        headless,
        tid: target.bilibili?.tid,
        onProgress: (p, m) => send('running', p, m),
      });
      send('success', 100);
    } catch (err) {
      // 登录态失效单独标记 'login-expired'：Renderer 据此弹窗重登并自动续发，
      // 区别于不可恢复的普通失败。
      const state = err instanceof LoginExpiredError ? 'login-expired' : 'failed';
      send(state, undefined, err instanceof Error ? err.message : String(err));
    }
  }
}

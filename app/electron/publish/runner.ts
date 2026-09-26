import type { WebContents } from 'electron';
import type { PublishJob } from './types';
import { getPlatform } from './platforms';
import { AccountStore } from './accounts';
import { LoginExpiredError } from './errors';
import { preflightPublishTargets, PublishPreflightError } from './preflight';

export async function runPublishJob(
  job: PublishJob,
  store: AccountStore,
  sender: WebContents,
  isCancelled: () => boolean,
  headless: boolean,
): Promise<void> {
  // One legacy registry snapshot and one whole-job validation before resolving
  // even the first platform module. Missing/UUID/duplicate targets never cause
  // a partial upload or a silently skipped Renderer row.
  let accountSnapshot: ReturnType<AccountStore['list']>;
  try {
    accountSnapshot = store.list();
  } catch {
    throw new PublishPreflightError('publish_preflight_accounts_unavailable');
  }
  const boundTargets = preflightPublishTargets(job, accountSnapshot);

  for (const { target, account } of boundTargets) {
    if (isCancelled()) break;
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
      await getPlatform(account.platform).uploadVideo({
        storageStatePath: account.storageStatePath,
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

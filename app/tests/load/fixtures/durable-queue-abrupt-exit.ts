import assert from 'node:assert/strict';
import { writeSync } from 'node:fs';
import { openDurableQueue } from '../../../electron/publish/durable-queue';

const storePath = process.argv[2];
if (!storePath) throw new Error('missing isolated queue store path');

const queue = openDurableQueue({
  storePath,
  clock: () => 1_700_000_000_000,
  budgets: {
    global: 8,
    device: 8,
    perAccount: 1,
    perPlatform: {
      douyin: 2,
      kuaishou: 2,
      'wechat-channels': 2,
      xiaohongshu: 2,
    },
  },
  retryPolicy: { leaseMs: 1_000 },
  executor: async () => new Promise(() => undefined),
  reconciler: async () => ({ finalState: 'unknown' }),
});

// tick 在第一个 await 之前已将领取快照原子落盘；不等待执行器，模拟进程
// 在提交结果未知时退出。这个子进程不连接平台，也不返回“提交成功”。
void queue.tick();
const uploading = queue.list().filter((task) => task.state === 'uploading');
assert.equal(uploading.length, 8);
writeSync(1, JSON.stringify({ taskIds: uploading.map((task) => task.id) }) + '\n');
process.exit(73);

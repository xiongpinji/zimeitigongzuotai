/**
 * Q2-R3b2b 产品发布队列引导（constructor wiring）。
 *
 * 职责（本子任务只有这些）：
 * - 在 Electron main ready 之后、首个窗口之前，用 openOwnedDurableQueue 构造
 *   恰好一个产品队列写者；store 固定 <userData>/publish-v2/queue.json；
 * - 注入 fail-closed 的惰性 executor / reconciler：在真正的平台适配器接线
 *   （P1 后续任务）之前，任何提交一律停到 needs_user_action 并确认未提交，
 *   核对一律只报 unknown，绝不自动重发、绝不宣称远端最终状态；
 * - 不注册 IPC、不读账号仓、不 import electron / 平台模块 / 网络客户端，
 *   不启动任何定时器或自动调度。
 *
 * 边界：
 * - 只有经 single-instance-gate 取得锁的 owner 能构造（openOwnedDurableQueue
 *   内断言）；loser / 未过门槛 / 加载失败被撤销所有权时构造抛出；
 * - 空 store 构造不会创建目录或文件；已有 store 在加载时可能因隔离违规的
 *   commerce 任务而原子写盘（沿用 DurablePublishQueue 的恢复语义）；
 * - 通用 DurablePublishQueue 仍非跨进程 CAS；本引导不改变该事实。
 */
import { isAbsolute, join } from 'node:path';
import { openOwnedDurableQueue } from './owned-durable-queue';
import type { DurablePublishQueue, PublishExecutor, RemoteReconciler } from './durable-queue';

/** 产品队列存储目录（相对 userData）。 */
export const PRODUCT_QUEUE_STORE_DIRECTORY = 'publish-v2';
/** 产品队列存储文件名。 */
export const PRODUCT_QUEUE_STORE_FILENAME = 'queue.json';

/** 惰性 executor 的固定安全错误码（未接线平台适配器，等待人工处置）。 */
export const PRODUCT_QUEUE_INERT_EXECUTOR_ERROR_CODE = 'publisher_not_configured';
/** 惰性 reconciler 的固定安全错误码（绝不宣称远端最终状态）。 */
export const PRODUCT_QUEUE_INERT_RECONCILER_ERROR_CODE = 'reconciler_not_configured';

/** 解析产品队列存储的稳定绝对路径；非法 userDataPath 显式拒绝。 */
export function resolveProductQueueStorePath(userDataPath: string): string {
  if (typeof userDataPath !== 'string' || userDataPath.trim().length === 0) {
    throw new Error('userDataPath is required');
  }
  if (!isAbsolute(userDataPath)) {
    throw new Error('userDataPath must be absolute');
  }
  return join(userDataPath, PRODUCT_QUEUE_STORE_DIRECTORY, PRODUCT_QUEUE_STORE_FILENAME);
}

/**
 * 未接平台适配器前的惰性 executor：一律 fail closed 为 needs_user_action，
 * 并明确确认「未提交」，因此队列不会进入 unknown_submission 或自动重试。
 */
const inertPublishExecutor: PublishExecutor = async () => ({
  kind: 'needs_user_action',
  errorCode: PRODUCT_QUEUE_INERT_EXECUTOR_ERROR_CODE,
  confirmedNotSubmitted: true,
});

/** 未接远端核对前的惰性 reconciler：只报 unknown，绝不宣称 published / failed。 */
const inertRemoteReconciler: RemoteReconciler = async () => ({
  finalState: 'unknown',
  errorCode: PRODUCT_QUEUE_INERT_RECONCILER_ERROR_CODE,
});

/**
 * 构造产品队列唯一写者。必须只在 Electron main ready 之后、本进程已取得
 * 单实例锁时调用一次；调用方持有返回引用即可，本函数不自动调度。
 */
export function bootstrapProductQueue(userDataPath: string): DurablePublishQueue {
  return openOwnedDurableQueue({
    storePath: resolveProductQueueStorePath(userDataPath),
    executor: inertPublishExecutor,
    reconciler: inertRemoteReconciler,
  });
}

/**
 * P1-2 持久发布队列核心（离线单元，不接触真实平台）。
 *
 * 职责：
 * - 把「一个视频版本 × 多个账号」展开为每对一条持久任务（稳定任务 ID + 幂等键）；
 * - 原子写盘（同目录临时文件 + fsync + rename），坏 JSON / 未来 schema / 非法任务
 *   一律显式拒绝且不清空旧任务；
 * - 调度：单账号互斥（硬保证）、全局 / 设备 / 平台预算、计划时间、取消、退避；
 * - 崩溃恢复：重启后未到期 leasing 的 uploading 保持原样，租约到期由 tick 转
 *   unknown_submission，只核对不重发；
 * - 同进程实例隔离：同一 store 有在途提交 / 核对的实例时拒绝打开；每个实例写盘前
 *   核验磁盘字节指纹，外部改写后拒绝用陈旧快照整库覆盖；
 * - 未知提交必须先经注入的 reconcile 得到远端 ID / 最终状态，或人工解决。
 *
 * 边界：
 * - 只依赖注入的 clock / executor / reconciler，不调用任何真实平台或云端；
 * - 指纹核验只覆盖同一 Node / Electron main 进程，不是跨进程原子 CAS：两个 OS 进程
 *   仍可能读到同一旧字节后竞态 rename。跨进程安全、系统级单实例锁与远端幂等未验证。
 * - 队列只驱动已授权的普通视频任务：commerceRequest 非空时 fail closed
 *   （落库为 needs_user_action 并禁止提交），绝不静默降级为普通发布；
 * - 不读写 Cookie / Token / 存储态；executor 输入只含引用与安全元数据；
 * - 审计只记录安全错误码（[a-z0-9_.-]，最长 64）与远端 ID，异常文本不落盘；
 * - 时间统一用 epoch ms；契约层（production-contracts）的 ISO 字符串
 *   与上游平台适配器的 epoch ms 之间的转换由未来 Electron main 适配层完成。
 *
 * 未接线：本模块不注册 IPC、不读账号仓、不接平台适配器；
 * runner.ts / ipc.ts 的现网发布路径保持不变，接线由后续任务完成。
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  COMMERCE_KINDS,
  PRODUCTION_PLATFORMS,
  PUBLISH_JOB_STATES,
} from '../../src/types/production-contracts';
import type {
  CommerceRequestV1,
  ProductionPlatform,
  PublishJobState,
} from '../../src/types/production-contracts';

export const DURABLE_QUEUE_SCHEMA_VERSION = 1 as const;

export type DurableQueueSchemaVersion = typeof DURABLE_QUEUE_SCHEMA_VERSION;

/** 队列任务平台沿用 v1 契约命名；上游 'tencent'（视频号）在适配层映射。 */
export type QueuePlatform = ProductionPlatform;

/**
 * 任务状态 = 契约状态机 + 队列本地 'cancelled'。
 * 'cancelled' 只用于「尚未提交就被用户取消」的任务；已提交 / 未知提交不允许直接取消。
 */
export type QueueTaskState = PublishJobState | 'cancelled';

export type QueueRemoteFinalState = 'published' | 'failed' | 'unknown';

export interface QueueRemoteResult {
  remoteId: string | null;
  remoteUrl: string | null;
  finalState: QueueRemoteFinalState;
  /** 最近一次远端核验时间（epoch ms）；未核验为 null。 */
  verifiedAt: number | null;
}

export interface QueueJobMetadata {
  title: string;
  description: string;
  tags: string[];
  coverRefs: string[];
  /** 计划发布时间（epoch ms）；null 表示立即发布。 */
  scheduleAt: number | null;
}

export interface DurableTaskHistoryEntry {
  at: number;
  from: QueueTaskState | null;
  to: QueueTaskState;
  attempt: number;
  errorCode: string | null;
  remoteId: string | null;
  actor: string | null;
}

export interface DurablePublishTaskV1 {
  /** 稳定任务 ID（由幂等键派生，重建 / 重复入队不改变）。 */
  id: string;
  platform: QueuePlatform;
  accountId: string;
  videoVariantId: string;
  /** 渲染产物引用（本地数据目录），不是文件内容。 */
  videoRef: string;
  metadata: QueueJobMetadata;
  /** 普通发布显式为 null；非空任务 fail closed，绝不降级。 */
  commerceRequest: CommerceRequestV1 | null;
  /** 稳定幂等键，防止同一视频版本 × 同一账号重复提交。 */
  idempotencyKey: string;
  /** 入队载荷指纹，用于识别同键但内容不同的冲突。 */
  requestFingerprint: string;
  state: QueueTaskState;
  /** 已执行的发布尝试次数（含限流尝试）。 */
  attempt: number;
  /** 已执行的远端核对次数。 */
  reconcileAttempts: number;
  /** 队列租约到期时间（epoch ms）；无租约为 null。 */
  leaseUntil: number | null;
  nextAttemptAt: number | null;
  nextReconcileAt: number | null;
  cancelRequested: boolean;
  lastErrorCode: string | null;
  remoteResult: QueueRemoteResult | null;
  createdAt: number;
  updatedAt: number;
  stateChangedAt: number;
  history: DurableTaskHistoryEntry[];
}

export interface DurableQueueFileV1 {
  schemaVersion: DurableQueueSchemaVersion;
  updatedAt: number;
  tasks: DurablePublishTaskV1[];
}

// ——————————————————————————————— 注入接口 ———————————————————————————————

/** executor 收到的安全投影：只有引用、文案与进度语义，没有凭证。 */
export interface PublishAttemptInput {
  taskId: string;
  accountId: string;
  platform: QueuePlatform;
  videoVariantId: string;
  idempotencyKey: string;
  videoRef: string;
  metadata: QueueJobMetadata;
  attempt: number;
  signal: AbortSignal;
}

export type PublishAttemptOutcome =
  | { kind: 'submitted'; remoteId: string; remoteUrl?: string | null }
  | { kind: 'failed'; errorCode?: string; retryable?: boolean; confirmedNotSubmitted?: boolean }
  | { kind: 'throttled'; retryAfterMs?: number; errorCode?: string; confirmedNotSubmitted?: boolean }
  | { kind: 'needs_login'; errorCode?: string; confirmedNotSubmitted?: boolean }
  | { kind: 'needs_user_action'; errorCode?: string; confirmedNotSubmitted?: boolean }
  | { kind: 'unknown'; errorCode?: string };

export type PublishExecutor = (input: PublishAttemptInput) => Promise<PublishAttemptOutcome>;

export interface ReconcileInput {
  taskId: string;
  accountId: string;
  platform: QueuePlatform;
  videoVariantId: string;
  videoRef: string;
  remoteResult: QueueRemoteResult | null;
  /** 本次核对的序号（1 起）。 */
  reconcileAttempt: number;
  signal: AbortSignal;
}

export type ReconcileResult =
  | { finalState: 'published'; remoteId?: string | null; remoteUrl?: string | null }
  | {
      finalState: 'failed';
      remoteId?: string | null;
      remoteUrl?: string | null;
      retryable?: boolean;
      /** 只有平台核对明确证明没有发布时才允许重新提交。 */
      confirmedNotPublished?: boolean;
      errorCode?: string;
    }
  | { finalState: 'unknown'; remoteId?: string | null; remoteUrl?: string | null; errorCode?: string };

export type RemoteReconciler = (input: ReconcileInput) => Promise<ReconcileResult>;

export interface QueueBudgets {
  /** 全局提交 worker 上限，默认 2。 */
  global?: number;
  /** 本地设备（浏览器 / 渲染机）并发上限，默认 2；只约束提交，不约束远端核对。 */
  device?: number;
  /** 各平台 worker 上限，缺省 1（保守）。 */
  perPlatform?: Partial<Record<QueuePlatform, number>>;
  /** 单账号并发上限；单账号互斥是硬保证，配置大于 1 会被钳制为 1。默认 1。 */
  perAccount?: number;
}

export interface QueueRetryPolicy {
  /** 发布尝试上限（含限流），默认 5。 */
  maxAttempts?: number;
  /** 指数退避基数，默认 60000ms。 */
  baseBackoffMs?: number;
  /** 指数退避上限，默认 1800000ms。 */
  maxBackoffMs?: number;
  /** 自动远端核对次数上限，超过后等待人工接管，默认 5。 */
  maxReconcileAttempts?: number;
  /** 队列租约时长，默认 600000ms。 */
  leaseMs?: number;
}

export interface DurableQueueOptions {
  /** 队列存储文件路径（JSON）。父目录不存在时在首次写入时创建。 */
  storePath: string;
  executor: PublishExecutor;
  reconciler: RemoteReconciler;
  /** 注入时钟（epoch ms），默认 Date.now。 */
  clock?: () => number;
  budgets?: QueueBudgets;
  retryPolicy?: QueueRetryPolicy;
}

export interface PublishMatrixAccountInput {
  accountId: string;
  platform: QueuePlatform;
  overrides?: { title?: string; description?: string; tags?: string[] };
}

export interface PublishMatrixInput {
  videoVariantId: string;
  videoRef: string;
  metadata: QueueJobMetadata;
  accounts: PublishMatrixAccountInput[];
  /** 普通发布必须显式传 null；undefined / 缺失视为非法，防止静默降级。 */
  commerceRequest: CommerceRequestV1 | null;
}

export interface PublishMatrixReport {
  created: DurablePublishTaskV1[];
  existing: DurablePublishTaskV1[];
}

export interface QueueTickReport {
  at: number;
  /** 本轮领取并执行的提交任务 ID。 */
  claimed: string[];
  /** 本轮执行的远端核对任务 ID。 */
  reconciled: string[];
  /** 本轮因 cancelRequested 而终止的未提交任务 ID。 */
  cancelled: string[];
}

export interface QueueManualResolution {
  finalState: 'published' | 'failed';
  remoteId?: string | null;
  remoteUrl?: string | null;
  retryable?: boolean;
  confirmedNotPublished?: boolean;
  errorCode?: string;
  /** 人工处置人标识（安全 token），用于审计。 */
  resolvedBy: string;
}

export interface ResolvedQueueBudgets {
  global: number;
  device: number;
  perAccount: number;
  perPlatform: Record<QueuePlatform, number>;
}

export interface ResolvedQueueRetryPolicy {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxReconcileAttempts: number;
  leaseMs: number;
}

export interface DurableQueueSnapshot {
  schemaVersion: DurableQueueSchemaVersion;
  updatedAt: number;
  tasks: DurablePublishTaskV1[];
  budgets: ResolvedQueueBudgets;
  retryPolicy: ResolvedQueueRetryPolicy;
}

export type DurableQueueErrorCode =
  | 'corrupt_store'
  | 'unsupported_schema_version'
  | 'invalid_store'
  | 'invalid_task_input'
  | 'invalid_platform'
  | 'invalid_commerce_request'
  | 'idempotency_conflict'
  | 'task_not_found'
  | 'invalid_transition'
  | 'commerce_blocked'
  | 'store_read_failed'
  | 'store_write_failed'
  | 'store_in_use'
  | 'store_changed_externally';

export class DurableQueueError extends Error {
  readonly code: DurableQueueErrorCode;
  readonly detail: string | undefined;

  constructor(code: DurableQueueErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'DurableQueueError';
    this.code = code;
    this.detail = detail;
  }
}

// ——————————————————————————————— 常量与纯工具 ———————————————————————————————

const PLATFORM_SET: ReadonlySet<string> = new Set(PRODUCTION_PLATFORMS);
const TASK_STATE_SET: ReadonlySet<string> = new Set<string>([...PUBLISH_JOB_STATES, 'cancelled']);
const COMMERCE_KIND_SET: ReadonlySet<string> = new Set(COMMERCE_KINDS);
const REMOTE_FINAL_STATE_SET: ReadonlySet<string> = new Set(['published', 'failed', 'unknown']);

const EXECUTABLE_STATES: ReadonlySet<QueueTaskState> = new Set(['queued', 'retryable_failure']);
const RECONCILABLE_STATES: ReadonlySet<QueueTaskState> = new Set([
  'verifying',
  'submitted',
  'unknown_submission',
]);
const CANCELLABLE_PRE_EXECUTION: ReadonlySet<QueueTaskState> = new Set([
  'queued',
  'retryable_failure',
  'needs_login',
  'needs_permission',
  'needs_user_action',
]);
const TERMINAL_STATES: ReadonlySet<QueueTaskState> = new Set([
  'published',
  'terminal_failure',
  'cancelled',
]);

/** 显式状态机白名单；同状态重入（核对再次不明）允许。 */
const ALLOWED_TRANSITIONS: Record<QueueTaskState, readonly QueueTaskState[]> = {
  draft: ['preflight', 'queued', 'cancelled', 'needs_user_action'],
  preflight: ['queued', 'terminal_failure', 'needs_user_action', 'needs_login', 'cancelled'],
  queued: ['uploading', 'cancelled', 'needs_user_action'],
  uploading: [
    'verifying',
    'retryable_failure',
    'terminal_failure',
    'needs_login',
    'needs_user_action',
    'unknown_submission',
    'cancelled',
  ],
  submitted: ['verifying', 'published', 'unknown_submission', 'terminal_failure', 'retryable_failure', 'needs_user_action', 'cancelled'],
  verifying: ['published', 'unknown_submission', 'terminal_failure', 'retryable_failure', 'needs_user_action', 'cancelled'],
  retryable_failure: ['uploading', 'cancelled', 'terminal_failure', 'needs_user_action'],
  needs_login: ['queued', 'cancelled'],
  needs_permission: ['queued', 'cancelled'],
  needs_user_action: ['queued', 'cancelled'],
  unknown_submission: [
    'published',
    'retryable_failure',
    'terminal_failure',
    'verifying',
    'needs_user_action',
    'cancelled',
  ],
  published: [],
  terminal_failure: [],
  cancelled: [],
};

const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

function sanitizeSafeCode(value: string | undefined, fallback: string): string {
  if (typeof value === 'string' && SAFE_CODE_PATTERN.test(value)) return value;
  return fallback;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 同进程活动注册表：按规范化 store 路径统计在途提交 / 核对。
 * 只约束同一 Node 进程；跨进程竞态不在此守卫范围内（见文件头边界说明）。
 */
const activeStoreOperations = new Map<string, number>();

function normalizeStorePath(storePath: string): string {
  const resolved = resolve(storePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function beginStoreOperation(normalizedStorePath: string): void {
  activeStoreOperations.set(normalizedStorePath, (activeStoreOperations.get(normalizedStorePath) ?? 0) + 1);
}

function endStoreOperation(normalizedStorePath: string): void {
  const count = activeStoreOperations.get(normalizedStorePath) ?? 0;
  if (count <= 1) {
    activeStoreOperations.delete(normalizedStorePath);
    return;
  }
  activeStoreOperations.set(normalizedStorePath, count - 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function cloneTask(task: DurablePublishTaskV1): DurablePublishTaskV1 {
  return structuredClone(task);
}

function cloneMetadata(metadata: QueueJobMetadata): QueueJobMetadata {
  return {
    title: metadata.title,
    description: metadata.description,
    tags: [...metadata.tags],
    coverRefs: [...metadata.coverRefs],
    scheduleAt: metadata.scheduleAt,
  };
}

function compareTasks(a: DurablePublishTaskV1, b: DurablePublishTaskV1): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function requirePositiveInt(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new DurableQueueError('invalid_task_input', `${field} 必须为 >= 1 的整数`);
  }
  return value;
}

function requireNonNegativeNumber(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!isFiniteNumber(value) || value < 0) {
    throw new DurableQueueError('invalid_task_input', `${field} 必须为 >= 0 的有限数字`);
  }
  return value;
}

function validatePlatform(value: unknown, detail: string): QueuePlatform {
  if (typeof value !== 'string' || !PLATFORM_SET.has(value)) {
    throw new DurableQueueError('invalid_platform', `${detail} 不是阶段一四平台之一`, String(value));
  }
  return value as QueuePlatform;
}

function validateMetadata(input: unknown): QueueJobMetadata {
  if (!isRecord(input)) {
    throw new DurableQueueError('invalid_task_input', 'metadata 必须为对象');
  }
  if (!isNonEmptyString(input.title)) {
    throw new DurableQueueError('invalid_task_input', '普通发布的 metadata.title 不能为空');
  }
  if (typeof input.description !== 'string') {
    throw new DurableQueueError('invalid_task_input', 'metadata.description 必须为字符串');
  }
  const tags = input.tags;
  if (!Array.isArray(tags) || tags.some((tag) => !isNonEmptyString(tag))) {
    throw new DurableQueueError('invalid_task_input', 'metadata.tags 必须为非空字符串数组');
  }
  const coverRefs = input.coverRefs;
  if (!Array.isArray(coverRefs) || coverRefs.some((ref) => !isNonEmptyString(ref))) {
    throw new DurableQueueError('invalid_task_input', 'metadata.coverRefs 必须为非空字符串数组');
  }
  const scheduleAt = input.scheduleAt;
  if (scheduleAt !== null && (!isFiniteNumber(scheduleAt) || scheduleAt < 0)) {
    throw new DurableQueueError('invalid_task_input', 'metadata.scheduleAt 必须为 null 或 >= 0 的时间戳');
  }
  return {
    title: input.title,
    description: input.description,
    tags: [...tags],
    coverRefs: [...coverRefs],
    scheduleAt: scheduleAt as number | null,
  };
}

function validateCommerceRequest(
  value: unknown,
  task: { accountId: string; platform: QueuePlatform },
): CommerceRequestV1 {
  if (!isRecord(value)) {
    throw new DurableQueueError('invalid_commerce_request', 'commerceRequest 必须为对象或显式 null');
  }
  const platform = validatePlatform(value.platform, 'commerceRequest.platform');
  if (!isNonEmptyString(value.accountId) || value.accountId !== task.accountId) {
    throw new DurableQueueError('invalid_commerce_request', 'commerceRequest.accountId 必须与任务账号一致');
  }
  if (platform !== task.platform) {
    throw new DurableQueueError('invalid_commerce_request', 'commerceRequest.platform 必须与任务平台一致');
  }
  if (typeof value.kind !== 'string' || !COMMERCE_KIND_SET.has(value.kind)) {
    throw new DurableQueueError('invalid_commerce_request', 'commerceRequest.kind 非法', String(value.kind));
  }
  if (!isNonEmptyString(value.platformProductId)) {
    throw new DurableQueueError('invalid_commerce_request', 'commerceRequest.platformProductId 不能为空');
  }
  if (/^https?:\/\//i.test(value.platformProductId)) {
    throw new DurableQueueError('invalid_commerce_request', 'platformProductId 禁止用通用 URL 冒充');
  }
  if (typeof value.required !== 'boolean') {
    throw new DurableQueueError('invalid_commerce_request', 'commerceRequest.required 必须为布尔值');
  }
  return {
    platform,
    accountId: value.accountId,
    kind: value.kind as CommerceRequestV1['kind'],
    platformProductId: value.platformProductId,
    required: value.required,
  };
}

// ——————————————————————————————— 持久化解析 ———————————————————————————————

function parsePersistedStore(raw: string): DurableQueueFileV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DurableQueueError('corrupt_store', '发布队列存储不是合法 JSON，已拒绝加载且未改动原文件');
  }
  if (!isRecord(parsed)) {
    throw new DurableQueueError('invalid_store', '发布队列存储根节点必须为对象');
  }
  if (parsed.schemaVersion !== DURABLE_QUEUE_SCHEMA_VERSION) {
    throw new DurableQueueError(
      'unsupported_schema_version',
      '发布队列存储 schemaVersion 不受支持，已拒绝加载且未改动原文件',
      String(parsed.schemaVersion),
    );
  }
  if (!isFiniteNumber(parsed.updatedAt)) {
    throw new DurableQueueError('invalid_store', 'updatedAt 必须为有限数字');
  }
  if (!Array.isArray(parsed.tasks)) {
    throw new DurableQueueError('invalid_store', 'tasks 必须为数组');
  }
  const tasks = parsed.tasks.map((task, index) => validatePersistedTask(task, index));
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new DurableQueueError('invalid_store', '任务 ID 重复', task.id);
    }
    ids.add(task.id);
    if (keys.has(task.idempotencyKey)) {
      throw new DurableQueueError('invalid_store', '幂等键重复，可能导致重复提交', task.idempotencyKey);
    }
    keys.add(task.idempotencyKey);
  }
  return { schemaVersion: DURABLE_QUEUE_SCHEMA_VERSION, updatedAt: parsed.updatedAt, tasks };
}

function validatePersistedTask(input: unknown, index: number): DurablePublishTaskV1 {
  const fail = (field: string): never => {
    throw new DurableQueueError('invalid_store', `任务字段非法：tasks[${index}].${field}`);
  };
  if (!isRecord(input)) return fail('<root>');
  let platform: QueuePlatform;
  try {
    platform = validatePlatform(input.platform, `tasks[${index}].platform`);
  } catch {
    return fail('platform');
  }
  for (const field of ['id', 'accountId', 'videoVariantId', 'videoRef', 'idempotencyKey', 'requestFingerprint']) {
    if (!isNonEmptyString(input[field])) fail(field);
  }
  if (typeof input.state !== 'string' || !TASK_STATE_SET.has(input.state)) fail('state');
  for (const field of ['attempt', 'reconcileAttempts']) {
    if (!isNonNegativeInteger(input[field])) fail(field);
  }
  for (const field of ['createdAt', 'updatedAt', 'stateChangedAt']) {
    if (!isFiniteNumber(input[field])) fail(field);
  }
  for (const field of ['leaseUntil', 'nextAttemptAt', 'nextReconcileAt']) {
    if (!isNullableTimestamp(input[field])) fail(field);
  }
  const cancelRequested = input.cancelRequested;
  if (typeof cancelRequested !== 'boolean') return fail('cancelRequested');
  if (!(input.lastErrorCode === null || typeof input.lastErrorCode === 'string')) fail('lastErrorCode');
  let metadata: QueueJobMetadata;
  try {
    metadata = validateMetadata(input.metadata);
  } catch {
    return fail('metadata');
  }
  // 契约要求 commerceRequest 字段显式存在（null 或完整对象），缺失视为损坏。
  if (!('commerceRequest' in input)) fail('commerceRequest');
  let commerceRequest: CommerceRequestV1 | null = null;
  if (input.commerceRequest !== null) {
    try {
      commerceRequest = validateCommerceRequest(input.commerceRequest, {
        accountId: input.accountId as string,
        platform,
      });
    } catch {
      return fail('commerceRequest');
    }
  }
  if (!('remoteResult' in input)) fail('remoteResult');
  const remote = input.remoteResult;
  if (remote !== null) {
    if (!isRecord(remote)) return fail('remoteResult');
    if (!(remote.remoteId === null || isNonEmptyString(remote.remoteId))) fail('remoteResult.remoteId');
    if (!(remote.remoteUrl === null || isNonEmptyString(remote.remoteUrl))) fail('remoteResult.remoteUrl');
    if (typeof remote.finalState !== 'string' || !REMOTE_FINAL_STATE_SET.has(remote.finalState)) {
      fail('remoteResult.finalState');
    }
    if (!isNullableTimestamp(remote.verifiedAt)) fail('remoteResult.verifiedAt');
  }
  const history = input.history;
  if (!Array.isArray(history)) return fail('history');
  for (const entry of history) {
    if (!isRecord(entry)) fail('history[]');
    if (!isFiniteNumber(entry.at)) fail('history[].at');
    if (entry.from !== null && (typeof entry.from !== 'string' || !TASK_STATE_SET.has(entry.from))) {
      fail('history[].from');
    }
    if (typeof entry.to !== 'string' || !TASK_STATE_SET.has(entry.to)) fail('history[].to');
    if (!isNonNegativeInteger(entry.attempt)) fail('history[].attempt');
    if (!(entry.errorCode === null || typeof entry.errorCode === 'string')) fail('history[].errorCode');
    if (!(entry.remoteId === null || isNonEmptyString(entry.remoteId))) fail('history[].remoteId');
    if (!(entry.actor === null || isNonEmptyString(entry.actor))) fail('history[].actor');
  }
  return {
    id: input.id as string,
    platform,
    accountId: input.accountId as string,
    videoVariantId: input.videoVariantId as string,
    videoRef: input.videoRef as string,
    metadata,
    commerceRequest,
    idempotencyKey: input.idempotencyKey as string,
    requestFingerprint: input.requestFingerprint as string,
    state: input.state as QueueTaskState,
    attempt: input.attempt as number,
    reconcileAttempts: input.reconcileAttempts as number,
    leaseUntil: input.leaseUntil as number | null,
    nextAttemptAt: input.nextAttemptAt as number | null,
    nextReconcileAt: input.nextReconcileAt as number | null,
    cancelRequested,
    lastErrorCode: (input.lastErrorCode as string | null) ?? null,
    remoteResult: remote as QueueRemoteResult | null,
    createdAt: input.createdAt as number,
    updatedAt: input.updatedAt as number,
    stateChangedAt: input.stateChangedAt as number,
    history: history as DurableTaskHistoryEntry[],
  };
}

// ——————————————————————————————— 队列主体 ———————————————————————————————

interface RunningEntry {
  accountId: string;
  platform: QueuePlatform;
  kind: 'submit' | 'reconcile';
  controller: AbortController;
}

export class DurablePublishQueue {
  readonly budgets: ResolvedQueueBudgets;
  readonly retryPolicy: ResolvedQueueRetryPolicy;

  private readonly storePath: string;
  private readonly normalizedStorePath: string;
  private readonly executor: PublishExecutor;
  private readonly reconciler: RemoteReconciler;
  private readonly clock: () => number;
  private readonly running = new Map<string, RunningEntry>();
  private tickInFlight: Promise<QueueTickReport> | null = null;
  private file: DurableQueueFileV1;
  /** 本实例最近一次读 / 写盘得到的字节指纹；null 表示当时文件不存在。 */
  private expectedStoreDigest: string | null = null;

  constructor(options: DurableQueueOptions) {
    if (!isNonEmptyString(options.storePath)) {
      throw new DurableQueueError('invalid_task_input', 'storePath 不能为空');
    }
    if (typeof options.executor !== 'function' || typeof options.reconciler !== 'function') {
      throw new DurableQueueError('invalid_task_input', 'executor 与 reconciler 必须为函数');
    }
    this.storePath = options.storePath;
    this.normalizedStorePath = normalizeStorePath(options.storePath);
    if ((activeStoreOperations.get(this.normalizedStorePath) ?? 0) > 0) {
      throw new DurableQueueError(
        'store_in_use',
        '同一 store 已有实例正在执行提交或核对，拒绝并发打开新实例',
      );
    }
    this.executor = options.executor;
    this.reconciler = options.reconciler;
    this.clock = options.clock ?? Date.now;

    const perPlatform = {} as Record<QueuePlatform, number>;
    for (const platform of PRODUCTION_PLATFORMS) {
      perPlatform[platform] = requirePositiveInt(
        options.budgets?.perPlatform?.[platform],
        1,
        `budgets.perPlatform.${platform}`,
      );
    }
    this.budgets = {
      global: requirePositiveInt(options.budgets?.global, 2, 'budgets.global'),
      device: requirePositiveInt(options.budgets?.device, 2, 'budgets.device'),
      // 单账号互斥是硬保证：配置只能收紧，不能放宽。
      perAccount: Math.min(requirePositiveInt(options.budgets?.perAccount, 1, 'budgets.perAccount'), 1),
      perPlatform,
    };
    const baseBackoffMs = requireNonNegativeNumber(
      options.retryPolicy?.baseBackoffMs,
      60_000,
      'retryPolicy.baseBackoffMs',
    );
    const maxBackoffMs = requireNonNegativeNumber(
      options.retryPolicy?.maxBackoffMs,
      30 * 60_000,
      'retryPolicy.maxBackoffMs',
    );
    if (maxBackoffMs < baseBackoffMs) {
      throw new DurableQueueError('invalid_task_input', 'maxBackoffMs 不能小于 baseBackoffMs');
    }
    this.retryPolicy = {
      maxAttempts: requirePositiveInt(options.retryPolicy?.maxAttempts, 5, 'retryPolicy.maxAttempts'),
      baseBackoffMs,
      maxBackoffMs,
      maxReconcileAttempts: requirePositiveInt(
        options.retryPolicy?.maxReconcileAttempts,
        5,
        'retryPolicy.maxReconcileAttempts',
      ),
      leaseMs: requirePositiveInt(options.retryPolicy?.leaseMs, 600_000, 'retryPolicy.leaseMs'),
    };

    this.file = this.load();
  }

  // ————————————————————————————— 读 API —————————————————————————————

  list(): DurablePublishTaskV1[] {
    return this.file.tasks.map(cloneTask);
  }

  get(taskId: string): DurablePublishTaskV1 | undefined {
    const task = this.file.tasks.find((candidate) => candidate.id === taskId);
    return task ? cloneTask(task) : undefined;
  }

  snapshot(): DurableQueueSnapshot {
    return {
      schemaVersion: DURABLE_QUEUE_SCHEMA_VERSION,
      updatedAt: this.file.updatedAt,
      tasks: this.list(),
      budgets: { ...this.budgets, perPlatform: { ...this.budgets.perPlatform } },
      retryPolicy: { ...this.retryPolicy },
    };
  }

  // ————————————————————————————— 入队 —————————————————————————————

  /**
   * 展开「一个视频版本 × 多账号」矩阵为独立任务。
   * 幂等：同账号重复入队返回既有任务；载荷指纹不同的同键入队显式拒绝。
   */
  enqueueMatrix(input: PublishMatrixInput): PublishMatrixReport {
    if (!isRecord(input)) {
      throw new DurableQueueError('invalid_task_input', '入队参数必须为对象');
    }
    if (!isNonEmptyString(input.videoVariantId)) {
      throw new DurableQueueError('invalid_task_input', 'videoVariantId 不能为空');
    }
    if (!isNonEmptyString(input.videoRef)) {
      throw new DurableQueueError('invalid_task_input', 'videoRef 不能为空');
    }
    const metadata = validateMetadata(input.metadata);
    if (!Array.isArray(input.accounts) || input.accounts.length === 0) {
      throw new DurableQueueError('invalid_task_input', 'accounts 必须为非空数组');
    }
    const seenAccounts = new Set<string>();
    for (const account of input.accounts) {
      if (!isRecord(account) || !isNonEmptyString(account.accountId)) {
        throw new DurableQueueError('invalid_task_input', 'accountId 不能为空');
      }
      if (seenAccounts.has(account.accountId)) {
        throw new DurableQueueError('invalid_task_input', `accounts 中账号重复：${account.accountId}`);
      }
      seenAccounts.add(account.accountId);
    }
    // commerceRequest 必须显式给出（null 或完整契约对象）；undefined / 缺失一律拒绝。
    if (!('commerceRequest' in input)) {
      throw new DurableQueueError(
        'invalid_commerce_request',
        'commerceRequest 字段必须显式提供（普通发布为 null），拒绝静默降级',
      );
    }
    const at = this.clock();
    const prepared = input.accounts.map((account) =>
      this.buildTask(input, account, metadata, at),
    );

    const known = new Map(this.file.tasks.map((task) => [task.idempotencyKey, task]));
    for (const task of prepared) {
      const existing = known.get(task.idempotencyKey);
      if (existing && existing.requestFingerprint !== task.requestFingerprint) {
        throw new DurableQueueError(
          'idempotency_conflict',
          '同一幂等键已存在但载荷不同，请先人工处理原任务',
          task.idempotencyKey,
        );
      }
    }
    const allExisting = prepared.every((task) => known.has(task.idempotencyKey));
    if (allExisting) {
      return {
        created: [],
        existing: prepared.map((task) => cloneTask(known.get(task.idempotencyKey)!)),
      };
    }

    const created: DurablePublishTaskV1[] = [];
    const existing: DurablePublishTaskV1[] = [];
    this.mutate((draft) => {
      for (const task of prepared) {
        const found = draft.tasks.find((candidate) => candidate.idempotencyKey === task.idempotencyKey);
        if (found) {
          existing.push(cloneTask(found));
          continue;
        }
        draft.tasks.push(task);
        created.push(cloneTask(task));
      }
    });
    return { created, existing };
  }

  private buildTask(
    input: PublishMatrixInput,
    account: PublishMatrixAccountInput,
    sharedMetadata: QueueJobMetadata,
    at: number,
  ): DurablePublishTaskV1 {
    const platform = validatePlatform(account.platform, `accounts.${account.accountId}.platform`);
    const overrides = account.overrides ?? {};
    const metadata: QueueJobMetadata = {
      ...cloneMetadata(sharedMetadata),
      ...(overrides.title !== undefined ? { title: overrides.title } : {}),
      ...(overrides.description !== undefined ? { description: overrides.description } : {}),
      ...(overrides.tags !== undefined ? { tags: [...overrides.tags] } : {}),
    };
    validateMetadata(metadata);
    const taskShape = { accountId: account.accountId, platform };
    const commerceRequest =
      input.commerceRequest === null
        ? null
        : validateCommerceRequest(input.commerceRequest, taskShape);

    const idempotencyKey = `publish-v1:${sha256Hex(`${input.videoVariantId}\u0000${account.accountId}`)}`;
    const requestFingerprint = sha256Hex(
      JSON.stringify({
        videoVariantId: input.videoVariantId,
        videoRef: input.videoRef,
        accountId: account.accountId,
        platform,
        metadata,
        commerce: commerceRequest
          ? [
              commerceRequest.platform,
              commerceRequest.accountId,
              commerceRequest.kind,
              commerceRequest.platformProductId,
              commerceRequest.required,
            ]
          : null,
      }),
    );
    const state: QueueTaskState = commerceRequest === null ? 'queued' : 'needs_user_action';
    return {
      id: `pubjob_${sha256Hex(idempotencyKey).slice(0, 24)}`,
      platform,
      accountId: account.accountId,
      videoVariantId: input.videoVariantId,
      videoRef: input.videoRef,
      metadata,
      commerceRequest,
      idempotencyKey,
      requestFingerprint,
      state,
      attempt: 0,
      reconcileAttempts: 0,
      leaseUntil: null,
      nextAttemptAt: null,
      nextReconcileAt: null,
      cancelRequested: false,
      lastErrorCode: commerceRequest === null ? null : 'commerce_not_configured',
      remoteResult: null,
      createdAt: at,
      updatedAt: at,
      stateChangedAt: at,
      history: [
        {
          at,
          from: null,
          to: state,
          attempt: 0,
          errorCode: commerceRequest === null ? null : 'commerce_not_configured',
          remoteId: null,
          actor: null,
        },
      ],
    };
  }

  // ————————————————————————————— 调度 —————————————————————————————

  /**
   * 驱动一轮调度：先领取可提交任务（受预算 / 计划时间 / 账号互斥约束），
   * 再对 verifying / unknown_submission 任务执行远端核对。并发调用会合并到同一轮。
   */
  tick(): Promise<QueueTickReport> {
    if (this.tickInFlight) return this.tickInFlight;
    const run = this.doTick().finally(() => {
      if (this.tickInFlight === run) this.tickInFlight = null;
    });
    this.tickInFlight = run;
    return run;
  }

  private async doTick(): Promise<QueueTickReport> {
    const at = this.clock();
    const report: QueueTickReport = { at, claimed: [], reconciled: [], cancelled: [] };
    const submissions: Array<{ task: DurablePublishTaskV1; controller: AbortController }> = [];
    const reconciliations: Array<{ task: DurablePublishTaskV1; controller: AbortController }> = [];
    const busyAccounts = new Set<string>();
    for (const entry of this.running.values()) busyAccounts.add(entry.accountId);
    const selectedPlatforms = new Map<QueuePlatform, number>();

    this.mutate((draft) => {
      const ordered = [...draft.tasks].sort(compareTasks);

      // 0) 同进程租约回收：uploading 超过租约且没有在途执行器（例如结果落盘失败留下）时，
      //    转 unknown_submission 交由核对，绝不直接重发。仍在 running 中的执行器即使
      //    租约超时也不能在这里回收——无法中止挂起的执行器是已知限制，不能伪称已解决。
      for (const task of ordered) {
        if (task.state !== 'uploading' || this.running.has(task.id)) continue;
        if (task.leaseUntil !== null && task.leaseUntil > at) continue;
        this.transition(task, 'unknown_submission', { at, errorCode: 'leased_upload_expired' });
        task.leaseUntil = null;
        task.nextAttemptAt = null;
        task.nextReconcileAt = at;
      }

      // 1) restart 后仍带取消标记的未提交任务在下一轮直接终止
      for (const task of ordered) {
        if (!task.cancelRequested) continue;
        if (CANCELLABLE_PRE_EXECUTION.has(task.state)) {
          this.transition(task, 'cancelled', { at, errorCode: 'cancelled_by_request' });
          report.cancelled.push(task.id);
        }
      }

      // 2) 提交领取：先到先得；互斥与预算在领取时一次性落实
      for (const task of ordered) {
        if (submissions.length >= this.budgets.global) break;
        if (submissions.length >= this.budgets.device) break;
        if (!EXECUTABLE_STATES.has(task.state) || task.cancelRequested) continue;
        // 挂车任务即使状态可执行也绝不进入普通发布执行器。
        if (task.commerceRequest !== null) continue;
        if (task.metadata.scheduleAt !== null && task.metadata.scheduleAt > at) continue;
        if (task.nextAttemptAt !== null && task.nextAttemptAt > at) continue;
        if (busyAccounts.has(task.accountId)) continue;
        const platformCount = selectedPlatforms.get(task.platform) ?? 0;
        if (platformCount >= this.budgets.perPlatform[task.platform]) continue;

        task.attempt += 1;
        this.transition(task, 'uploading', { at, errorCode: null });
        task.leaseUntil = at + this.retryPolicy.leaseMs;
        task.nextAttemptAt = null;
        submissions.push({ task: cloneTask(task), controller: new AbortController() });
        busyAccounts.add(task.accountId);
        selectedPlatforms.set(task.platform, platformCount + 1);
        report.claimed.push(task.id);
      }

      // 3) 远端核对：提交优先占用全局预算；账号互斥同样适用于核对。
      //    带取消标记的未知提交也必须核对（可能已提交成功），绝不允许直接丢弃或重发。
      for (const task of ordered) {
        if (this.running.size + submissions.length + reconciliations.length >= this.budgets.global) break;
        if (!RECONCILABLE_STATES.has(task.state)) continue;
        // 防御旧文件/外部改写：未实现的商品请求不得进入普通发布核对器。
        if (task.commerceRequest !== null) continue;
        if (task.reconcileAttempts >= this.retryPolicy.maxReconcileAttempts) continue;
        if (task.nextReconcileAt !== null && task.nextReconcileAt > at) continue;
        if (busyAccounts.has(task.accountId)) continue;
        reconciliations.push({ task: cloneTask(task), controller: new AbortController() });
        busyAccounts.add(task.accountId);
        report.reconciled.push(task.id);
      }
    });

    const work: Array<Promise<void>> = [];
    for (const entry of submissions) {
      this.running.set(entry.task.id, {
        accountId: entry.task.accountId,
        platform: entry.task.platform,
        kind: 'submit',
        controller: entry.controller,
      });
      beginStoreOperation(this.normalizedStorePath);
      work.push(this.runSubmission(entry.task, entry.controller));
    }
    for (const entry of reconciliations) {
      this.running.set(entry.task.id, {
        accountId: entry.task.accountId,
        platform: entry.task.platform,
        kind: 'reconcile',
        controller: entry.controller,
      });
      beginStoreOperation(this.normalizedStorePath);
      work.push(this.runReconciliation(entry.task, entry.controller));
    }
    const settled = await Promise.allSettled(work);
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure && failure.status === 'rejected') throw failure.reason;
    return report;
  }

  private async runSubmission(task: DurablePublishTaskV1, controller: AbortController): Promise<void> {
    try {
      let outcome: PublishAttemptOutcome;
      try {
        outcome = await this.executor({
          taskId: task.id,
          accountId: task.accountId,
          platform: task.platform,
          videoVariantId: task.videoVariantId,
          idempotencyKey: task.idempotencyKey,
          videoRef: task.videoRef,
          metadata: cloneMetadata(task.metadata),
          attempt: task.attempt,
          signal: controller.signal,
        });
      } catch {
        // 适配器抛异常时无法判断远端是否已受理，保守按未知提交处理。
        outcome = { kind: 'unknown', errorCode: 'executor_threw' };
      }
      this.running.delete(task.id);
      this.applyAttemptOutcome(task.id, outcome);
    } finally {
      endStoreOperation(this.normalizedStorePath);
    }
  }

  private async runReconciliation(task: DurablePublishTaskV1, controller: AbortController): Promise<void> {
    try {
      let result: ReconcileResult | null = null;
      try {
        result = await this.reconciler({
          taskId: task.id,
          accountId: task.accountId,
          platform: task.platform,
          videoVariantId: task.videoVariantId,
          videoRef: task.videoRef,
          remoteResult: task.remoteResult ? { ...task.remoteResult } : null,
          reconcileAttempt: task.reconcileAttempts + 1,
          signal: controller.signal,
        });
      } catch {
        result = null;
      }
      this.running.delete(task.id);
      if (result) {
        this.applyReconcileResult(task.id, result);
      } else {
        this.recordReconcileInconclusive(task.id, 'reconcile_threw');
      }
    } finally {
      endStoreOperation(this.normalizedStorePath);
    }
  }

  private applyAttemptOutcome(taskId: string, outcome: PublishAttemptOutcome): void {
    const at = this.clock();
    this.mutate((draft) => {
      const task = draft.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      // 人工决议已写入终态后，迟到的执行器结果必须丢弃，不得覆盖终态。
      if (TERMINAL_STATES.has(task.state)) return;
      // AbortSignal 只能请求停止；适配器返回的普通失败也无法证明远端没有受理。
      // 取消上传后先核对，避免把可能已发布的作品误记为已取消。
      if (task.cancelRequested && outcome.kind !== 'submitted') {
        this.transition(task, 'unknown_submission', { at, errorCode: 'cancelled_upload_uncertain' });
        task.leaseUntil = null;
        task.nextAttemptAt = null;
        task.nextReconcileAt = at;
        return;
      }
      if (
        (outcome.kind === 'failed' || outcome.kind === 'throttled' ||
          outcome.kind === 'needs_login' || outcome.kind === 'needs_user_action') &&
        outcome.confirmedNotSubmitted !== true
      ) {
        this.transition(task, 'unknown_submission', { at, errorCode: 'submission_not_ruled_out' });
        task.leaseUntil = null;
        task.nextAttemptAt = null;
        task.nextReconcileAt = at;
        return;
      }
      switch (outcome.kind) {
        case 'submitted': {
          if (!isNonEmptyString(outcome.remoteId)) {
            this.transition(task, 'unknown_submission', { at, errorCode: 'submitted_without_remote_id' });
            task.leaseUntil = null;
            task.nextReconcileAt = at;
            return;
          }
          this.transition(task, 'verifying', { at, errorCode: null, remoteId: outcome.remoteId });
          task.remoteResult = {
            remoteId: outcome.remoteId,
            remoteUrl: outcome.remoteUrl ?? null,
            finalState: 'unknown',
            verifiedAt: null,
          };
          task.leaseUntil = null;
          task.nextAttemptAt = null;
          task.nextReconcileAt = at;
          return;
        }
        case 'failed': {
          const code = sanitizeSafeCode(outcome.errorCode, 'executor_failed');
          task.leaseUntil = null;
          if (outcome.retryable === true && task.attempt < this.retryPolicy.maxAttempts) {
            this.transition(task, 'retryable_failure', { at, errorCode: code });
            task.nextAttemptAt = at + this.backoffFor(task.attempt);
            return;
          }
          this.transition(task, 'terminal_failure', {
            at,
            errorCode: task.attempt >= this.retryPolicy.maxAttempts ? 'attempts_exhausted' : code,
          });
          return;
        }
        case 'throttled': {
          const code = sanitizeSafeCode(outcome.errorCode, 'throttled');
          task.leaseUntil = null;
          if (task.attempt >= this.retryPolicy.maxAttempts) {
            this.transition(task, 'terminal_failure', { at, errorCode: 'attempts_exhausted' });
            return;
          }
          const retryAfterMs = outcome.retryAfterMs;
          const delay =
            isFiniteNumber(retryAfterMs) && retryAfterMs >= 0
              ? retryAfterMs
              : this.backoffFor(task.attempt);
          this.transition(task, 'retryable_failure', { at, errorCode: code });
          task.nextAttemptAt = at + delay;
          return;
        }
        case 'needs_login': {
          this.transition(task, 'needs_login', { at, errorCode: sanitizeSafeCode(outcome.errorCode, 'login_required') });
          task.leaseUntil = null;
          task.nextAttemptAt = null;
          return;
        }
        case 'needs_user_action': {
          this.transition(task, 'needs_user_action', {
            at,
            errorCode: sanitizeSafeCode(outcome.errorCode, 'needs_user_action'),
          });
          task.leaseUntil = null;
          task.nextAttemptAt = null;
          return;
        }
        case 'unknown': {
          this.transition(task, 'unknown_submission', {
            at,
            errorCode: sanitizeSafeCode(outcome.errorCode, 'unknown_submission'),
          });
          task.leaseUntil = null;
          task.nextReconcileAt = at;
          return;
        }
      }
    });
  }

  private applyReconcileResult(taskId: string, result: ReconcileResult): void {
    const at = this.clock();
    this.mutate((draft) => {
      const task = draft.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      // 任务已被人工决议等并发操作移出可核对状态时，迟到的核对结果必须丢弃：
      // 不得覆盖人工持久化决定，也不得触发非法迁移使本轮 tick 抛错。
      if (!RECONCILABLE_STATES.has(task.state)) return;
      task.reconcileAttempts += 1;
      const priorRemoteId = task.remoteResult?.remoteId ?? null;
      if (result.finalState === 'published') {
        const remoteId = result.remoteId ?? priorRemoteId;
        this.transition(task, 'published', { at, errorCode: null, remoteId });
        task.remoteResult = {
          remoteId,
          remoteUrl: result.remoteUrl ?? task.remoteResult?.remoteUrl ?? null,
          finalState: 'published',
          verifiedAt: at,
        };
        task.leaseUntil = null;
        task.nextAttemptAt = null;
        task.nextReconcileAt = null;
        return;
      }
      if (result.finalState === 'failed') {
        const remoteId = result.remoteId ?? priorRemoteId;
        const code = sanitizeSafeCode(result.errorCode, 'remote_failed');
        if (result.confirmedNotPublished !== true) {
          task.remoteResult = {
            remoteId,
            remoteUrl: result.remoteUrl ?? task.remoteResult?.remoteUrl ?? null,
            finalState: 'unknown',
            verifiedAt: at,
          };
          this.transition(task, 'unknown_submission', { at, errorCode: 'remote_failure_unconfirmed', remoteId });
          task.leaseUntil = null;
          task.nextReconcileAt = task.reconcileAttempts >= this.retryPolicy.maxReconcileAttempts
            ? null : at + this.backoffFor(task.reconcileAttempts);
          return;
        }
        task.remoteResult = {
          remoteId,
          remoteUrl: result.remoteUrl ?? task.remoteResult?.remoteUrl ?? null,
          finalState: 'failed',
          verifiedAt: at,
        };
        task.leaseUntil = null;
        task.nextReconcileAt = null;
        // 已请求取消且核对确认远端没有产物：按用户意图终止，不自动重发。
        if (task.cancelRequested) {
          this.transition(task, 'cancelled', { at, errorCode: 'cancelled_after_request' });
          return;
        }
        // 只有核对确认「远端没有产物」（remoteId 为空）时才允许重新提交，避免重复作品。
        if (result.retryable === true && remoteId === null && task.attempt < this.retryPolicy.maxAttempts) {
          if (task.commerceRequest !== null) {
            // 挂车任务绝不能借“核对确认未发布”降级为普通发布，隔离等待人工移除请求。
            this.transition(task, 'needs_user_action', { at, errorCode: 'commerce_blocked' });
            task.nextAttemptAt = null;
          } else {
            this.transition(task, 'retryable_failure', { at, errorCode: code });
            task.nextAttemptAt = at + this.backoffFor(task.attempt);
          }
        } else {
          this.transition(task, 'terminal_failure', { at, errorCode: code });
        }
        return;
      }
      const remoteId = result.remoteId ?? priorRemoteId;
      task.remoteResult = {
        remoteId,
        remoteUrl: result.remoteUrl ?? task.remoteResult?.remoteUrl ?? null,
        finalState: 'unknown',
        verifiedAt: at,
      };
      this.transition(task, 'unknown_submission', {
        at,
        errorCode: sanitizeSafeCode(result.errorCode, 'remote_unknown'),
        remoteId,
      });
      task.leaseUntil = null;
      task.nextReconcileAt =
        task.reconcileAttempts >= this.retryPolicy.maxReconcileAttempts
          ? null
          : at + this.backoffFor(task.reconcileAttempts);
    });
  }

  private recordReconcileInconclusive(taskId: string, errorCode: string): void {
    const at = this.clock();
    this.mutate((draft) => {
      const task = draft.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      // 已离开可核对状态的任务不再接受迟到核对的重入记录。
      if (!RECONCILABLE_STATES.has(task.state)) return;
      task.reconcileAttempts += 1;
      this.transition(task, task.state, { at, errorCode: sanitizeSafeCode(errorCode, 'reconcile_failed') });
      task.nextReconcileAt =
        task.reconcileAttempts >= this.retryPolicy.maxReconcileAttempts
          ? null
          : at + this.backoffFor(task.reconcileAttempts);
    });
  }

  private backoffFor(attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    return Math.min(this.retryPolicy.maxBackoffMs, this.retryPolicy.baseBackoffMs * 2 ** exponent);
  }

  // ————————————————————————————— 人工操作 —————————————————————————————

  /** 取消尚未提交的任务；执行中的任务转为取消请求并中止执行器。 */
  cancel(taskId: string): boolean {
    const task = this.requireTask(taskId);
    if (TERMINAL_STATES.has(task.state)) return false;
    const at = this.clock();
    if (task.state === 'uploading') {
      const entry = this.running.get(taskId);
      this.mutate((draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === taskId);
        if (target && !target.cancelRequested) {
          target.cancelRequested = true;
          target.updatedAt = at;
        }
      });
      entry?.controller.abort();
      return true;
    }
    if (!CANCELLABLE_PRE_EXECUTION.has(task.state)) {
      throw new DurableQueueError(
        'invalid_transition',
        `已提交或提交不明的任务不能直接取消（当前 ${task.state}），请先核对远端`,
      );
    }
    this.mutate((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === taskId);
      if (target) this.transition(target, 'cancelled', { at, errorCode: 'cancelled_by_request' });
    });
    return true;
  }

  /** 登录 / 权限 / 验证码等外部阻塞解除后重新排队；CommerceRequest 非空时拒绝。 */
  resumeTask(taskId: string): boolean {
    const task = this.requireTask(taskId);
    if (task.state !== 'needs_login' && task.state !== 'needs_permission' && task.state !== 'needs_user_action') {
      throw new DurableQueueError('invalid_transition', `状态 ${task.state} 的任务不能恢复排队`);
    }
    if (task.commerceRequest !== null) {
      throw new DurableQueueError(
        'commerce_blocked',
        '携带 CommerceRequest 的任务必须由用户显式移除请求并另建任务，禁止恢复为普通发布',
      );
    }
    const at = this.clock();
    this.mutate((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === taskId);
      if (!target) return;
      this.transition(target, 'queued', { at, errorCode: null });
      target.nextAttemptAt = at;
      target.nextReconcileAt = null;
    });
    return true;
  }

  /** 把退避中的可重试任务立即提前；未知提交必须先核对，禁止直接重试。 */
  retryNow(taskId: string): boolean {
    const task = this.requireTask(taskId);
    if (task.state === 'unknown_submission') {
      throw new DurableQueueError('invalid_transition', '未知提交必须先经远端核对，禁止直接重试');
    }
    if (task.state !== 'retryable_failure') {
      throw new DurableQueueError('invalid_transition', `状态 ${task.state} 的任务不能立即重试`);
    }
    const at = this.clock();
    this.mutate((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === taskId);
      if (target) target.nextAttemptAt = at;
    });
    return true;
  }

  /**
   * 人工接管未知提交 / 核对中任务：只有明确 published 或 failed（无远端产物才可重试）才会终结。
   */
  applyManualResolution(taskId: string, resolution: QueueManualResolution): DurablePublishTaskV1 {
    const task = this.requireTask(taskId);
    if (task.state !== 'unknown_submission' && task.state !== 'verifying') {
      throw new DurableQueueError('invalid_transition', `状态 ${task.state} 的任务不需要人工解决`);
    }
    if (!isRecord(resolution) || (resolution.finalState !== 'published' && resolution.finalState !== 'failed')) {
      throw new DurableQueueError('invalid_task_input', '人工解决必须给出 published 或 failed');
    }
    if (resolution.finalState === 'failed' && resolution.confirmedNotPublished !== true) {
      throw new DurableQueueError('invalid_task_input', '人工判定失败前必须明确确认远端没有发布');
    }
    const actor = sanitizeSafeCode(resolution.resolvedBy, '');
    if (actor === '') {
      throw new DurableQueueError('invalid_task_input', 'resolvedBy 必须为安全标识（[a-z0-9_.-]）');
    }
    const at = this.clock();
    this.mutate((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === taskId);
      if (!target) return;
      target.reconcileAttempts += 1;
      const priorRemoteId = target.remoteResult?.remoteId ?? null;
      if (resolution.finalState === 'published') {
        const remoteId = resolution.remoteId ?? priorRemoteId;
        this.transition(target, 'published', { at, errorCode: null, remoteId, actor });
        target.remoteResult = {
          remoteId,
          remoteUrl: resolution.remoteUrl ?? target.remoteResult?.remoteUrl ?? null,
          finalState: 'published',
          verifiedAt: at,
        };
      } else {
        const remoteId = resolution.remoteId ?? priorRemoteId;
        const code = sanitizeSafeCode(resolution.errorCode, 'manual_resolution_failed');
        target.remoteResult = {
          remoteId,
          remoteUrl: resolution.remoteUrl ?? target.remoteResult?.remoteUrl ?? null,
          finalState: 'failed',
          verifiedAt: at,
        };
        if (target.cancelRequested) {
          this.transition(target, 'cancelled', { at, errorCode: 'cancelled_after_request', actor });
        } else if (resolution.retryable === true && remoteId === null && target.attempt < this.retryPolicy.maxAttempts) {
          this.transition(target, 'retryable_failure', { at, errorCode: code, actor });
          target.nextAttemptAt = at + this.backoffFor(target.attempt);
        } else {
          this.transition(target, 'terminal_failure', { at, errorCode: code, actor });
        }
      }
      target.leaseUntil = null;
      target.nextReconcileAt = null;
    });
    return cloneTask(this.requireTask(taskId));
  }

  // ————————————————————————————— 内部工具 —————————————————————————————

  private load(): DurableQueueFileV1 {
    if (!existsSync(this.storePath)) {
      this.expectedStoreDigest = null;
      const at = this.clock();
      return { schemaVersion: DURABLE_QUEUE_SCHEMA_VERSION, updatedAt: at, tasks: [] };
    }
    let raw: string;
    try {
      raw = readFileSync(this.storePath, 'utf-8');
    } catch {
      throw new DurableQueueError(
        'store_read_failed',
        '发布队列存储不可读，已拒绝按空存储加载且未改动原文件',
      );
    }
    const loaded = parsePersistedStore(raw);
    this.expectedStoreDigest = sha256Hex(raw);
    const at = this.clock();
    const draft = structuredClone(loaded);
    let recovered = false;
    for (const task of draft.tasks) {
      // 挂车任务绝不能停留在可执行 / 上传 / 核对态：加载即隔离，等待人工移除请求。
      if (task.commerceRequest !== null && (
        EXECUTABLE_STATES.has(task.state) ||
        RECONCILABLE_STATES.has(task.state) ||
        task.state === 'uploading'
      )) {
        this.transition(task, 'needs_user_action', { at, errorCode: 'commerce_blocked_recovered' });
        task.leaseUntil = null;
        task.nextAttemptAt = null;
        task.nextReconcileAt = null;
        recovered = true;
      }
      // uploading 不在加载时改写：真实重启必须等租约到期后由 tick 转 unknown_submission，
      // 打开新实例不得抹掉其他实例尚未结束的租约或领取快照。
    }
    if (recovered) {
      draft.updatedAt = at;
      this.persist(draft);
      return draft;
    }
    return loaded;
  }

  /**
   * 写盘前核验磁盘字节与上一次读写是否一致：外部实例改写后拒绝用陈旧快照整库覆盖。
   * 这是同进程守卫，不是跨进程原子 CAS（见文件头边界说明）。
   */
  private assertStoreUnchanged(): void {
    let actual: string | null;
    if (!existsSync(this.storePath)) {
      actual = null;
    } else {
      try {
        actual = sha256Hex(readFileSync(this.storePath, 'utf-8'));
      } catch (err) {
        throw new DurableQueueError(
          'store_write_failed',
          '发布队列存储当前不可读，拒绝继续写入',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    if (actual !== this.expectedStoreDigest) {
      throw new DurableQueueError(
        'store_changed_externally',
        '发布队列存储已被其他实例改写，拒绝用陈旧快照整库覆盖',
      );
    }
  }

  private requireTask(taskId: string): DurablePublishTaskV1 {
    const task = this.file.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new DurableQueueError('task_not_found', `任务不存在：${taskId}`);
    }
    return task;
  }

  private transition(
    task: DurablePublishTaskV1,
    to: QueueTaskState,
    options: { at: number; errorCode?: string | null; remoteId?: string | null; actor?: string | null },
  ): void {
    const from = task.state;
    if (from !== to && !ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new DurableQueueError('invalid_transition', `不允许的状态迁移：${from} → ${to}`, task.id);
    }
    task.state = to;
    task.updatedAt = options.at;
    task.stateChangedAt = options.at;
    if ('errorCode' in options) task.lastErrorCode = options.errorCode ?? null;
    task.history.push({
      at: options.at,
      from,
      to,
      attempt: task.attempt,
      errorCode: options.errorCode ?? null,
      remoteId: options.remoteId ?? task.remoteResult?.remoteId ?? null,
      actor: options.actor ?? null,
    });
  }

  private mutate<T>(fn: (draft: DurableQueueFileV1) => T): T {
    this.assertStoreUnchanged();
    const draft = structuredClone(this.file);
    const result = fn(draft);
    draft.updatedAt = this.clock();
    this.persist(draft);
    this.file = draft;
    return result;
  }

  /** 原子写盘：同目录临时文件写入 + fsync 后 rename 覆盖；失败时保留旧文件。 */
  private persist(file: DurableQueueFileV1): void {
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.storePath}.tmp-${process.pid}-${randomUUID()}`;
    const payload = `${JSON.stringify(file, null, 2)}\n`;
    let fd: number | null = null;
    let ownedTmp = false;
    try {
      fd = openSync(tmpPath, 'wx');
      ownedTmp = true;
      writeFileSync(fd, payload, 'utf-8');
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmpPath, this.storePath);
      this.expectedStoreDigest = sha256Hex(payload);
    } catch (err) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // 忽略关闭失败，继续尝试清理临时文件。
        }
      }
      if (ownedTmp) {
        try {
          rmSync(tmpPath, { force: true });
        } catch {
          // 临时文件清理失败不影响旧文件完整性。
        }
      }
      throw new DurableQueueError(
        'store_write_failed',
        '发布队列存储原子写入失败，旧文件保持不变',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export function openDurableQueue(options: DurableQueueOptions): DurablePublishQueue {
  return new DurablePublishQueue(options);
}

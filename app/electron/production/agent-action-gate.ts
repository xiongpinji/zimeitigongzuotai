/**
 * app/electron/production/agent-action-gate.ts
 *
 * P4-1 第一段：九类生产动作的预授权活动门控（纯函数，无副作用）。
 *
 * 定位与边界：
 * - 本模块只回答一个问题：在某个「预授权活动」快照下，Agent 请求的某类生产动作
 *   当前是否被允许。它不执行动作、不写文件、不读系统时间、不访问网络、不读取
 *   账号会话 / Cookie / 素材 / 队列存储。
 * - `grant`（活动快照）只能由未来受信任的 Electron main 从本地存储装载并注入；
 *   绝不能来自 Agent 工具参数或 renderer 自报。本轮不实现 grant 发行、持久化或 UI。
 * - 本门控通过不代表账号登录有效、素材已授权、质检合格或远端发布成功；
 *   这些必须由后续各阶段独立检查。`queue_publish` 只针对普通视频：
 *   `commerceRequest` 非 null 一律拒绝。
 * - 三个入参都按不可信输入做运行时校验（失败关闭）：调用方跨进程 / 跨存储边界时
 *   可能存在损坏或伪造数据。类型接口只描述未来受信任调用方应构造的形状。
 *
 * 判定次序（稳定，便于审计与测试；先命中先返回）：
 *   1. request_invalid / unknown_action  请求结构与动作枚举
 *   2. grant_missing / grant_invalid     grant 存在性与结构
 *   3. clock_invalid                     注入时钟
 *   4. grant_not_yet_valid / grant_expired  活动时间窗
 *   5. project_mismatch                  项目一致
 *   6. action_not_allowed                动作在授权列表内
 *   7. （非发布动作到此为止，直接允许；不要求账号 / 平台）
 *   8. account_not_allowed               账号在活动范围
 *   9. platform_not_allowed              平台在活动范围
 *  10. auto_publish_disabled             autoPublish 显式为 true
 *  11. used_jobs_invalid / publish_quota_exceeded  requested <= max - used（安全减法）
 *  12. commerce_not_supported            commerceRequest 显式 null
 *
 * 时间边界：nowMs < issuedAtMs → 未生效；nowMs >= expiresAtMs → 已过期
 *（发行时刻本身生效，失效时刻本身即过期）。时间、额度一律来自注入 context；
 * 本模块不读取系统时间或存储。
 *
 * 数值边界（第二轮定向修复）：requestedJobs 必须是正安全整数，usedQueuedJobs 与
 * maxQueuedJobs 必须是非负安全整数（0 .. Number.MAX_SAFE_INTEGER）。不能用
 * Number.isInteger：它会把 1e308 和 MAX_SAFE_INTEGER+1 也视作整数，超出安全范围后
 * 相邻计数可能相等，配额无法可靠执行。配额比较用 `requestedJobs > maxQueuedJobs -
 * usedQueuedJobs`（两个非负安全整数之差仍在安全范围内，不会溢出）；当
 * usedQueuedJobs > maxQueuedJobs 时剩余额度为负，任何正请求数都被拒绝。
 *
 * 本门控是单次纯判定，不占用、不预留任何配额，并发调用之间互不感知。未来接入
 * 并发发布队列时，必须在受信任 Electron main 的事务 / 锁内重新校验并原子预留
 * 配额，不得把本函数的通过结果直接当作已入队凭证。
 *
 * 拒绝结果只含稳定机器码，不含 Cookie / 路径 / 账号 / 原始输入；调用方不得把原始
 * 请求或异常文本写进日志。本模块未接 MCP / IPC / Agent runtime / 发布队列。
 */

import {
  PRODUCTION_PLATFORMS,
} from '../../src/types/production-contracts';
import type {
  CommerceRequestV1,
  ProductionPlatform,
} from '../../src/types/production-contracts';

// ——————————————————————————————— 动作类型 ———————————————————————————————

/**
 * 九类生产动作（顺序稳定）：
 * - 创作动作：导入录屏、找高光、调整高光、检索授权素材、搭建混剪计划、
 *   编辑时间线、渲染版本、质检；
 * - 发布动作：`queue_publish`（仅普通视频，需活动显式打开自动发布）。
 */
export const AGENT_PRODUCTION_ACTIONS = Object.freeze([
  'import_recordings',
  'detect_highlights',
  'adjust_highlights',
  'search_authorized_assets',
  'build_compositions',
  'edit_timeline',
  'render_variants',
  'quality_check',
  'queue_publish',
] as const);

export type AgentProductionAction = (typeof AGENT_PRODUCTION_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(AGENT_PRODUCTION_ACTIONS);
const PLATFORM_SET: ReadonlySet<string> = new Set(PRODUCTION_PLATFORMS);

/** 运行时动作枚举守卫：只认九类动作字符串。 */
export function isAgentProductionAction(value: unknown): value is AgentProductionAction {
  return typeof value === 'string' && ACTION_SET.has(value);
}

// ——————————————————————————————— 注入契约 ———————————————————————————————

/**
 * 预授权活动快照（由未来受信任 Electron main 存储 / 装载后注入；不得由 Agent 自报）。
 * 字段为最小集合：项目、有效期、允许动作、允许账号、允许平台、自动发布开关、排队上限。
 */
export interface ProductionActivityGrantV1 {
  /** 活动所属 Lingji 项目 ID；必须与请求项目一致。 */
  readonly projectId: string;
  /** 发行时间（epoch ms，有限数字）。 */
  readonly issuedAtMs: number;
  /** 失效时间（epoch ms，有限数字，必须严格晚于 issuedAtMs）。 */
  readonly expiresAtMs: number;
  /** 明确允许的动作；未列出的动作一律拒绝。 */
  readonly allowedActions: readonly AgentProductionAction[];
  /** 允许发布到的账号 ID 列表（创作动作不需要账号）。 */
  readonly accountIds: readonly string[];
  /** 允许发布的平台列表。 */
  readonly platforms: readonly ProductionPlatform[];
  /** 只有显式为 true 且 queue_publish 已授权时才允许自动排队发布。 */
  readonly autoPublish: boolean;
  /** 活动内最多允许排队的任务数（非负安全整数，含已用量）。 */
  readonly maxQueuedJobs: number;
}

/** 门控上下文：由接线方注入时钟与队列已用量，门控不读取系统时间或文件。 */
export interface AgentActionGateContext {
  /** 注入时钟（epoch ms）；非法时默认拒绝。 */
  readonly nowMs: number;
  /** 活动内已占用的排队任务数（非负安全整数）；仅发布动作校验。 */
  readonly usedQueuedJobs: number;
}

/** 非发布创作动作的最小请求：项目 + 动作。 */
export interface CreativeAgentActionRequest {
  readonly action: Exclude<AgentProductionAction, 'queue_publish'>;
  readonly projectId: string;
}

/**
 * 普通视频排队发布请求。`commerceRequest` 字段必须显式存在：
 * 普通发布为 `null`，任何非 null 值一律拒绝（绝不静默降级为普通发布）。
 */
export interface QueuePublishActionRequest {
  readonly action: 'queue_publish';
  readonly projectId: string;
  readonly accountId: string;
  readonly platform: ProductionPlatform;
  /** 拟排队任务数（正安全整数，<= Number.MAX_SAFE_INTEGER）。 */
  readonly requestedJobs: number;
  readonly commerceRequest: CommerceRequestV1 | null;
}

export type AgentProductionActionRequest = CreativeAgentActionRequest | QueuePublishActionRequest;

// ——————————————————————————————— 判定结果 ———————————————————————————————

/** 稳定拒绝码（仅机器码；新增需同步测试与验证文档）。 */
export const AGENT_ACTION_GATE_DENIAL_CODES = Object.freeze([
  'request_invalid',
  'unknown_action',
  'grant_missing',
  'grant_invalid',
  'clock_invalid',
  'grant_not_yet_valid',
  'grant_expired',
  'project_mismatch',
  'action_not_allowed',
  'account_not_allowed',
  'platform_not_allowed',
  'auto_publish_disabled',
  'used_jobs_invalid',
  'publish_quota_exceeded',
  'commerce_not_supported',
] as const);

export type AgentActionGateDenialCode = (typeof AGENT_ACTION_GATE_DENIAL_CODES)[number];

/**
 * 判定结果：允许时只有 `{ allowed: true }`；拒绝时只有稳定机器码 `reason`。
 * 拒绝结果不含账号 / 项目 / 路径 / Cookie 或任何原始输入。
 */
export type AgentActionGateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: AgentActionGateDenialCode };

// ——————————————————————————————— 纯工具 ———————————————————————————————

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: AgentActionGateDenialCode };

function deny(reason: AgentActionGateDenialCode): AgentActionGateDecision {
  return { allowed: false, reason };
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

/**
 * 配额计数必须是安全整数（|v| <= Number.MAX_SAFE_INTEGER）：Number.isInteger 会把
 * 1e308 和 MAX_SAFE_INTEGER+1 也视作整数，超出安全范围后相邻计数可能相等，
 * 配额比较不可靠，因此这里一律用 Number.isSafeInteger 失败关闭。
 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

// ——————————————————————————————— 输入解析 ———————————————————————————————

interface ParsedQueuePublish {
  readonly accountId: string;
  readonly platform: ProductionPlatform;
  readonly requestedJobs: number;
  /** 仅区分「显式 null」；任何非 null 值在后续统一拒绝。 */
  readonly commerceRequestPresent: boolean;
}

interface ParsedRequest {
  readonly action: AgentProductionAction;
  readonly projectId: string;
  readonly queue: ParsedQueuePublish | null;
}

function parseRequest(request: unknown): ParseResult<ParsedRequest> {
  if (!isRecord(request)) return { ok: false, reason: 'request_invalid' };
  const action = request.action;
  if (typeof action !== 'string') return { ok: false, reason: 'request_invalid' };
  if (!isAgentProductionAction(action)) return { ok: false, reason: 'unknown_action' };
  if (!isNonEmptyString(request.projectId)) return { ok: false, reason: 'request_invalid' };
  const projectId = request.projectId;

  if (action !== 'queue_publish') {
    return { ok: true, value: { action, projectId, queue: null } };
  }

  if (!isNonEmptyString(request.accountId)) return { ok: false, reason: 'request_invalid' };
  const platform = request.platform;
  if (typeof platform !== 'string' || !PLATFORM_SET.has(platform)) {
    return { ok: false, reason: 'request_invalid' };
  }
  if (!isPositiveSafeInteger(request.requestedJobs)) return { ok: false, reason: 'request_invalid' };
  if (!('commerceRequest' in request)) return { ok: false, reason: 'request_invalid' };

  return {
    ok: true,
    value: {
      action,
      projectId,
      queue: {
        accountId: request.accountId,
        platform: platform as ProductionPlatform,
        requestedJobs: request.requestedJobs,
        commerceRequestPresent: request.commerceRequest !== null,
      },
    },
  };
}

function parseGrant(grant: unknown): ParseResult<ProductionActivityGrantV1> {
  if (grant === null || grant === undefined) return { ok: false, reason: 'grant_missing' };
  if (!isRecord(grant)) return { ok: false, reason: 'grant_invalid' };
  if (!isNonEmptyString(grant.projectId)) return { ok: false, reason: 'grant_invalid' };
  if (!isFiniteNumber(grant.issuedAtMs) || !isFiniteNumber(grant.expiresAtMs)) {
    return { ok: false, reason: 'grant_invalid' };
  }
  if (grant.expiresAtMs <= grant.issuedAtMs) return { ok: false, reason: 'grant_invalid' };
  if (!Array.isArray(grant.allowedActions) || grant.allowedActions.some((action) => !isAgentProductionAction(action))) {
    return { ok: false, reason: 'grant_invalid' };
  }
  if (!Array.isArray(grant.accountIds) || grant.accountIds.some((accountId) => !isNonEmptyString(accountId))) {
    return { ok: false, reason: 'grant_invalid' };
  }
  if (
    !Array.isArray(grant.platforms) ||
    grant.platforms.some((platform) => typeof platform !== 'string' || !PLATFORM_SET.has(platform))
  ) {
    return { ok: false, reason: 'grant_invalid' };
  }
  if (typeof grant.autoPublish !== 'boolean') return { ok: false, reason: 'grant_invalid' };
  if (!isNonNegativeSafeInteger(grant.maxQueuedJobs)) return { ok: false, reason: 'grant_invalid' };

  return {
    ok: true,
    value: {
      projectId: grant.projectId,
      issuedAtMs: grant.issuedAtMs,
      expiresAtMs: grant.expiresAtMs,
      allowedActions: [...grant.allowedActions] as AgentProductionAction[],
      accountIds: [...grant.accountIds],
      platforms: [...grant.platforms] as ProductionPlatform[],
      autoPublish: grant.autoPublish,
      maxQueuedJobs: grant.maxQueuedJobs,
    },
  };
}

// ——————————————————————————————— 门控主函数 ———————————————————————————————

/**
 * 判定一次生产动作是否被预授权活动允许。无副作用纯函数。
 *
 * 三个入参均按不可信输入校验并失败关闭；拒绝结果只含稳定机器码。
 * 判定次序与时间 / 配额边界见文件头注释。
 */
export function evaluateAgentProductionAction(
  request: unknown,
  grant: unknown,
  context: unknown,
): AgentActionGateDecision {
  const parsedRequest = parseRequest(request);
  if (!parsedRequest.ok) return deny(parsedRequest.reason);

  const parsedGrant = parseGrant(grant);
  if (!parsedGrant.ok) return deny(parsedGrant.reason);

  if (!isRecord(context) || !isFiniteNumber(context.nowMs)) return deny('clock_invalid');
  const nowMs = context.nowMs;
  const activity = parsedGrant.value;

  if (nowMs < activity.issuedAtMs) return deny('grant_not_yet_valid');
  if (nowMs >= activity.expiresAtMs) return deny('grant_expired');
  if (parsedRequest.value.projectId !== activity.projectId) return deny('project_mismatch');
  if (!activity.allowedActions.includes(parsedRequest.value.action)) return deny('action_not_allowed');

  const queue = parsedRequest.value.queue;
  // 非发布创作动作：活动授权 + 项目 + 时间窗即可，不需要账号 / 平台 / 配额。
  if (queue === null) return { allowed: true };

  if (!activity.accountIds.includes(queue.accountId)) return deny('account_not_allowed');
  if (!activity.platforms.includes(queue.platform)) return deny('platform_not_allowed');
  if (activity.autoPublish !== true) return deny('auto_publish_disabled');
  if (!isNonNegativeSafeInteger(context.usedQueuedJobs)) return deny('used_jobs_invalid');
  // 安全比较：三个字段均已确认为安全整数，max - used 的结果不会溢出；
  // used > max 时剩余额度为负，任何正 requestedJobs 都被拒绝。
  // 等价于 used + requested > max，但避免非安全范围浮点加法取整放行。
  if (queue.requestedJobs > activity.maxQueuedJobs - context.usedQueuedJobs) {
    return deny('publish_quota_exceeded');
  }
  if (queue.commerceRequestPresent) return deny('commerce_not_supported');

  return { allowed: true };
}
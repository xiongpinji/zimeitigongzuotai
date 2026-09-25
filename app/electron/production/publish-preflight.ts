/**
 * app/electron/production/publish-preflight.ts
 *
 * P4-2 有界实现：普通视频发布的**本地预检**（纯函数、离线、fail-closed）。
 *
 * 定位与边界：
 * - 只回答一个问题：给定一份生产 sidecar 文档（ProductionDocumentV1）与一个已存在的
 *   发布任务 ID，该任务是否满足**本地可静态判定**的全部普通视频发布条件：
 *   文档结构、任务状态、商品请求拦截、账号快照、质检 / 渲染引用、计划内容与素材
 *   授权标志。
 * - 成功状态命名为 `ready_for_live_checks`，**永远不是** `authorized_to_publish`：
 *   通过本地预检只代表可以进入实时检查阶段。以下检查仍是后续阶段的强制义务，
 *   本模块一概不执行，只在成功结果中作为未决清单显式列出：
 *     trusted_campaign_grant               P4-1 预授权活动门控（受信任 main 注入）
 *     live_account_session                 账号实时登录 / 会话探针
 *     source_rights                        v1 素材授权标志之外的来源权利核验
 *     platform_permission_and_user_awareness 平台应用权限与每次发布的用户可感知交互
 *     output_file_integrity                渲染产物文件字节与 outputSha256 的一致性
 *     remote_final_state                   提交后的平台远端最终状态核验
 * - 本模块不调用队列 / IPC / Agent / MCP，不触碰 Cookie 或原始会话存储态，不读文件、
 *   不访问网络、不调用平台、不改写输入文档。账号快照检查（status==='active' 且
 *   sessionRef 非 null）**不是**实时登录探针；sessionRef 只按不透明字符串对待。
 * - 商品请求没有任何降级路径：commerceRequest 非严格 null 一律阻止，`required:false`
 *   同样阻止，绝不把商品任务静默转换为普通发布。
 * - 来源权利只认 AssetV1.authorizedForAutoUse === true；不从自由文本 usageScope 推断
 *   任何平台权利，也不因录屏 / 高光出现在 sidecar 中而视其权利已清（该核验属于
 *   未决项 source_rights）。
 *
 * 输入与 fail-closed：
 * - documentInput 按不可信 unknown 处理，经 parseProductionDocument 完整重校验，
 *   不信任调用方的 TypeScript 类型标注。
 * - 解析异常只映射为稳定机器码（ProductionContractError → document_invalid；
 *   其他任何意外异常 → preflight_error），绝不回显异常文本、JSON 路径、账号 ID、
 *   标题、Token 或原始输入内容。本函数自身从不抛异常。
 * - 解析器已保证引用完整性与实体唯一性；即便如此，任何意外的引用缺失仍显式
 *   失败关闭（reference_missing），不带病预检。
 * - 阻止结果只含 `{ status: 'blocked', reason }`；成功结果只含
 *   `{ status: 'ready_for_live_checks', pendingChecks }`，两者均运行时冻结。
 *
 * 判定次序（稳定，先命中先返回；由测试固定）：
 *   1. job_id_invalid                publishJobId 必须是非空白字符串
 *   2. document_invalid / preflight_error   v1 文档解析
 *   3. job_not_found                 任务 ID 存在于 publishJobs
 *   4. job_state_not_preflightable   state ∈ {draft, preflight}；queued / submitted /
 *                                    published / unknown_submission 等一律阻止且永不
 *                                    在本地重试（未知提交必须先查远端）
 *   5. commerce_request_present      commerceRequest 严格为 null
 *   6. account_not_active / account_session_missing   账号快照 active 且 sessionRef 非 null
 *   7. variant_not_qc_passed / variant_output_missing / variant_duration_invalid /
 *      variant_timeline_missing      质检通过、产物引用与哈希非 null、时长为正、
 *                                    可编辑时间线引用非 null
 *   8. plan_empty / plan_timeline_missing / plan_timeline_mismatch
 *                                    至少一个分段；计划时间线引用非 null 且与版本一致
 *   9. asset_not_authorized          每个 kind:'asset' 分段解析到 authorizedForAutoUse === true
 *  10. ready_for_live_checks         全部本地条件通过（仍附六项未决检查）
 *
 * 本模块没有调用方接线：不注册 IPC、不进入队列、不暴露给 Agent runtime。
 * 通过本地预检不构成任何平台「原创」认定、平台接受或发布成功承诺。
 */

import {
  ProductionContractError,
  parseProductionDocument,
} from '../../src/lib/production-document';
import type { ProductionDocumentV1 } from '../../src/types/production-contracts';

// ——————————————————————————————— 结果契约 ———————————————————————————————

/**
 * 成功时仍未完成的检查（后续阶段的强制义务，非本模块执行的验证）。
 * 顺序稳定；新增需同步测试与验证文档。
 */
export const LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS = Object.freeze([
  'trusted_campaign_grant',
  'live_account_session',
  'source_rights',
  'platform_permission_and_user_awareness',
  'output_file_integrity',
  'remote_final_state',
] as const);

export type LocalPublishPreflightPendingCheck =
  (typeof LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS)[number];

/** 稳定阻止原因码（仅机器码；新增需同步测试与验证文档）。 */
export const LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS = Object.freeze([
  'job_id_invalid',
  'document_invalid',
  'job_not_found',
  'job_state_not_preflightable',
  'commerce_request_present',
  'account_not_active',
  'account_session_missing',
  'reference_missing',
  'variant_not_qc_passed',
  'variant_output_missing',
  'variant_duration_invalid',
  'variant_timeline_missing',
  'plan_empty',
  'plan_timeline_missing',
  'plan_timeline_mismatch',
  'asset_not_authorized',
  'preflight_error',
] as const);

export type LocalPublishPreflightBlockedReason =
  (typeof LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS)[number];

/** 允许进入本地预检的任务状态白名单：草稿与预检中；其余状态（含全部提交后状态）一律阻止。 */
export const LOCAL_PUBLISH_PREFLIGHTABLE_JOB_STATES = Object.freeze([
  'draft',
  'preflight',
] as const);

/**
 * 判定结果（可辨识联合）：
 * - blocked：只含稳定机器码 reason，不含任何输入内容；
 * - ready_for_live_checks：本地条件全部通过，附冻结的未决检查清单。
 *   刻意不使用 allowed / publishable / authorized 等可被误读为最终授权的形状。
 */
export type LocalPublishPreflightResult =
  | { readonly status: 'blocked'; readonly reason: LocalPublishPreflightBlockedReason }
  | {
      readonly status: 'ready_for_live_checks';
      readonly pendingChecks: readonly LocalPublishPreflightPendingCheck[];
    };

// ——————————————————————————————— 纯工具 ———————————————————————————————

function blocked(reason: LocalPublishPreflightBlockedReason): LocalPublishPreflightResult {
  return Object.freeze({ status: 'blocked', reason } as const);
}

const READY_FOR_LIVE_CHECKS_RESULT: LocalPublishPreflightResult = Object.freeze({
  status: 'ready_for_live_checks',
  pendingChecks: LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS,
} as const);

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ——————————————————————————————— 本地检查 ———————————————————————————————

/**
 * 对已通过 v1 解析的文档执行本地检查。只读取，不改写；
 * 任何意外的引用缺失都以 reference_missing 失败关闭（解析后正常不可达，属防御分支）。
 */
function evaluateParsedDocument(
  doc: ProductionDocumentV1,
  publishJobId: string,
): LocalPublishPreflightResult {
  const job = doc.publishJobs.find((candidate) => candidate.id === publishJobId);
  if (!job) return blocked('job_not_found');

  if (!(LOCAL_PUBLISH_PREFLIGHTABLE_JOB_STATES as readonly string[]).includes(job.state)) {
    return blocked('job_state_not_preflightable');
  }

  // 商品请求必须严格为 null；required:false 同样阻止，绝不降级为普通发布。
  if (job.commerceRequest !== null) return blocked('commerce_request_present');

  // 账号快照检查（不是实时登录探针；live_account_session 仍是未决项）。
  const account = doc.accounts.find((candidate) => candidate.id === job.accountId);
  if (!account) return blocked('reference_missing');
  if (account.status !== 'active') return blocked('account_not_active');
  if (account.sessionRef === null) return blocked('account_session_missing');

  // 质检与渲染产物引用检查（文件字节一致性属于未决项 output_file_integrity）。
  const variant = doc.videoVariants.find((candidate) => candidate.id === job.videoVariantId);
  if (!variant) return blocked('reference_missing');
  if (variant.status !== 'qc_passed') return blocked('variant_not_qc_passed');
  if (variant.outputRef === null || variant.outputSha256 === null) {
    return blocked('variant_output_missing');
  }
  if (variant.durationMs === null || variant.durationMs <= 0) {
    return blocked('variant_duration_invalid');
  }
  if (variant.timelineRef === null) return blocked('variant_timeline_missing');

  // 计划内容与时间线一致性检查。
  const plan = doc.compositionPlans.find((candidate) => candidate.id === variant.compositionPlanId);
  if (!plan) return blocked('reference_missing');
  if (plan.segments.length === 0) return blocked('plan_empty');
  if (plan.timelineRef === null) return blocked('plan_timeline_missing');
  if (plan.timelineRef !== variant.timelineRef) return blocked('plan_timeline_mismatch');

  // 分段来源检查：asset 分段必须显式授权；recording / highlight 只确认引用存在，
  // 其来源权利核验属于未决项 source_rights，不在此放行或推断。
  for (const segment of plan.segments) {
    const source = segment.source;
    switch (source.kind) {
      case 'asset': {
        const asset = doc.assets.find((candidate) => candidate.id === source.sourceId);
        if (!asset) return blocked('reference_missing');
        if (asset.authorizedForAutoUse !== true) return blocked('asset_not_authorized');
        break;
      }
      case 'recording': {
        if (!doc.recordings.some((candidate) => candidate.id === source.sourceId)) {
          return blocked('reference_missing');
        }
        break;
      }
      case 'highlight': {
        if (!doc.highlights.some((candidate) => candidate.id === source.sourceId)) {
          return blocked('reference_missing');
        }
        break;
      }
      default:
        // 解析器已拒绝未知来源类型；此分支为防御性失败关闭。
        return blocked('preflight_error');
    }
  }

  return READY_FOR_LIVE_CHECKS_RESULT;
}

// ——————————————————————————————— 公共 API ———————————————————————————————

/**
 * 对一个发布任务执行纯离线本地预检。无副作用；自身从不抛异常。
 *
 * @param documentInput 不可信的生产文档 JSON（unknown）；经 parseProductionDocument 重校验。
 * @param publishJobId  不可信的任务 ID（unknown）；必须是非空白字符串且存在于文档中。
 * @returns 阻止结果（稳定机器码）或 ready_for_live_checks（附冻结的未决检查清单）。
 *          成功**不代表**平台授权、登录有效、产物完整或远端发布成功。
 */
export function evaluateLocalPublishPreflight(
  documentInput: unknown,
  publishJobId: unknown,
): LocalPublishPreflightResult {
  if (!isNonBlankString(publishJobId)) return blocked('job_id_invalid');

  let doc: ProductionDocumentV1;
  try {
    doc = parseProductionDocument(documentInput);
  } catch (error) {
    // 只映射为稳定机器码；绝不携带解析器消息、路径或输入内容。
    if (error instanceof ProductionContractError) return blocked('document_invalid');
    return blocked('preflight_error');
  }

  try {
    return evaluateParsedDocument(doc, publishJobId);
  } catch {
    // 任何意外内部异常都失败关闭，不外抛、不放行。
    return blocked('preflight_error');
  }
}

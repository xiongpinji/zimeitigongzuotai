/**
 * tests/production-publish-preflight.test.ts
 *
 * P4-2 有界实现：普通视频发布的**本地预检**（纯函数、离线、fail-closed）行为测试。
 *
 * 边界：
 * - 被测实现 electron/production/publish-preflight.ts 只做本地静态判定：文档结构、
 *   任务状态、商品请求拦截、账号快照、质检/渲染引用、计划内容与素材授权标志。
 *   它不触网、不读盘、不登录、不入队、不调用平台、不改写输入文档。
 * - 通过预检的结果命名为 ready_for_live_checks，**永远不是**发布授权：平台授权、
 *   实时登录探针、来源权利、产物文件完整性与远端最终状态仍是后续阶段的未决检查。
 * - 全部输入为合成夹具；不含真实账号、Cookie、Token、素材或平台数据。
 * - 账号快照检查（status==='active' 且 sessionRef 非 null）**不是**实时登录探针。
 */

import { describe, expect, it } from 'vitest';
import {
  LOCAL_PUBLISH_PREFLIGHTABLE_JOB_STATES,
  LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS,
  LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS,
  evaluateLocalPublishPreflight,
} from '../electron/production/publish-preflight';
import type {
  LocalPublishPreflightBlockedReason,
  LocalPublishPreflightResult,
} from '../electron/production/publish-preflight';
import {
  PRODUCTION_SCHEMA_VERSION,
  PUBLISH_JOB_STATES,
} from '../src/types/production-contracts';
import type {
  AccountV1,
  AssetV1,
  CommerceRequestV1,
  CompositionPlanSegmentV1,
  CompositionPlanV1,
  HighlightV1,
  ProductionDocumentV1,
  PublishJobV1,
  RecordingV1,
  VideoVariantV1,
} from '../src/types/production-contracts';

// —— 合成夹具：全部字段显式给出，默认形态为「本地全部通过」的合法 v1 文档 ——

const PROJECT_ID = 'lingji-project-001';
const ACCOUNT_ID = 'acct-7c1f0a5e-6f6a-4b7e-9a11-2d9c8b7a6f50';
const JOB_ID = 'job-1';
const TIMELINE_REF = 'lingji:project-001#timeline';

const RECORDING_SHA = 'a3f5c8d9e0b1427f8a6c5d4e3f2019a8b7c6d5e4f3021a9b8c7d6e5f40312987';
const ASSET_SHA = '0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0';
const ASSET2_SHA = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const OUTPUT_SHA = 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321';

const SESSION_REF_VALUE = 'secure-session-store/acct-7c1f0a5e';

function makeRecording(overrides: Partial<RecordingV1> = {}): RecordingV1 {
  return {
    id: 'rec-1',
    sourceRef: 'live-capture/2026-09-20-evening.mp4',
    sourceSha256: RECORDING_SHA,
    capturedAt: '2026-09-20T19:00:00.000Z',
    durationMs: 3_600_000,
    mimeType: 'video/mp4',
    transcriptRef: 'transcripts/rec-1.srt',
    importedAt: '2026-09-21T02:00:00.000Z',
    ...overrides,
  };
}

function makeHighlight(overrides: Partial<HighlightV1> = {}): HighlightV1 {
  return {
    id: 'hl-1',
    recordingId: 'rec-1',
    startMs: 60_000,
    endMs: 120_000,
    score: 0.82,
    topic: '开场产品介绍',
    context: '主播首次展示产品核心卖点',
    evidence: [
      { kind: 'transcript', startMs: 60_000, endMs: 61_500, note: null },
      { kind: 'audio-peak', startMs: 90_000, endMs: null, note: null },
    ],
    boundaryOrigin: 'auto',
    adjustedAt: null,
    createdAt: '2026-09-21T03:00:00.000Z',
    ...overrides,
  };
}

function makeAsset(overrides: Partial<AssetV1> = {}): AssetV1 {
  return {
    id: 'asset-1',
    sha256: ASSET_SHA,
    mediaType: 'video',
    durationMs: 30_000,
    tags: ['b-roll'],
    transcript: null,
    embeddingRef: null,
    source: '自有拍摄 2026-09-18',
    rightsHolder: '本项目用户',
    license: 'proprietary',
    usageScope: '本工作台内混剪',
    authorizedForAutoUse: true,
    importedAt: '2026-09-21T02:30:00.000Z',
    ...overrides,
  };
}

function makeHighlightSegment(overrides: Partial<CompositionPlanSegmentV1> = {}): CompositionPlanSegmentV1 {
  return {
    id: 'seg-hl',
    order: 0,
    description: '高光开场',
    source: { kind: 'highlight', sourceId: 'hl-1', inMs: 60_000, outMs: 90_000 },
    ...overrides,
  };
}

function makeAssetSegment(
  assetId: string,
  overrides: Partial<CompositionPlanSegmentV1> = {},
): CompositionPlanSegmentV1 {
  return {
    id: `seg-asset-${assetId}`,
    order: 1,
    description: '授权素材 B-roll',
    source: { kind: 'asset', sourceId: assetId, inMs: 0, outMs: 10_000 },
    ...overrides,
  };
}

function makePlan(overrides: Partial<CompositionPlanV1> = {}): CompositionPlanV1 {
  return {
    id: 'cp-1',
    narrativeSummary: '高光开场加授权 B-roll 的竖屏版本',
    voiceoverKind: 'original-audio',
    aspectRatio: '9:16',
    segments: [makeHighlightSegment(), makeAssetSegment('asset-1')],
    timelineRef: TIMELINE_REF,
    createdAt: '2026-09-21T04:00:00.000Z',
    updatedAt: '2026-09-21T04:00:00.000Z',
    ...overrides,
  };
}

function makeVariant(overrides: Partial<VideoVariantV1> = {}): VideoVariantV1 {
  return {
    id: 'vv-1',
    compositionPlanId: 'cp-1',
    timelineRef: TIMELINE_REF,
    outputRef: 'renders/vv-1-final.mp4',
    outputSha256: OUTPUT_SHA,
    durationMs: 45_000,
    aspectRatio: '9:16',
    status: 'qc_passed',
    createdAt: '2026-09-21T04:10:00.000Z',
    updatedAt: '2026-09-22T08:00:00.000Z',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountV1> = {}): AccountV1 {
  return {
    id: ACCOUNT_ID,
    platform: 'douyin',
    displayName: '合成测试账号甲',
    owner: 'user-local',
    status: 'active',
    sessionRef: SESSION_REF_VALUE,
    capabilitySnapshot: { commerce: 'not_implemented' },
    lastVerifiedAt: '2026-09-22T08:00:00.000Z',
    createdAt: '2026-09-21T05:00:00.000Z',
    ...overrides,
  };
}

function makeCommerceRequest(overrides: Partial<CommerceRequestV1> = {}): CommerceRequestV1 {
  return {
    platform: 'douyin',
    accountId: ACCOUNT_ID,
    kind: 'shop',
    platformProductId: '3612345678901234567',
    required: true,
    ...overrides,
  };
}

function makeJob(overrides: Partial<PublishJobV1> = {}): PublishJobV1 {
  return {
    id: JOB_ID,
    accountId: ACCOUNT_ID,
    videoVariantId: 'vv-1',
    metadata: {
      title: '合成夹具标题',
      description: '合成夹具描述',
      tags: ['合成夹具'],
      coverRefs: ['covers/job-1.png'],
      scheduleAt: null,
    },
    commerceRequest: null,
    state: 'draft',
    idempotencyKey: 'idem-job-1-0001',
    attempt: 0,
    leaseUntil: null,
    remoteResult: null,
    createdAt: '2026-09-22T09:00:00.000Z',
    updatedAt: '2026-09-22T09:00:00.000Z',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ProductionDocumentV1> = {}): ProductionDocumentV1 {
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    projectId: PROJECT_ID,
    createdAt: '2026-09-21T02:00:00.000Z',
    updatedAt: '2026-09-22T09:00:00.000Z',
    recordings: [makeRecording()],
    highlights: [makeHighlight()],
    assets: [makeAsset()],
    compositionPlans: [makePlan()],
    videoVariants: [makeVariant()],
    accounts: [makeAccount()],
    publishJobs: [makeJob()],
    ...overrides,
  };
}

/** 深拷贝为「来路不明」的 JSON 输入，模拟从 sidecar / IPC 反序列化。 */
function asUnknownJson(doc: ProductionDocumentV1): unknown {
  return JSON.parse(JSON.stringify(doc));
}

/** 默认入口：结构化夹具 → unknown JSON → 预检。 */
function evaluate(doc: ProductionDocumentV1, jobId: unknown = JOB_ID): LocalPublishPreflightResult {
  return evaluateLocalPublishPreflight(asUnknownJson(doc), jobId);
}

function expectBlocked(
  result: LocalPublishPreflightResult,
  reason: LocalPublishPreflightBlockedReason,
): void {
  expect(result).toEqual({ status: 'blocked', reason });
}

function expectReady(result: LocalPublishPreflightResult): void {
  expect(result.status).toBe('ready_for_live_checks');
  if (result.status !== 'ready_for_live_checks') {
    throw new Error('期望 ready_for_live_checks，实际被阻止');
  }
  expect([...result.pendingChecks]).toEqual([...LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS]);
}

describe('稳定枚举：阻止原因码与未决检查清单', () => {
  it('阻止原因码集合稳定、唯一且全部为小写机器码', () => {
    expect([...LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS]).toEqual([
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
    ]);
    expect(new Set(LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS).size).toBe(
      LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS.length,
    );
    for (const reason of LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS) {
      expect(reason).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expect(Object.isFrozen(LOCAL_PUBLISH_PREFLIGHT_BLOCKED_REASONS)).toBe(true);
  });

  it('未决检查清单恰好为六项后续义务且运行时冻结', () => {
    expect([...LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS]).toEqual([
      'trusted_campaign_grant',
      'live_account_session',
      'source_rights',
      'platform_permission_and_user_awareness',
      'output_file_integrity',
      'remote_final_state',
    ]);
    expect(Object.isFrozen(LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS)).toBe(true);
  });

  it('可预检任务状态只有 draft / preflight，且是契约状态机子集', () => {
    expect([...LOCAL_PUBLISH_PREFLIGHTABLE_JOB_STATES]).toEqual(['draft', 'preflight']);
    expect(Object.isFrozen(LOCAL_PUBLISH_PREFLIGHTABLE_JOB_STATES)).toBe(true);
    for (const state of LOCAL_PUBLISH_PREFLIGHTABLE_JOB_STATES) {
      expect(PUBLISH_JOB_STATES).toContain(state);
    }
  });
});

describe('合法夹具：ready_for_live_checks（不是发布授权）', () => {
  it('draft 任务的完整合法文档返回 ready_for_live_checks 并列出全部未决检查', () => {
    expectReady(evaluate(makeDocument()));
  });

  it('preflight 状态的任务同样可以预检', () => {
    expectReady(evaluate(makeDocument({ publishJobs: [makeJob({ state: 'preflight' })] })));
  });

  it('成功结果形状冻结：只有 status + pendingChecks，无 allowed / publishable / authorized 字样', () => {
    const result = evaluate(makeDocument());
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== 'ready_for_live_checks') throw new Error('期望 ready_for_live_checks');
    expect(Object.isFrozen(result.pendingChecks)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['pendingChecks', 'status']);
    expect('allowed' in result).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('authorized_to_publish');
    expect(serialized).not.toContain('publishable');
    expect(serialized).not.toContain('"allowed"');
    expect(result.status).not.toBe('authorized_to_publish');
  });

  it('未决检查清单不可被调用方改写（冻结后 push 抛错且长度不变）', () => {
    const result = evaluate(makeDocument());
    if (result.status !== 'ready_for_live_checks') throw new Error('期望 ready_for_live_checks');
    const checks = result.pendingChecks as unknown as string[];
    expect(() => checks.push('nothing_else_pending')).toThrow();
    expect(result.pendingChecks).toHaveLength(6);
    expect([...LOCAL_PUBLISH_PREFLIGHT_PENDING_CHECKS]).toHaveLength(6);
  });

  it('录屏 / 高光分段不需要素材授权标志，但 source_rights 仍是未决项', () => {
    const doc = makeDocument({
      compositionPlans: [
        makePlan({
          segments: [
            {
              id: 'seg-rec',
              order: 0,
              description: '录屏开场',
              source: { kind: 'recording', sourceId: 'rec-1', inMs: 0, outMs: 30_000 },
            },
            makeHighlightSegment({ order: 1 }),
          ],
        }),
      ],
    });
    const result = evaluate(doc);
    expectReady(result);
    if (result.status !== 'ready_for_live_checks') throw new Error('期望 ready_for_live_checks');
    expect(result.pendingChecks).toContain('source_rights');
    expect(result.pendingChecks).toContain('live_account_session');
    expect(result.pendingChecks).toContain('remote_final_state');
  });

  it('纯函数：重复调用结果一致', () => {
    const raw = asUnknownJson(makeDocument());
    const first = evaluateLocalPublishPreflight(raw, JOB_ID);
    const second = evaluateLocalPublishPreflight(raw, JOB_ID);
    expect(first).toEqual(second);
    expectReady(first);
  });
});

describe('任务 ID 与文档输入校验（fail-closed）', () => {
  it('非法任务 ID 一律 job_id_invalid（不先解析文档）', () => {
    // 直接调用生产入口：显式传入 undefined 必须原样到达生产函数，
    // 不得被局部 helper 的默认参数 JOB_ID 吞掉（否则本用例会误测合法任务）。
    for (const bad of ['', '   ', 42, null, undefined, {}, [], true]) {
      expectBlocked(evaluateLocalPublishPreflight(asUnknownJson(makeDocument()), bad), 'job_id_invalid');
    }
    // 文档同时非法时仍先报任务 ID 问题（判定次序由测试固定）
    expectBlocked(evaluateLocalPublishPreflight(null, ''), 'job_id_invalid');
  });

  it('非对象文档输入一律 document_invalid', () => {
    for (const bad of [null, undefined, 42, 'doc', [], true]) {
      expectBlocked(evaluateLocalPublishPreflight(bad, JOB_ID), 'document_invalid');
    }
  });

  it('未知 / 缺失 / 字符串 schemaVersion 一律 document_invalid，不做迁移', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    expectBlocked(evaluateLocalPublishPreflight({ ...raw, schemaVersion: 2 }, JOB_ID), 'document_invalid');
    expectBlocked(evaluateLocalPublishPreflight({ ...raw, schemaVersion: 0 }, JOB_ID), 'document_invalid');
    expectBlocked(evaluateLocalPublishPreflight({ ...raw, schemaVersion: '1' }, JOB_ID), 'document_invalid');
    const missing: Record<string, unknown> = { ...raw };
    delete missing.schemaVersion;
    expectBlocked(evaluateLocalPublishPreflight(missing, JOB_ID), 'document_invalid');
  });

  it('缺失必填字段 / 未知字段 / 非法枚举一律 document_invalid', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    const noProject: Record<string, unknown> = { ...raw };
    delete noProject.projectId;
    expectBlocked(evaluateLocalPublishPreflight(noProject, JOB_ID), 'document_invalid');
    expectBlocked(
      evaluateLocalPublishPreflight({ ...raw, unknownField: 1 }, JOB_ID),
      'document_invalid',
    );
    expectBlocked(
      evaluate(makeDocument({ accounts: [makeAccount({ status: 'banned' as never })] })),
      'document_invalid',
    );
  });

  it('凭证材料字段进入文档被拒且不回显凭证值', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    const accounts = raw.accounts as Array<Record<string, unknown>>;
    accounts[0]!.cookie = 'sessionid=SECRET-COOKIE-MARKER';
    const result = evaluateLocalPublishPreflight(raw, JOB_ID);
    expectBlocked(result, 'document_invalid');
    expect(JSON.stringify(result)).not.toContain('SECRET-COOKIE-MARKER');
  });

  it('解析器遭遇非契约异常（敌意 getter）时以 preflight_error 失败关闭，不泄露异常文本', () => {
    const hostile = {
      get schemaVersion(): number {
        throw new Error('boom-secret-marker');
      },
    };
    const result = evaluateLocalPublishPreflight(hostile, JOB_ID);
    expectBlocked(result, 'preflight_error');
    expect(JSON.stringify(result)).not.toContain('boom-secret-marker');
  });

  it('类实例 / Date 等非普通 JSON 对象以 document_invalid 拒绝', () => {
    class FakeDoc {}
    expectBlocked(evaluateLocalPublishPreflight(new FakeDoc(), JOB_ID), 'document_invalid');
    expectBlocked(evaluateLocalPublishPreflight(new Date(), JOB_ID), 'document_invalid');
  });

  it('任务不存在于文档中时 job_not_found', () => {
    expectBlocked(evaluate(makeDocument(), 'job-404'), 'job_not_found');
    expectBlocked(
      evaluate(makeDocument({ publishJobs: [makeJob({ id: 'other-job' })] }), JOB_ID),
      'job_not_found',
    );
  });
});

describe('任务状态：只有 draft / preflight 可预检，提交后状态永不重试', () => {
  it('契约状态机中除 draft / preflight 外全部阻止', () => {
    const allowed: string[] = [...LOCAL_PUBLISH_PREFLIGHTABLE_JOB_STATES];
    const blockedStates = PUBLISH_JOB_STATES.filter((state) => !allowed.includes(state));
    expect(blockedStates).toHaveLength(PUBLISH_JOB_STATES.length - 2);
    for (const state of blockedStates) {
      expectBlocked(
        evaluate(makeDocument({ publishJobs: [makeJob({ state })] })),
        'job_state_not_preflightable',
      );
    }
  });

  it('unknown_submission / submitted / published 显式阻止（先查远端，绝不本地重试）', () => {
    for (const state of ['unknown_submission', 'submitted', 'published'] as const) {
      expectBlocked(
        evaluate(makeDocument({ publishJobs: [makeJob({ state })] })),
        'job_state_not_preflightable',
      );
    }
  });
});

describe('商品请求：commerceRequest 必须严格为 null，绝不降级为普通发布', () => {
  it('required=true 的商品请求阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ publishJobs: [makeJob({ commerceRequest: makeCommerceRequest({ required: true }) })] })),
      'commerce_request_present',
    );
  });

  it('required=false 的「可选」商品请求同样阻止（不存在静默降级路径）', () => {
    expectBlocked(
      evaluate(makeDocument({ publishJobs: [makeJob({ commerceRequest: makeCommerceRequest({ required: false }) })] })),
      'commerce_request_present',
    );
  });
});

describe('账号快照：active 且 sessionRef 非 null（不是实时登录探针）', () => {
  it('非 active 账号状态全部阻止（expired / needs_login / removed / unknown）', () => {
    for (const status of ['expired', 'needs_login', 'removed', 'unknown'] as const) {
      expectBlocked(
        evaluate(makeDocument({ accounts: [makeAccount({ status })] })),
        'account_not_active',
      );
    }
  });

  it('「陈旧 / 过期」账号 + 其余全部合法（含已授权素材）仍阻止', () => {
    expectBlocked(
      evaluate(
        makeDocument({
          accounts: [makeAccount({ status: 'expired', lastVerifiedAt: '2026-01-01T00:00:00.000Z' })],
        }),
      ),
      'account_not_active',
    );
  });

  it('status=active 但 sessionRef 为 null 时以 account_session_missing 阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ accounts: [makeAccount({ sessionRef: null })] })),
      'account_session_missing',
    );
  });
});

describe('视频版本：质检通过 + 产物引用 / 哈希 / 正时长 + 可编辑时间线', () => {
  it('未通过质检的状态全部阻止（planned / rendering / rendered / qc_failed）', () => {
    for (const status of ['planned', 'rendering', 'rendered', 'qc_failed'] as const) {
      expectBlocked(
        evaluate(makeDocument({ videoVariants: [makeVariant({ status })] })),
        'variant_not_qc_passed',
      );
    }
  });

  it('渲染产物引用或哈希缺失阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ videoVariants: [makeVariant({ outputRef: null })] })),
      'variant_output_missing',
    );
    expectBlocked(
      evaluate(makeDocument({ videoVariants: [makeVariant({ outputSha256: null })] })),
      'variant_output_missing',
    );
  });

  it('产物时长为 null 或 0（非正）阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ videoVariants: [makeVariant({ durationMs: null })] })),
      'variant_duration_invalid',
    );
    expectBlocked(
      evaluate(makeDocument({ videoVariants: [makeVariant({ durationMs: 0 })] })),
      'variant_duration_invalid',
    );
  });

  it('版本未绑定可编辑时间线（timelineRef null）阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ videoVariants: [makeVariant({ timelineRef: null })] })),
      'variant_timeline_missing',
    );
  });
});

describe('合成计划：非空分段 + 时间线引用非空且与版本一致', () => {
  it('空计划（无分段）阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ compositionPlans: [makePlan({ segments: [] })] })),
      'plan_empty',
    );
  });

  it('计划尚未回写时间线（timelineRef null）阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ compositionPlans: [makePlan({ timelineRef: null })] })),
      'plan_timeline_missing',
    );
  });

  it('计划与版本时间线引用不一致阻止', () => {
    expectBlocked(
      evaluate(
        makeDocument({
          compositionPlans: [makePlan({ timelineRef: 'lingji:project-001#other-timeline' })],
        }),
      ),
      'plan_timeline_mismatch',
    );
  });
});

describe('素材授权：每个 asset 分段必须 authorizedForAutoUse === true', () => {
  it('被引用素材未授权时阻止', () => {
    expectBlocked(
      evaluate(makeDocument({ assets: [makeAsset({ authorizedForAutoUse: false })] })),
      'asset_not_authorized',
    );
  });

  it('多素材分段中任一未授权即阻止', () => {
    const doc = makeDocument({
      assets: [makeAsset(), makeAsset({ id: 'asset-2', sha256: ASSET2_SHA, authorizedForAutoUse: false })],
      compositionPlans: [
        makePlan({ segments: [makeAssetSegment('asset-1'), makeAssetSegment('asset-2')] }),
      ],
    });
    expectBlocked(evaluate(doc), 'asset_not_authorized');
  });

  it('素材库中存在未授权素材但计划未引用时不阻止（只闸被引用的分段）', () => {
    const doc = makeDocument({
      assets: [makeAsset(), makeAsset({ id: 'asset-3', sha256: ASSET2_SHA, authorizedForAutoUse: false })],
    });
    expectReady(evaluate(doc));
  });
});

describe('悬挂引用：解析层失败关闭', () => {
  it('任何悬挂引用都产生 document_invalid（绝不带病预检）', () => {
    expectBlocked(
      evaluate(makeDocument({ publishJobs: [makeJob({ accountId: 'acct-404' })] })),
      'document_invalid',
    );
    expectBlocked(
      evaluate(makeDocument({ publishJobs: [makeJob({ videoVariantId: 'vv-404' })] })),
      'document_invalid',
    );
    expectBlocked(
      evaluate(makeDocument({ videoVariants: [makeVariant({ compositionPlanId: 'cp-404' })] })),
      'document_invalid',
    );
    expectBlocked(
      evaluate(makeDocument({ highlights: [makeHighlight({ recordingId: 'rec-404' })] })),
      'document_invalid',
    );
    expectBlocked(
      evaluate(
        makeDocument({
          compositionPlans: [makePlan({ segments: [makeAssetSegment('asset-404')] })],
        }),
      ),
      'document_invalid',
    );
  });
});

describe('判定次序（先命中先返回，固定审计顺序）', () => {
  it('任务 ID → 文档 → 查找 → 状态 → 商品 → 账号 → 版本 → 计划 → 素材', () => {
    // 文档解析先于任务查找：
    expectBlocked(
      evaluateLocalPublishPreflight({ schemaVersion: 2 }, JOB_ID),
      'document_invalid',
    );
    // 任务查找先于状态判定：
    expectBlocked(
      evaluate(makeDocument({ publishJobs: [makeJob({ id: 'other-job', state: 'submitted' })] }), JOB_ID),
      'job_not_found',
    );
    // 状态先于商品：
    expectBlocked(
      evaluate(
        makeDocument({
          publishJobs: [makeJob({ state: 'submitted', commerceRequest: makeCommerceRequest() })],
        }),
      ),
      'job_state_not_preflightable',
    );
    // 商品先于账号：
    expectBlocked(
      evaluate(
        makeDocument({
          accounts: [makeAccount({ status: 'expired' })],
          publishJobs: [makeJob({ commerceRequest: makeCommerceRequest() })],
        }),
      ),
      'commerce_request_present',
    );
    // 账号状态先于 sessionRef，且账号先于版本：
    expectBlocked(
      evaluate(
        makeDocument({
          accounts: [makeAccount({ status: 'expired', sessionRef: null })],
          videoVariants: [makeVariant({ status: 'planned' })],
        }),
      ),
      'account_not_active',
    );
    expectBlocked(
      evaluate(
        makeDocument({
          accounts: [makeAccount({ sessionRef: null })],
          videoVariants: [makeVariant({ status: 'planned' })],
        }),
      ),
      'account_session_missing',
    );
    // 版本先于计划：
    expectBlocked(
      evaluate(
        makeDocument({
          videoVariants: [makeVariant({ status: 'planned' })],
          compositionPlans: [makePlan({ segments: [] })],
        }),
      ),
      'variant_not_qc_passed',
    );
    // 版本内部次序：状态 → 产物 → 时长 → 时间线：
    expectBlocked(
      evaluate(
        makeDocument({
          videoVariants: [makeVariant({ outputRef: null, durationMs: null, timelineRef: null })],
        }),
      ),
      'variant_output_missing',
    );
    expectBlocked(
      evaluate(
        makeDocument({
          videoVariants: [makeVariant({ durationMs: null, timelineRef: null })],
        }),
      ),
      'variant_duration_invalid',
    );
    // 计划先于素材：
    expectBlocked(
      evaluate(
        makeDocument({
          compositionPlans: [
            makePlan({ timelineRef: null, segments: [makeAssetSegment('asset-1')] }),
          ],
          assets: [makeAsset({ authorizedForAutoUse: false })],
        }),
      ),
      'plan_timeline_missing',
    );
    // 计划内部次序：空分段先于时间线：
    expectBlocked(
      evaluate(makeDocument({ compositionPlans: [makePlan({ segments: [], timelineRef: null })] })),
      'plan_empty',
    );
  });
});

describe('脱敏与无副作用', () => {
  it('阻止结果只含 status + reason 两个键，不回显账号 / 标题 / 会话引用等敏感文本', () => {
    const doc = makeDocument({
      accounts: [makeAccount({ status: 'expired', displayName: 'MARKER-display-name' })],
      publishJobs: [
        makeJob({
          metadata: {
            title: 'MARKER-title',
            description: 'MARKER-description',
            tags: ['MARKER-tag'],
            coverRefs: ['MARKER-cover.png'],
            scheduleAt: null,
          },
        }),
      ],
    });
    const result = evaluate(doc);
    expectBlocked(result, 'account_not_active');
    expect(Object.keys(result).sort()).toEqual(['reason', 'status']);
    const serialized = JSON.stringify(result);
    for (const marker of [
      'MARKER-display-name',
      'MARKER-title',
      'MARKER-description',
      'MARKER-tag',
      'MARKER-cover',
      ACCOUNT_ID,
      SESSION_REF_VALUE,
      PROJECT_ID,
      'renders/vv-1-final.mp4',
      '$.',
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it('解析失败的阻止结果同样只含稳定机器码（不回显解析器消息与输入值）', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    raw.schemaVersion = 'SECRET-VERSION-MARKER';
    const result = evaluateLocalPublishPreflight(raw, JOB_ID);
    expectBlocked(result, 'document_invalid');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SECRET-VERSION-MARKER');
    expect(serialized).not.toContain('schemaVersion');
    expect(serialized).not.toContain('必须是');
  });

  it('成功结果不含账号 / 路径 / 项目等输入内容', () => {
    const result = evaluate(makeDocument());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain(SESSION_REF_VALUE);
    expect(serialized).not.toContain(PROJECT_ID);
    expect(serialized).not.toContain(JOB_ID);
  });

  it('不改写输入文档：ready 与 blocked 路径均保持原样', () => {
    const readyRaw = asUnknownJson(makeDocument());
    const readySnapshot = JSON.stringify(readyRaw);
    expectReady(evaluateLocalPublishPreflight(readyRaw, JOB_ID));
    expect(JSON.stringify(readyRaw)).toBe(readySnapshot);

    const blockedRaw = asUnknownJson(
      makeDocument({ publishJobs: [makeJob({ state: 'submitted' })] }),
    );
    const blockedSnapshot = JSON.stringify(blockedRaw);
    expectBlocked(
      evaluateLocalPublishPreflight(blockedRaw, JOB_ID),
      'job_state_not_preflightable',
    );
    expect(JSON.stringify(blockedRaw)).toBe(blockedSnapshot);
  });

  it('函数自身从不抛异常：敌意输入也只返回阻止结果', () => {
    expect(() => evaluateLocalPublishPreflight(undefined, undefined)).not.toThrow();
    expect(() => evaluateLocalPublishPreflight(Symbol('x'), 10n)).not.toThrow();
    const cyclic: Record<string, unknown> = { schemaVersion: 1 };
    cyclic.self = cyclic;
    expectBlocked(evaluateLocalPublishPreflight(cyclic, JOB_ID), 'document_invalid');
  });
});

import { describe, expect, it } from 'vitest';
import type {
  AccountV1,
  AssetV1,
  CommerceRequestV1,
  CompositionPlanV1,
  HighlightV1,
  ProductionDocumentV1,
  PublishJobV1,
  RecordingV1,
  VideoVariantV1,
} from '../src/types/production-contracts';
import {
  PRODUCTION_PLATFORMS,
  PRODUCTION_SCHEMA_VERSION,
} from '../src/types/production-contracts';
import type { ProductionContractErrorCode } from '../src/lib/production-document';
import {
  ProductionContractError,
  createEmptyProductionDocument,
  parseProductionDocument,
} from '../src/lib/production-document';

// —— 测试夹具：全部字段显式给出，覆盖 v1 契约的合法形态 ——

const RECORDING_SHA = 'a3f5c8d9e0b1427f8a6c5d4e3f2019a8b7c6d5e4f3021a9b8c7d6e5f40312987';
const ASSET_SHA = '0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0';

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
    context: '主播首次展示商品核心卖点',
    evidence: [
      { kind: 'transcript', startMs: 60_000, endMs: 61_500, note: '“这款”首次出现' },
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
    tags: ['b-roll', '产品'],
    transcript: null,
    embeddingRef: 'embeddings/asset-1.vec',
    source: '自有拍摄 2026-09-18',
    rightsHolder: '本项目用户',
    license: 'proprietary',
    usageScope: '本工作台内混剪与四平台发布',
    authorizedForAutoUse: true,
    importedAt: '2026-09-21T02:30:00.000Z',
    ...overrides,
  };
}

function makePlan(overrides: Partial<CompositionPlanV1> = {}): CompositionPlanV1 {
  return {
    id: 'cp-1',
    narrativeSummary: '以高光开场、B-roll 补足产品细节的竖屏版本',
    voiceoverKind: 'original-audio',
    aspectRatio: '9:16',
    segments: [
      {
        id: 'seg-1',
        order: 0,
        description: '高光开场',
        source: { kind: 'highlight', sourceId: 'hl-1', inMs: 60_000, outMs: 90_000 },
      },
      {
        id: 'seg-2',
        order: 1,
        description: '产品细节 B-roll',
        source: { kind: 'asset', sourceId: 'asset-1', inMs: 0, outMs: 10_000 },
      },
    ],
    timelineRef: 'lingji:project-001#timeline',
    createdAt: '2026-09-21T04:00:00.000Z',
    updatedAt: '2026-09-21T04:00:00.000Z',
    ...overrides,
  };
}

function makeVariant(overrides: Partial<VideoVariantV1> = {}): VideoVariantV1 {
  return {
    id: 'vv-1',
    compositionPlanId: 'cp-1',
    timelineRef: 'lingji:project-001#timeline',
    outputRef: null,
    outputSha256: null,
    durationMs: null,
    aspectRatio: '9:16',
    status: 'planned',
    createdAt: '2026-09-21T04:10:00.000Z',
    updatedAt: '2026-09-21T04:10:00.000Z',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountV1> = {}): AccountV1 {
  return {
    id: 'acct-7c1f0a5e-6f6a-4b7e-9a11-2d9c8b7a6f50',
    platform: 'douyin',
    displayName: '测试账号甲',
    owner: 'user-local',
    status: 'active',
    sessionRef: 'secure-session-store/acct-7c1f0a5e',
    capabilitySnapshot: { commerce: 'not_implemented' },
    lastVerifiedAt: '2026-09-22T08:00:00.000Z',
    createdAt: '2026-09-21T05:00:00.000Z',
    ...overrides,
  };
}

function makeCommerceRequest(
  overrides: Partial<CommerceRequestV1> = {},
): CommerceRequestV1 {
  return {
    platform: 'douyin',
    accountId: 'acct-7c1f0a5e-6f6a-4b7e-9a11-2d9c8b7a6f50',
    kind: 'shop',
    platformProductId: '3612345678901234567',
    required: true,
    ...overrides,
  };
}

function makeJob(overrides: Partial<PublishJobV1> = {}): PublishJobV1 {
  return {
    id: 'job-1',
    accountId: 'acct-7c1f0a5e-6f6a-4b7e-9a11-2d9c8b7a6f50',
    videoVariantId: 'vv-1',
    metadata: {
      title: '开场高光切片',
      description: '直播开场片段剪辑',
      tags: ['直播切片'],
      coverRefs: ['covers/job-1-3x4.png'],
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

function makeDocument(
  overrides: Partial<ProductionDocumentV1> = {},
): ProductionDocumentV1 {
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    projectId: 'lingji-project-001',
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

/** 深拷贝为“来路不明”的 JSON 输入，模拟从 sidecar 反序列化。 */
function asUnknownJson(doc: ProductionDocumentV1): unknown {
  return JSON.parse(JSON.stringify(doc));
}

function expectContractError(
  fn: () => unknown,
  code: ProductionContractErrorCode,
): ProductionContractError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProductionContractError);
    const contractError = error as ProductionContractError;
    expect(contractError.code).toBe(code);
    expect(contractError.path.length).toBeGreaterThan(0);
    return contractError;
  }
  throw new Error(`期望抛出 ProductionContractError(${code})，但没有异常`);
}

describe('createEmptyProductionDocument', () => {
  it('创建带 schemaVersion=1 的空文档，所有集合为空', () => {
    const doc = createEmptyProductionDocument('lingji-project-001', {
      nowIso: '2026-09-25T00:00:00.000Z',
    });
    expect(doc.schemaVersion).toBe(1);
    expect(doc.projectId).toBe('lingji-project-001');
    expect(doc.createdAt).toBe('2026-09-25T00:00:00.000Z');
    expect(doc.updatedAt).toBe(doc.createdAt);
    expect(doc.recordings).toEqual([]);
    expect(doc.highlights).toEqual([]);
    expect(doc.assets).toEqual([]);
    expect(doc.compositionPlans).toEqual([]);
    expect(doc.videoVariants).toEqual([]);
    expect(doc.accounts).toEqual([]);
    expect(doc.publishJobs).toEqual([]);
  });

  it('空文档能被 parse 原样接受（初始化即可通过契约校验）', () => {
    const doc = createEmptyProductionDocument('lingji-project-001');
    const parsed = parseProductionDocument(asUnknownJson(doc));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it('拒绝空 / 空白 projectId', () => {
    expectContractError(() => createEmptyProductionDocument(''), 'invalid_field');
    expectContractError(() => createEmptyProductionDocument('   '), 'invalid_field');
  });
});

describe('parseProductionDocument：v1 JSON 往返', () => {
  it('完整八实体文档 JSON 往返后逐字段保持不变', () => {
    const doc = makeDocument();
    const parsed = parseProductionDocument(asUnknownJson(doc));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it('parse 不改写传入数据', () => {
    const raw = asUnknownJson(makeDocument());
    const snapshot = JSON.stringify(raw);
    parseProductionDocument(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('平台枚举只含抖音 / 快手 / 视频号 / 小红书', () => {
    expect([...PRODUCTION_PLATFORMS].sort()).toEqual(
      ['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'].sort(),
    );
  });
});

describe('parseProductionDocument：版本边界', () => {
  it('拒绝未来版本 schemaVersion=2，不做自动迁移', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    raw.schemaVersion = 2;
    expectContractError(() => parseProductionDocument(raw), 'unsupported_schema_version');
  });

  it('拒绝 schemaVersion=0（契约不存在 v0，不猜测）', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    raw.schemaVersion = 0;
    expectContractError(() => parseProductionDocument(raw), 'unsupported_schema_version');
  });

  it('拒绝缺失 schemaVersion', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    delete raw.schemaVersion;
    expectContractError(() => parseProductionDocument(raw), 'unsupported_schema_version');
  });

  it('拒绝字符串 "1"（不做静默类型转换）', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    raw.schemaVersion = '1';
    expectContractError(() => parseProductionDocument(raw), 'unsupported_schema_version');
  });

  it('未知版本错误不回显可能包含凭证的输入值', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    raw.schemaVersion = 'secret-value-example';
    const error = expectContractError(
      () => parseProductionDocument(raw),
      'unsupported_schema_version',
    );
    expect(error.message).not.toContain('secret-value-example');
  });

  it('拒绝非对象输入', () => {
    for (const input of [null, undefined, 42, 'doc', []]) {
      expectContractError(() => parseProductionDocument(input), 'invalid_document');
    }
  });

  it('拒绝集合字段不是数组的文档', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    raw.recordings = { '0': makeRecording() };
    expectContractError(() => parseProductionDocument(raw), 'invalid_document');
  });
});

describe('parseProductionDocument：平台枚举', () => {
  it('拒绝账号上的非法平台（bilibili 不在阶段一契约内）', () => {
    const doc = makeDocument({
      accounts: [makeAccount({ platform: 'bilibili' as never })],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_platform',
    );
  });

  it('平台匹配大小写敏感，拒绝 "Douyin"', () => {
    const doc = makeDocument({
      accounts: [makeAccount({ platform: 'Douyin' as never })],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_platform',
    );
  });

  it('拒绝 CommerceRequest 上的非法平台', () => {
    const doc = makeDocument({
      publishJobs: [
        makeJob({
          commerceRequest: makeCommerceRequest({ platform: 'tiktok' as never }),
        }),
      ],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_platform',
    );
  });
});

describe('parseProductionDocument：CommerceRequest 不被静默丢弃或降级', () => {
  it('带商品请求的任务往返后 commerceRequest 原样保留', () => {
    const request = makeCommerceRequest();
    const doc = makeDocument({ publishJobs: [makeJob({ commerceRequest: request })] });
    const parsed = parseProductionDocument(asUnknownJson(doc));
    expect(parsed.publishJobs[0]?.commerceRequest).toEqual(
      JSON.parse(JSON.stringify(request)),
    );
    expect(parsed.publishJobs[0]?.commerceRequest?.required).toBe(true);
  });

  it('commerceRequest 字段缺失（而非显式 null）被拒绝，防止静默变普通发布', () => {
    const raw = asUnknownJson(makeDocument()) as Record<string, unknown>;
    const jobs = raw.publishJobs as Array<Record<string, unknown>>;
    delete jobs[0]!.commerceRequest;
    expectContractError(() => parseProductionDocument(raw), 'invalid_field');
  });

  it('拒绝用 URL 冒充平台商品 ID', () => {
    const doc = makeDocument({
      publishJobs: [
        makeJob({
          commerceRequest: makeCommerceRequest({
            platformProductId: 'https://haohuo.example.com/product/123',
          }),
        }),
      ],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_commerce_request',
    );
  });

  it('拒绝空 platformProductId', () => {
    const doc = makeDocument({
      publishJobs: [
        makeJob({ commerceRequest: makeCommerceRequest({ platformProductId: '' }) }),
      ],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_commerce_request',
    );
  });

  it('拒绝非法商品类型 kind', () => {
    const doc = makeDocument({
      publishJobs: [
        makeJob({ commerceRequest: makeCommerceRequest({ kind: 'any-url' as never }) }),
      ],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_commerce_request',
    );
  });

  it('拒绝 commerceRequest.accountId 与任务账号不一致', () => {
    const doc = makeDocument({
      publishJobs: [
        makeJob({ commerceRequest: makeCommerceRequest({ accountId: 'acct-other' }) }),
      ],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_commerce_request',
    );
  });

  it('拒绝 commerceRequest.platform 与账号平台不一致', () => {
    const doc = makeDocument({
      publishJobs: [
        makeJob({ commerceRequest: makeCommerceRequest({ platform: 'kuaishou' }) }),
      ],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_commerce_request',
    );
  });
});

describe('parseProductionDocument：引用完整性', () => {
  it('拒绝高光引用不存在的录屏', () => {
    const doc = makeDocument({ highlights: [makeHighlight({ recordingId: 'rec-404' })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'dangling_reference',
    );
  });

  it('拒绝发布任务引用不存在的账号', () => {
    const doc = makeDocument({ publishJobs: [makeJob({ accountId: 'acct-404' })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'dangling_reference',
    );
  });

  it('拒绝发布任务引用不存在的视频版本', () => {
    const doc = makeDocument({
      publishJobs: [makeJob({ videoVariantId: 'vv-404' })],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'dangling_reference',
    );
  });

  it('无效引用的错误消息不回显外部输入内容', () => {
    const marker = 'sensitive-marker-example';
    const doc = makeDocument({ publishJobs: [makeJob({ videoVariantId: marker })] });
    const error = expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'dangling_reference',
    );
    expect(error.message).not.toContain(marker);
  });

  it('拒绝视频版本引用不存在的合成计划', () => {
    const doc = makeDocument({
      videoVariants: [makeVariant({ compositionPlanId: 'cp-404' })],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'dangling_reference',
    );
  });

  it('拒绝合成计划分段引用不存在的素材', () => {
    const plan = makePlan({
      segments: [
        {
          id: 'seg-x',
          order: 0,
          description: '引用丢失',
          source: { kind: 'asset', sourceId: 'asset-404', inMs: 0, outMs: 1_000 },
        },
      ],
    });
    const doc = makeDocument({
      compositionPlans: [plan],
      videoVariants: [],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'dangling_reference',
    );
  });

  it('拒绝同集合内重复 ID', () => {
    const doc = makeDocument({ recordings: [makeRecording(), makeRecording()] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'duplicate_id',
    );
  });

  it('拒绝同一合成计划中的重复分段 ID', () => {
    const segment = makePlan().segments[0];
    const doc = makeDocument({
      compositionPlans: [makePlan({ segments: [segment, { ...segment, order: 1 }] })],
    });
    expectContractError(() => parseProductionDocument(asUnknownJson(doc)), 'duplicate_id');
  });
});

describe('parseProductionDocument：录屏 / 高光时间码边界', () => {
  it('拒绝高光 startMs >= endMs', () => {
    const doc = makeDocument({ highlights: [makeHighlight({ startMs: 120_000, endMs: 120_000 })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_timecode',
    );
  });

  it('拒绝负数时间码', () => {
    const doc = makeDocument({ highlights: [makeHighlight({ startMs: -1 })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_timecode',
    );
  });

  it('拒绝非整数毫秒时间码', () => {
    const doc = makeDocument({ highlights: [makeHighlight({ endMs: 120_000.5 })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_timecode',
    );
  });

  it('拒绝高光 endMs 超出录屏总时长', () => {
    const doc = makeDocument({
      recordings: [makeRecording({ durationMs: 90_000 })],
      highlights: [makeHighlight({ startMs: 60_000, endMs: 120_000 })],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_timecode',
    );
  });

  it('接受贴边时间码：startMs=0 且 endMs=录屏总时长', () => {
    const doc = makeDocument({
      recordings: [makeRecording({ durationMs: 120_000 })],
      highlights: [makeHighlight({ startMs: 0, endMs: 120_000 })],
    });
    expect(() => parseProductionDocument(asUnknownJson(doc))).not.toThrow();
  });

  it('录屏时长未知（null）时不做上界校验', () => {
    const doc = makeDocument({
      recordings: [makeRecording({ durationMs: null })],
      highlights: [makeHighlight({ startMs: 0, endMs: 9_999_999 })],
    });
    expect(() => parseProductionDocument(asUnknownJson(doc))).not.toThrow();
  });

  it('拒绝拒绝非法录屏哈希（长度/字符不符 sha256）', () => {
    const doc = makeDocument({ recordings: [makeRecording({ sourceSha256: 'abc123' })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_field',
    );
  });

  it('拒绝合成计划分段越出素材时长', () => {
    const plan = makePlan({
      segments: [
        {
          id: 'seg-1',
          order: 0,
          description: '越界分段',
          source: { kind: 'asset', sourceId: 'asset-1', inMs: 0, outMs: 31_000 },
        },
      ],
    });
    const doc = makeDocument({
      compositionPlans: [plan],
      videoVariants: [],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_timecode',
    );
  });

  it('拒绝高光来源分段越出高光边界（录屏绝对时间码）', () => {
    const plan = makePlan({
      segments: [
        {
          id: 'seg-1',
          order: 0,
          description: '越出高光',
          source: { kind: 'highlight', sourceId: 'hl-1', inMs: 30_000, outMs: 70_000 },
        },
      ],
    });
    const doc = makeDocument({
      compositionPlans: [plan],
      videoVariants: [],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_timecode',
    );
  });
});

describe('parseProductionDocument：账号元数据边界', () => {
  it('拒绝账号对象携带 cookie 字段（凭证不进契约）', () => {
    const account = { ...makeAccount(), cookie: 'sessionid=abc' } as never;
    const doc = makeDocument({ accounts: [account], publishJobs: [] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'credential_material_forbidden',
    );
  });

  it('拒绝账号对象携带 token 字段', () => {
    const account = { ...makeAccount(), accessToken: 'tk-123' } as never;
    const doc = makeDocument({ accounts: [account], publishJobs: [] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'credential_material_forbidden',
    );
  });

  it('拒绝账号内部 ID 与昵称相同（ID 不得由昵称推导）', () => {
    const doc = makeDocument({
      accounts: [makeAccount({ id: '测试账号甲', displayName: '测试账号甲' })],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_field',
    );
  });

  it('接受不透明 sessionRef 且状态合法', () => {
    const doc = makeDocument({
      accounts: [makeAccount({ sessionRef: null, status: 'expired' })],
      publishJobs: [],
    });
    expect(() => parseProductionDocument(asUnknownJson(doc))).not.toThrow();
  });

  it('拒绝非法账号状态', () => {
    const doc = makeDocument({
      accounts: [makeAccount({ status: 'banned' as never })],
      publishJobs: [],
    });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_field',
    );
  });
});

describe('parseProductionDocument：发布任务字段边界', () => {
  it('拒绝重复发布任务 ID', () => {
    const doc = makeDocument({ publishJobs: [makeJob(), makeJob()] });
    expectContractError(() => parseProductionDocument(asUnknownJson(doc)), 'duplicate_id');
  });

  it('拒绝不同任务复用同一个幂等键', () => {
    const doc = makeDocument({ publishJobs: [makeJob(), makeJob({ id: 'job-2' })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'duplicate_idempotency_key',
    );
  });

  it('拒绝非法任务状态', () => {
    const doc = makeDocument({ publishJobs: [makeJob({ state: 'done' as never })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_field',
    );
  });

  it('拒绝空幂等键', () => {
    const doc = makeDocument({ publishJobs: [makeJob({ idempotencyKey: '' })] });
    expectContractError(
      () => parseProductionDocument(asUnknownJson(doc)),
      'invalid_field',
    );
  });

  it('往返保留状态机字段、重试计数、租约与远端结果', () => {
    const job = makeJob({
      state: 'unknown_submission',
      attempt: 3,
      leaseUntil: '2026-09-22T10:00:00.000Z',
      remoteResult: {
        remoteId: '7342xxxxxxxxxxxxxxx',
        remoteUrl: 'https://www.douyin.com/video/7342xxxxxxxxxxxxxxx',
        finalState: 'unknown',
        verifiedAt: null,
      },
    });
    const doc = makeDocument({ publishJobs: [job] });
    const parsed = parseProductionDocument(asUnknownJson(doc));
    expect(parsed.publishJobs[0]).toEqual(JSON.parse(JSON.stringify(job)));
  });
});

/**
 * 授权素材目录与语义检索端口测试（P3-1 第一段）。
 *
 * 全部使用合成元数据与假语义检索端口（不触网、不下载模型、不读真实媒体文件、
 * 不调 LLM），证明的是「授权闸门 + 可注入索引端口」协议：
 * - fail-closed 权限筛选：无结构化授权 / 平台或地区不匹配 / 商业用途不符 /
 *   过期 / 证据缺失 / 来源空白一律阻断，`authorizedForAutoUse:true` 与自由文本
 *   `usageScope` 单独都不足以放行；
 * - 语义端口只接收已授权 ID 候选集；端口返回越权 ID、重复 ID、非法分数或抛异常
 *   时结果仍不含无权素材；索引不可用返回明确的不可用状态而非随机推荐；
 * - 排序确定（分数降序、同分按 ID 升序）、结果可追溯（来源 / 权利持有人 /
 *   许可 / 证据引用 / 相似度原样透传）、理由不伪造模型证据；
 * - 输入输出深拷贝 + 深冻结，不共享可变内部状态；ID / sha256 冲突显式报错。
 *
 * 这属于合成测试证据，不代表真实 CLIP embedding、索引构建或混剪成片验收
 * （见 docs/validation/p3-1-asset-rights.md）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AssetRightsCatalog,
  AssetRightsError,
  evaluateAssetEligibility,
  recommendBrollFromEntries,
  selectEligibleAssets,
  validateAssetCatalogEntry,
  validateAssetUsageContext,
  validateBrollQuery,
  type AssetCatalogEntry,
  type AssetUsageContext,
  type BrollQuery,
  type RightsGrant,
  type SemanticSearchHit,
  type SemanticSearchPort,
} from '../../electron/assets/asset-rights';
import {
  PRODUCTION_PLATFORMS,
  type AssetV1,
} from '../../src/types/production-contracts';

// ——————————————————————————————— 合成数据脚手架 ———————————————————————————————

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

/** 合成 AssetV1（字段全部满足 src/lib/production-document.ts 的契约校验形状）。 */
function makeAsset(overrides: Partial<AssetV1> = {}): AssetV1 {
  return {
    id: 'asset-1',
    sha256: SHA_A,
    mediaType: 'video',
    durationMs: 15_000,
    tags: ['城市', '夜景'],
    transcript: null,
    embeddingRef: null,
    source: '2026-08-01 购于 stock.example（订单 #123）',
    rightsHolder: 'Example Stock Ltd.',
    license: 'purchased-stock',
    usageScope: '全媒介、全球、三年（人类可读描述，不是机器放行依据）',
    authorizedForAutoUse: true,
    importedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 结构化授权证明（机器可执行的许可边界）。 */
function makeGrant(overrides: Partial<RightsGrant> = {}): RightsGrant {
  return {
    platforms: ['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'],
    regions: ['cn'],
    commercialShortVideoUse: 'allowed',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    evidence: [
      {
        kind: 'purchase-record',
        ref: 'evidence/order-123.pdf',
        collectedAt: '2026-08-01T10:00:00.000Z',
        note: null,
      },
    ],
    ...overrides,
  };
}

/** 可变的目录项输入（普通对象，未经冻结）。 */
function makeEntryInput(overrides: {
  asset?: Partial<AssetV1>;
  mediaRef?: string;
  rightsGrant?: RightsGrant | null;
} = {}): { asset: AssetV1; mediaRef: string; rightsGrant: RightsGrant | null } {
  return {
    asset: makeAsset(overrides.asset),
    mediaRef: overrides.mediaRef ?? 'media-store/asset-1.mp4',
    rightsGrant:
      overrides.rightsGrant === undefined ? makeGrant() : overrides.rightsGrant,
  };
}

const CONTEXT: AssetUsageContext = {
  platform: 'douyin',
  region: 'cn',
  usedAt: '2026-09-25T12:00:00.000Z',
  commercialShortVideo: true,
};

const QUERY: BrollQuery = { text: '夜晚的城市街景空镜' };

function portReturning(hits: readonly unknown[]): SemanticSearchPort {
  return vi.fn(async () => hits as readonly SemanticSearchHit[]);
}

// ——————————————————————————————— 注册校验 ———————————————————————————————

describe('validateAssetCatalogEntry：注册校验与深拷贝冻结', () => {
  it('接受合法条目并返回深冻结副本，不与输入共享引用', () => {
    const input = makeEntryInput();
    const validated = validateAssetCatalogEntry(input);
    expect(validated).toEqual(input);
    expect(validated).not.toBe(input);
    expect(validated.asset).not.toBe(input.asset);
    expect(validated.rightsGrant).not.toBe(input.rightsGrant);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.asset)).toBe(true);
    expect(Object.isFrozen(validated.asset.tags)).toBe(true);
    expect(Object.isFrozen(validated.rightsGrant)).toBe(true);
    expect(Object.isFrozen(validated.rightsGrant!.platforms)).toBe(true);
    expect(Object.isFrozen(validated.rightsGrant!.evidence[0])).toBe(true);
  });

  it('接受 rightsGrant 为 null 的未授权资产（保留给人工处理，闸门另行阻断）', () => {
    const validated = validateAssetCatalogEntry(makeEntryInput({ rightsGrant: null }));
    expect(validated.rightsGrant).toBeNull();
  });

  it('接受空 platforms / regions / evidence 数组的授权结构（充分性由闸门判定）', () => {
    const grant = makeGrant({ platforms: [], regions: [], evidence: [] });
    const validated = validateAssetCatalogEntry(makeEntryInput({ rightsGrant: grant }));
    expect(validated.rightsGrant!.platforms).toEqual([]);
  });

  it('拒绝非对象输入、缺字段与未知字段', () => {
    expect(() => validateAssetCatalogEntry(null)).toThrow(AssetRightsError);
    expect(() => validateAssetCatalogEntry('media/asset.mp4')).toThrow(AssetRightsError);
    const missing = makeEntryInput() as Record<string, unknown>;
    delete missing.mediaRef;
    expect(() => validateAssetCatalogEntry(missing)).toThrow(
      expect.objectContaining({ code: 'invalid_entry', path: '$.mediaRef' }),
    );
    expect(() =>
      validateAssetCatalogEntry({ ...makeEntryInput(), extraField: 1 }),
    ).toThrow(expect.objectContaining({ code: 'invalid_entry', path: '$.extraField' }));
  });

  it('拒绝凭证材料字段名进入目录项', () => {
    expect(() =>
      validateAssetCatalogEntry({ ...makeEntryInput(), sessionToken: 'x' }),
    ).toThrow(expect.objectContaining({ code: 'credential_material_forbidden' }));
  });

  it('拒绝空白 mediaRef', () => {
    expect(() => validateAssetCatalogEntry(makeEntryInput({ mediaRef: '   ' }))).toThrow(
      expect.objectContaining({ code: 'invalid_entry', path: '$.mediaRef' }),
    );
  });

  it('拒绝不符合 AssetV1 形状的资产（非法 sha256 / mediaType / 空白来源）', () => {
    expect(() =>
      validateAssetCatalogEntry(makeEntryInput({ asset: { sha256: 'abc123' } })),
    ).toThrow(expect.objectContaining({ code: 'invalid_asset', path: '$.asset.sha256' }));
    expect(() =>
      validateAssetCatalogEntry(
        makeEntryInput({ asset: { mediaType: 'pdf' as AssetV1['mediaType'] } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_asset', path: '$.asset.mediaType' }));
    expect(() =>
      validateAssetCatalogEntry(makeEntryInput({ asset: { rightsHolder: '  ' } })),
    ).toThrow(expect.objectContaining({ code: 'invalid_asset', path: '$.asset.rightsHolder' }));
    expect(() =>
      validateAssetCatalogEntry(makeEntryInput({ asset: { importedAt: '2026-09-01' } })),
    ).toThrow(expect.objectContaining({ code: 'invalid_asset', path: '$.asset.importedAt' }));
  });

  it('拒绝非法授权结构（未知平台 / 非法日期 / 倒挂有效期 / 非法证据）', () => {
    const grantWith = (overrides: Partial<RightsGrant>): RightsGrant | null =>
      makeGrant(overrides);
    expect(() =>
      validateAssetCatalogEntry(
        makeEntryInput({
          rightsGrant: grantWith({
            platforms: ['tiktok'] as unknown as RightsGrant['platforms'],
          }),
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'invalid_grant', path: '$.rightsGrant.platforms[0]' }),
    );
    expect(() =>
      validateAssetCatalogEntry(
        makeEntryInput({ rightsGrant: grantWith({ validFrom: '2026-01-01' }) }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'invalid_grant', path: '$.rightsGrant.validFrom' }),
    );
    expect(() =>
      validateAssetCatalogEntry(
        makeEntryInput({
          rightsGrant: grantWith({
            validFrom: '2027-01-01T00:00:00.000Z',
            validUntil: '2026-01-01T00:00:00.000Z',
          }),
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'invalid_grant', path: '$.rightsGrant.validUntil' }),
    );
    expect(() =>
      validateAssetCatalogEntry(
        makeEntryInput({
          rightsGrant: grantWith({
            evidence: [
              {
                kind: 'vibes' as RightsGrant['evidence'][number]['kind'],
                ref: 'evidence/x.pdf',
                collectedAt: '2026-08-01T10:00:00.000Z',
                note: null,
              },
            ],
          }),
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'invalid_grant', path: '$.rightsGrant.evidence[0].kind' }),
    );
    expect(() =>
      validateAssetCatalogEntry(
        makeEntryInput({
          rightsGrant: grantWith({
            evidence: [
              {
                kind: 'purchase-record',
                ref: '   ',
                collectedAt: '2026-08-01T10:00:00.000Z',
                note: null,
              },
            ],
          }),
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'invalid_grant', path: '$.rightsGrant.evidence[0].ref' }),
    );
  });

  it('拒绝日历非法的 ISO 日期时间（模式匹配但 Date.parse 为 NaN）', () => {
    expect(() =>
      validateAssetCatalogEntry(
        makeEntryInput({ rightsGrant: makeGrant({ validFrom: '2026-13-01T00:00:00.000Z' }) }),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'invalid_grant', path: '$.rightsGrant.validFrom' }),
    );
  });
});

// ——————————————————————————————— 授权闸门 ———————————————————————————————

describe('evaluateAssetEligibility：fail-closed 授权闸门', () => {
  it('完整结构化授权在有效期内对授权平台/地区/商业用途放行', () => {
    const entry = validateAssetCatalogEntry(makeEntryInput());
    const result = evaluateAssetEligibility(entry, CONTEXT);
    expect(result.eligible).toBe(true);
    expect(result.blockReasons).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blockReasons)).toBe(true);
  });

  it('对四个平台分别按授权范围放行', () => {
    const entry = validateAssetCatalogEntry(makeEntryInput());
    for (const platform of PRODUCTION_PLATFORMS) {
      const result = evaluateAssetEligibility(entry, { ...CONTEXT, platform });
      expect(result.eligible, `platform=${platform}`).toBe(true);
    }
  });

  it('授权未覆盖的平台被阻断（授权给抖音不等于授权给小红书）', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ platforms: ['douyin'] }) }),
    );
    const result = evaluateAssetEligibility(entry, { ...CONTEXT, platform: 'xiaohongshu' });
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('platform_not_allowed');
  });

  it('authorizedForAutoUse=false 时即使授权完整也阻断（保留给人工处理）', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({ asset: { authorizedForAutoUse: false } }),
    );
    const result = evaluateAssetEligibility(entry, CONTEXT);
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('auto_use_flag_false');
  });

  it('authorizedForAutoUse=true 单独不足以放行：无结构化授权仍阻断', () => {
    const entry = validateAssetCatalogEntry(makeEntryInput({ rightsGrant: null }));
    expect(entry.asset.authorizedForAutoUse).toBe(true);
    const result = evaluateAssetEligibility(entry, CONTEXT);
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('missing_grant');
  });

  it('自由文本 usageScope 绝不作为机器放行依据（声称全球永久也阻断）', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({
        asset: { usageScope: '全球全平台永久商用，无任何限制' },
        rightsGrant: null,
      }),
    );
    const result = evaluateAssetEligibility(entry, CONTEXT);
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('missing_grant');
  });

  it('闸门不读取 usageScope：空文本 + 有效结构化授权仍放行', () => {
    // 通过 cast 绕过注册校验（契约要求 usageScope 非空），证明机器判定与自由文本无关。
    const entry = {
      ...makeEntryInput({ asset: { usageScope: '' } }),
    } as unknown as AssetCatalogEntry;
    const result = evaluateAssetEligibility(entry, CONTEXT);
    expect(result.eligible).toBe(true);
  });

  it('未知地区阻断；worldwide 保留词覆盖任意地区', () => {
    const cnOnly = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ regions: ['cn'] }) }),
    );
    const jp = evaluateAssetEligibility(cnOnly, { ...CONTEXT, region: 'jp' });
    expect(jp.eligible).toBe(false);
    expect(jp.blockReasons).toContain('region_not_allowed');

    const worldwide = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ regions: ['WORLDWIDE'] }) }),
    );
    for (const region of ['cn', 'jp', 'us', 'de']) {
      const result = evaluateAssetEligibility(worldwide, { ...CONTEXT, region });
      expect(result.eligible, `region=${region}`).toBe(true);
    }
  });

  it('地区匹配大小写与首尾空白不敏感，但空地区数组阻断一切', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ regions: [' CN '] }) }),
    );
    expect(evaluateAssetEligibility(entry, { ...CONTEXT, region: 'cn' }).eligible).toBe(true);
    expect(evaluateAssetEligibility(entry, { ...CONTEXT, region: 'CN' }).eligible).toBe(true);

    const empty = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ regions: [] }) }),
    );
    expect(evaluateAssetEligibility(empty, CONTEXT).blockReasons).toContain(
      'region_not_allowed',
    );
  });

  it('商业用途不符阻断：prohibited 与 unknown 都拒绝商业短视频', () => {
    for (const use of ['prohibited', 'unknown'] as const) {
      const entry = validateAssetCatalogEntry(
        makeEntryInput({ rightsGrant: makeGrant({ commercialShortVideoUse: use }) }),
      );
      const result = evaluateAssetEligibility(entry, CONTEXT);
      expect(result.eligible).toBe(false);
      expect(result.blockReasons).toContain(
        use === 'prohibited' ? 'commercial_use_prohibited' : 'commercial_use_unknown',
      );
    }
  });

  it('非商业用途不受 commercialShortVideoUse 阻断', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({
        rightsGrant: makeGrant({ commercialShortVideoUse: 'prohibited' }),
      }),
    );
    const result = evaluateAssetEligibility(entry, {
      ...CONTEXT,
      commercialShortVideo: false,
    });
    expect(result.eligible).toBe(true);
  });

  it('有效期边界包含端点；早于生效或晚于截止都阻断', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({
        rightsGrant: makeGrant({
          validFrom: '2026-09-25T12:00:00.000Z',
          validUntil: '2026-09-25T20:00:00+08:00', // == 12:00:00.000Z
        }),
      }),
    );
    expect(
      evaluateAssetEligibility(entry, { ...CONTEXT, usedAt: '2026-09-25T12:00:00.000Z' })
        .eligible,
    ).toBe(true);
    const expired = evaluateAssetEligibility(entry, {
      ...CONTEXT,
      usedAt: '2026-09-25T12:00:00.001Z',
    });
    expect(expired.blockReasons).toContain('grant_expired');
    const notStarted = evaluateAssetEligibility(entry, {
      ...CONTEXT,
      usedAt: '2026-09-25T11:59:59.999Z',
    });
    expect(notStarted.blockReasons).toContain('grant_not_started');
  });

  it('validUntil 为 null 表示无固定截止，远期使用仍放行', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ validUntil: null }) }),
    );
    const result = evaluateAssetEligibility(entry, {
      ...CONTEXT,
      usedAt: '2099-01-01T00:00:00.000Z',
    });
    expect(result.eligible).toBe(true);
  });

  it('证据数组为空阻断（授权声明必须挂结构化证据引用）', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ evidence: [] }) }),
    );
    const result = evaluateAssetEligibility(entry, CONTEXT);
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('missing_evidence');
  });

  it('同时违规时收集全部阻断原因（过期 + 平台不符）', () => {
    const entry = validateAssetCatalogEntry(
      makeEntryInput({
        rightsGrant: makeGrant({
          platforms: ['douyin'],
          validUntil: '2026-09-01T00:00:00.000Z',
        }),
      }),
    );
    const result = evaluateAssetEligibility(entry, { ...CONTEXT, platform: 'kuaishou' });
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('platform_not_allowed');
    expect(result.blockReasons).toContain('grant_expired');
  });

  it('防御性闸门：绕过注册校验的空白来源/权利持有人仍被阻断', () => {
    const bypassed = {
      asset: makeAsset({ rightsHolder: '   ', authorizedForAutoUse: true }),
      mediaRef: 'media-store/x.mp4',
      rightsGrant: makeGrant(),
    } as unknown as AssetCatalogEntry;
    const result = evaluateAssetEligibility(bypassed, CONTEXT);
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('missing_provenance');
  });

  it('防御性闸门：结构损坏的授权按 invalid_grant 阻断而非放行', () => {
    const broken = {
      asset: makeAsset(),
      mediaRef: 'media-store/x.mp4',
      rightsGrant: { ...makeGrant(), platforms: 'douyin', validFrom: 'not-a-date' },
    } as unknown as AssetCatalogEntry;
    const result = evaluateAssetEligibility(broken, CONTEXT);
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('invalid_grant');
  });

  it('条目本身不是对象时返回 invalid_entry，不抛异常', () => {
    for (const garbage of [null, undefined, 42, 'asset-1']) {
      const result = evaluateAssetEligibility(garbage as unknown as AssetCatalogEntry, CONTEXT);
      expect(result.eligible).toBe(false);
      expect(result.blockReasons).toEqual(['invalid_entry']);
    }
  });

  it('非法 context 抛 invalid_context（含日历非法时间与空地区）', () => {
    const entry = validateAssetCatalogEntry(makeEntryInput());
    const badContexts: unknown[] = [
      { ...CONTEXT, platform: 'bilibili' },
      { ...CONTEXT, region: '   ' },
      { ...CONTEXT, usedAt: '2026-09-25' },
      { ...CONTEXT, usedAt: '2026-13-01T00:00:00.000Z' },
      { ...CONTEXT, commercialShortVideo: 'yes' },
      null,
    ];
    for (const bad of badContexts) {
      expect(
        () => evaluateAssetEligibility(entry, bad as AssetUsageContext),
        JSON.stringify(bad),
      ).toThrow(expect.objectContaining({ code: 'invalid_context' }));
    }
    expect(() => validateAssetUsageContext(CONTEXT)).not.toThrow();
  });
});

// ——————————————————————————————— 目录类 ———————————————————————————————

describe('AssetRightsCatalog：注册、冲突与状态隔离', () => {
  it('register 后可按 ID 取回，entries 保持注册顺序', () => {
    const catalog = new AssetRightsCatalog();
    const first = catalog.register(makeEntryInput());
    const second = catalog.register(
      makeEntryInput({
        asset: { id: 'asset-2', sha256: SHA_B },
        mediaRef: 'media-store/asset-2.mp4',
      }),
    );
    expect(catalog.get('asset-1')).toBe(first);
    expect(catalog.get('asset-2')).toBe(second);
    expect(catalog.get('missing')).toBeNull();
    expect(catalog.entries().map((entry) => entry.asset.id)).toEqual(['asset-1', 'asset-2']);
    expect(Object.isFrozen(catalog.entries())).toBe(true);
  });

  it('构造函数接受初始条目数组', () => {
    const catalog = new AssetRightsCatalog([
      makeEntryInput(),
      makeEntryInput({ asset: { id: 'asset-2', sha256: SHA_B } }),
    ]);
    expect(catalog.entries()).toHaveLength(2);
    expect(() => new AssetRightsCatalog([{ broken: true }])).toThrow(AssetRightsError);
  });

  it('重复 ID 注册显式报 duplicate_id，原条目不被覆盖', () => {
    const catalog = new AssetRightsCatalog([makeEntryInput()]);
    const conflict = makeEntryInput({ mediaRef: 'media-store/other.mp4' });
    expect(() => catalog.register(conflict)).toThrow(
      expect.objectContaining({ code: 'duplicate_id', path: '$.asset.id' }),
    );
    expect(catalog.entries()).toHaveLength(1);
    expect(catalog.get('asset-1')!.mediaRef).toBe('media-store/asset-1.mp4');
  });

  it('不同 ID 但相同 sha256 显式报 duplicate_sha256（大小写不敏感）', () => {
    const catalog = new AssetRightsCatalog([makeEntryInput()]);
    expect(() =>
      catalog.register(
        makeEntryInput({ asset: { id: 'asset-2', sha256: SHA_A.toUpperCase() } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'duplicate_sha256', path: '$.asset.sha256' }));
    expect(catalog.entries()).toHaveLength(1);
  });

  it('注册时深拷贝输入：注册后修改原对象不影响目录内容', () => {
    const input = makeEntryInput();
    const catalog = new AssetRightsCatalog();
    catalog.register(input);
    input.asset.tags.push('被篡改');
    input.rightsGrant!.platforms.push('xiaohongshu');
    input.rightsGrant!.evidence[0].ref = 'evidence/forged.pdf';
    const stored = catalog.get('asset-1')!;
    expect(stored.asset.tags).toEqual(['城市', '夜景']);
    expect(stored.rightsGrant!.evidence[0].ref).toBe('evidence/order-123.pdf');
  });

  it('eligibleAssets 只返回通过闸门的条目，未授权条目仍保留在目录中', () => {
    const catalog = new AssetRightsCatalog([
      makeEntryInput(),
      makeEntryInput({
        asset: { id: 'asset-2', sha256: SHA_B, authorizedForAutoUse: false },
        mediaRef: 'media-store/asset-2.mp4',
      }),
      makeEntryInput({
        asset: { id: 'asset-3', sha256: SHA_C },
        mediaRef: 'media-store/asset-3.mp4',
        rightsGrant: null,
      }),
    ]);
    const eligible = catalog.eligibleAssets(CONTEXT);
    expect(eligible.map((entry) => entry.asset.id)).toEqual(['asset-1']);
    expect(catalog.entries()).toHaveLength(3);
    expect(() => catalog.eligibleAssets({ ...CONTEXT, region: 42 as unknown as string })).toThrow(
      expect.objectContaining({ code: 'invalid_context' }),
    );
  });

  it('selectEligibleAssets 独立纯函数与目录方法行为一致', () => {
    const entries = [
      validateAssetCatalogEntry(makeEntryInput()),
      validateAssetCatalogEntry(
        makeEntryInput({ asset: { id: 'asset-2', sha256: SHA_B }, rightsGrant: null }),
      ),
    ];
    expect(selectEligibleAssets(entries, CONTEXT).map((e) => e.asset.id)).toEqual(['asset-1']);
    expect(selectEligibleAssets(entries, CONTEXT)).toEqual(
      new AssetRightsCatalog(entries).eligibleAssets(CONTEXT),
    );
  });
});

// ——————————————————————————————— 推荐：授权优先 ———————————————————————————————

describe('recommendBroll：授权筛选先于语义检索', () => {
  it('没有合格资产时返回 no_eligible_assets，且不调用检索端口', async () => {
    const catalog = new AssetRightsCatalog([
      makeEntryInput({ asset: { authorizedForAutoUse: false } }),
      makeEntryInput({
        asset: { id: 'asset-2', sha256: SHA_B },
        mediaRef: 'media-store/asset-2.mp4',
        rightsGrant: null,
      }),
    ]);
    const port = portReturning([{ assetId: 'asset-1', score: 0.99 }]);
    const result = await catalog.recommendBroll(QUERY, CONTEXT, port);
    expect(result.status).toBe('no_eligible_assets');
    expect(result.recommendations).toEqual([]);
    expect(result.portCalled).toBe(false);
    expect(result.candidateAssetIds).toEqual([]);
    expect(result.message).not.toBeNull();
    expect(port).not.toHaveBeenCalled();
  });

  it('端口只接收已授权 ID 的冻结候选集（过期/无权条目不在其中）', async () => {
    const catalog = new AssetRightsCatalog([
      makeEntryInput(),
      makeEntryInput({
        asset: { id: 'asset-2', sha256: SHA_B },
        mediaRef: 'media-store/asset-2.mp4',
      }),
      makeEntryInput({
        asset: { id: 'asset-3', sha256: SHA_C },
        mediaRef: 'media-store/asset-3.mp4',
        rightsGrant: makeGrant({ validUntil: '2026-09-01T00:00:00.000Z' }),
      }),
    ]);
    const port = vi.fn(async (ids: readonly string[]) =>
      ids.map((assetId) => ({ assetId, score: 0.5 })),
    );
    const result = await catalog.recommendBroll(QUERY, CONTEXT, port);
    expect(port).toHaveBeenCalledTimes(1);
    const [passedIds, passedQuery] = port.mock.calls[0];
    expect(passedIds).toEqual(['asset-1', 'asset-2']);
    expect(Object.isFrozen(passedIds)).toBe(true);
    expect(passedQuery.text).toBe(QUERY.text);
    expect(result.status).toBe('ok');
    expect(result.candidateAssetIds).toEqual(['asset-1', 'asset-2']);
    expect(result.recommendations.map((r) => r.assetId)).toEqual(['asset-1', 'asset-2']);
  });

  it('混合目录中输出只含已授权资产，且携带完整追溯字段', async () => {
    const catalog = new AssetRightsCatalog([
      makeEntryInput({
        asset: {
          id: 'asset-1',
          tags: ['城市', '夜景', '航拍'],
          source: '2026-08-01 购于 stock.example（订单 #123）',
          rightsHolder: 'Example Stock Ltd.',
          license: 'purchased-stock',
        },
      }),
      makeEntryInput({
        asset: { id: 'asset-2', sha256: SHA_B, authorizedForAutoUse: false },
        mediaRef: 'media-store/asset-2.mp4',
      }),
    ]);
    const result = await catalog.recommendBroll(
      { ...QUERY, preferredTags: ['夜景', '美食'] },
      CONTEXT,
      portReturning([{ assetId: 'asset-1', score: 0.9 }, { assetId: 'asset-2', score: 0.95 }]),
    );
    expect(result.status).toBe('ok');
    expect(result.recommendations).toHaveLength(1);
    const rec = result.recommendations[0];
    expect(rec.assetId).toBe('asset-1');
    expect(rec.sha256).toBe(SHA_A);
    expect(rec.mediaRef).toBe('media-store/asset-1.mp4');
    expect(rec.mediaType).toBe('video');
    expect(rec.source).toBe('2026-08-01 购于 stock.example（订单 #123）');
    expect(rec.rightsHolder).toBe('Example Stock Ltd.');
    expect(rec.license).toBe('purchased-stock');
    expect(rec.evidenceRefs).toEqual(['evidence/order-123.pdf']);
    expect(rec.grantValidFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(rec.grantValidUntil).toBe('2027-01-01T00:00:00.000Z');
    expect(rec.similarity).toBe(0.9); // 端口分数原样透传，不加工
    expect(rec.matchedTags).toEqual(['夜景']);
    expect(result.droppedHits.unauthorized).toBe(1); // asset-2 越权命中被丢弃
  });
});

// ——————————————————————————————— 推荐：端口输出净化 ———————————————————————————————

describe('recommendBroll：语义端口输出净化与异常安全', () => {
  function catalogWithTwoEligible(): AssetRightsCatalog {
    return new AssetRightsCatalog([
      makeEntryInput(),
      makeEntryInput({
        asset: { id: 'asset-2', sha256: SHA_B },
        mediaRef: 'media-store/asset-2.mp4',
      }),
    ]);
  }

  it('端口返回未注册 ID 与已注册但无权 ID 时全部丢弃，绝不输出', async () => {
    const catalog = new AssetRightsCatalog([
      makeEntryInput(),
      makeEntryInput({
        asset: { id: 'asset-2', sha256: SHA_B, authorizedForAutoUse: false },
        mediaRef: 'media-store/asset-2.mp4',
      }),
    ]);
    const result = await catalog.recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([
        { assetId: 'ghost-asset', score: 0.99 },
        { assetId: 'asset-2', score: 0.98 },
        { assetId: 'asset-1', score: 0.5 },
      ]),
    );
    expect(result.status).toBe('ok');
    expect(result.recommendations.map((r) => r.assetId)).toEqual(['asset-1']);
    expect(result.droppedHits.unauthorized).toBe(2);
  });

  it('端口返回重复 ID 时保留第一条有效命中', async () => {
    const result = await catalogWithTwoEligible().recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([
        { assetId: 'asset-1', score: 0.9 },
        { assetId: 'asset-1', score: 0.2 },
        { assetId: 'asset-2', score: 0.5 },
      ]),
    );
    expect(result.recommendations.map((r) => [r.assetId, r.similarity])).toEqual([
      ['asset-1', 0.9],
      ['asset-2', 0.5],
    ]);
    expect(result.droppedHits.duplicate).toBe(1);
  });

  it('非法分数（NaN/Infinity/越界/非数字）与畸形命中全部丢弃', async () => {
    const result = await catalogWithTwoEligible().recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([
        { assetId: 'asset-1', score: Number.NaN },
        { assetId: 'asset-1', score: Number.POSITIVE_INFINITY },
        { assetId: 'asset-2', score: -0.1 },
        { assetId: 'asset-2', score: 1.5 },
        { assetId: 'asset-2', score: '0.9' },
        { assetId: 42, score: 0.9 },
        null,
        { score: 0.9 },
      ]),
    );
    expect(result.status).toBe('ok');
    expect(result.recommendations).toEqual([]);
    expect(result.droppedHits.invalid).toBe(8);
    expect(result.droppedHits.unauthorized).toBe(0);
  });

  it('minScore 阈值过滤低分命中并单独计数', async () => {
    const result = await catalogWithTwoEligible().recommendBroll(
      { ...QUERY, minScore: 0.5 },
      CONTEXT,
      portReturning([
        { assetId: 'asset-1', score: 0.4999 },
        { assetId: 'asset-2', score: 0.5 },
      ]),
    );
    expect(result.recommendations.map((r) => r.assetId)).toEqual(['asset-2']);
    expect(result.droppedHits.belowThreshold).toBe(1);
  });

  it('端口抛异常时返回 index_unavailable，异常不外抛且消息不回显异常内容', async () => {
    const port: SemanticSearchPort = vi.fn(async () => {
      throw new Error('boom: C:\\secret\\index-path 连接失败');
    });
    const result = await catalogWithTwoEligible().recommendBroll(QUERY, CONTEXT, port);
    expect(result.status).toBe('index_unavailable');
    expect(result.recommendations).toEqual([]);
    expect(result.portCalled).toBe(true);
    expect(result.message).not.toBeNull();
    expect(result.message).not.toContain('boom');
    expect(result.message).not.toContain('secret');
  });

  it('端口同步抛异常同样返回 index_unavailable', async () => {
    const port = (() => {
      throw new Error('sync failure');
    }) as unknown as SemanticSearchPort;
    const result = await catalogWithTwoEligible().recommendBroll(QUERY, CONTEXT, port);
    expect(result.status).toBe('index_unavailable');
    expect(result.recommendations).toEqual([]);
  });

  it('端口返回非数组时视为索引不可用', async () => {
    const result = await catalogWithTwoEligible().recommendBroll(
      QUERY,
      CONTEXT,
      portReturning({ not: 'an-array' } as unknown),
    );
    expect(result.status).toBe('index_unavailable');
    expect(result.recommendations).toEqual([]);
  });

  it('未注入端口（null）时返回 index_unavailable，不退化为随机推荐', async () => {
    const result = await catalogWithTwoEligible().recommendBroll(QUERY, CONTEXT, null);
    expect(result.status).toBe('index_unavailable');
    expect(result.portCalled).toBe(false);
    expect(result.recommendations).toEqual([]);
    expect(result.eligibleCount).toBe(2);
    expect(result.message).not.toBeNull();
  });

  it('端口返回同步数组（非 Promise）也被接受', async () => {
    const syncPort: SemanticSearchPort = vi.fn(() => [{ assetId: 'asset-1', score: 0.7 }]);
    const result = await catalogWithTwoEligible().recommendBroll(QUERY, CONTEXT, syncPort);
    expect(result.status).toBe('ok');
    expect(result.recommendations.map((r) => r.assetId)).toEqual(['asset-1']);
  });

  it('零匹配是合法结果：ok + 空推荐 + 零丢弃', async () => {
    const result = await catalogWithTwoEligible().recommendBroll(QUERY, CONTEXT, portReturning([]));
    expect(result.status).toBe('ok');
    expect(result.recommendations).toEqual([]);
    expect(result.droppedHits).toEqual({
      unauthorized: 0,
      invalid: 0,
      duplicate: 0,
      belowThreshold: 0,
    });
    expect(result.eligibleCount).toBe(2);
  });
});

// ——————————————————————————————— 推荐：排序、截断与理由 ———————————————————————————————

describe('recommendBroll：确定性排序、截断与可解释理由', () => {
  function catalogWithThree(): AssetRightsCatalog {
    return new AssetRightsCatalog([
      makeEntryInput({ asset: { id: 'asset-a', sha256: SHA_A, tags: ['城市', '夜景'] } }),
      makeEntryInput({
        asset: { id: 'asset-b', sha256: SHA_B, tags: ['航拍'] },
        mediaRef: 'media-store/b.mp4',
      }),
      makeEntryInput({
        asset: { id: 'asset-c', sha256: SHA_C, tags: ['美食'] },
        mediaRef: 'media-store/c.mp4',
      }),
    ]);
  }

  it('按分数降序输出，与端口返回顺序无关', async () => {
    const result = await catalogWithThree().recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([
        { assetId: 'asset-a', score: 0.5 },
        { assetId: 'asset-b', score: 0.9 },
        { assetId: 'asset-c', score: 0.7 },
      ]),
    );
    expect(result.recommendations.map((r) => r.assetId)).toEqual([
      'asset-b',
      'asset-c',
      'asset-a',
    ]);
  });

  it('同分时按资产 ID 升序，输出与端口乱序输入无关（排序稳定）', async () => {
    const orderOne = await catalogWithThree().recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([
        { assetId: 'asset-c', score: 0.9 },
        { assetId: 'asset-a', score: 0.9 },
        { assetId: 'asset-b', score: 0.9 },
      ]),
    );
    const orderTwo = await catalogWithThree().recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([
        { assetId: 'asset-b', score: 0.9 },
        { assetId: 'asset-c', score: 0.9 },
        { assetId: 'asset-a', score: 0.9 },
      ]),
    );
    const expected = ['asset-a', 'asset-b', 'asset-c'];
    expect(orderOne.recommendations.map((r) => r.assetId)).toEqual(expected);
    expect(orderTwo.recommendations.map((r) => r.assetId)).toEqual(expected);
  });

  it('maxResults 在排序后截断取前 N', async () => {
    const result = await catalogWithThree().recommendBroll(
      { ...QUERY, maxResults: 2 },
      CONTEXT,
      portReturning([
        { assetId: 'asset-a', score: 0.1 },
        { assetId: 'asset-b', score: 0.9 },
        { assetId: 'asset-c', score: 0.7 },
      ]),
    );
    expect(result.recommendations.map((r) => r.assetId)).toEqual(['asset-b', 'asset-c']);
  });

  it('理由由标签匹配、端口分数与权利事实组合，不伪造模型证据', async () => {
    const result = await catalogWithThree().recommendBroll(
      { ...QUERY, preferredTags: ['夜景', '美食'] },
      CONTEXT,
      portReturning([{ assetId: 'asset-a', score: 0.87 }]),
    );
    const rec = result.recommendations[0];
    const joined = rec.reasons.join('\n');
    // 分数来自端口且注明出处（不得伪装成本模块或模型复核）。
    expect(joined).toContain('0.87');
    expect(joined).toContain('语义检索端口');
    // 标签匹配是集合交集事实。
    expect(rec.matchedTags).toEqual(['夜景']);
    expect(joined).toContain('夜景');
    // 权利与来源追溯事实进入理由。
    expect(joined).toContain('Example Stock Ltd.');
    expect(joined).toContain('purchased-stock');
    expect(joined).toContain('evidence/order-123.pdf');
    // 理由非空且全部为字符串。
    expect(rec.reasons.length).toBeGreaterThanOrEqual(2);
    for (const reason of rec.reasons) expect(typeof reason).toBe('string');
  });

  it('无标签匹配时理由不包含标签匹配项，也不虚构标签', async () => {
    const result = await catalogWithThree().recommendBroll(
      { ...QUERY, preferredTags: ['美食'] },
      CONTEXT,
      portReturning([{ assetId: 'asset-a', score: 0.6 }]),
    );
    const rec = result.recommendations[0];
    expect(rec.matchedTags).toEqual([]);
    expect(rec.reasons.join('\n')).not.toContain('标签匹配');
  });

  it('未提供 preferredTags 时 matchedTags 为空数组', async () => {
    const result = await catalogWithThree().recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([{ assetId: 'asset-a', score: 0.6 }]),
    );
    expect(result.recommendations[0].matchedTags).toEqual([]);
  });

  it('结果与推荐条目深冻结，不与目录内部状态共享可变引用', async () => {
    const catalog = catalogWithThree();
    const result = await catalog.recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([{ assetId: 'asset-a', score: 0.6 }]),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.recommendations)).toBe(true);
    expect(Object.isFrozen(result.recommendations[0])).toBe(true);
    expect(Object.isFrozen(result.recommendations[0].reasons)).toBe(true);
    expect(Object.isFrozen(result.droppedHits)).toBe(true);
    expect(Object.isFrozen(result.candidateAssetIds)).toBe(true);
    // 两次调用返回不同数组实例（非共享可变状态）。
    const again = await catalog.recommendBroll(
      QUERY,
      CONTEXT,
      portReturning([{ assetId: 'asset-a', score: 0.6 }]),
    );
    expect(again.recommendations).not.toBe(result.recommendations);
    expect(again.recommendations).toEqual(result.recommendations);
  });
});

// ——————————————————————————————— 查询校验与独立纯函数 ———————————————————————————————

describe('validateBrollQuery / recommendBrollFromEntries', () => {
  it('拒绝非法查询（空文本 / 非正整数 maxResults / 越界 minScore / 未知字段）', () => {
    expect(() => validateBrollQuery({ text: '   ' })).toThrow(
      expect.objectContaining({ code: 'invalid_query', path: '$.text' }),
    );
    expect(() => validateBrollQuery({ text: 'x', maxResults: 0 })).toThrow(
      expect.objectContaining({ code: 'invalid_query', path: '$.maxResults' }),
    );
    expect(() => validateBrollQuery({ text: 'x', maxResults: 1.5 })).toThrow(
      expect.objectContaining({ code: 'invalid_query' }),
    );
    expect(() => validateBrollQuery({ text: 'x', minScore: 1.5 })).toThrow(
      expect.objectContaining({ code: 'invalid_query', path: '$.minScore' }),
    );
    expect(() => validateBrollQuery({ text: 'x', minScore: Number.NaN })).toThrow(
      expect.objectContaining({ code: 'invalid_query' }),
    );
    expect(() =>
      validateBrollQuery({ text: 'x', preferredTags: ['a', 5 as unknown as string] }),
    ).toThrow(expect.objectContaining({ code: 'invalid_query' }));
    expect(() =>
      validateBrollQuery({ text: 'x', limit: 3 } as unknown as BrollQuery),
    ).toThrow(expect.objectContaining({ code: 'invalid_query', path: '$.limit' }));
    expect(validateBrollQuery({ text: '夜景', maxResults: 3, minScore: 0 })).toEqual({
      text: '夜景',
      maxResults: 3,
      minScore: 0,
      preferredTags: [],
    });
  });

  it('非法查询/上下文在调用端口前抛出，端口不被触碰', async () => {
    const port = portReturning([{ assetId: 'asset-1', score: 0.9 }]);
    await expect(
      recommendBrollFromEntries(
        [validateAssetCatalogEntry(makeEntryInput())],
        { text: '' },
        CONTEXT,
        port,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'invalid_query' }));
    expect(port).not.toHaveBeenCalled();
  });

  it('独立纯函数对垃圾条目 fail-closed：损坏条目不进入输出也不抛异常', async () => {
    const good = validateAssetCatalogEntry(makeEntryInput());
    const garbage = {
      asset: makeAsset({ id: 'asset-evil', sha256: SHA_D, source: '' }),
      mediaRef: 'media-store/evil.mp4',
      rightsGrant: makeGrant(),
    } as unknown as AssetCatalogEntry;
    const result = await recommendBrollFromEntries(
      [garbage, good],
      QUERY,
      CONTEXT,
      portReturning([
        { assetId: 'asset-evil', score: 0.99 },
        { assetId: 'asset-1', score: 0.4 },
      ]),
    );
    expect(result.status).toBe('ok');
    expect(result.recommendations.map((r) => r.assetId)).toEqual(['asset-1']);
    expect(result.droppedHits.unauthorized).toBe(1);
  });

  it('独立纯函数与目录方法在相同输入下结果一致', async () => {
    const entries = [
      validateAssetCatalogEntry(makeEntryInput()),
      validateAssetCatalogEntry(
        makeEntryInput({ asset: { id: 'asset-2', sha256: SHA_B } }),
      ),
    ];
    const hits = [
      { assetId: 'asset-2', score: 0.8 },
      { assetId: 'asset-1', score: 0.6 },
    ];
    const viaFunction = await recommendBrollFromEntries(
      entries,
      QUERY,
      CONTEXT,
      portReturning(hits),
    );
    const viaCatalog = await new AssetRightsCatalog(entries).recommendBroll(
      QUERY,
      CONTEXT,
      portReturning(hits),
    );
    expect(viaFunction).toEqual(viaCatalog);
  });
});

describe('Codex 复核补充的授权负例', () => {
  it('仅授权 cn 的素材不能用于 worldwide 上下文', () => {
    const cnOnly = validateAssetCatalogEntry(
      makeEntryInput({ rightsGrant: makeGrant({ regions: ['cn'] }) }),
    );
    const result = evaluateAssetEligibility(cnOnly, { ...CONTEXT, region: 'worldwide' });
    expect(result.eligible).toBe(false);
    expect(result.blockReasons).toContain('region_not_allowed');
  });

  it('绕过注册校验的损坏素材不能进入语义端口候选集', async () => {
    const invalid = makeEntryInput({ asset: { sha256: 'not-a-sha256' } }) as AssetCatalogEntry;
    const port = vi.fn(async () => [{ assetId: invalid.asset.id, score: 0.9 }]);
    const result = await recommendBrollFromEntries([invalid], QUERY, CONTEXT, port);
    expect(port).not.toHaveBeenCalled();
    expect(result.candidateAssetIds).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it('凭证字段的任意后缀不出现在错误消息或错误路径', () => {
    const marker = 'SYNTHETIC_PRIVATE_VALUE_0123';
    const input = Object.assign(makeEntryInput(), { [`cookie${marker}`]: 'ignored' });
    let caught: unknown;
    try {
      validateAssetCatalogEntry(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AssetRightsError);
    const rightsError = caught as AssetRightsError;
    expect(rightsError.code).toBe('credential_material_forbidden');
    expect(rightsError.message).not.toContain(marker);
    expect(rightsError.path).not.toContain(marker);
  });

  it('异步检索期间外部改写输入不能伪造已筛选素材的来源和证据', async () => {
    const entry = makeEntryInput();
    const originalSource = entry.asset.source;
    const originalEvidenceRef = entry.rightsGrant!.evidence[0].ref;
    let complete!: (hits: readonly SemanticSearchHit[]) => void;
    const delayed = new Promise<readonly SemanticSearchHit[]>((resolve) => {
      complete = resolve;
    });
    const port = vi.fn(() => delayed);

    const pending = recommendBrollFromEntries([entry], QUERY, CONTEXT, port);
    expect(port).toHaveBeenCalledTimes(1);
    entry.asset.source = 'forged-after-check';
    entry.rightsGrant!.evidence[0].ref = 'forged-evidence';
    complete([{ assetId: entry.asset.id, score: 0.8 }]);

    const result = await pending;
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].source).toBe(originalSource);
    expect(result.recommendations[0].evidenceRefs).toEqual([originalEvidenceRef]);
  });
});

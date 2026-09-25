/**
 * 授权素材目录与可注入语义检索端口（P3-1 第一段）—— 纯函数 / 内存边界。
 *
 * 设计约束：
 * - 不依赖 Electron、磁盘、网络、模型、系统时间或全局状态。语义检索能力由调用方
 *   以 `SemanticSearchPort` 显式注入；未注入、抛异常或返回畸形结果时返回
 *   `index_unavailable`，绝不退化为本地随机推荐或目录顺序兜底。
 * - fail-closed 授权闸门：只有结构化 `RightsGrant` 明确覆盖平台 / 地区 / 商业短视频
 *   用途、处于有效期内且挂有非空证据引用，并且 `authorizedForAutoUse === true`、
 *   素材来源与权利持有人非空时，条目才可能进入语义检索候选集。
 *   `usageScope` 自由文本永远不作为机器放行依据。
 * - 本模块只做「已记录元数据」的一致性与边界匹配，不证明平台 / 地区 / 商业 / 期限
 *   授权的法律充分性，也不构成任何平台“原创”认定，不接触真实素材文件内容。
 * - 注册与输出均深拷贝 + 深冻结，不与调用方共享可变引用；ID / sha256 冲突显式报错。
 * - 错误消息不包含凭证材料或原始媒体内容；凭证字段名一律拒绝进入目录项。
 */

import {
  ASSET_MEDIA_TYPES,
  PRODUCTION_PLATFORMS,
} from '../../src/types/production-contracts';
import type {
  AssetMediaType,
  AssetV1,
  ProductionPlatform,
} from '../../src/types/production-contracts';

// ——————————————————————————————— 错误 ———————————————————————————————

export type AssetRightsErrorCode =
  | 'invalid_entry'
  | 'invalid_asset'
  | 'invalid_grant'
  | 'invalid_context'
  | 'invalid_query'
  | 'duplicate_id'
  | 'duplicate_sha256'
  | 'credential_material_forbidden';

/**
 * 素材权利目录错误。携带机器可判定的 code 与 JSON 路径式 path（根为 `$`），
 * 绝不把凭证值、原始媒体内容或端口异常文本写进 message。
 */
export class AssetRightsError extends Error {
  readonly code: AssetRightsErrorCode;
  readonly path: string;

  constructor(code: AssetRightsErrorCode, path: string, message: string) {
    super(`${message}（${path}）`);
    this.name = 'AssetRightsError';
    this.code = code;
    this.path = path;
  }
}

// ——————————————————————————————— 类型 ———————————————————————————————

export const COMMERCIAL_SHORT_VIDEO_USES = ['allowed', 'prohibited', 'unknown'] as const;

export type CommercialShortVideoUse = (typeof COMMERCIAL_SHORT_VIDEO_USES)[number];

export const RIGHTS_EVIDENCE_KINDS = [
  'purchase-record',
  'license-document',
  'contract',
  'platform-permission',
  'written-approval',
  'public-domain',
  'other',
] as const;

export type RightsEvidenceKind = (typeof RIGHTS_EVIDENCE_KINDS)[number];

/** 结构化授权证据引用；只保存引用与采集时间，不含证据文件内容。 */
export interface RightsEvidence {
  kind: RightsEvidenceKind;
  /** 证据引用（本地数据目录内路径 / 单据编号等），非空白。 */
  ref: string;
  /** 证据采集时间（ISO 8601）。 */
  collectedAt: string;
  note: string | null;
}

/**
 * 结构化授权边界（机器可执行）。字段齐全且匹配才可能放行；
 * `validFrom` / `validUntil` 为 null 表示「未记录该侧边界」，不是无限制授权。
 */
export interface RightsGrant {
  platforms: ProductionPlatform[];
  regions: string[];
  commercialShortVideoUse: CommercialShortVideoUse;
  validFrom: string | null;
  validUntil: string | null;
  evidence: RightsEvidence[];
}

/** 目录项：素材元数据 + 引用 + 结构化授权（未授权显式为 null）。 */
export interface AssetCatalogEntry {
  asset: AssetV1;
  mediaRef: string;
  rightsGrant: RightsGrant | null;
}

/** 使用上下文：平台、地区、使用时间与是否商业短视频。 */
export interface AssetUsageContext {
  platform: ProductionPlatform;
  region: string;
  usedAt: string;
  commercialShortVideo: boolean;
}

/** 语义检索查询（调用方输入，可含可选边界）。 */
export interface BrollQuery {
  text: string;
  maxResults?: number;
  minScore?: number;
  preferredTags?: string[];
}

/** 校验并补齐默认值后的查询（端口收到的形状）。 */
export interface NormalizedBrollQuery {
  readonly text: string;
  readonly maxResults: number;
  readonly minScore: number;
  readonly preferredTags: readonly string[];
}

/** 语义检索端口单条命中。端口输出一律视为不可信。 */
export interface SemanticSearchHit {
  assetId: string;
  score: number;
}

/** 可注入语义检索端口：只接收已通过授权闸门的候选 ID 集。 */
export type SemanticSearchPort = (
  candidateAssetIds: readonly string[],
  query: NormalizedBrollQuery,
) => readonly SemanticSearchHit[] | Promise<readonly SemanticSearchHit[]>;

export type AssetEligibilityBlockReason =
  | 'invalid_entry'
  | 'missing_provenance'
  | 'missing_media_ref'
  | 'missing_grant'
  | 'invalid_grant'
  | 'auto_use_flag_false'
  | 'platform_not_allowed'
  | 'region_not_allowed'
  | 'commercial_use_prohibited'
  | 'commercial_use_unknown'
  | 'grant_not_started'
  | 'grant_expired'
  | 'missing_evidence';

export interface AssetEligibilityResult {
  readonly eligible: boolean;
  readonly blockReasons: readonly AssetEligibilityBlockReason[];
}

export interface BrollDroppedHits {
  unauthorized: number;
  invalid: number;
  duplicate: number;
  belowThreshold: number;
}

export type BrollStatus = 'ok' | 'no_eligible_assets' | 'index_unavailable';

export interface BrollRecommendation {
  assetId: string;
  sha256: string;
  mediaRef: string;
  mediaType: AssetMediaType;
  source: string;
  rightsHolder: string;
  license: string;
  evidenceRefs: string[];
  grantValidFrom: string | null;
  grantValidUntil: string | null;
  /** 端口原始相似度，原样透传。 */
  similarity: number;
  matchedTags: string[];
  reasons: string[];
}

export interface BrollRecommendationResult {
  status: BrollStatus;
  recommendations: readonly BrollRecommendation[];
  candidateAssetIds: readonly string[];
  droppedHits: BrollDroppedHits;
  portCalled: boolean;
  eligibleCount: number;
  message: string | null;
}

// ——————————————————————————————— 常量与基础校验 ———————————————————————————————

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

/** 与 src/lib/production-document.ts 相同的凭证字段名模式。 */
const CREDENTIAL_KEY_PATTERN =
  /(cookie|token|password|passwd|secret|authorization|apikey|privatekey|credential|sessionid|storagestate|sessionkey)/i;

const ENTRY_KEYS = ['asset', 'mediaRef', 'rightsGrant'] as const;

const ASSET_KEYS = [
  'id',
  'sha256',
  'mediaType',
  'durationMs',
  'tags',
  'transcript',
  'embeddingRef',
  'source',
  'rightsHolder',
  'license',
  'usageScope',
  'authorizedForAutoUse',
  'importedAt',
] as const;

const GRANT_KEYS = [
  'platforms',
  'regions',
  'commercialShortVideoUse',
  'validFrom',
  'validUntil',
  'evidence',
] as const;

const EVIDENCE_KEYS = ['kind', 'ref', 'collectedAt', 'note'] as const;

const CONTEXT_KEYS = ['platform', 'region', 'usedAt', 'commercialShortVideo'] as const;

const QUERY_KEYS = ['text', 'maxResults', 'minScore', 'preferredTags'] as const;

const DEFAULT_MAX_RESULTS = 10;

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(key.replace(/[^a-z0-9]/gi, ''));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(code: AssetRightsErrorCode, path: string, message: string): never {
  throw new AssetRightsError(code, path, message);
}

function assertNoCredentialKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (isCredentialKey(key)) {
      // 凭证疑似字段名本身可能携带敏感字节：路径与消息一律使用固定脱敏文案，
      // 绝不回显原始键名或其任意前后缀（code 保持机器可判定）。
      fail(
        'credential_material_forbidden',
        `${path}.<redacted-credential-key>`,
        '疑似凭证材料字段名不允许进入素材目录项（字段名与字段值均已脱敏，不回显）',
      );
    }
    assertNoCredentialKeys(item, `${path}.${key}`);
  }
}

/** 既拒绝缺少必填字段，也拒绝未知字段（凭证字段已在上游单独拦截）。 */
function assertObjectKeys(
  value: unknown,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[],
  code: AssetRightsErrorCode,
  path: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) fail(code, path, '必须是普通 JSON 对象');
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(code, `${path}.${key}`, `缺少必填字段 "${key}"`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) fail(code, `${path}.${key}`, `未知字段 "${key}"`);
  }
  return value;
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  code: AssetRightsErrorCode,
  path: string,
): Record<string, unknown> {
  return assertObjectKeys(value, keys, keys, code, path);
}

function requireString(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): string {
  if (typeof value !== 'string') fail(code, path, '必须是字符串');
  return value;
}

function requireNonBlankString(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): string {
  if (!isNonBlankString(value)) fail(code, path, '必须是非空白字符串');
  return value;
}

function requireNullableString(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): string | null {
  if (value === null) return null;
  return requireString(value, path, code);
}

function requireIsoDateTime(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): string {
  const text = requireString(value, path, code);
  if (!ISO_DATE_TIME_PATTERN.test(text) || !Number.isFinite(Date.parse(text))) {
    fail(code, path, '必须是合法的 ISO 8601 日期时间字符串');
  }
  return text;
}

function requireNullableIsoDateTime(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): string | null {
  if (value === null) return null;
  return requireIsoDateTime(value, path, code);
}

function requireBoolean(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): boolean {
  if (typeof value !== 'boolean') fail(code, path, '必须是布尔值');
  return value;
}

function requireNullableNonNegativeInteger(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(code, path, '必须是非负整数或 null');
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: AssetRightsErrorCode,
  label: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(code, path, `${label}必须是 ${allowed.join(' / ')} 之一`);
  }
  return value as T;
}

function requireStringArray(
  value: unknown,
  path: string,
  code: AssetRightsErrorCode,
): string[] {
  if (!Array.isArray(value)) fail(code, path, '必须是字符串数组');
  return value.map((item, index) => requireString(item, `${path}[${index}]`, code));
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  return value;
}

// ——————————————————————————————— 注册校验 ———————————————————————————————

function validateAssetShape(value: unknown, path: string): AssetV1 {
  const obj = assertExactKeys(value, ASSET_KEYS, 'invalid_asset', path);
  return {
    id: requireNonBlankString(obj.id, `${path}.id`, 'invalid_asset'),
    sha256: (() => {
      const text = requireString(obj.sha256, `${path}.sha256`, 'invalid_asset');
      if (!SHA256_PATTERN.test(text)) {
        fail('invalid_asset', `${path}.sha256`, '必须是 64 位十六进制 sha256');
      }
      return text;
    })(),
    mediaType: requireEnum(
      obj.mediaType,
      ASSET_MEDIA_TYPES,
      `${path}.mediaType`,
      'invalid_asset',
      '素材媒体类型',
    ),
    durationMs: requireNullableNonNegativeInteger(
      obj.durationMs,
      `${path}.durationMs`,
      'invalid_asset',
    ),
    tags: requireStringArray(obj.tags, `${path}.tags`, 'invalid_asset'),
    transcript: requireNullableString(obj.transcript, `${path}.transcript`, 'invalid_asset'),
    embeddingRef: requireNullableString(obj.embeddingRef, `${path}.embeddingRef`, 'invalid_asset'),
    source: requireNonBlankString(obj.source, `${path}.source`, 'invalid_asset'),
    rightsHolder: requireNonBlankString(obj.rightsHolder, `${path}.rightsHolder`, 'invalid_asset'),
    license: requireNonBlankString(obj.license, `${path}.license`, 'invalid_asset'),
    usageScope: requireNonBlankString(obj.usageScope, `${path}.usageScope`, 'invalid_asset'),
    authorizedForAutoUse: requireBoolean(
      obj.authorizedForAutoUse,
      `${path}.authorizedForAutoUse`,
      'invalid_asset',
    ),
    importedAt: requireIsoDateTime(obj.importedAt, `${path}.importedAt`, 'invalid_asset'),
  };
}

function validateEvidenceShape(value: unknown, path: string): RightsEvidence {
  const obj = assertExactKeys(value, EVIDENCE_KEYS, 'invalid_grant', path);
  return {
    kind: requireEnum(
      obj.kind,
      RIGHTS_EVIDENCE_KINDS,
      `${path}.kind`,
      'invalid_grant',
      '授权证据类型',
    ),
    ref: requireNonBlankString(obj.ref, `${path}.ref`, 'invalid_grant'),
    collectedAt: requireIsoDateTime(obj.collectedAt, `${path}.collectedAt`, 'invalid_grant'),
    note: requireNullableString(obj.note, `${path}.note`, 'invalid_grant'),
  };
}

function validateRightsGrantShape(value: unknown, path: string): RightsGrant {
  const obj = assertExactKeys(value, GRANT_KEYS, 'invalid_grant', path);
  const platforms = (() => {
    if (!Array.isArray(obj.platforms)) fail('invalid_grant', `${path}.platforms`, '必须是平台数组');
    return obj.platforms.map((item, index) =>
      requireEnum(
        item,
        PRODUCTION_PLATFORMS,
        `${path}.platforms[${index}]`,
        'invalid_grant',
        '授权平台',
      ),
    );
  })();
  const regions = (() => {
    if (!Array.isArray(obj.regions)) {
      fail('invalid_grant', `${path}.regions`, '必须是地区字符串数组');
    }
    return obj.regions.map((item, index) =>
      requireNonBlankString(item, `${path}.regions[${index}]`, 'invalid_grant'),
    );
  })();
  const commercialShortVideoUse = requireEnum(
    obj.commercialShortVideoUse,
    COMMERCIAL_SHORT_VIDEO_USES,
    `${path}.commercialShortVideoUse`,
    'invalid_grant',
    '商业短视频用途',
  );
  const validFrom = requireNullableIsoDateTime(obj.validFrom, `${path}.validFrom`, 'invalid_grant');
  const validUntil = requireNullableIsoDateTime(
    obj.validUntil,
    `${path}.validUntil`,
    'invalid_grant',
  );
  if (
    validFrom !== null &&
    validUntil !== null &&
    Date.parse(validUntil) < Date.parse(validFrom)
  ) {
    fail('invalid_grant', `${path}.validUntil`, '授权截止时间早于生效时间');
  }
  const evidence = (() => {
    if (!Array.isArray(obj.evidence)) fail('invalid_grant', `${path}.evidence`, '必须是证据数组');
    return obj.evidence.map((item, index) =>
      validateEvidenceShape(item, `${path}.evidence[${index}]`),
    );
  })();
  return { platforms, regions, commercialShortVideoUse, validFrom, validUntil, evidence };
}

/**
 * 注册校验入口：凭证字段名、字段齐全性、AssetV1 形状、mediaRef 与结构化授权；
 * 合法时返回深拷贝 + 深冻结的条目，绝不与输入共享引用。
 */
export function validateAssetCatalogEntry(input: unknown): AssetCatalogEntry {
  assertNoCredentialKeys(input, '$');
  const obj = assertExactKeys(input, ENTRY_KEYS, 'invalid_entry', '$');
  const asset = validateAssetShape(obj.asset, '$.asset');
  const mediaRef = requireNonBlankString(obj.mediaRef, '$.mediaRef', 'invalid_entry');
  const rightsGrant =
    obj.rightsGrant === null
      ? null
      : validateRightsGrantShape(obj.rightsGrant, '$.rightsGrant');
  return deepFreeze({ asset, mediaRef, rightsGrant });
}

/** 校验使用上下文；任何非法输入抛 invalid_context。 */
export function validateAssetUsageContext(value: unknown): AssetUsageContext {
  const obj = assertExactKeys(value, CONTEXT_KEYS, 'invalid_context', '$');
  return deepFreeze({
    platform: requireEnum(
      obj.platform,
      PRODUCTION_PLATFORMS,
      '$.platform',
      'invalid_context',
      '平台',
    ),
    region: requireNonBlankString(obj.region, '$.region', 'invalid_context'),
    usedAt: requireIsoDateTime(obj.usedAt, '$.usedAt', 'invalid_context'),
    commercialShortVideo: requireBoolean(
      obj.commercialShortVideo,
      '$.commercialShortVideo',
      'invalid_context',
    ),
  });
}

/** 校验检索查询并补齐默认值；任何非法输入抛 invalid_query。 */
export function validateBrollQuery(value: unknown): NormalizedBrollQuery {
  const obj = assertObjectKeys(value, ['text'], QUERY_KEYS, 'invalid_query', '$');
  const text = requireNonBlankString(obj.text, '$.text', 'invalid_query');
  let maxResults = DEFAULT_MAX_RESULTS;
  if (obj.maxResults !== undefined) {
    if (
      typeof obj.maxResults !== 'number' ||
      !Number.isInteger(obj.maxResults) ||
      obj.maxResults <= 0
    ) {
      fail('invalid_query', '$.maxResults', 'maxResults 必须是正整数');
    }
    maxResults = obj.maxResults;
  }
  let minScore = 0;
  if (obj.minScore !== undefined) {
    if (
      typeof obj.minScore !== 'number' ||
      !Number.isFinite(obj.minScore) ||
      obj.minScore < 0 ||
      obj.minScore > 1
    ) {
      fail('invalid_query', '$.minScore', 'minScore 必须是 0 到 1 之间的有限数字');
    }
    minScore = obj.minScore;
  }
  const preferredTags =
    obj.preferredTags === undefined
      ? []
      : (() => {
          if (!Array.isArray(obj.preferredTags)) {
            fail('invalid_query', '$.preferredTags', 'preferredTags 必须是字符串数组');
          }
          return obj.preferredTags.map((item, index) =>
            requireNonBlankString(item, `$.preferredTags[${index}]`, 'invalid_query'),
          );
        })();
  return deepFreeze({ text, maxResults, minScore, preferredTags });
}

// ——————————————————————————————— 授权闸门 ———————————————————————————————

function normalizeRegion(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 运行时 AssetV1 形状复核（fail-closed）：拦截被 cast 成 `AssetCatalogEntry`
 * 但绕过注册校验的畸形素材（如非法 sha256），不让其进入语义检索候选集。
 * 只返回布尔值，不记录、不回显任何原始字段值。
 * 按闸门契约**不读取** `usageScope` 自由文本（空 usageScope 不构成形状畸形）；
 * 来源 / 权利持有人空白另有更具体的 `missing_provenance` 原因，此处一并
 * 视为形状畸形以阻断一切下游使用。
 */
function isRuntimeValidAssetShape(asset: Record<string, unknown>): boolean {
  return (
    isNonBlankString(asset.id) &&
    typeof asset.sha256 === 'string' &&
    SHA256_PATTERN.test(asset.sha256) &&
    typeof asset.mediaType === 'string' &&
    (ASSET_MEDIA_TYPES as readonly string[]).includes(asset.mediaType) &&
    (asset.durationMs === null ||
      (typeof asset.durationMs === 'number' &&
        Number.isInteger(asset.durationMs) &&
        asset.durationMs >= 0)) &&
    Array.isArray(asset.tags) &&
    asset.tags.every((tag: unknown) => typeof tag === 'string') &&
    (asset.transcript === null || typeof asset.transcript === 'string') &&
    (asset.embeddingRef === null || typeof asset.embeddingRef === 'string') &&
    isNonBlankString(asset.source) &&
    isNonBlankString(asset.rightsHolder) &&
    isNonBlankString(asset.license) &&
    typeof asset.authorizedForAutoUse === 'boolean' &&
    typeof asset.importedAt === 'string' &&
    ISO_DATE_TIME_PATTERN.test(asset.importedAt) &&
    Number.isFinite(Date.parse(asset.importedAt))
  );
}

function evaluateWithValidatedContext(
  entry: unknown,
  context: AssetUsageContext,
): AssetEligibilityResult {
  if (!isPlainObject(entry) || !isPlainObject(entry.asset)) {
    return deepFreeze({ eligible: false, blockReasons: ['invalid_entry'] });
  }

  const asset = entry.asset;
  const blockReasons: AssetEligibilityBlockReason[] = [];

  if (!isNonBlankString(asset.source) || !isNonBlankString(asset.rightsHolder)) {
    blockReasons.push('missing_provenance');
  }
  if (!isNonBlankString(entry.mediaRef)) {
    blockReasons.push('missing_media_ref');
  }
  // 运行时形状复核：绕过注册校验的畸形 AssetV1（如非法 sha256）按 invalid_entry
  // 阻断，绝不进入候选集；更具体的既有原因（missing_provenance 等）保持不变。
  if (!isRuntimeValidAssetShape(asset)) {
    blockReasons.push('invalid_entry');
  }

  const grantValue = entry.rightsGrant;
  if (grantValue === null || grantValue === undefined) {
    blockReasons.push('missing_grant');
  } else {
    let grant: RightsGrant | null = null;
    try {
      grant = validateRightsGrantShape(grantValue, '$.rightsGrant');
    } catch {
      blockReasons.push('invalid_grant');
    }
    if (grant !== null) {
      if (!grant.platforms.includes(context.platform)) {
        blockReasons.push('platform_not_allowed');
      }
      const wantedRegion = normalizeRegion(context.region);
      // `worldwide` 是单向保留词：记录的 worldwide 授权覆盖任意具体地区；
      // 上下文要求 worldwide 时，只有同样记录为 worldwide 的授权才匹配，
      // 具体地区（如 cn）授权绝不反向放大为全球授权（fail-closed）。
      const regionAllowed = grant.regions.some((region) => {
        const recorded = normalizeRegion(region);
        return recorded === 'worldwide' || recorded === wantedRegion;
      });
      if (!regionAllowed) {
        blockReasons.push('region_not_allowed');
      }
      if (context.commercialShortVideo) {
        if (grant.commercialShortVideoUse === 'prohibited') {
          blockReasons.push('commercial_use_prohibited');
        } else if (grant.commercialShortVideoUse === 'unknown') {
          blockReasons.push('commercial_use_unknown');
        }
      }
      const usedAtMs = Date.parse(context.usedAt);
      if (grant.validFrom !== null && usedAtMs < Date.parse(grant.validFrom)) {
        blockReasons.push('grant_not_started');
      }
      if (grant.validUntil !== null && usedAtMs > Date.parse(grant.validUntil)) {
        blockReasons.push('grant_expired');
      }
      if (grant.evidence.length === 0) {
        blockReasons.push('missing_evidence');
      }
    }
  }

  if (asset.authorizedForAutoUse !== true) {
    blockReasons.push('auto_use_flag_false');
  }

  return deepFreeze({ eligible: blockReasons.length === 0, blockReasons });
}

/**
 * fail-closed 授权闸门。任何非法或绕过注册校验的条目都不会抛异常，
 * 而是返回带稳定 reason 的阻断结果。
 */
export function evaluateAssetEligibility(
  entry: unknown,
  context: AssetUsageContext,
): AssetEligibilityResult {
  return evaluateWithValidatedContext(entry, validateAssetUsageContext(context));
}

/** 独立纯函数：按注册顺序返回通过闸门的条目（原引用，不复制）。 */
export function selectEligibleAssets(
  entries: readonly AssetCatalogEntry[],
  context: AssetUsageContext,
): readonly AssetCatalogEntry[] {
  const validatedContext = validateAssetUsageContext(context);
  const eligible: AssetCatalogEntry[] = [];
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (evaluateWithValidatedContext(entry, validatedContext).eligible) {
        eligible.push(entry);
      }
    }
  }
  return Object.freeze(eligible);
}

// ——————————————————————————————— 推荐 ———————————————————————————————

function zeroDroppedHits(): BrollDroppedHits {
  return { unauthorized: 0, invalid: 0, duplicate: 0, belowThreshold: 0 };
}

/**
 * 在调用（可能异步的）语义端口之前，对已通过闸门的条目做逐字段深拷贝 + 深冻结，
 * 得到不可变快照：调用方在端口 Promise 悬置期间改写原对象的 `asset.source`、
 * `rightsGrant.evidence[*].ref` 等字段，不能改变最终推荐记录的来源与证据
 * （fail-closed 溯源保证）。只拷贝契约字段，不携带未知附加键。
 */
function snapshotEligibleEntry(entry: AssetCatalogEntry): AssetCatalogEntry {
  const asset = entry.asset;
  const grant = entry.rightsGrant;
  return deepFreeze({
    asset: {
      id: asset.id,
      sha256: asset.sha256,
      mediaType: asset.mediaType,
      durationMs: asset.durationMs,
      tags: [...asset.tags],
      transcript: asset.transcript,
      embeddingRef: asset.embeddingRef,
      source: asset.source,
      rightsHolder: asset.rightsHolder,
      license: asset.license,
      usageScope: asset.usageScope,
      authorizedForAutoUse: asset.authorizedForAutoUse,
      importedAt: asset.importedAt,
    },
    mediaRef: entry.mediaRef,
    rightsGrant:
      grant === null
        ? null
        : {
            platforms: [...grant.platforms],
            regions: [...grant.regions],
            commercialShortVideoUse: grant.commercialShortVideoUse,
            validFrom: grant.validFrom,
            validUntil: grant.validUntil,
            evidence: grant.evidence.map((evidence) => ({
              kind: evidence.kind,
              ref: evidence.ref,
              collectedAt: evidence.collectedAt,
              note: evidence.note,
            })),
          },
  });
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function matchedPreferredTags(
  preferredTags: readonly string[],
  tags: readonly string[],
): string[] {
  const matched: string[] = [];
  for (const tag of preferredTags) {
    if (tags.includes(tag) && !matched.includes(tag)) matched.push(tag);
  }
  return matched;
}

function buildReasons(
  score: number,
  matchedTags: readonly string[],
  entry: AssetCatalogEntry,
  evidenceRefs: readonly string[],
): string[] {
  const reasons = [
    `语义检索端口命中：相似度 ${score}（原始分数由注入端口提供，非本模块或模型复核）`,
  ];
  if (matchedTags.length > 0) {
    reasons.push(`标签匹配：${matchedTags.join('、')}`);
  }
  const grant = entry.rightsGrant;
  const validUntilText =
    grant !== null && grant.validUntil !== null ? `；授权截止 ${grant.validUntil}` : '';
  reasons.push(
    `权利事实：来源 ${entry.asset.source}；权利持有人 ${entry.asset.rightsHolder}；` +
      `许可 ${entry.asset.license}；授权证据 ${evidenceRefs.join('、')}${validUntilText}`,
  );
  return reasons;
}

function unavailableResult(
  candidateAssetIds: readonly string[],
  eligibleCount: number,
  portCalled: boolean,
  message: string,
): BrollRecommendationResult {
  return deepFreeze({
    status: 'index_unavailable' as const,
    recommendations: [],
    candidateAssetIds,
    droppedHits: zeroDroppedHits(),
    portCalled,
    eligibleCount,
    message,
  });
}

/**
 * 独立纯函数推荐入口：先按授权闸门筛选（含运行时 AssetV1 形状复核），再对合格
 * 条目做深拷贝 + 深冻结快照，把冻结的候选 ID 集交给注入端口；端口 Promise 悬置
 * 期间调用方改写原始条目不影响推荐记录的来源 / 证据。端口输出视为不可信，
 * 越权 / 重复 / 非法分数 / 畸形命中一律丢弃。
 */
export async function recommendBrollFromEntries(
  entries: readonly AssetCatalogEntry[],
  query: BrollQuery,
  context: AssetUsageContext,
  port: SemanticSearchPort | null,
): Promise<BrollRecommendationResult> {
  const normalizedQuery = validateBrollQuery(query);
  const normalizedContext = validateAssetUsageContext(context);
  // 授权筛选后、await 端口之前，同步冻结候选快照：此后调用方对外部原始条目的
  // 任何改写都无法影响候选 ID、推荐记录的来源 / 证据等溯源字段。
  const eligible = Object.freeze(
    selectEligibleAssets(entries, normalizedContext).map(snapshotEligibleEntry),
  );
  const candidateAssetIds = Object.freeze(eligible.map((entry) => entry.asset.id));

  if (eligible.length === 0) {
    return deepFreeze({
      status: 'no_eligible_assets' as const,
      recommendations: [],
      candidateAssetIds,
      droppedHits: zeroDroppedHits(),
      portCalled: false,
      eligibleCount: 0,
      message: '没有通过授权闸门的候选素材，未调用语义检索端口。',
    });
  }

  if (port === null) {
    return unavailableResult(
      candidateAssetIds,
      eligible.length,
      false,
      '未注入语义检索端口，索引不可用；未生成任何推荐。',
    );
  }

  let rawHits: unknown;
  try {
    rawHits = await port(candidateAssetIds, normalizedQuery);
  } catch {
    return unavailableResult(
      candidateAssetIds,
      eligible.length,
      true,
      '语义检索端口调用失败，索引不可用；未生成任何推荐。',
    );
  }

  if (!Array.isArray(rawHits)) {
    return unavailableResult(
      candidateAssetIds,
      eligible.length,
      true,
      '语义检索端口返回格式非法，索引不可用；未生成任何推荐。',
    );
  }

  const eligibleById = new Map(eligible.map((entry) => [entry.asset.id, entry] as const));
  const droppedHits = zeroDroppedHits();
  const seen = new Set<string>();
  const accepted: Array<{ assetId: string; score: number }> = [];

  for (const rawHit of rawHits) {
    if (!isPlainObject(rawHit)) {
      droppedHits.invalid += 1;
      continue;
    }
    const assetId = rawHit.assetId;
    const score = rawHit.score;
    if (
      typeof assetId !== 'string' ||
      assetId.trim().length === 0 ||
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    ) {
      droppedHits.invalid += 1;
      continue;
    }
    if (!eligibleById.has(assetId)) {
      droppedHits.unauthorized += 1;
      continue;
    }
    if (score < normalizedQuery.minScore) {
      droppedHits.belowThreshold += 1;
      continue;
    }
    if (seen.has(assetId)) {
      droppedHits.duplicate += 1;
      continue;
    }
    seen.add(assetId);
    accepted.push({ assetId, score });
  }

  accepted.sort((a, b) => b.score - a.score || compareIds(a.assetId, b.assetId));
  const limited = accepted.slice(0, normalizedQuery.maxResults);

  const recommendations: BrollRecommendation[] = limited.map(({ assetId, score }) => {
    const entry = eligibleById.get(assetId)!;
    const grant = entry.rightsGrant!;
    const evidenceRefs = grant.evidence.map((evidence) => evidence.ref);
    const matchedTags = matchedPreferredTags(normalizedQuery.preferredTags, entry.asset.tags);
    return {
      assetId,
      sha256: entry.asset.sha256,
      mediaRef: entry.mediaRef,
      mediaType: entry.asset.mediaType,
      source: entry.asset.source,
      rightsHolder: entry.asset.rightsHolder,
      license: entry.asset.license,
      evidenceRefs,
      grantValidFrom: grant.validFrom,
      grantValidUntil: grant.validUntil,
      similarity: score,
      matchedTags,
      reasons: buildReasons(score, matchedTags, entry, evidenceRefs),
    };
  });

  return deepFreeze({
    status: 'ok' as const,
    recommendations,
    candidateAssetIds,
    droppedHits,
    portCalled: true,
    eligibleCount: eligible.length,
    message: null,
  });
}

// ——————————————————————————————— 目录 ———————————————————————————————

/** 内存授权素材目录；注册冲突显式报错，绝不覆盖既有条目。 */
export class AssetRightsCatalog {
  private readonly entriesInOrder: AssetCatalogEntry[] = [];
  private readonly byId = new Map<string, AssetCatalogEntry>();
  private readonly sha256Index = new Set<string>();

  constructor(initialEntries: readonly unknown[] = []) {
    if (!Array.isArray(initialEntries)) {
      throw new AssetRightsError('invalid_entry', '$', '初始条目必须是数组');
    }
    for (const entry of initialEntries) {
      this.register(entry);
    }
  }

  register(input: unknown): AssetCatalogEntry {
    const entry = validateAssetCatalogEntry(input);
    if (this.byId.has(entry.asset.id)) {
      throw new AssetRightsError('duplicate_id', '$.asset.id', '素材 ID 已注册');
    }
    const sha256 = entry.asset.sha256.toLowerCase();
    if (this.sha256Index.has(sha256)) {
      throw new AssetRightsError('duplicate_sha256', '$.asset.sha256', '素材 sha256 已注册');
    }
    this.entriesInOrder.push(entry);
    this.byId.set(entry.asset.id, entry);
    this.sha256Index.add(sha256);
    return entry;
  }

  get(id: string): AssetCatalogEntry | null {
    return this.byId.get(id) ?? null;
  }

  entries(): readonly AssetCatalogEntry[] {
    return Object.freeze([...this.entriesInOrder]);
  }

  eligibleAssets(context: AssetUsageContext): readonly AssetCatalogEntry[] {
    return selectEligibleAssets(this.entriesInOrder, context);
  }

  recommendBroll(
    query: BrollQuery,
    context: AssetUsageContext,
    port: SemanticSearchPort | null,
  ): Promise<BrollRecommendationResult> {
    return recommendBrollFromEntries(this.entriesInOrder, query, context, port);
  }
}

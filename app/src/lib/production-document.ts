/**
 * 阶段一生产 sidecar 文档（v1）的解析与初始化 —— 纯函数边界。
 *
 * 设计约束：
 * - 不依赖 Electron、磁盘、网络或全局状态；输入输出均为可 JSON 序列化的普通对象。
 * - fail-closed：未知 schemaVersion、未知字段、非法枚举、错误引用、错误时间码、
 *   凭证材料一律显式抛 ProductionContractError，绝不静默补默认值、丢字段或降级。
 * - 合法 v1 JSON 逐字段往返：解析结果与输入深相等；解析不写入 / 不篡改调用方数据。
 * - 没有 sidecar 文件时由调用方使用 createEmptyProductionDocument 显式创建空 v1；
 *   契约不存在 v0，本模块不做任何迁移。
 */

import {
  ACCOUNT_STATUSES,
  ASSET_MEDIA_TYPES,
  COMMERCE_KINDS,
  COMPOSITION_SEGMENT_SOURCE_KINDS,
  COMPOSITION_VOICEOVER_KINDS,
  HIGHLIGHT_BOUNDARY_ORIGINS,
  HIGHLIGHT_EVIDENCE_KINDS,
  PRODUCTION_ASPECT_RATIOS,
  PRODUCTION_PLATFORMS,
  PRODUCTION_SCHEMA_VERSION,
  PUBLISH_JOB_STATES,
  PUBLISH_REMOTE_FINAL_STATES,
  VIDEO_VARIANT_STATUSES,
} from '../types/production-contracts';
import type {
  AccountV1,
  AssetV1,
  CommerceRequestV1,
  CompositionPlanSegmentV1,
  CompositionPlanV1,
  CompositionSegmentSourceV1,
  HighlightEvidenceV1,
  HighlightV1,
  ProductionAspectRatio,
  ProductionDocumentV1,
  ProductionPlatform,
  PublishJobMetadataV1,
  PublishJobRemoteResultV1,
  PublishJobV1,
  RecordingV1,
  VideoVariantV1,
} from '../types/production-contracts';

export type ProductionContractErrorCode =
  | 'unsupported_schema_version'
  | 'invalid_document'
  | 'invalid_field'
  | 'invalid_platform'
  | 'invalid_commerce_request'
  | 'dangling_reference'
  | 'duplicate_id'
  | 'duplicate_idempotency_key'
  | 'invalid_timecode'
  | 'credential_material_forbidden';

/**
 * 契约错误。携带机器可判定的 code 与 JSON 路径式 path（根为 `$`，永远非空），
 * 绝不把凭证值写进 message。
 */
export class ProductionContractError extends Error {
  readonly code: ProductionContractErrorCode;
  readonly path: string;

  constructor(code: ProductionContractErrorCode, path: string, message: string) {
    super(`${message}（${path}）`);
    this.name = 'ProductionContractError';
    this.code = code;
    this.path = path;
  }
}

export interface CreateEmptyProductionDocumentOptions {
  /** 注入当前时间（ISO 8601）；缺省为系统时间。 */
  nowIso?: string;
}

const DOCUMENT_KEYS = [
  'schemaVersion',
  'projectId',
  'createdAt',
  'updatedAt',
  'recordings',
  'highlights',
  'assets',
  'compositionPlans',
  'videoVariants',
  'accounts',
  'publishJobs',
] as const;

const COLLECTION_KEYS = [
  'recordings',
  'highlights',
  'assets',
  'compositionPlans',
  'videoVariants',
  'accounts',
  'publishJobs',
] as const;

const RECORDING_KEYS = [
  'id',
  'sourceRef',
  'sourceSha256',
  'capturedAt',
  'durationMs',
  'mimeType',
  'transcriptRef',
  'importedAt',
] as const;

const HIGHLIGHT_KEYS = [
  'id',
  'recordingId',
  'startMs',
  'endMs',
  'score',
  'topic',
  'context',
  'evidence',
  'boundaryOrigin',
  'adjustedAt',
  'createdAt',
] as const;

const EVIDENCE_KEYS = ['kind', 'startMs', 'endMs', 'note'] as const;

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

const PLAN_KEYS = [
  'id',
  'narrativeSummary',
  'voiceoverKind',
  'aspectRatio',
  'segments',
  'timelineRef',
  'createdAt',
  'updatedAt',
] as const;

const SEGMENT_KEYS = ['id', 'order', 'description', 'source'] as const;

const SOURCE_KEYS = ['kind', 'sourceId', 'inMs', 'outMs'] as const;

const VARIANT_KEYS = [
  'id',
  'compositionPlanId',
  'timelineRef',
  'outputRef',
  'outputSha256',
  'durationMs',
  'aspectRatio',
  'status',
  'createdAt',
  'updatedAt',
] as const;

const ACCOUNT_KEYS = [
  'id',
  'platform',
  'displayName',
  'owner',
  'status',
  'sessionRef',
  'capabilitySnapshot',
  'lastVerifiedAt',
  'createdAt',
] as const;

const JOB_KEYS = [
  'id',
  'accountId',
  'videoVariantId',
  'metadata',
  'commerceRequest',
  'state',
  'idempotencyKey',
  'attempt',
  'leaseUntil',
  'remoteResult',
  'createdAt',
  'updatedAt',
] as const;

const METADATA_KEYS = ['title', 'description', 'tags', 'coverRefs', 'scheduleAt'] as const;

const COMMERCE_REQUEST_KEYS = [
  'platform',
  'accountId',
  'kind',
  'platformProductId',
  'required',
] as const;

const REMOTE_RESULT_KEYS = ['remoteId', 'remoteUrl', 'finalState', 'verifiedAt'] as const;

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

const URL_SCHEME_PATTERN = /:\/\//;

/** Cookie / Token / 密码 / 会话存储态等凭证字段名一律拒绝进入契约。 */
const CREDENTIAL_KEY_PATTERN =
  /(cookie|token|password|passwd|secret|authorization|apikey|privatekey|credential|sessionid|storagestate|sessionkey)/i;

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(key.replace(/[^a-z0-9]/gi, ''));
}

function fail(code: ProductionContractErrorCode, path: string, message: string): never {
  throw new ProductionContractError(code, path, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail('invalid_field', path, '必须是普通 JSON 对象');
  return value;
}

/** 既拒绝缺少必填字段，也拒绝未知字段；凭证字段名给出专门错误码。 */
function assertObjectShape(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail('invalid_field', `${path}.${key}`, `缺少必填字段 "${key}"`);
    }
  }
  for (const key of Object.keys(value)) {
    if (keys.includes(key)) continue;
    if (isCredentialKey(key)) {
      fail(
        'credential_material_forbidden',
        `${path}.${key}`,
        `凭证材料字段 "${key}" 不允许进入生产契约`,
      );
    }
    fail('invalid_field', `${path}.${key}`, `未知字段 "${key}"`);
  }
}

function requireString(
  value: unknown,
  path: string,
  code: ProductionContractErrorCode = 'invalid_field',
): string {
  if (typeof value !== 'string') fail(code, path, '必须是字符串');
  return value;
}

function requireNonEmptyString(
  value: unknown,
  path: string,
  code: ProductionContractErrorCode = 'invalid_field',
): string {
  const text = requireString(value, path, code);
  if (text.trim().length === 0) fail(code, path, '必须是非空白字符串');
  return text;
}

function requireNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requireString(value, path);
}

function requireIsoDateTime(value: unknown, path: string): string {
  const text = requireString(value, path);
  if (!ISO_DATE_TIME_PATTERN.test(text)) {
    fail('invalid_field', path, '必须是 ISO 8601 日期时间字符串');
  }
  return text;
}

function requireNullableIsoDateTime(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requireIsoDateTime(value, path);
}

function requireBoolean(
  value: unknown,
  path: string,
  code: ProductionContractErrorCode = 'invalid_field',
): boolean {
  if (typeof value !== 'boolean') fail(code, path, '必须是布尔值');
  return value;
}

function requireNonNegativeInteger(
  value: unknown,
  path: string,
  code: ProductionContractErrorCode = 'invalid_field',
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(code, path, '必须是非负整数');
  }
  return value;
}

function requireNullableNonNegativeInteger(
  value: unknown,
  path: string,
  code: ProductionContractErrorCode = 'invalid_field',
): number | null {
  if (value === null) return null;
  return requireNonNegativeInteger(value, path, code);
}

function requireNullableFiniteNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid_field', path, '必须是有限数字');
  }
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail('invalid_field', path, '必须是字符串数组');
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

function requireSha256(value: unknown, path: string): string {
  const text = requireString(value, path);
  if (!SHA256_PATTERN.test(text)) fail('invalid_field', path, '必须是 64 位十六进制 sha256');
  return text;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: ProductionContractErrorCode,
  label: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(code, path, `${label}必须是 ${allowed.join(' / ')} 之一`);
  }
  return value as T;
}

function requirePlatform(
  value: unknown,
  path: string,
  code: ProductionContractErrorCode = 'invalid_platform',
): ProductionPlatform {
  return requireEnum(value, PRODUCTION_PLATFORMS, path, code, '平台');
}

/** 只允许 JSON 值，并深拷贝，保证解析结果不与调用方输入共享引用。 */
function cloneJsonValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_field', path, '只允许有限数字');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`));
  }
  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isCredentialKey(key)) {
        fail(
          'credential_material_forbidden',
          `${path}.${key}`,
          `凭证材料字段 "${key}" 不允许进入生产契约`,
        );
      }
      cloned[key] = cloneJsonValue(item, `${path}.${key}`);
    }
    return cloned;
  }
  return fail('invalid_field', path, '只允许 JSON 值（对象 / 数组 / 字符串 / 数字 / 布尔 / null）');
}

function parseCollection<T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, itemPath: string) => T,
): T[] {
  return (value as unknown[]).map((item, index) => parseItem(item, `${path}[${index}]`));
}

/** 集合内 ID 必须唯一；重复立即失败，绝不覆盖。 */
function indexCollection<T extends { id: string }>(items: T[], path: string): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) {
    if (index.has(item.id)) fail('duplicate_id', path, '集合内 ID 重复');
    index.set(item.id, item);
  }
  return index;
}

// ——————————————————————————————— 实体解析 ———————————————————————————————

function parseRecording(value: unknown, path: string): RecordingV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, RECORDING_KEYS, path);
  return {
    id: requireNonEmptyString(obj.id, `${path}.id`),
    sourceRef: requireNonEmptyString(obj.sourceRef, `${path}.sourceRef`),
    sourceSha256: requireSha256(obj.sourceSha256, `${path}.sourceSha256`),
    capturedAt: requireNullableIsoDateTime(obj.capturedAt, `${path}.capturedAt`),
    durationMs: requireNullableNonNegativeInteger(obj.durationMs, `${path}.durationMs`),
    mimeType: requireNullableString(obj.mimeType, `${path}.mimeType`),
    transcriptRef: requireNullableString(obj.transcriptRef, `${path}.transcriptRef`),
    importedAt: requireIsoDateTime(obj.importedAt, `${path}.importedAt`),
  };
}

function parseEvidence(value: unknown, path: string): HighlightEvidenceV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, EVIDENCE_KEYS, path);
  const startMs = requireNullableNonNegativeInteger(
    obj.startMs,
    `${path}.startMs`,
    'invalid_timecode',
  );
  const endMs = requireNullableNonNegativeInteger(obj.endMs, `${path}.endMs`, 'invalid_timecode');
  if (startMs !== null && endMs !== null && endMs <= startMs) {
    fail('invalid_timecode', `${path}.endMs`, '证据结束时间码必须大于开始时间码');
  }
  return {
    kind: requireEnum(
      obj.kind,
      HIGHLIGHT_EVIDENCE_KINDS,
      `${path}.kind`,
      'invalid_field',
      '高光证据类型',
    ),
    startMs,
    endMs,
    note: requireNullableString(obj.note, `${path}.note`),
  };
}

function parseHighlight(value: unknown, path: string): HighlightV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, HIGHLIGHT_KEYS, path);
  const startMs = requireNonNegativeInteger(obj.startMs, `${path}.startMs`, 'invalid_timecode');
  const endMs = requireNonNegativeInteger(obj.endMs, `${path}.endMs`, 'invalid_timecode');
  if (endMs <= startMs) {
    fail('invalid_timecode', `${path}.endMs`, '高光结束时间码必须大于开始时间码');
  }
  if (!Array.isArray(obj.evidence)) {
    fail('invalid_field', `${path}.evidence`, '必须是数组');
  }
  return {
    id: requireNonEmptyString(obj.id, `${path}.id`),
    recordingId: requireNonEmptyString(obj.recordingId, `${path}.recordingId`),
    startMs,
    endMs,
    score: requireNullableFiniteNumber(obj.score, `${path}.score`),
    topic: requireNullableString(obj.topic, `${path}.topic`),
    context: requireNullableString(obj.context, `${path}.context`),
    evidence: parseCollection(obj.evidence, `${path}.evidence`, parseEvidence),
    boundaryOrigin: requireEnum(
      obj.boundaryOrigin,
      HIGHLIGHT_BOUNDARY_ORIGINS,
      `${path}.boundaryOrigin`,
      'invalid_field',
      '高光边界来源',
    ),
    adjustedAt: requireNullableIsoDateTime(obj.adjustedAt, `${path}.adjustedAt`),
    createdAt: requireIsoDateTime(obj.createdAt, `${path}.createdAt`),
  };
}

function parseAsset(value: unknown, path: string): AssetV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, ASSET_KEYS, path);
  return {
    id: requireNonEmptyString(obj.id, `${path}.id`),
    sha256: requireSha256(obj.sha256, `${path}.sha256`),
    mediaType: requireEnum(
      obj.mediaType,
      ASSET_MEDIA_TYPES,
      `${path}.mediaType`,
      'invalid_field',
      '素材媒体类型',
    ),
    durationMs: requireNullableNonNegativeInteger(obj.durationMs, `${path}.durationMs`),
    tags: requireStringArray(obj.tags, `${path}.tags`),
    transcript: requireNullableString(obj.transcript, `${path}.transcript`),
    embeddingRef: requireNullableString(obj.embeddingRef, `${path}.embeddingRef`),
    source: requireNonEmptyString(obj.source, `${path}.source`),
    rightsHolder: requireNonEmptyString(obj.rightsHolder, `${path}.rightsHolder`),
    license: requireNonEmptyString(obj.license, `${path}.license`),
    usageScope: requireNonEmptyString(obj.usageScope, `${path}.usageScope`),
    authorizedForAutoUse: requireBoolean(
      obj.authorizedForAutoUse,
      `${path}.authorizedForAutoUse`,
    ),
    importedAt: requireIsoDateTime(obj.importedAt, `${path}.importedAt`),
  };
}

function parseSegmentSource(value: unknown, path: string): CompositionSegmentSourceV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, SOURCE_KEYS, path);
  const inMs = requireNonNegativeInteger(obj.inMs, `${path}.inMs`, 'invalid_timecode');
  const outMs = requireNonNegativeInteger(obj.outMs, `${path}.outMs`, 'invalid_timecode');
  if (outMs <= inMs) {
    fail('invalid_timecode', `${path}.outMs`, '分段出点时间码必须大于入点时间码');
  }
  return {
    kind: requireEnum(
      obj.kind,
      COMPOSITION_SEGMENT_SOURCE_KINDS,
      `${path}.kind`,
      'invalid_field',
      '分段来源类型',
    ),
    sourceId: requireNonEmptyString(obj.sourceId, `${path}.sourceId`),
    inMs,
    outMs,
  };
}

function parseSegment(value: unknown, path: string): CompositionPlanSegmentV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, SEGMENT_KEYS, path);
  return {
    id: requireNonEmptyString(obj.id, `${path}.id`),
    order: requireNonNegativeInteger(obj.order, `${path}.order`),
    description: requireString(obj.description, `${path}.description`),
    source: parseSegmentSource(obj.source, `${path}.source`),
  };
}

function parsePlan(value: unknown, path: string): CompositionPlanV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, PLAN_KEYS, path);
  if (!Array.isArray(obj.segments)) {
    fail('invalid_field', `${path}.segments`, '必须是数组');
  }
  const segments = parseCollection(obj.segments, `${path}.segments`, parseSegment);
  indexCollection(segments, `${path}.segments`);
  return {
    id: requireNonEmptyString(obj.id, `${path}.id`),
    narrativeSummary: requireString(obj.narrativeSummary, `${path}.narrativeSummary`),
    voiceoverKind: requireEnum(
      obj.voiceoverKind,
      COMPOSITION_VOICEOVER_KINDS,
      `${path}.voiceoverKind`,
      'invalid_field',
      '解说类型',
    ),
    aspectRatio: requireEnum<ProductionAspectRatio>(
      obj.aspectRatio,
      PRODUCTION_ASPECT_RATIOS,
      `${path}.aspectRatio`,
      'invalid_field',
      '画幅比例',
    ),
    segments,
    timelineRef: requireNullableString(obj.timelineRef, `${path}.timelineRef`),
    createdAt: requireIsoDateTime(obj.createdAt, `${path}.createdAt`),
    updatedAt: requireIsoDateTime(obj.updatedAt, `${path}.updatedAt`),
  };
}

function parseVariant(value: unknown, path: string): VideoVariantV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, VARIANT_KEYS, path);
  const outputSha256 = obj.outputSha256 === null
    ? null
    : requireSha256(obj.outputSha256, `${path}.outputSha256`);
  return {
    id: requireNonEmptyString(obj.id, `${path}.id`),
    compositionPlanId: requireNonEmptyString(obj.compositionPlanId, `${path}.compositionPlanId`),
    timelineRef: requireNullableString(obj.timelineRef, `${path}.timelineRef`),
    outputRef: requireNullableString(obj.outputRef, `${path}.outputRef`),
    outputSha256,
    durationMs: requireNullableNonNegativeInteger(obj.durationMs, `${path}.durationMs`),
    aspectRatio: requireEnum<ProductionAspectRatio>(
      obj.aspectRatio,
      PRODUCTION_ASPECT_RATIOS,
      `${path}.aspectRatio`,
      'invalid_field',
      '画幅比例',
    ),
    status: requireEnum(
      obj.status,
      VIDEO_VARIANT_STATUSES,
      `${path}.status`,
      'invalid_field',
      '视频版本状态',
    ),
    createdAt: requireIsoDateTime(obj.createdAt, `${path}.createdAt`),
    updatedAt: requireIsoDateTime(obj.updatedAt, `${path}.updatedAt`),
  };
}

function parseCapabilitySnapshot(
  value: unknown,
  path: string,
): Record<string, unknown> | null {
  if (value === null) return null;
  const obj = requireObject(value, path);
  const snapshot: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(obj)) {
    if (isCredentialKey(key)) {
      fail(
        'credential_material_forbidden',
        `${path}.${key}`,
        `凭证材料字段 "${key}" 不允许进入生产契约`,
      );
    }
    snapshot[key] = cloneJsonValue(item, `${path}.${key}`);
  }
  return snapshot;
}

function parseAccount(value: unknown, path: string): AccountV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, ACCOUNT_KEYS, path);
  const id = requireNonEmptyString(obj.id, `${path}.id`);
  const displayName = requireString(obj.displayName, `${path}.displayName`);
  if (id === displayName) {
    fail('invalid_field', `${path}.id`, '账号内部 ID 不得与展示昵称相同（ID 必须独立生成）');
  }
  return {
    id,
    platform: requirePlatform(obj.platform, `${path}.platform`),
    displayName,
    owner: requireNonEmptyString(obj.owner, `${path}.owner`),
    status: requireEnum(obj.status, ACCOUNT_STATUSES, `${path}.status`, 'invalid_field', '账号状态'),
    sessionRef: requireNullableString(obj.sessionRef, `${path}.sessionRef`),
    capabilitySnapshot: parseCapabilitySnapshot(
      obj.capabilitySnapshot,
      `${path}.capabilitySnapshot`,
    ),
    lastVerifiedAt: requireNullableIsoDateTime(obj.lastVerifiedAt, `${path}.lastVerifiedAt`),
    createdAt: requireIsoDateTime(obj.createdAt, `${path}.createdAt`),
  };
}

function parseCommerceRequest(value: unknown, path: string): CommerceRequestV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, COMMERCE_REQUEST_KEYS, path);
  const platform = requirePlatform(obj.platform, `${path}.platform`);
  const accountId = requireNonEmptyString(
    obj.accountId,
    `${path}.accountId`,
    'invalid_commerce_request',
  );
  const kind = requireEnum(
    obj.kind,
    COMMERCE_KINDS,
    `${path}.kind`,
    'invalid_commerce_request',
    '商品类型',
  );
  const platformProductId = requireNonEmptyString(
    obj.platformProductId,
    `${path}.platformProductId`,
    'invalid_commerce_request',
  );
  if (URL_SCHEME_PATTERN.test(platformProductId)) {
    fail(
      'invalid_commerce_request',
      `${path}.platformProductId`,
      '平台商品 ID 必须是平台自有标识，不能用 URL 冒充',
    );
  }
  return {
    platform,
    accountId,
    kind,
    platformProductId,
    required: requireBoolean(obj.required, `${path}.required`, 'invalid_commerce_request'),
  };
}

function parseJobMetadata(value: unknown, path: string): PublishJobMetadataV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, METADATA_KEYS, path);
  return {
    title: requireString(obj.title, `${path}.title`),
    description: requireString(obj.description, `${path}.description`),
    tags: requireStringArray(obj.tags, `${path}.tags`),
    coverRefs: requireStringArray(obj.coverRefs, `${path}.coverRefs`),
    scheduleAt: requireNullableIsoDateTime(obj.scheduleAt, `${path}.scheduleAt`),
  };
}

function parseRemoteResult(value: unknown, path: string): PublishJobRemoteResultV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, REMOTE_RESULT_KEYS, path);
  return {
    remoteId: requireNullableString(obj.remoteId, `${path}.remoteId`),
    remoteUrl: requireNullableString(obj.remoteUrl, `${path}.remoteUrl`),
    finalState: requireEnum(
      obj.finalState,
      PUBLISH_REMOTE_FINAL_STATES,
      `${path}.finalState`,
      'invalid_field',
      '远端核验状态',
    ),
    verifiedAt: requireNullableIsoDateTime(obj.verifiedAt, `${path}.verifiedAt`),
  };
}

function parseJob(value: unknown, path: string): PublishJobV1 {
  const obj = requireObject(value, path);
  assertObjectShape(obj, JOB_KEYS, path);
  return {
    id: requireNonEmptyString(obj.id, `${path}.id`),
    accountId: requireNonEmptyString(obj.accountId, `${path}.accountId`),
    videoVariantId: requireNonEmptyString(obj.videoVariantId, `${path}.videoVariantId`),
    metadata: parseJobMetadata(obj.metadata, `${path}.metadata`),
    commerceRequest:
      obj.commerceRequest === null
        ? null
        : parseCommerceRequest(obj.commerceRequest, `${path}.commerceRequest`),
    state: requireEnum(obj.state, PUBLISH_JOB_STATES, `${path}.state`, 'invalid_field', '任务状态'),
    idempotencyKey: requireNonEmptyString(obj.idempotencyKey, `${path}.idempotencyKey`),
    attempt: requireNonNegativeInteger(obj.attempt, `${path}.attempt`),
    leaseUntil: requireNullableIsoDateTime(obj.leaseUntil, `${path}.leaseUntil`),
    remoteResult:
      obj.remoteResult === null
        ? null
        : parseRemoteResult(obj.remoteResult, `${path}.remoteResult`),
    createdAt: requireIsoDateTime(obj.createdAt, `${path}.createdAt`),
    updatedAt: requireIsoDateTime(obj.updatedAt, `${path}.updatedAt`),
  };
}

// ——————————————————————————————— 引用与时间码交叉校验 ———————————————————————————————

interface EntityIndex {
  recordings: Map<string, RecordingV1>;
  highlights: Map<string, HighlightV1>;
  assets: Map<string, AssetV1>;
  compositionPlans: Map<string, CompositionPlanV1>;
  videoVariants: Map<string, VideoVariantV1>;
  accounts: Map<string, AccountV1>;
}

function checkSegmentSource(
  source: CompositionSegmentSourceV1,
  path: string,
  index: EntityIndex,
): void {
  if (source.kind === 'recording') {
    const recording = index.recordings.get(source.sourceId);
    if (!recording) {
      fail('dangling_reference', `${path}.sourceId`, '引用的录屏不存在');
    }
    if (recording.durationMs !== null && source.outMs > recording.durationMs) {
      fail('invalid_timecode', `${path}.outMs`, '分段超出录屏总时长');
    }
    return;
  }
  if (source.kind === 'highlight') {
    const highlight = index.highlights.get(source.sourceId);
    if (!highlight) {
      fail('dangling_reference', `${path}.sourceId`, '引用的高光不存在');
    }
    if (source.inMs < highlight.startMs || source.outMs > highlight.endMs) {
      fail(
        'invalid_timecode',
        path,
        '分段必须落在高光时间码范围内',
      );
    }
    return;
  }
  const asset = index.assets.get(source.sourceId);
  if (!asset) {
    fail('dangling_reference', `${path}.sourceId`, '引用的素材不存在');
  }
  if (asset.durationMs !== null && source.outMs > asset.durationMs) {
    fail('invalid_timecode', `${path}.outMs`, '分段超出素材总时长');
  }
}

function checkReferences(doc: ProductionDocumentV1, index: EntityIndex): void {
  doc.highlights.forEach((highlight, highlightIndex) => {
    const path = `$.highlights[${highlightIndex}]`;
    const recording = index.recordings.get(highlight.recordingId);
    if (!recording) {
      fail(
        'dangling_reference',
        `${path}.recordingId`,
        '引用的录屏不存在',
      );
    }
    if (recording.durationMs !== null && highlight.endMs > recording.durationMs) {
      fail('invalid_timecode', `${path}.endMs`, '高光结束时间码超出录屏总时长');
    }
  });

  doc.compositionPlans.forEach((plan, planIndex) => {
    plan.segments.forEach((segment, segmentIndex) => {
      checkSegmentSource(
        segment.source,
        `$.compositionPlans[${planIndex}].segments[${segmentIndex}].source`,
        index,
      );
    });
  });

  doc.videoVariants.forEach((variant, variantIndex) => {
    if (!index.compositionPlans.has(variant.compositionPlanId)) {
      fail(
        'dangling_reference',
        `$.videoVariants[${variantIndex}].compositionPlanId`,
        '引用的合成计划不存在',
      );
    }
  });

  doc.publishJobs.forEach((job, jobIndex) => {
    const path = `$.publishJobs[${jobIndex}]`;
    const account = index.accounts.get(job.accountId);
    if (!account) {
      fail('dangling_reference', `${path}.accountId`, '引用的账号不存在');
    }
    if (!index.videoVariants.has(job.videoVariantId)) {
      fail(
        'dangling_reference',
        `${path}.videoVariantId`,
        '引用的视频版本不存在',
      );
    }
    if (job.commerceRequest) {
      if (job.commerceRequest.accountId !== job.accountId) {
        fail(
          'invalid_commerce_request',
          `${path}.commerceRequest.accountId`,
          '商品请求账号必须与发布任务账号一致',
        );
      }
      if (job.commerceRequest.platform !== account.platform) {
        fail(
          'invalid_commerce_request',
          `${path}.commerceRequest.platform`,
          '商品请求平台必须与任务账号平台一致',
        );
      }
    }
  });
}

// ——————————————————————————————— 公共 API ———————————————————————————————

/**
 * 显式创建空 v1 文档。仅在没有 sidecar 文件时由调用方使用；
 * 不猜测 v0、不迁移、不补任何业务实体。
 */
export function createEmptyProductionDocument(
  projectId: string,
  options: CreateEmptyProductionDocumentOptions = {},
): ProductionDocumentV1 {
  const id = requireNonEmptyString(projectId, '$.projectId');
  const nowIso =
    options.nowIso === undefined
      ? new Date().toISOString()
      : requireIsoDateTime(options.nowIso, '$.createdAt');
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    projectId: id,
    createdAt: nowIso,
    updatedAt: nowIso,
    recordings: [],
    highlights: [],
    assets: [],
    compositionPlans: [],
    videoVariants: [],
    accounts: [],
    publishJobs: [],
  };
}

/**
 * 解析来自 sidecar / IPC 的 unknown JSON。合法 v1 完整保留；其余一律 fail-closed。
 */
export function parseProductionDocument(input: unknown): ProductionDocumentV1 {
  if (!isPlainObject(input)) {
    fail('invalid_document', '$', '生产文档必须是 JSON 对象');
  }

  if (input.schemaVersion !== PRODUCTION_SCHEMA_VERSION) {
    fail(
      'unsupported_schema_version',
      '$.schemaVersion',
      `仅支持 schemaVersion=${PRODUCTION_SCHEMA_VERSION}`,
    );
  }

  for (const key of DOCUMENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      fail('invalid_field', `$.${key}`, `缺少必填字段 "${key}"`);
    }
  }
  for (const key of Object.keys(input)) {
    if ((DOCUMENT_KEYS as readonly string[]).includes(key)) continue;
    if (isCredentialKey(key)) {
      fail('credential_material_forbidden', `$.${key}`, `凭证材料字段 "${key}" 不允许进入生产契约`);
    }
    fail('invalid_field', `$.${key}`, `未知字段 "${key}"`);
  }

  for (const key of COLLECTION_KEYS) {
    if (!Array.isArray(input[key])) {
      fail('invalid_document', `$.${key}`, `集合字段 "${key}" 必须是数组`);
    }
  }

  const doc: ProductionDocumentV1 = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    projectId: requireNonEmptyString(input.projectId, '$.projectId'),
    createdAt: requireIsoDateTime(input.createdAt, '$.createdAt'),
    updatedAt: requireIsoDateTime(input.updatedAt, '$.updatedAt'),
    recordings: parseCollection(input.recordings, '$.recordings', parseRecording),
    highlights: parseCollection(input.highlights, '$.highlights', parseHighlight),
    assets: parseCollection(input.assets, '$.assets', parseAsset),
    compositionPlans: parseCollection(input.compositionPlans, '$.compositionPlans', parsePlan),
    videoVariants: parseCollection(input.videoVariants, '$.videoVariants', parseVariant),
    accounts: parseCollection(input.accounts, '$.accounts', parseAccount),
    publishJobs: parseCollection(input.publishJobs, '$.publishJobs', parseJob),
  };

  const index: EntityIndex = {
    recordings: indexCollection(doc.recordings, '$.recordings'),
    highlights: indexCollection(doc.highlights, '$.highlights'),
    assets: indexCollection(doc.assets, '$.assets'),
    compositionPlans: indexCollection(doc.compositionPlans, '$.compositionPlans'),
    videoVariants: indexCollection(doc.videoVariants, '$.videoVariants'),
    accounts: indexCollection(doc.accounts, '$.accounts'),
  };

  indexCollection(doc.publishJobs, '$.publishJobs');
  const idempotencyKeys = new Set<string>();
  doc.publishJobs.forEach((job, jobIndex) => {
    if (idempotencyKeys.has(job.idempotencyKey)) {
      fail(
        'duplicate_idempotency_key',
        `$.publishJobs[${jobIndex}].idempotencyKey`,
        '发布任务幂等键重复',
      );
    }
    idempotencyKeys.add(job.idempotencyKey);
  });

  checkReferences(doc, index);
  return doc;
}

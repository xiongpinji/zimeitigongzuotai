/**
 * HotClip 高光候选 → HighlightV1 纯来源投影（H1-S1）。
 *
 * 许可与分发边界：
 * - 本模块只从 hotclip-sidecar.ts `import type` 候选投影类型；sidecar 通过
 *   独立子进程与用户**另行安装**的 AGPL-3.0-only HotClip 通信。本模块不导入、
 *   不复制、不分发任何上游代码，不新增许可耦合（正式分发前的许可证审查仍按
 *   docs/validation/p0-3-hotclip-pilot.md 的边界单独进行）。
 *
 * 语义边界：
 * - 纯函数：不读文件系统、不哈希或读取任何媒体、不起子进程、不触网、不调用
 *   模型、不读取系统时钟；`createdAt` 必须由调用方显式给出（ISO 8601）。
 * - `observedSourceSha256` 是后续 ingest 步骤**已经计算好**的内容摘要，本模块
 *   只负责把它与 `RecordingV1.sourceSha256` 做大小写不敏感的十六进制比对；
 *   本模块绝不声称自己计算了媒体摘要。
 * - 上游 `recommended` 只是启发式建议：每条投影结果固定 `reviewRequired: true`，
 *   绝不构成发布许可、质量 / 原创性判定或任何平台验收；候选进入生产文档前
 *   仍需人工独立评审。
 * - 候选 `visualEvidence` 是不可信上游载荷：不校验、不解释、不进入任何输出。
 *
 * 安全边界：
 * - fail closed：即使 TypeScript 类型被绕过，畸形运行时数据也会被固定错误码
 *   拒绝；错误消息是**静态文本**，绝不携带媒体路径、转写引用、提示词、候选
 *   reason / hook / title 或视觉证据内容，最多附带数值型候选下标。
 * - 越界时间码整体拒绝，绝不静默截断；秒 / 毫秒缺失或不一致直接拒绝，绝不
 *   发明数值；重复上游 ID 或重复投影时间范围直接拒绝，绝不静默丢弃候选。
 * - 日期时间做显式日历校验（月份 01–12、日期按当月天数含闰年二月、时 00–23、
 *   分 / 秒 00–59、时区偏移时 / 分范围）；`2026-02-31` 等不存在的日历日期
 *   固定拒绝，绝不依赖 `Date.parse`——它会把这类值规范化成下个月并返回有限值。
 * - 输出为深拷贝 + 深冻结：与调用方输入不共享任何可变引用，事后变异输入
 *   不影响已返回结果。
 */

import { createHash } from 'node:crypto';
import type { HotClipHighlightCandidate } from './hotclip-sidecar';
import type { HighlightV1, RecordingV1 } from '../../src/types/production-contracts';

// ——————————————————————————————— 常量 ———————————————————————————————

/** 投影生成的高光 ID 前缀；ID = 前缀 + 规范化输入的 sha256 十六进制。 */
export const PROJECTED_HIGHLIGHT_ID_PREFIX = 'hlcv1-';

/**
 * 候选 reason 写入 evidence.note 时的固定标注前缀：该文本只是**未核验的
 * 上游启发式理由**，不是已核验的场景 / 音频 / 互动事实。
 */
export const HOTCLIP_UNVERIFIED_REASON_NOTE_PREFIX =
  '[未核验的上游 HotClip 启发式理由，非已核验的场景/音频/互动事实] ';

/** 稳定 ID 的规范化输入版本标记；语义变化时必须升级，避免跨版本 ID 混淆。 */
const STABLE_ID_DOMAIN = 'hotclip-projection-v1';

/** 与 src/lib/production-document.ts 一致的 sha256 形态（大小写不敏感）。 */
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * 与 src/lib/production-document.ts 一致的 ISO 8601 日期时间形态；捕获组只服务
 * 于后续显式日历校验，不改变接受的语言。
 */
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** 平年每月天数；2 月由 daysInMonth 按闰年规则单独处理。 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

/** RecordingV1 的封闭键集合（契约要求所有字段必填，未知字段拒绝）。 */
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

// ——————————————————————————————— 错误 ———————————————————————————————

export const HOTCLIP_PROJECTION_ERROR_CODES = [
  'invalid_input',
  'invalid_recording',
  'invalid_observed_hash',
  'source_hash_mismatch',
  'invalid_created_at',
  'invalid_candidates',
  'invalid_candidate',
  'candidate_out_of_range',
  'duplicate_candidate_id',
  'duplicate_candidate_range',
] as const;

export type HotClipProjectionErrorCode = (typeof HOTCLIP_PROJECTION_ERROR_CODES)[number];

/** 每个错误码对应且仅对应一条静态消息；任何输入文本都不得进入消息。 */
const ERROR_MESSAGES: Record<HotClipProjectionErrorCode, string> = {
  invalid_input: 'Projection input must be a plain object',
  invalid_recording: 'RecordingV1 input failed contract validation',
  invalid_observed_hash: 'observedSourceSha256 must be a 64-character hexadecimal string',
  source_hash_mismatch: 'observedSourceSha256 does not match recording.sourceSha256',
  invalid_created_at: 'createdAt must be an explicit valid ISO 8601 date-time string',
  invalid_candidates: 'candidates must be an array of HotClipHighlightCandidate',
  invalid_candidate: 'HotClip candidate failed structural or timecode validation',
  candidate_out_of_range: 'HotClip candidate time range exceeds the known recording duration',
  duplicate_candidate_id: 'HotClip candidates contain a duplicate upstream candidate id',
  duplicate_candidate_range: 'HotClip candidates contain a duplicate projected time range',
};

/**
 * 机器可读的投影失败。message 是固定静态文本；candidateIndex 只携带数值
 * 下标（与具体候选的对应关系由调用方按输入顺序还原），绝不携带内容文本。
 */
export class HotClipProjectionError extends Error {
  readonly code: HotClipProjectionErrorCode;
  readonly candidateIndex: number | null;

  constructor(code: HotClipProjectionErrorCode, candidateIndex: number | null = null) {
    super(ERROR_MESSAGES[code]);
    this.name = 'HotClipProjectionError';
    this.code = code;
    this.candidateIndex = candidateIndex;
  }
}

function fail(code: HotClipProjectionErrorCode, candidateIndex: number | null = null): never {
  throw new HotClipProjectionError(code, candidateIndex);
}

// ——————————————————————————————— 输入 / 输出类型 ———————————————————————————————

export interface ProjectHotClipCandidatesInput {
  /** 已导入录屏的契约记录；必须通过 RecordingV1 形态校验。 */
  readonly recording: RecordingV1;
  /**
   * 调用方（后续 ingest 步骤）已计算好的录屏内容 sha256。本模块只做与
   * `recording.sourceSha256` 的大小写不敏感比对，不计算任何媒体摘要。
   */
  readonly observedSourceSha256: string;
  /** sidecar 解析产出的候选（可为空数组 = 合法零候选）；本模块不起子进程。 */
  readonly candidates: readonly HotClipHighlightCandidate[];
  /** 调用方显式给出的投影时间（ISO 8601）；本模块绝不读取系统时钟。 */
  readonly createdAt: string;
}

/** 单条候选的投影结果：契约高光 + 来源追溯 + 恒定人工评审门槛。 */
export interface ProjectedHotClipHighlight {
  /** 可直接进入生产文档 highlights 集合的记录（已深冻结）。 */
  readonly highlight: HighlightV1;
  /** 规范化（小写）的录屏内容 sha256，绑定高光与录屏内容。 */
  readonly sourceSha256: string;
  /** 上游候选 ID，原样保留用于追溯。 */
  readonly upstreamCandidateId: string;
  /** 上游启发式建议原样保留；不是发布批准，也不是人工评审通过。 */
  readonly upstreamRecommended: boolean;
  /** 恒为 true：投影结果一律需要独立人工评审后才可能进入后续环节。 */
  readonly reviewRequired: true;
}

// ——————————————————————————————— 校验 ———————————————————————————————

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value: unknown): boolean {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isIsoDateTime(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (match === null) return false;
  // 形态正确还不够：显式校验日历日、闰年二月、月份天数、时分秒与时区偏移
  // 范围，绝不依赖 Date.parse——它会把 2026-02-31 规范化为 3 月并返回有限值。
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(Number(match[1]), month)) return false;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  // Z 形式没有偏移捕获组；带偏移时分别校验时（≤ 23）与分（≤ 59）。
  if (match[7] !== undefined && Number(match[7]) > 23) return false;
  if (match[8] !== undefined && Number(match[8]) > 59) return false;
  return true;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** 按契约校验录屏形态；只依赖字段结构，绝不读取 sourceRef 指向的任何文件。 */
function validateRecording(value: unknown): void {
  if (!isPlainObject(value)) fail('invalid_recording');
  for (const key of RECORDING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('invalid_recording');
  }
  if (Object.keys(value).length !== RECORDING_KEYS.length) fail('invalid_recording');
  if (!isNonEmptyString(value.id)) fail('invalid_recording');
  if (!isNonEmptyString(value.sourceRef)) fail('invalid_recording');
  if (!isSha256(value.sourceSha256)) fail('invalid_recording');
  if (value.capturedAt !== null && !isIsoDateTime(value.capturedAt)) fail('invalid_recording');
  if (value.durationMs !== null && !isNonNegativeSafeInteger(value.durationMs)) {
    fail('invalid_recording');
  }
  if (value.mimeType !== null && typeof value.mimeType !== 'string') fail('invalid_recording');
  if (value.transcriptRef !== null && typeof value.transcriptRef !== 'string') {
    fail('invalid_recording');
  }
  if (!isIsoDateTime(value.importedAt)) fail('invalid_recording');
}

/**
 * 校验单条候选：结构、秒 / 毫秒时间码及其一致性（毫秒必须等于上游秒的
 * Math.round(sec*1000) 投影，与 sidecar 解析器语义一致）。visualEvidence
 * 不参与校验也绝不进入输出。
 */
function validateCandidate(value: unknown, index: number): void {
  if (!isPlainObject(value)) fail('invalid_candidate', index);
  if (!isNonEmptyString(value.id)) fail('invalid_candidate', index);

  const startSec = value.startSec;
  const endSec = value.endSec;
  if (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0) {
    fail('invalid_candidate', index);
  }
  if (typeof endSec !== 'number' || !Number.isFinite(endSec) || !(endSec > startSec)) {
    fail('invalid_candidate', index);
  }

  const startMs = value.startMs;
  const endMs = value.endMs;
  if (!isNonNegativeSafeInteger(startMs)) fail('invalid_candidate', index);
  if (!isNonNegativeSafeInteger(endMs) || !(endMs > startMs)) fail('invalid_candidate', index);
  // 秒 / 毫秒不一致说明输入不是 sidecar 解析器产物（或被篡改）；拒绝而不是
  // 自行重算，绝不发明缺失的时间值。
  if (startMs !== Math.round(startSec * 1_000) || endMs !== Math.round(endSec * 1_000)) {
    fail('invalid_candidate', index);
  }

  if (typeof value.title !== 'string') fail('invalid_candidate', index);
  if (typeof value.hook !== 'string') fail('invalid_candidate', index);
  if (typeof value.reason !== 'string') fail('invalid_candidate', index);
  if (typeof value.score !== 'number' || !Number.isFinite(value.score)) {
    fail('invalid_candidate', index);
  }
  if (typeof value.recommended !== 'boolean') fail('invalid_candidate', index);
  if (value.reviewNote !== null && typeof value.reviewNote !== 'string') {
    fail('invalid_candidate', index);
  }
}

// ——————————————————————————————— 稳定 ID ———————————————————————————————

/**
 * 由录屏身份（ID + 规范化内容哈希）、上游候选 ID 与精确投影毫秒范围派生
 * 稳定高光 ID：同一输入重跑结果不变；任何身份 / 范围变化都会得到不同 ID。
 * 规范化序列化使用 JSON 数组（字符串转义保证无歧义拼接）。
 */
function buildStableHighlightId(
  recordingId: string,
  normalizedSourceSha256: string,
  upstreamCandidateId: string,
  startMs: number,
  endMs: number,
): string {
  const canonical = JSON.stringify([
    STABLE_ID_DOMAIN,
    recordingId,
    normalizedSourceSha256,
    upstreamCandidateId,
    startMs,
    endMs,
  ]);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `${PROJECTED_HIGHLIGHT_ID_PREFIX}${digest}`;
}

// ——————————————————————————————— 主入口 ———————————————————————————————

/**
 * 把一个录屏的 HotClip 候选投影为绑定来源哈希与精确时间码的 HighlightV1
 * 记录。任何输入非法都整体失败（fail closed），绝不返回部分结果；成功输出
 * 为深冻结数组，顺序与输入候选一致，空候选数组返回空数组（合法零候选）。
 */
export function projectHotClipCandidates(
  input: ProjectHotClipCandidatesInput,
): readonly ProjectedHotClipHighlight[] {
  if (!isPlainObject(input)) fail('invalid_input');
  validateRecording(input.recording);
  if (!isSha256(input.observedSourceSha256)) fail('invalid_observed_hash');

  const normalizedObservedSha256 = input.observedSourceSha256.toLowerCase();
  const normalizedSourceSha256 = input.recording.sourceSha256.toLowerCase();
  if (normalizedObservedSha256 !== normalizedSourceSha256) fail('source_hash_mismatch');

  if (!isIsoDateTime(input.createdAt)) fail('invalid_created_at');
  if (!Array.isArray(input.candidates)) fail('invalid_candidates');

  const candidates = input.candidates as readonly HotClipHighlightCandidate[];
  const durationMs = input.recording.durationMs;
  const recordingId = input.recording.id;
  const createdAt = input.createdAt;

  // 先整体校验再投影：任何一条候选非法都拒绝整批，绝不静默丢弃或截断。
  const seenCandidateIds = new Set<string>();
  const seenProjectedRanges = new Set<string>();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    validateCandidate(candidate, index);
    if (seenCandidateIds.has(candidate.id)) fail('duplicate_candidate_id', index);
    seenCandidateIds.add(candidate.id);
    // startMs / endMs 已校验为非负安全整数，十进制拼接无歧义。
    const rangeKey = `${candidate.startMs}:${candidate.endMs}`;
    if (seenProjectedRanges.has(rangeKey)) fail('duplicate_candidate_range', index);
    seenProjectedRanges.add(rangeKey);
    if (durationMs !== null && candidate.endMs > durationMs) {
      fail('candidate_out_of_range', index);
    }
  }

  const projected: ProjectedHotClipHighlight[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const evidenceNote = `${HOTCLIP_UNVERIFIED_REASON_NOTE_PREFIX}${candidate.reason}`;
    const highlight: HighlightV1 = {
      id: buildStableHighlightId(
        recordingId,
        normalizedSourceSha256,
        candidate.id,
        candidate.startMs,
        candidate.endMs,
      ),
      recordingId,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      score: candidate.score,
      topic: candidate.title,
      context: candidate.hook,
      evidence: [
        {
          kind: 'other',
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          note: evidenceNote,
        },
      ],
      boundaryOrigin: 'auto',
      adjustedAt: null,
      createdAt,
    };
    Object.freeze(highlight.evidence[0]);
    Object.freeze(highlight.evidence);
    Object.freeze(highlight);
    projected.push(
      Object.freeze({
        highlight,
        sourceSha256: normalizedSourceSha256,
        upstreamCandidateId: candidate.id,
        upstreamRecommended: candidate.recommended,
        reviewRequired: true as const,
      }),
    );
  }
  return Object.freeze(projected);
}

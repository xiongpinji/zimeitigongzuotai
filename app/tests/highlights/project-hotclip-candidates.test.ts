/**
 * HotClip 高光候选 → HighlightV1 纯来源映射测试（H1-S1）。
 *
 * 全部输入为合成的本地数据：不触网、不起子进程、不读真实媒体、不调用模型，
 * 也不读取系统时钟（createdAt 一律显式传入）。证明的是「来源边界契约」：
 * 内容哈希绑定（大小写不敏感、失配拒绝）、毫秒时间码安全（负值 / 舍入后
 * 零时长 / 越过已知录屏时长拒绝）、稳定 ID（同一输入重跑不变，录屏 / 哈希 /
 * 候选 ID / 时间范围变化则不同）、重复候选拒绝、深拷贝 + 深冻结防调用方
 * 变异，以及上游 `recommended` 永远只是启发式建议、绝不变成发布批准。
 * 这属于合成映射证据，不等于真实 HotClip 运行、真实媒体或人工评审验收
 * （见 docs/validation/p2-1-highlight-projection.md）。
 */
import { describe, expect, it } from 'vitest';
import type { HotClipHighlightCandidate } from '../../electron/highlights/hotclip-sidecar';
import type { HighlightV1, RecordingV1 } from '../../src/types/production-contracts';
import {
  HOTCLIP_PROJECTION_ERROR_CODES,
  HOTCLIP_UNVERIFIED_REASON_NOTE_PREFIX,
  HotClipProjectionError,
  PROJECTED_HIGHLIGHT_ID_PREFIX,
  projectHotClipCandidates,
  type HotClipProjectionErrorCode,
} from '../../electron/highlights/project-hotclip-candidates';

// ——————————————————————————————— 合成夹具 ———————————————————————————————

/** 合成 64 位十六进制哈希（非任何媒体真实摘要）。 */
const SHA_RECORDING = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(2);
const SHA_OTHER = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2);
const CREATED_AT = '2026-09-26T10:00:00.000Z';

function makeRecording(overrides: Partial<RecordingV1> = {}): RecordingV1 {
  return {
    id: 'rec-live-0001',
    sourceRef: 'recordings/synthetic-rec-live-0001.mp4',
    sourceSha256: SHA_RECORDING,
    capturedAt: '2026-09-20T19:00:00.000Z',
    durationMs: 120_000,
    mimeType: 'video/mp4',
    transcriptRef: null,
    importedAt: '2026-09-21T08:00:00.000Z',
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<HotClipHighlightCandidate> = {},
): HotClipHighlightCandidate {
  return {
    id: 'hc-cand-0001',
    startSec: 12.5,
    endSec: 34.25,
    startMs: 12_500,
    endMs: 34_250,
    title: 'synthetic topic',
    hook: 'synthetic hook',
    score: 0.83,
    reason: 'synthetic upstream reason',
    recommended: false,
    reviewNote: null,
    visualEvidence: { marker: 'synthetic-untrusted-payload' },
    ...overrides,
  };
}

function projectWith(overrides: {
  recording?: RecordingV1;
  observedSourceSha256?: string;
  candidates?: readonly HotClipHighlightCandidate[];
  createdAt?: string;
} = {}) {
  // 显式 in 检查：调用方传 undefined/null 等非法值时必须原样透传（fail-closed
  // 测试依赖这一点），不能被 ?? 默认值吞掉。
  return projectHotClipCandidates({
    recording: 'recording' in overrides ? (overrides.recording as RecordingV1) : makeRecording(),
    observedSourceSha256:
      'observedSourceSha256' in overrides
        ? (overrides.observedSourceSha256 as string)
        : SHA_RECORDING,
    candidates:
      'candidates' in overrides
        ? (overrides.candidates as readonly HotClipHighlightCandidate[])
        : [makeCandidate()],
    createdAt: 'createdAt' in overrides ? (overrides.createdAt as string) : CREATED_AT,
  });
}

/** 断言抛出 HotClipProjectionError 且 code 精确匹配；返回错误供进一步断言。 */
function expectProjectionError(
  fn: () => unknown,
  code: HotClipProjectionErrorCode,
): HotClipProjectionError {
  let thrown: unknown;
  let didThrow = false;
  try {
    fn();
  } catch (error) {
    didThrow = true;
    thrown = error;
  }
  expect(didThrow, `expected HotClipProjectionError(${code}) but nothing was thrown`).toBe(true);
  expect(thrown).toBeInstanceOf(HotClipProjectionError);
  const projectionError = thrown as HotClipProjectionError;
  expect(projectionError.code).toBe(code);
  return projectionError;
}

// ——————————————————————————————— 映射与来源绑定 ———————————————————————————————

describe('projectHotClipCandidates', () => {
  it('maps hash-matched candidates onto review-required HighlightV1 records', () => {
    // 观察哈希大小写不敏感：全大写形式同样匹配小写录屏哈希。
    const result = projectWith({ observedSourceSha256: SHA_RECORDING.toUpperCase() });
    expect(result).toHaveLength(1);
    const projected = result[0];
    const highlight = projected.highlight;

    expect(highlight.id.startsWith(PROJECTED_HIGHLIGHT_ID_PREFIX)).toBe(true);
    expect(highlight.id).toMatch(new RegExp(`^${PROJECTED_HIGHLIGHT_ID_PREFIX}[0-9a-f]{64}$`));
    expect(highlight.recordingId).toBe('rec-live-0001');
    expect(highlight.startMs).toBe(12_500);
    expect(highlight.endMs).toBe(34_250);
    expect(highlight.score).toBe(0.83);
    expect(highlight.topic).toBe('synthetic topic');
    expect(highlight.context).toBe('synthetic hook');
    expect(highlight.boundaryOrigin).toBe('auto');
    expect(highlight.adjustedAt).toBeNull();
    expect(highlight.createdAt).toBe(CREATED_AT);

    // reason 只能作为「未核验上游启发式」进入 evidence，kind 必须是 other。
    expect(highlight.evidence).toHaveLength(1);
    expect(highlight.evidence[0].kind).toBe('other');
    expect(highlight.evidence[0].startMs).toBe(12_500);
    expect(highlight.evidence[0].endMs).toBe(34_250);
    expect(highlight.evidence[0].note).toBe(
      `${HOTCLIP_UNVERIFIED_REASON_NOTE_PREFIX}synthetic upstream reason`,
    );
    expect(HOTCLIP_UNVERIFIED_REASON_NOTE_PREFIX).toContain('未核验');

    // 包装层：规范化小写哈希 + 上游追溯字段 + 恒定人工评审门槛。
    expect(projected.sourceSha256).toBe(SHA_RECORDING);
    expect(projected.upstreamCandidateId).toBe('hc-cand-0001');
    expect(projected.upstreamRecommended).toBe(false);
    expect(projected.reviewRequired).toBe(true);
  });

  it('rejects mismatched, malformed, or missing observed source hashes', () => {
    expectProjectionError(
      () => projectWith({ observedSourceSha256: SHA_OTHER }),
      'source_hash_mismatch',
    );
    for (const bad of ['', 'abc', SHA_RECORDING.slice(0, 63), `${SHA_RECORDING}0`, 'zz'.repeat(32)]) {
      expectProjectionError(() => projectWith({ observedSourceSha256: bad }), 'invalid_observed_hash');
    }
    for (const missing of [undefined, null, 123, {}]) {
      expectProjectionError(
        () => projectWith({ observedSourceSha256: missing as unknown as string }),
        'invalid_observed_hash',
      );
    }
    // 录屏自身哈希非法时 fail closed，而不是与观察哈希「都不合法所以相等」。
    expectProjectionError(
      () =>
        projectWith({
          recording: makeRecording({ sourceSha256: 'not-a-sha' }),
          observedSourceSha256: 'not-a-sha',
        }),
      'invalid_recording',
    );
  });

  it('returns a frozen empty list for zero candidates (legal negative sample)', () => {
    const result = projectWith({ candidates: [] });
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  // ——————————————————————————————— 稳定 ID ———————————————————————————————

  it('produces identical ids and output across reruns of equal input', () => {
    const first = projectWith();
    const second = projectWith();
    expect(first[0].highlight.id).toBe(second[0].highlight.id);
    expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify(second)));
  });

  it('derives different ids from recording id, hash, candidate id, or range; normalizes hash case', () => {
    const base = projectWith()[0].highlight.id;
    const variants = [
      projectWith({ recording: makeRecording({ id: 'rec-live-0002' }) })[0].highlight.id,
      projectWith({
        recording: makeRecording({ sourceSha256: SHA_OTHER }),
        observedSourceSha256: SHA_OTHER,
      })[0].highlight.id,
      projectWith({ candidates: [makeCandidate({ id: 'hc-cand-0002' })] })[0].highlight.id,
      projectWith({
        candidates: [makeCandidate({ endSec: 34.5, endMs: 34_500 })],
      })[0].highlight.id,
    ];
    expect(new Set([base, ...variants]).size).toBe(5);

    // 哈希大小写不同的同一录屏规范化后得到同一个 ID。
    const upper = projectWith({
      recording: makeRecording({ sourceSha256: SHA_RECORDING.toUpperCase() }),
      observedSourceSha256: SHA_RECORDING.toUpperCase(),
    })[0];
    expect(upper.highlight.id).toBe(base);
    expect(upper.sourceSha256).toBe(SHA_RECORDING);
  });

  // ——————————————————————————————— 重复与时间码安全 ———————————————————————————————

  it('rejects duplicate upstream ids and duplicate projected ranges', () => {
    const dupId = expectProjectionError(
      () =>
        projectWith({
          candidates: [
            makeCandidate({ id: 'hc-dup', startSec: 10, endSec: 20, startMs: 10_000, endMs: 20_000 }),
            makeCandidate({ id: 'hc-dup', startSec: 30, endSec: 40, startMs: 30_000, endMs: 40_000 }),
          ],
        }),
      'duplicate_candidate_id',
    );
    expect(dupId.candidateIndex).toBe(1);

    const dupRange = expectProjectionError(
      () =>
        projectWith({
          candidates: [
            makeCandidate({ id: 'hc-a', startSec: 10, endSec: 20, startMs: 10_000, endMs: 20_000 }),
            makeCandidate({ id: 'hc-b', startSec: 10, endSec: 20, startMs: 10_000, endMs: 20_000 }),
          ],
        }),
      'duplicate_candidate_range',
    );
    expect(dupRange.candidateIndex).toBe(1);
  });

  it('rejects negative, reversed, zero-duration, post-rounding-zero, and inconsistent timecodes', () => {
    const cases: HotClipHighlightCandidate[] = [
      // 负起点
      makeCandidate({ startSec: -0.5, endSec: 1, startMs: -500, endMs: 1_000 }),
      // 秒级逆序（end <= start）
      makeCandidate({ startSec: 5, endSec: 1, startMs: 5_000, endMs: 1_000 }),
      // 舍入后零时长：1.0001s 与 1.0004s 都舍入到 1000ms
      makeCandidate({ startSec: 1.0001, endSec: 1.0004, startMs: 1_000, endMs: 1_000 }),
      // 毫秒非整数
      makeCandidate({ startSec: 1.5, endSec: 2.5, startMs: 1500.5, endMs: 2_500 }),
      // 毫秒与上游秒舍入语义（Math.round(sec*1000)）不一致
      makeCandidate({ startSec: 1, endSec: 2, startMs: 1_000, endMs: 2_500 }),
      // 毫秒缺失（类型被绕过）
      { ...makeCandidate(), endMs: undefined } as unknown as HotClipHighlightCandidate,
    ];
    cases.forEach((candidate, index) => {
      const error = expectProjectionError(
        () => projectWith({ candidates: [candidate] }),
        'invalid_candidate',
      );
      expect(error.candidateIndex, `case ${index} should carry its index`).toBe(0);
    });
  });

  it('enforces the known recording duration as an upper bound without clamping', () => {
    // 恰好落在边界（endMs === durationMs）合法；起点为 0 也合法。
    const boundary = projectWith({
      recording: makeRecording({ durationMs: 60_000 }),
      candidates: [makeCandidate({ startSec: 0, endSec: 60, startMs: 0, endMs: 60_000 })],
    });
    expect(boundary[0].highlight.startMs).toBe(0);
    expect(boundary[0].highlight.endMs).toBe(60_000);

    // 超出已知时长必须整体拒绝，绝不静默截断到 durationMs。
    const outOfRange = expectProjectionError(
      () =>
        projectWith({
          recording: makeRecording({ durationMs: 60_000 }),
          candidates: [
            makeCandidate({ startSec: 10, endSec: 20, startMs: 10_000, endMs: 20_000 }),
            makeCandidate({ id: 'hc-late', startSec: 59, endSec: 60.001, startMs: 59_000, endMs: 60_001 }),
          ],
        }),
      'candidate_out_of_range',
    );
    expect(outOfRange.candidateIndex).toBe(1);
  });

  it('skips the upper-bound check when the recording duration is unknown (null)', () => {
    const result = projectWith({
      recording: makeRecording({ durationMs: null }),
      candidates: [
        makeCandidate({ startSec: 999_999, endSec: 1_000_000, startMs: 999_999_000, endMs: 1_000_000_000 }),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].highlight.endMs).toBe(1_000_000_000);
  });

  // ——————————————————————————————— 评审门槛与不可变性 ———————————————————————————————

  it('never turns upstream recommended=true into any approval and exposes exact key sets', () => {
    const result = projectWith({
      candidates: [makeCandidate({ recommended: true })],
    });
    const projected = result[0];
    expect(projected.upstreamRecommended).toBe(true);
    expect(projected.reviewRequired).toBe(true);

    // 包装层与 HighlightV1 的键集合是封闭的：不存在任何批准 / 发布语义字段。
    expect([...Object.keys(projected)].sort()).toEqual(
      ['highlight', 'reviewRequired', 'sourceSha256', 'upstreamCandidateId', 'upstreamRecommended'].sort(),
    );
    expect([...Object.keys(projected.highlight)].sort()).toEqual(
      [
        'adjustedAt',
        'boundaryOrigin',
        'context',
        'createdAt',
        'endMs',
        'evidence',
        'id',
        'recordingId',
        'score',
        'startMs',
        'topic',
      ].sort(),
    );
    const serialized = JSON.stringify(projected);
    expect(serialized).toContain('"reviewRequired":true');
    expect(serialized).not.toContain('approved');
    expect(serialized).not.toContain('published');
  });

  it('returns deeply frozen defensive copies isolated from caller mutation', () => {
    const recording = makeRecording();
    const candidate = makeCandidate();
    const result = projectWith({ recording, candidates: [candidate] });
    const snapshot = JSON.parse(JSON.stringify(result));

    // 深冻结：包装层、highlight、evidence 数组与元素都不可写。
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].highlight)).toBe(true);
    expect(Object.isFrozen(result[0].highlight.evidence)).toBe(true);
    expect(Object.isFrozen(result[0].highlight.evidence[0])).toBe(true);
    expect(() => {
      result[0].highlight.topic = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      (result[0].highlight.evidence as unknown[]).push({ kind: 'manual' });
    }).toThrow(TypeError);

    // 调用方事后变异输入（含嵌套 visualEvidence 与录屏字段）不得影响输出。
    candidate.title = 'mutated-title';
    candidate.reason = 'mutated-reason';
    candidate.startMs = -1;
    candidate.endMs = -1;
    (candidate.visualEvidence as { marker: string }).marker = 'mutated-payload';
    recording.durationMs = -5;
    (recording as { id: string }).id = 'mutated-recording';
    expect(JSON.parse(JSON.stringify(result))).toEqual(snapshot);
  });

  // ——————————————————————————————— fail closed 与错误卫生 ———————————————————————————————

  it('fails closed on malformed runtime data that bypasses TypeScript types', () => {
    expectProjectionError(
      () => projectHotClipCandidates(null as never),
      'invalid_input',
    );
    for (const bad of [undefined, 'candidates', { length: 1 }]) {
      expectProjectionError(
        () => projectWith({ candidates: bad as unknown as HotClipHighlightCandidate[] }),
        'invalid_candidates',
      );
    }
    const brokenCandidates: unknown[] = [
      null,
      [],
      { ...makeCandidate(), id: '' },
      { ...makeCandidate(), id: '   ' },
      (() => {
        const noId = makeCandidate() as Partial<HotClipHighlightCandidate>;
        delete noId.id;
        return noId;
      })(),
      { ...makeCandidate(), recommended: 'true' },
      { ...makeCandidate(), score: Number.NaN },
      { ...makeCandidate(), title: 42 },
      { ...makeCandidate(), reviewNote: 7 },
    ];
    brokenCandidates.forEach((broken) => {
      expectProjectionError(
        () => projectWith({ candidates: [broken as HotClipHighlightCandidate] }),
        'invalid_candidate',
      );
    });

    const brokenRecordings: unknown[] = [
      null,
      [],
      { ...makeRecording(), id: '' },
      { ...makeRecording(), durationMs: -1 },
      { ...makeRecording(), durationMs: 1.5 },
      { ...makeRecording(), capturedAt: 'yesterday' },
      { ...makeRecording(), importedAt: null },
      { ...makeRecording(), unexpectedExtraKey: true },
      (() => {
        const noRef = makeRecording() as Partial<RecordingV1>;
        delete noRef.sourceRef;
        return noRef;
      })(),
    ];
    brokenRecordings.forEach((broken) => {
      expectProjectionError(
        () => projectWith({ recording: broken as RecordingV1 }),
        'invalid_recording',
      );
    });

    for (const badCreatedAt of [
      undefined,
      null,
      '',
      'yesterday',
      '2026-09-26',
      '2026-09-26T10:00:00',
      '2026-02-31T00:00:00Z',
      '2026-13-01T00:00:00Z',
      1_758_880_000_000,
    ]) {
      expectProjectionError(
        () => projectWith({ createdAt: badCreatedAt as unknown as string }),
        'invalid_created_at',
      );
    }
  });

  it('validates calendar days, leap years, clock components, and offsets by entry point', () => {
    // 合法边界：闰年 2 月 29 日、四百年闰、时分秒上界、最大偏移与 9 位小数。
    const legalDateTimes = [
      '2024-02-29T00:00:00Z',
      '2000-02-29T00:00:00.000000001Z',
      '2026-01-31T23:59:59.999999999Z',
      '2026-04-30T23:59:59+23:59',
      '2026-12-31T00:00:00-23:59',
    ];
    for (const legal of legalDateTimes) {
      expect(projectWith({ createdAt: legal })[0].highlight.createdAt).toBe(legal);
      expect(() =>
        projectWith({ recording: makeRecording({ capturedAt: legal }) }),
      ).not.toThrow();
      expect(() =>
        projectWith({ recording: makeRecording({ importedAt: legal }) }),
      ).not.toThrow();
    }

    // 非法日历 / 闰年 / 时钟 / 偏移：必须显式拒绝，绝不能被 Date.parse
    // 规范化成「下一天 / 下个月」后放行。
    const impossibleDateTimes = [
      '2026-02-31T00:00:00Z', // 2 月没有 31 日（Date.parse 会规范化为 3 月 3 日）
      '2026-04-31T00:00:00Z', // 4 月只有 30 天
      '2025-02-29T00:00:00Z', // 非闰年 2 月没有 29 日
      '1900-02-29T00:00:00Z', // 百年不闰（可被 100 整除但不可被 400 整除）
      '2100-02-29T00:00:00Z', // 同上
      '2026-13-01T00:00:00Z', // 月份越界
      '2026-00-10T00:00:00Z', // 月份 0
      '2026-01-00T00:00:00Z', // 日期 0
      '2026-01-01T25:00:00Z', // 时越界
      '2026-01-01T24:00:00Z', // 24:00 结尾形式不在本契约内
      '2026-01-01T12:60:00Z', // 分越界
      '2026-01-01T12:00:60Z', // 秒越界（不接受闰秒）
      '2026-01-01T12:00:00+24:00', // 偏移时越界
      '2026-01-01T12:00:00-00:60', // 偏移分越界
    ];
    for (const impossible of impossibleDateTimes) {
      // 三个入口共享同一校验语义，但按入口返回各自的错误码。
      expectProjectionError(
        () => projectWith({ createdAt: impossible }),
        'invalid_created_at',
      );
      expectProjectionError(
        () => projectWith({ recording: makeRecording({ capturedAt: impossible }) }),
        'invalid_recording',
      );
      expectProjectionError(
        () => projectWith({ recording: makeRecording({ importedAt: impossible }) }),
        'invalid_recording',
      );
    }
  });

  it('keeps error text fixed and free of media paths, reasons, hooks, and evidence payloads', () => {
    const markedRecording = makeRecording({
      sourceRef: '/private/SECRET-PATH-MARKER/recording.mp4',
      transcriptRef: 'SECRET-TRANSCRIPT-REF-MARKER',
    });
    const markedCandidate = makeCandidate({
      reason: 'SECRET-REASON-MARKER',
      title: 'SECRET-TITLE-MARKER',
      hook: 'SECRET-HOOK-MARKER',
      visualEvidence: { marker: 'SECRET-VISUAL-MARKER' },
    });
    const markers = [
      'SECRET-PATH-MARKER',
      'SECRET-TRANSCRIPT-REF-MARKER',
      'SECRET-REASON-MARKER',
      'SECRET-TITLE-MARKER',
      'SECRET-HOOK-MARKER',
      'SECRET-VISUAL-MARKER',
    ];
    const failingCalls: Array<() => unknown> = [
      () => projectWith({ recording: markedRecording, observedSourceSha256: SHA_OTHER }),
      () =>
        projectWith({ recording: { ...markedRecording, id: '' } as RecordingV1 }),
      () => projectWith({ recording: markedRecording, observedSourceSha256: 'xyz' }),
      () => projectWith({ recording: markedRecording, createdAt: 'SECRET not a date' }),
      () =>
        projectWith({ recording: markedRecording, candidates: 'SECRET not an array' as never }),
      () =>
        projectWith({
          recording: markedRecording,
          candidates: [{ ...markedCandidate, startMs: -1 }],
        }),
      () =>
        projectWith({
          recording: markedRecording,
          candidates: [markedCandidate, { ...markedCandidate }],
        }),
      () =>
        projectWith({
          recording: markedRecording,
          candidates: [
            markedCandidate,
            { ...markedCandidate, id: 'hc-other' },
          ],
        }),
      () =>
        projectWith({
          recording: makeRecording({ ...markedRecording, durationMs: 20_000 }),
          candidates: [markedCandidate],
        }),
    ];
    const messagesByCode = new Map<string, string>();
    failingCalls.forEach((call) => {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HotClipProjectionError);
      const projectionError = thrown as HotClipProjectionError;
      expect(HOTCLIP_PROJECTION_ERROR_CODES).toContain(projectionError.code);
      expect(typeof projectionError.message).toBe('string');
      expect(projectionError.message.length).toBeGreaterThan(0);
      markers.forEach((marker) => {
        expect(projectionError.message).not.toContain(marker);
      });
      expect(
        projectionError.candidateIndex === null ||
          (Number.isInteger(projectionError.candidateIndex) && projectionError.candidateIndex >= 0),
      ).toBe(true);
      // 同一 code 的消息是固定静态文本。
      const previous = messagesByCode.get(projectionError.code);
      if (previous !== undefined) expect(projectionError.message).toBe(previous);
      messagesByCode.set(projectionError.code, projectionError.message);
    });
    expect(messagesByCode.size).toBeGreaterThanOrEqual(8);
  });

  it('never serializes visualEvidence or recording refs into output; reason stays labeled unverified', () => {
    const result = projectWith({
      recording: makeRecording({ sourceRef: '/private/SECRET-PATH-MARKER/recording.mp4' }),
      candidates: [
        makeCandidate({
          reason: 'SECRET-REASON-MARKER',
          visualEvidence: { marker: 'SECRET-VISUAL-MARKER', nested: [{ deep: 'payload' }] },
        }),
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SECRET-VISUAL-MARKER');
    expect(serialized).not.toContain('SECRET-PATH-MARKER');
    expect(serialized).not.toContain('payload');
    // reason 允许出现，但必须带上「未核验上游启发式」固定标注前缀。
    expect(result[0].highlight.evidence[0].note).toContain('SECRET-REASON-MARKER');
    expect(result[0].highlight.evidence[0].note?.startsWith(HOTCLIP_UNVERIFIED_REASON_NOTE_PREFIX)).toBe(
      true,
    );
    const highlight: HighlightV1 = result[0].highlight;
    expect(highlight.evidence[0].kind).toBe('other');
  });
});

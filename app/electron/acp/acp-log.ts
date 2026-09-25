import { addAppLog } from '../app-logger';
import type { AppLogLevel } from '../../src/lib/app-log';

/**
 * ACP 链路统一诊断日志入口。
 *
 * 背景：headless ACP LLM（claude-code-acp）链路此前完全没有应用日志埋点，
 * spawn / 握手 / session/prompt / agent stderr / 退出 全程黑盒，
 * 一旦 agent 失联会静默卡死且无任何线索。这里集中转发到 app-*.log，
 * scope 统一以 `acp` 前缀，便于 `grep acp` 过滤。
 *
 * 注意：
 * - 不要在 details 里打印 API Key、env value、完整 prompt 正文等敏感内容；
 *   只记录长度 / 计数 / role / key 名等元信息。
 * - 高频事件（content_delta / thinking chunk）必须经 ChunkLogThrottle 节流，
 *   否则会把日志刷爆。
 */
export function acpLog(
  level: AppLogLevel,
  scope: string,
  message: string,
  details?: string | Record<string, unknown>,
): void {
  const detailText =
    details == null
      ? undefined
      : typeof details === 'string'
        ? details
        : safeStringify(details);
  addAppLog(level, scope, message, detailText);
}

function safeStringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 当前高精度时间戳（ms），用于阶段耗时统计。 */
export function nowMs(): number {
  return Date.now();
}

/** 将文本截断到 maxLen，超出追加省略标记，避免单条日志过长。 */
export function clip(text: string, maxLen = 500): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…(+${text.length - maxLen} chars)`;
}

/**
 * 高频 chunk 日志节流器：按累计次数与字符数聚合，
 * 每隔 minIntervalMs 或每攒够 everyNChunks 个 chunk 落一条聚合日志。
 */
export class ChunkLogThrottle {
  private count = 0;
  private chars = 0;
  private lastFlushAt = 0;
  private firstSeenAt = 0;

  constructor(
    private readonly scope: string,
    private readonly kind: string,
    private readonly opts: { everyNChunks?: number; minIntervalMs?: number } = {},
  ) {}

  record(textLen: number): void {
    const now = Date.now();
    if (this.count === 0) {
      this.firstSeenAt = now;
      this.lastFlushAt = now;
      acpLog('info', this.scope, `首个 ${this.kind} chunk 到达`, { textLen });
    }
    this.count += 1;
    this.chars += textLen;

    const everyN = this.opts.everyNChunks ?? 20;
    const minInterval = this.opts.minIntervalMs ?? 3_000;
    if (this.count % everyN === 0 || now - this.lastFlushAt >= minInterval) {
      this.lastFlushAt = now;
      acpLog('info', this.scope, `${this.kind} 进行中`, {
        chunks: this.count,
        totalChars: this.chars,
        elapsedMs: now - this.firstSeenAt,
      });
    }
  }

  summary(): Record<string, unknown> {
    return {
      kind: this.kind,
      chunks: this.count,
      totalChars: this.chars,
      elapsedMs: this.count > 0 ? Date.now() - this.firstSeenAt : 0,
    };
  }
}

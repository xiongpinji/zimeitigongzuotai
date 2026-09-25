/**
 * 一键成稿 / AI 视频流水线的耗时观测日志。
 *
 * 落盘位置：<userData>/logs/auto-run/
 *   - <runId>.jsonl               按运行 ID 分文件，逐行 JSON 事件
 *   - LATEST.txt                  指向最近一次 runId 的纯文本指针
 *
 * 事件结构（每行 JSON）：
 *   { runId, ts, kind, ... }
 *
 * 常见 kind：
 *   run.start         { autoMode, projectDir, scriptChars, modelHint? }
 *   run.end           { ok, totalDurationMs, error? }
 *   stage.start       { stage }
 *   stage.end         { stage, durationMs, ok, error? }
 *   llm.start         { label, model?, thinking?, promptChars?, attempt? }
 *   llm.firstChunk    { label, latencyMs }
 *   llm.end           { label, durationMs, outputChars?, ok, retry?, error? }
 *   card.start        { segmentIndex, totalSegments, segmentId, visualType }
 *   card.end          { segmentIndex, durationMs, ok, error? }
 *   highlight.batch.start { batchIndex, batchTotal }
 *   highlight.batch.end   { batchIndex, durationMs, ok, error? }
 *   note              { message, ... }
 *
 * 设计原则：
 *   - append-only、文件锁靠 Promise 串行队列保证 jsonl 不会撕裂
 *   - 单条事件出错只 warn，不抛错，永远不能阻塞主流程
 *   - 日志体量预期不大（一次运行几 KB ~ 几十 KB），不做轮转，仅在 listRecentRuns 里手动裁剪
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const LOG_SUBDIR = path.join('logs', 'auto-run');
const LATEST_POINTER = 'LATEST.txt';

export interface AutoRunEvent {
  runId: string;
  ts: number;
  kind: string;
  [key: string]: unknown;
}

let writeQueue: Promise<void> = Promise.resolve();

export function getAutoRunLogDir(): string {
  return path.join(app.getPath('userData'), LOG_SUBDIR);
}

function getRunLogPath(runId: string): string {
  return path.join(getAutoRunLogDir(), `${sanitizeRunId(runId)}.jsonl`);
}

function getLatestPointerPath(): string {
  return path.join(getAutoRunLogDir(), LATEST_POINTER);
}

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'unknown';
}

async function ensureLogDir(): Promise<void> {
  await fs.mkdir(getAutoRunLogDir(), { recursive: true });
}

/**
 * 追加单条事件。永远 resolve，内部错误只 warn。
 * 多个调用通过队列串行，确保 jsonl 行不会交错。
 */
export function appendAutoRunEvent(event: AutoRunEvent): Promise<void> {
  const task = async () => {
    try {
      await ensureLogDir();
      const line = `${JSON.stringify(event)}\n`;
      await fs.appendFile(getRunLogPath(event.runId), line, 'utf8');
      if (event.kind === 'run.start') {
        await fs.writeFile(getLatestPointerPath(), sanitizeRunId(event.runId), 'utf8');
      }
    } catch (err) {
      // 观测代码本身不允许抛错影响业务
      console.warn('[auto-run-logger] append failed:', err);
    }
  };
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

export async function getLatestRunId(): Promise<string | null> {
  try {
    const text = await fs.readFile(getLatestPointerPath(), 'utf8');
    const trimmed = text.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

export async function readRunEvents(runId: string): Promise<AutoRunEvent[]> {
  try {
    const text = await fs.readFile(getRunLogPath(runId), 'utf8');
    const out: AutoRunEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AutoRunEvent);
      } catch {
        // 单行损坏不影响其它
      }
    }
    return out;
  } catch {
    return [];
  }
}

export interface RecentRunMeta {
  runId: string;
  filePath: string;
  startedAt: number;
  endedAt: number;
  sizeBytes: number;
}

export async function listRecentRuns(limit = 20): Promise<RecentRunMeta[]> {
  try {
    await ensureLogDir();
    const files = await fs.readdir(getAutoRunLogDir());
    const ids = files
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length));
    const stats = await Promise.all(
      ids.map(async (id) => {
        const filePath = getRunLogPath(id);
        try {
          const stat = await fs.stat(filePath);
          return {
            runId: id,
            filePath,
            startedAt: stat.birthtimeMs || stat.mtimeMs,
            endedAt: stat.mtimeMs,
            sizeBytes: stat.size,
          } satisfies RecentRunMeta;
        } catch {
          return null;
        }
      }),
    );
    return stats
      .filter((s): s is RecentRunMeta => s !== null)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, limit);
  } catch {
    return [];
  }
}

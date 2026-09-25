/**
 * Renderer 侧的"一键成稿"耗时观测：通过 IPC 把事件追加到主进程的 jsonl 文件里。
 *
 * 用法：
 *   const tel = createAutoRunTelemetry(`autorun-${Date.now()}`);
 *   tel.event('run.start', { autoMode: true, scriptChars: 5000 });
 *   await tel.stage('tts', () => generateTts(...));
 *   tel.event('run.end', { ok: true, totalDurationMs });
 *
 * 设计目标：
 *   - fire-and-forget，永远不阻塞业务路径（IPC 内部已串行写入）
 *   - tel.stage(name, fn) 包装异步任务：自动埋 stage.start / stage.end + 失败时记录 error
 *   - 永远不抛错；任何 IPC 失败都吞掉
 *
 * 事件结构和主进程 electron/telemetry/auto-run-logger.ts 中的 AutoRunEvent 完全一致。
 */

export interface AutoRunEvent {
  runId: string;
  ts: number;
  kind: string;
  [key: string]: unknown;
}

export interface AutoRunLogMeta {
  runId: string;
  filePath: string;
  startedAt: number;
  endedAt: number;
  sizeBytes: number;
}

export interface AutoRunTelemetry {
  runId: string;
  /** 立刻发一条事件（不等 IPC 回传） */
  event: (kind: string, extra?: Record<string, unknown>) => void;
  /** 把一个异步任务包成 stage.start / stage.end；失败也会上报 */
  stage: <T>(name: string, fn: () => Promise<T>, extra?: Record<string, unknown>) => Promise<T>;
  /** 计时器辅助：返回 endFn()，调用时计算 durationMs 并发出 end 事件 */
  timer: (kind: string, startExtra?: Record<string, unknown>) =>
    (endExtra?: Record<string, unknown>) => void;
}

interface ElectronAPILike {
  appendAutoRunEvent?: (event: AutoRunEvent) => Promise<unknown> | unknown;
}

function getApi(): ElectronAPILike | undefined {
  // electronAPI 只在 renderer + preload 注入；测试环境 / Node 环境会缺
  return (globalThis as { electronAPI?: ElectronAPILike }).electronAPI;
}

function emitRaw(event: AutoRunEvent): void {
  const api = getApi();
  if (!api?.appendAutoRunEvent) return;
  try {
    const result = api.appendAutoRunEvent(event);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // 观测代码不抛错
  }
}

export function createAutoRunTelemetry(runId: string): AutoRunTelemetry {
  const safeRunId = runId.trim() || `autorun-${Date.now()}`;

  const event = (kind: string, extra: Record<string, unknown> = {}): void => {
    emitRaw({ runId: safeRunId, ts: Date.now(), kind, ...extra });
  };

  const stage = async <T,>(
    name: string,
    fn: () => Promise<T>,
    extra: Record<string, unknown> = {},
  ): Promise<T> => {
    const start = Date.now();
    event('stage.start', { stage: name, ...extra });
    try {
      const result = await fn();
      event('stage.end', { stage: name, durationMs: Date.now() - start, ok: true });
      return result;
    } catch (err) {
      event('stage.end', {
        stage: name,
        durationMs: Date.now() - start,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  const timer = (kind: string, startExtra: Record<string, unknown> = {}) => {
    const startTs = Date.now();
    event(`${kind}.start`, startExtra);
    return (endExtra: Record<string, unknown> = {}) => {
      event(`${kind}.end`, { durationMs: Date.now() - startTs, ...endExtra });
    };
  };

  return { runId: safeRunId, event, stage, timer };
}

/** 测试 / 无 electronAPI 环境的 no-op 实现，调用方语义不变。 */
export function createNoopTelemetry(): AutoRunTelemetry {
  return {
    runId: 'noop',
    event: () => undefined,
    stage: async (_name, fn) => fn(),
    timer: () => () => undefined,
  };
}

/**
 * Main 进程内部使用：把 lib 层调用站点（ai-analysis / llm）接入到任意 emitter。
 *
 * 关键：lib 代码同时被 main 直接 import 和测试单跑，不能依赖 globalThis.electronAPI。
 * 所以我们用一个轻量 hook 类型，main 侧调用 analyzeSrt 时显式注入；
 * renderer 侧调用 LLM 的路径（很少）则可以用 createAutoRunTelemetry 的 .event 注入。
 */
export interface TelemetryHook {
  emit: (kind: string, extra?: Record<string, unknown>) => void;
}

export function hookFromTelemetry(tel: AutoRunTelemetry): TelemetryHook {
  return { emit: (kind, extra) => tel.event(kind, extra) };
}

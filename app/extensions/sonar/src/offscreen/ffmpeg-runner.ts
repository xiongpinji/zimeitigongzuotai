/**
 * ffmpeg.wasm 音频提取核心（offscreen document **主线程**运行）。
 *
 * 替代旧的 Web Audio decodeAudioData 路径：把任意视频字节解码 / 重采样为 16kHz 单声道 WAV，
 * 供 bcut ASR 转录。对短 / 长视频行为一致，不再把整轨 PCM 驻留内存。
 *
 * 为什么直接在 offscreen 主线程跑、不经 @ffmpeg/ffmpeg 的 worker：
 * - 单线程 @ffmpeg/core 是 UMD（Emscripten MODULARIZE）：经典 <script>/importScripts 加载时
 *   createFFmpegCore 才会挂到全局；而 @ffmpeg/ffmpeg@0.12 把 worker 硬编码为 module worker，
 *   module worker 内 importScripts 不可用 → 回退 `await import(core)` → UMD 以 module 解析时
 *   createFFmpegCore 不挂全局 → 抛 ERROR_IMPORT_FAILURE（实测「分析失败：浏览器音频提取失败」即此）。
 * - offscreen 是隐藏的专用页面，单线程 exec 阻塞主线程无妨，换来零 worker / 零 blob / 零 CSP 摩擦。
 *
 * 约束（MV3）：
 * - core js 经经典 <script src=chrome.runtime.getURL(...)> 加载（扩展自身源 = CSP 的 'self'）。
 * - wasm 实例化需要 CSP 'wasm-unsafe-eval'；core 经 locateFile 取扩展自身源的 .wasm。
 * - core 实例惰性创建并复用，避免每条视频重新加载 ~30MB wasm。
 * - 加载包超时：把异常加载转成可见错误（带 detail），而非永远转圈。
 */

const INPUT_NAME = 'input.mp4';
const OUTPUT_NAME = 'output.wav';
const TARGET_SAMPLE_RATE = 16_000;
const LOAD_TIMEOUT_MS = 60_000;

/** ffmpeg 日志条目（core 的 setLogger 回调入参）。 */
export type FfmpegLogEntry = string | { type?: string; message?: string };

/** @ffmpeg/core（Emscripten Module）暴露的最小契约，便于单测注入 fake。 */
export interface FfmpegCore {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  exec(...args: string[]): void;
  /** 上一次 exec 的退出码（0 成功）。 */
  ret: number;
  reset(): void;
  setTimeout?(ms: number): void;
  /** 注册日志回调（ffmpeg stderr/stdout）；用于在失败时回传真实原因。 */
  setLogger?(cb: (entry: FfmpegLogEntry) => void): void;
}

/**
 * 构造 16kHz 单声道 WAV 的 ffmpeg argv（纯函数，可单测）。
 * 前置 -nostdin -y：禁用 stdin 交互、覆盖已存在输出（对齐 @ffmpeg/ffmpeg 默认行为，避免卡 / 报错）。
 */
export function buildWav16kMonoArgs(input: string, output: string): string[] {
  return ['-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-ar', String(TARGET_SAMPLE_RATE), '-f', 'wav', output];
}

function logEntryMessage(entry: FfmpegLogEntry): string {
  return (typeof entry === 'string' ? entry : entry?.message ?? '').trim();
}

export interface FfmpegRunnerDeps {
  /** 惰性创建 core 实例（真实实现见 createChromeFfmpegRunner）。 */
  loadCore: () => Promise<FfmpegCore>;
  /** 加载超时毫秒（默认 60s）；测试可注入 0 关闭。 */
  loadTimeoutMs?: number;
}

export interface FfmpegRunner {
  transcodeToWav16kMono(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>>;
}

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 判断异常是否为 wasm 运行时崩溃（越界 / abort）。这类崩溃会把 Emscripten 实例置为
 * ABORT=true 永久毒化——`reset()` 救不回——故必须丢弃整个 core 实例重建。
 * 我们自己抛的「ffmpeg 退出码 N」是干净的非零退出，core 仍可用，不在此列。
 */
function isWasmCrash(err: unknown): boolean {
  if (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /memory access out of bounds|out of bounds|\bAborted\b|abort\(/i.test(msg);
}

/** 从日志尾部挑出最可能解释失败的一行（优先含错误关键字的行）。 */
function diagnosticFromLogs(logs: string[]): string {
  const meaningful = logs.filter(Boolean);
  const errorLine = [...meaningful].reverse().find((l) =>
    /error|invalid|not found|unable|failed|no such|does not contain/i.test(l),
  );
  return (errorLine ?? meaningful.at(-1) ?? '').slice(0, 200);
}

export function createFfmpegRunner(deps: FfmpegRunnerDeps): FfmpegRunner {
  const loadTimeoutMs = deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
  let corePromise: Promise<FfmpegCore> | null = null;
  const logTail: string[] = [];

  function ensureCore(): Promise<FfmpegCore> {
    corePromise ??= withTimeout(
      deps.loadCore(),
      loadTimeoutMs,
      'ffmpeg 加载超时（core/wasm 可能被扩展 CSP 拦截，或资源缺失）',
    )
      .then((core) => {
        core.setLogger?.((entry) => {
          const msg = logEntryMessage(entry);
          if (!msg) return;
          logTail.push(msg);
          if (logTail.length > 40) logTail.shift();
        });
        return core;
      })
      .catch((error) => {
        corePromise = null; // 允许下次重试（如 CSP / 资源临时问题）。
        throw error;
      });
    return corePromise;
  }

  return {
    async transcodeToWav16kMono(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
      const core = await ensureCore();
      logTail.length = 0; // 只保留本次 exec 的日志，便于定位本次失败原因。
      let crashed = false;
      try {
        core.FS.writeFile(INPUT_NAME, input);
        core.setTimeout?.(-1);
        core.exec(...buildWav16kMonoArgs(INPUT_NAME, OUTPUT_NAME));
        if (core.ret !== 0) {
          const why = diagnosticFromLogs(logTail);
          throw new Error(`ffmpeg 退出码 ${core.ret}${why ? `：${why}` : ''}`);
        }
        const out = core.FS.readFile(OUTPUT_NAME);
        // 复制出独立缓冲，避免持有 ffmpeg FS 内部视图。
        return new Uint8Array(out);
      } catch (error) {
        // wasm 崩溃会毒化整个实例：丢弃缓存，下次调用重建干净 core，
        // 否则后续候选源会全部复用死掉的 core、重抛同一句 out of bounds。
        if (isWasmCrash(error)) {
          crashed = true;
          corePromise = null;
        }
        throw error;
      } finally {
        // 已崩溃的实例不再触碰（reset/unlink 只会再抛 ABORT）。
        if (!crashed) {
          try { core.reset(); } catch { /* ignore */ }
          try { core.FS.unlink(INPUT_NAME); } catch { /* ignore */ }
          try { core.FS.unlink(OUTPUT_NAME); } catch { /* ignore */ }
        }
      }
    },
  };
}

/** 经典 <script> 注入 core 脚本到当前文档（扩展自身源，满足 CSP 'self'）。 */
function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`无法加载 ffmpeg core 脚本：${src}`));
    document.head.appendChild(el);
  });
}

/** 运行时默认工厂：经典 <script> 加载 UMD core，主线程实例化（locateFile 取扩展自身源 wasm）。 */
export function createChromeFfmpegRunner(): FfmpegRunner {
  return createFfmpegRunner({
    loadCore: async () => {
      await injectScript(chrome.runtime.getURL('ffmpeg/ffmpeg-core.js'));
      const factory = (globalThis as { createFFmpegCore?: (mod: object) => Promise<FfmpegCore> })
        .createFFmpegCore;
      if (typeof factory !== 'function') {
        throw new Error('createFFmpegCore 未定义（core 脚本未正确加载）');
      }
      const wasmURL = chrome.runtime.getURL('ffmpeg/ffmpeg-core.wasm');
      return factory({ locateFile: (path: string) => (path.endsWith('.wasm') ? wasmURL : path) });
    },
  });
}

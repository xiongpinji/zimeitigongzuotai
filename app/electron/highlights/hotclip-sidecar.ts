/**
 * HotClip CLI sidecar 适配器（P0-3 进程边界）。
 *
 * 许可与分发边界：
 * - HotClip 是用户**另行安装**的 AGPL-3.0-only 程序（试验记录见
 *   `docs/validation/p0-3-hotclip-pilot.md`）。本仓库不导入、不复制、不打包、
 *   不依赖其代码；本适配器只按上游固定 CLI 协议
 *   `highlights <video> --json [--subtitles SRT] [--max-clips 1..12]`
 *   通过独立子进程与 stdout JSON 通信。
 * - 依照 GNU GPL FAQ（插件与独立进程），独立进程 + IPC **本身不足以**断定
 *   不构成组合作品；本文件不做该断言，正式分发前需单独法务审查。
 *
 * 语义边界：
 * - 输出只是「高光候选」。上游 `recommended` 是启发式建议，**不是**本项目
 *   的发布批准，也不构成任何平台「原创」判定。候选要进入
 *   `HighlightV1`（src/types/production-contracts.ts）必须补齐录屏
 *   `sourceSha256` 来源追溯并经人工独立评审；本适配器不做自动映射。
 * - 空 stdout + 退出码 0 = 合法的「零候选」，返回 []，保留低高光负样本。
 *
 * 安全边界：
 * - 绝不静默下载或执行内置 HotClip：executable 必须由调用方（用户配置）显式给出。
 * - 子进程 env 显式构造：固定 OS 最小 allowlist + 调用方逐项批准的键值；
 *   进程内其余 env（可能含 API key）一律不转发，并拒绝 NODE_OPTIONS 等注入向量。
 * - 返回的错误 / 日志绝不包含 API key、转写文本、原始 stderr 或完整文件路径。
 * - 超时 / 取消 / 输出超限都会终止整个子进程树（Windows: `taskkill /PID <pid>
 *   /T /F` 固定 argv 无 shell；POSIX: detached 进程组 + 负 pid 组信号，
 *   带界升级 SIGKILL），并保证 Promise 恰好 settle 一次。
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// ——————————————————————————————— 常量 ———————————————————————————————

/** 上游 CLI 对 --max-clips 的硬性下界。 */
export const HOTCLIP_MIN_CLIPS = 1;
/** 上游 CLI 对 --max-clips 的硬性上界。 */
export const HOTCLIP_MAX_CLIPS = 12;
/** stdout / stderr 每路输出字节上限默认值（4 MiB，对 ≤12 条候选 JSON 足够宽裕）。 */
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** 树终止发出后到升级 SIGKILL 的默认等待上限。 */
export const DEFAULT_KILL_GRACE_MS = 2_000;

/** 非 win32 平台转发的最小 OS env（运行管道所需，不含任何 LLM 凭证类键）。 */
const BASE_ENV_ALLOWLIST_POSIX = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'] as const;
/** win32 平台转发的最小 OS env（pnpm/node 在 Windows 上需要 SystemRoot 等）。 */
const BASE_ENV_ALLOWLIST_WIN32 = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'SYSTEMDRIVE',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'LOCALAPPDATA',
  'APPDATA',
  'PUBLIC',
] as const;
/** 即使调用方显式传入也拒绝的 env 键（代码注入向量），按大写比较。 */
const ENV_KEY_DENYLIST = new Set([
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
]);

// ——————————————————————————————— 错误 ———————————————————————————————

export const HOTCLIP_SIDECAR_ERROR_CODES = [
  'invalid_options',
  'executable_missing',
  'spawn_failed',
  'timeout',
  'cancelled',
  'nonzero_exit',
  'output_too_large',
  'invalid_output',
] as const;

export type HotClipSidecarErrorCode = (typeof HOTCLIP_SIDECAR_ERROR_CODES)[number];

export interface HotClipSidecarErrorDetails {
  exitCode?: number | null;
  signal?: string | null;
  stdoutBytes?: number;
  stderrBytes?: number;
}

/**
 * 机器可读的 sidecar 失败。message 与附加字段只含静态描述与数值度量，
 * 绝不含路径、stderr 原文、转写内容或凭证。
 */
export class HotClipSidecarError extends Error {
  readonly code: HotClipSidecarErrorCode;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;

  constructor(
    code: HotClipSidecarErrorCode,
    message: string,
    details: HotClipSidecarErrorDetails = {},
  ) {
    super(message);
    this.name = 'HotClipSidecarError';
    this.code = code;
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.stdoutBytes = details.stdoutBytes ?? 0;
    this.stderrBytes = details.stderrBytes ?? 0;
  }
}

// ——————————————————————————————— 候选投影 ———————————————————————————————

/**
 * 一条通过校验的 HotClip 高光**候选**（非发布批准）。
 * 同时保留上游秒（startSec/endSec）与精确毫秒投影
 * （startMs = Math.round(sec * 1000)），时间语义可追溯。
 */
export interface HotClipHighlightCandidate {
  id: string;
  startSec: number;
  endSec: number;
  startMs: number;
  endMs: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
  /** 上游启发式建议；不是本项目发布批准，也不是平台原创判定。 */
  recommended: boolean;
  reviewNote: string | null;
  /** 上游视觉证据载荷，按 JSON 原样透传（不解释、不信任其内容）。 */
  visualEvidence: unknown;
}

// ——————————————————————————————— 选项 ———————————————————————————————

/** 可注入的 spawn 形态（测试用）；真实实现始终 shell:false。 */
export type HotClipSpawn = (
  command: string,
  args: readonly string[],
  options: Record<string, unknown>,
) => ChildProcess;

export interface RunHotClipHighlightsOptions {
  /**
   * 用户配置的 HotClip 可执行文件（绝对路径或 PATH 可解析命令名，如 `pnpm`）。
   * 必填且无默认值：本适配器绝不静默下载或执行任何内置 HotClip。
   */
  executable: string;
  /** 可执行文件参数前缀，如外部 checkout 中 `pnpm` + `['cli']`。 */
  argsPrefix?: readonly string[];
  /** 子进程工作目录（如外部 HotClip checkout 根目录）。 */
  cwd?: string;
  /** 输入视频路径（本项目不校验其存在性；文件问题由上游以非零退出码表达）。 */
  videoPath: string;
  /** 可选 SRT 字幕路径；null / undefined 表示不传 --subtitles。 */
  subtitlesPath?: string | null;
  /** 1..12（上游 CLI 硬限制）；null / undefined 表示不传 --max-clips。 */
  maxClips?: number | null;
  /** 单次运行墙钟上限（ms），必填正数；到点终止整个子进程树。 */
  timeoutMs: number;
  /** 调用方取消信号；abort 时终止整个子进程树并以 cancelled 拒绝。 */
  signal?: AbortSignal;
  /** stdout / stderr 每路字节上限；超限立即终止子进程树。默认 4 MiB。 */
  maxOutputBytes?: number;
  /**
   * 调用方**逐项批准**转发的子进程 env（如用户配置的 HotClip LLM 键）。
   * process.env 中的其余键（可能含本应用凭证）一律不转发。
   */
  env?: Readonly<Record<string, string>>;
  /**
   * 是否继承固定 OS 最小 allowlist（PATH/HOME/SystemRoot 等），默认 true。
   * false 时不转发本应用基础环境；win32 上会显式把 PATH 置空，因为 Windows
   * 在 env 缺 PATH 时会自动补全父进程 PATH（本机实测，见
   * docs/validation/p0-3-hotclip-pilot.md）。
   */
  inheritBaseEnv?: boolean;
  /** 树终止到 SIGKILL 升级的等待上限（ms），默认 2000，最小 50。 */
  killGraceMs?: number;
  /** 仅测试注入；默认取 process.platform。 */
  platform?: NodeJS.Platform;
  /** 仅测试注入；默认 node:child_process spawn（始终 shell:false）。 */
  spawnImpl?: HotClipSpawn;
}

interface BuildHotClipArgvInput {
  argsPrefix?: readonly string[];
  videoPath: string;
  subtitlesPath?: string | null;
  maxClips?: number | null;
}

/** 按上游 CLI 协议构造完整 argv（含调用方前缀）。 */
export function buildHotClipHighlightsArgv(input: BuildHotClipArgvInput): string[] {
  const argv: string[] = [...(input.argsPrefix ?? []), 'highlights', input.videoPath, '--json'];
  if (input.subtitlesPath !== undefined && input.subtitlesPath !== null) {
    argv.push('--subtitles', input.subtitlesPath);
  }
  if (input.maxClips !== undefined && input.maxClips !== null) {
    argv.push('--max-clips', String(input.maxClips));
  }
  return argv;
}

// ——————————————————————————————— 校验 ———————————————————————————————

function invalidOptions(message: string): HotClipSidecarError {
  return new HotClipSidecarError('invalid_options', message);
}

function invalidOutput(message: string): never {
  throw new HotClipSidecarError('invalid_output', message);
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidOptions(`${label} must be a non-empty string`);
  }
  return value;
}

function assertPositiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalidOptions(`${label} must be a positive finite number`);
  }
  return value;
}

function validateEnvKey(key: string): void {
  if (typeof key !== 'string' || key.trim() === '' || /[=\u0000-\u001f\u007f]/.test(key)) {
    throw invalidOptions('HotClip env keys must be non-empty and free of "=" or control characters');
  }
  if (ENV_KEY_DENYLIST.has(key.toUpperCase())) {
    throw invalidOptions(`HotClip env key ${key} is not allowed for sidecar subprocesses`);
  }
}

function validateRunOptions(options: RunHotClipHighlightsOptions): void {
  if (typeof options.executable !== 'string' || options.executable.trim() === '') {
    throw new HotClipSidecarError(
      'executable_missing',
      'HotClip executable must be explicitly user-configured; nothing is bundled or downloaded',
    );
  }
  if (options.argsPrefix !== undefined) {
    if (!Array.isArray(options.argsPrefix)) {
      throw invalidOptions('argsPrefix must be an array of strings');
    }
    for (const entry of options.argsPrefix) {
      if (typeof entry !== 'string') {
        throw invalidOptions('argsPrefix must be an array of strings');
      }
    }
  }
  if (options.cwd !== undefined) assertNonEmptyString(options.cwd, 'cwd');
  assertNonEmptyString(options.videoPath, 'videoPath');
  if (options.subtitlesPath !== undefined && options.subtitlesPath !== null) {
    assertNonEmptyString(options.subtitlesPath, 'subtitlesPath');
  }
  if (options.maxClips !== undefined && options.maxClips !== null) {
    if (
      typeof options.maxClips !== 'number' ||
      !Number.isInteger(options.maxClips) ||
      options.maxClips < HOTCLIP_MIN_CLIPS ||
      options.maxClips > HOTCLIP_MAX_CLIPS
    ) {
      throw invalidOptions(
        `maxClips must be an integer between ${HOTCLIP_MIN_CLIPS} and ${HOTCLIP_MAX_CLIPS}`,
      );
    }
  }
  assertPositiveFiniteNumber(options.timeoutMs, 'timeoutMs');
  if (options.maxOutputBytes !== undefined) {
    if (
      typeof options.maxOutputBytes !== 'number' ||
      !Number.isInteger(options.maxOutputBytes) ||
      options.maxOutputBytes <= 0
    ) {
      throw invalidOptions('maxOutputBytes must be a positive integer');
    }
  }
  if (options.killGraceMs !== undefined) {
    if (
      typeof options.killGraceMs !== 'number' ||
      !Number.isFinite(options.killGraceMs) ||
      options.killGraceMs < 50
    ) {
      throw invalidOptions('killGraceMs must be a finite number >= 50');
    }
  }
  if (options.env !== undefined) {
    if (typeof options.env !== 'object' || options.env === null || Array.isArray(options.env)) {
      throw invalidOptions('env must be a plain object of string values');
    }
    for (const [key, value] of Object.entries(options.env)) {
      validateEnvKey(key);
      if (typeof value !== 'string') {
        throw invalidOptions('env values must be strings');
      }
    }
  }
  if (
    options.signal !== undefined &&
    (typeof options.signal.aborted !== 'boolean' ||
      typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function')
  ) {
    throw invalidOptions('signal must be an AbortSignal');
  }
}

function buildChildEnv(
  options: RunHotClipHighlightsOptions,
  platform: NodeJS.Platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (options.inheritBaseEnv !== false) {
    const allowlist =
      platform === 'win32' ? BASE_ENV_ALLOWLIST_WIN32 : BASE_ENV_ALLOWLIST_POSIX;
    for (const key of allowlist) {
      const value = process.env[key];
      if (typeof value === 'string') env[key] = value;
    }
  } else if (platform === 'win32') {
    // Windows（libuv）在子进程 env 块缺少 PATH 时会自动补全**父进程 PATH**
    // （Windows Node 22 本机实测），因此只有显式置空才能阻止父进程 PATH
    // 中的用户/应用私有目录泄漏给子进程。系统仍可能注入少量非敏感 OS 变量
    // （实测有 SystemRoot），文档如实记录；调用方显式批准的 env 仍可覆盖。
    env.PATH = '';
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    env[key] = value;
  }
  return env;
}

// ——————————————————————————————— 候选解析 ———————————————————————————————

function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1_000);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    invalidOutput(`HotClip candidate field ${field} must be a string`);
  }
  return value as string;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidOutput(`HotClip candidate field ${field} must be a finite number`);
  }
  return value as number;
}

function toCandidate(raw: unknown, index: number): HotClipHighlightCandidate {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    invalidOutput(`HotClip candidate[${index}] must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const id = requireString(record.id, `candidate[${index}].id`);
  if (id.trim() === '') {
    invalidOutput(`HotClip candidate[${index}].id must be non-empty`);
  }
  const startSec = requireFiniteNumber(record.startSec, `candidate[${index}].startSec`);
  if (startSec < 0) {
    invalidOutput(`HotClip candidate[${index}].startSec must be >= 0`);
  }
  const endSec = requireFiniteNumber(record.endSec, `candidate[${index}].endSec`);
  if (!(endSec > startSec)) {
    invalidOutput(`HotClip candidate[${index}].endSec must be greater than startSec`);
  }
  const title = requireString(record.title, `candidate[${index}].title`);
  const hook = requireString(record.hook, `candidate[${index}].hook`);
  const score = requireFiniteNumber(record.score, `candidate[${index}].score`);
  const reason = requireString(record.reason, `candidate[${index}].reason`);
  const recommended = record.recommended;
  if (typeof recommended !== 'boolean') {
    invalidOutput(`HotClip candidate[${index}].recommended must be a boolean`);
  }
  const reviewNote =
    record.reviewNote === undefined || record.reviewNote === null
      ? null
      : requireString(record.reviewNote, `candidate[${index}].reviewNote`);
  const visualEvidence = record.visualEvidence === undefined ? null : record.visualEvidence;
  return {
    id,
    startSec,
    endSec,
    startMs: secondsToMs(startSec),
    endMs: secondsToMs(endSec),
    title,
    hook,
    score,
    reason,
    recommended,
    reviewNote,
    visualEvidence,
  };
}

/**
 * 解析上游 `highlights --json` 的 stdout：JSON 数组 → 校验后的候选投影。
 * 空 / 纯空白 stdout 返回 []（零候选负样本）；任何结构或数值非法都以
 * invalid_output 拒绝，且错误信息不回显输出内容。
 */
export function parseHotClipCandidates(stdout: string): HotClipHighlightCandidate[] {
  const withoutBom = stdout.charCodeAt(0) === 0xfeff ? stdout.slice(1) : stdout;
  const trimmed = withoutBom.trim();
  if (trimmed === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    invalidOutput('HotClip stdout is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    invalidOutput('HotClip stdout JSON must be an array of highlight candidates');
  }
  return (parsed as unknown[]).map(toCandidate);
}

// ——————————————————————————————— 子进程树终止 ———————————————————————————————

function safeKill(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // 子进程已消失或不可杀；settle 守卫保证不会重复失败。
  }
}

/**
 * 终止整个子进程树：
 * - win32：`taskkill /PID <pid> /T /F`，固定 argv、无 shell；失败回退直接 kill。
 * - POSIX：子进程以 detached 成为进程组组长，向 -pid 发 SIGTERM 覆盖全部后代。
 */
function terminateTree(child: ChildProcess, platform: NodeJS.Platform, spawnFn: HotClipSpawn): void {
  const pid = child.pid;
  if (typeof pid !== 'number') return; // 尚未 fork 成功；error/close 会 settle。
  if (platform === 'win32') {
    try {
      const killer = spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
      killer.on('error', () => safeKill(child, 'SIGKILL'));
      killer.unref();
      return;
    } catch {
      safeKill(child, 'SIGKILL');
      return;
    }
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    safeKill(child, 'SIGTERM');
  }
}

/** 有界升级：宽限期内未 close 时强杀（POSIX 组 SIGKILL；win32 直接 SIGKILL）。 */
function escalateTree(child: ChildProcess, platform: NodeJS.Platform): void {
  const pid = child.pid;
  if (typeof pid !== 'number') return;
  if (platform === 'win32') {
    safeKill(child, 'SIGKILL');
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    safeKill(child, 'SIGKILL');
  }
}

// ——————————————————————————————— 主入口 ———————————————————————————————

type KillReason = 'timeout' | 'cancelled' | 'output_too_large';

function killErrorMessage(reason: KillReason, timeoutMs: number, maxOutputBytes: number): string {
  if (reason === 'timeout') {
    return `HotClip process exceeded the ${timeoutMs}ms bound and was terminated`;
  }
  if (reason === 'cancelled') {
    return 'HotClip process was cancelled and terminated';
  }
  return `HotClip process output exceeded the ${maxOutputBytes} byte bound and was terminated`;
}

/**
 * 运行用户配置的 HotClip CLI `highlights`，返回校验后的候选投影。
 *
 * - 退出码 0 + 空 stdout → []（零候选是合法负样本）。
 * - 非零退出 / 非法输出 / 超时 / 取消 / 输出超限 → 以带机器可读 code 的
 *   {@link HotClipSidecarError} 拒绝；超时、取消与超限都会终止子进程树
 *   （含有界 SIGKILL 升级），Promise 恰好 settle 一次。
 * - 候选**不是**发布批准；写入 HighlightV1 前必须补 sourceSha256 并人工评审。
 */
export async function runHotClipHighlights(
  options: RunHotClipHighlightsOptions,
): Promise<HotClipHighlightCandidate[]> {
  validateRunOptions(options);
  const platform = options.platform ?? process.platform;
  if (options.signal?.aborted) {
    throw new HotClipSidecarError('cancelled', 'HotClip run was cancelled before it started');
  }

  const timeoutMs = options.timeoutMs;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const spawnFn = options.spawnImpl ?? (nodeSpawn as unknown as HotClipSpawn);
  const argv = buildHotClipHighlightsArgv(options);
  const childEnv = buildChildEnv(options, platform);

  return new Promise<HotClipHighlightCandidate[]>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(options.executable, argv, {
        cwd: options.cwd,
        env: childEnv,
        shell: false,
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new HotClipSidecarError('spawn_failed', 'HotClip process could not be started'));
      return;
    }

    let settled = false;
    let killReason: KillReason | null = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutText = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const signal = options.signal;

    const pushTimer = (ms: number, fn: () => void): void => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      timers.push(timer);
    };
    const clearTimers = (): void => {
      while (timers.length > 0) clearTimeout(timers.pop());
    };
    const onAbort = (): void => beginKill('cancelled');
    const removeAbortListener = (): void => {
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      removeAbortListener();
      action();
    };

    function killError(
      reason: KillReason,
      code: number | null,
      signalName: string | null,
    ): HotClipSidecarError {
      return new HotClipSidecarError(reason, killErrorMessage(reason, timeoutMs, maxOutputBytes), {
        exitCode: code,
        signal: signalName,
        stdoutBytes,
        stderrBytes,
      });
    }

    function beginKill(reason: KillReason): void {
      if (killReason !== null || settled) return;
      killReason = reason;
      terminateTree(child, platform, spawnFn);
      // 有界升级：宽限期内未 close 则强杀；再一个宽限期后无条件 settle。
      pushTimer(killGraceMs, () => escalateTree(child, platform));
      pushTimer(killGraceMs * 2, () => {
        settle(() => reject(killError(reason, child.exitCode, child.signalCode)));
      });
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (killReason !== null) return; // 已在终止流程；停止累积，内存有界。
      if (stdoutBytes > maxOutputBytes) {
        beginKill('output_too_large');
        return;
      }
      stdoutText += stdoutDecoder.write(buffer);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      // stderr 原文绝不保留、绝不返回；只计字节数用于超限判定与度量。
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (killReason !== null) return;
      if (stderrBytes > maxOutputBytes) beginKill('output_too_large');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (killReason !== null) {
        const reason = killReason;
        settle(() => reject(killError(reason, child.exitCode, child.signalCode)));
        return;
      }
      const code: HotClipSidecarErrorCode =
        error.code === 'ENOENT' ? 'executable_missing' : 'spawn_failed';
      // 不使用 error.message：Node 的 spawn 错误消息会携带完整文件路径。
      settle(() =>
        reject(
          new HotClipSidecarError(
            code,
            code === 'executable_missing'
              ? 'HotClip executable was not found or is not runnable'
              : 'HotClip process could not be started',
            { stdoutBytes, stderrBytes },
          ),
        ),
      );
    });

    child.on('close', (code, closeSignal) => {
      if (killReason !== null) {
        const reason = killReason;
        settle(() => reject(killError(reason, code, closeSignal)));
        return;
      }
      if (code !== 0) {
        settle(() =>
          reject(
            new HotClipSidecarError(
              'nonzero_exit',
              code === null
                ? `HotClip process was terminated by signal ${closeSignal ?? 'unknown'} without an exit code`
                : `HotClip process exited with code ${code}`,
              { exitCode: code, signal: closeSignal, stdoutBytes, stderrBytes },
            ),
          ),
        );
        return;
      }
      stdoutText += stdoutDecoder.end();
      let candidates: HotClipHighlightCandidate[];
      try {
        candidates = parseHotClipCandidates(stdoutText);
      } catch (error) {
        settle(() =>
          reject(
            error instanceof HotClipSidecarError
              ? error
              : new HotClipSidecarError('invalid_output', 'HotClip output could not be parsed', {
                  stdoutBytes,
                  stderrBytes,
                }),
          ),
        );
        return;
      }
      settle(() => resolve(candidates));
    });

    pushTimer(timeoutMs, () => beginKill('timeout'));
    signal?.addEventListener('abort', onAbort, { once: true });
    // spawnFn 可能在返回句柄之前同步触发 abort；那时监听器尚未注册，事件会丢失，
    // 子进程将一直运行到 timeout。挂好监听后必须重读 aborted 以补发取消。
    if (signal?.aborted) onAbort();
  });
}

/**
 * detection.ts
 *
 * Agent 探测层：检测 agent CLI 是否在 PATH / nvm/fnm/volta 中可用，并可选探测版本。
 *
 * 设计原则：
 * - 纯注入式（DetectionDeps），不直接持有 BinaryManager 实例，便于单测。
 * - createDetectionDeps(bm) 把 BinaryManager 适配成 DetectionDeps，供主进程使用。
 * - 容错：probeVersion 失败不抛，version:null。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentModel, RuntimeAgentDef } from './types.js';

const execFileAsync = promisify(execFile);

// ─── 公开接口 ────────────────────────────────────────────────────────────────

export interface AgentDetection {
  installed: boolean;
  binPath: string | null;
  version: string | null;
}

export interface DetectionDeps {
  resolveBinary: (name: string) => Promise<string | null>;
  probeVersion?: (binPath: string, versionArgs: string[]) => Promise<string | null>;
}

// ─── 核心探测函数 ─────────────────────────────────────────────────────────────

/**
 * 探测 agent CLI 是否可用。
 *
 * 查找顺序：def.bin → def.fallbackBins（依次）。
 * 命中 → installed:true, binPath 为绝对路径；
 * 全部未命中 → installed:false, binPath:null。
 * 若 installed 且 deps.probeVersion 存在，调它获取版本（失败 version:null，不抛）。
 */
export async function detectAgent(
  def: RuntimeAgentDef,
  deps: DetectionDeps,
): Promise<AgentDetection> {
  // 按优先级依次解析 bin 和 fallbackBins
  const candidates = [def.bin, ...(def.fallbackBins ?? [])];

  let binPath: string | null = null;
  for (const candidate of candidates) {
    const resolved = await deps.resolveBinary(candidate);
    if (resolved) {
      binPath = resolved;
      break;
    }
  }

  if (!binPath) {
    return { installed: false, binPath: null, version: null };
  }

  // 命中，尝试探测版本
  let version: string | null = null;
  if (deps.probeVersion) {
    try {
      version = await deps.probeVersion(binPath, def.versionArgs);
    } catch {
      // 容错：version 保持 null
    }
  }

  return { installed: true, binPath, version };
}

// ─── 动态模型列表拉取 ─────────────────────────────────────────────────────────

export type ModelListSource = 'live' | 'fallback';

export interface ModelListResult {
  models: AgentModel[];
  /** 'live'：来自 CLI 实时拉取；'fallback'：兜底 / 静态列表。 */
  source: ModelListSource;
}

/**
 * 内置 Node 入口（如 pi 的 resources/pi/dist/cli.js）相关注入依赖。
 * 全部可选，缺省时退回 process.execPath / 模块内 execFileAsync，便于单测注入。
 */
export interface ListModelsBundledDeps {
  resolveBundledEntry?: (relPath: string) => string | null;
  execPath?: string;
  execFileAsync?: (cmd: string, args: string[], opts?: any) => Promise<{ stdout: unknown; stderr: unknown }>;
}

/** clean env：去掉 npm_*（与 session.ts spawn 一致），避免污染 CLI 探测。 */
function modelExecEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('npm_')) env[key] = value;
  }
  return env;
}

/**
 * 拉取某个 agent 的可用模型列表。
 *
 * 策略：
 *   - def 未声明 `listModelsArgs` + `parseModels` → 直接返回兜底（claude/codex 等静态 agent）。
 *   - 解析不到 bin / 执行异常 / 解析为空 → 返回兜底（fallbackModels ?? models）。
 *   - 成功解析出非空列表 → source:'live'。
 *
 * 部分 CLI（pi）把表格打印到 stderr，故按 `def.modelsOutputStream` 选流；
 * 即便命令以非零退出码结束，也尝试从 error 的 stdout/stderr 解析（容错）。
 */
export async function listAgentModels(
  bm: BinaryManagerLike,
  def: RuntimeAgentDef,
  bundled?: ListModelsBundledDeps,
): Promise<ModelListResult> {
  const fallback: ModelListResult = {
    models: def.fallbackModels ?? def.models ?? [],
    source: 'fallback',
  };

  if (!def.listModelsArgs || !def.parseModels) return fallback;

  const exec = bundled?.execFileAsync ?? execFileAsync;

  // 计算执行命令、参数与环境。
  let command: string;
  let args: string[];
  let env = modelExecEnv();

  if (def.bundledNodeEntry) {
    // 内置 Node 入口：用 Electron 的 process.execPath 以 ELECTRON_RUN_AS_NODE 跑 cli.js。
    const entry = bundled?.resolveBundledEntry?.(def.bundledNodeEntry);
    if (!entry) return fallback;
    command = bundled?.execPath ?? process.execPath;
    args = [entry, ...def.listModelsArgs];
    env = { ...env, ELECTRON_RUN_AS_NODE: '1' };
  } else {
    // 旧路径：解析 bin（def.bin → fallbackBins）。
    let binPath: string | null = null;
    for (const candidate of [def.bin, ...(def.fallbackBins ?? [])]) {
      const resolved = await bm.resolveBinary(candidate);
      if (resolved) {
        binPath = resolved;
        break;
      }
    }
    if (!binPath) return fallback;
    command = binPath;
    args = def.listModelsArgs;
  }

  // 优先解析声明的流；失败再试另一条流（不同 CLI 版本可能把列表打到 stdout 或 stderr）。
  const parseDef = def.parseModels;
  const tryParse = (out: { stdout?: unknown; stderr?: unknown }): AgentModel[] | null => {
    const primary = def.modelsOutputStream === 'stderr' ? out.stderr : out.stdout;
    const secondary = def.modelsOutputStream === 'stderr' ? out.stdout : out.stderr;
    for (const raw of [primary, secondary]) {
      try {
        const parsed = parseDef(String(raw ?? ''));
        if (parsed && parsed.length > 0) return parsed;
      } catch {
        // 试下一条流
      }
    }
    return null;
  };

  try {
    const result = await exec(command, args, {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      env,
    });
    const parsed = tryParse(result);
    return parsed ? { models: parsed, source: 'live' } : fallback;
  } catch (err) {
    // 非零退出码：execFile 抛错，但 stdout/stderr 可能仍带有列表（容错解析）。
    const parsed = tryParse(err as { stdout?: unknown; stderr?: unknown });
    return parsed ? { models: parsed, source: 'live' } : fallback;
  }
}

// ─── BinaryManager 适配器 ──────────────────────────────────────────────────

/** BinaryManager 公开方法子集（避免直接 import 完整类，降低耦合） */
export interface BinaryManagerLike {
  resolveBinary: (name: string) => Promise<string | null>;
}

/**
 * 把 BinaryManager 实例适配成 DetectionDeps。
 * probeVersion 使用 execFile 调用二进制，超时 10s，失败返回 null。
 */
export function createDetectionDeps(bm: BinaryManagerLike): DetectionDeps {
  return {
    resolveBinary: (name) => bm.resolveBinary(name),
    probeVersion: async (binPath, versionArgs) => {
      try {
        const { stdout } = await execFileAsync(binPath, versionArgs, {
          timeout: 10_000,
        });
        return stdout.trim() || null;
      } catch {
        return null;
      }
    },
  };
}

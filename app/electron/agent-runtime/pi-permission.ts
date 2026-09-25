/**
 * pi-permission.ts
 *
 * Pi 工具审批门控的纯函数层（风险分类 + 策略决策）。
 *
 * 由 in-process driver（pi-inprocess.ts）在 pi 的 `tool_call` 扩展事件 handler 里调用
 * （`agent.beforeToolCall` → emitToolCall）：pi 在执行任何工具前触发 tool_call，
 * 本模块综合工具名、入参（序列化后的命令/URL 文本）、以及入参里的文件路径（是否越出
 * 项目目录）判定 risky / benign，再按当前审批策略决定 auto_allow（自动放行）还是
 * ask（surface 审批卡片、等用户响应；拒绝时 handler 返回 {block:true} 拦下工具）。
 *
 * 注：pi 的内置工具从不调用 `uiContext.confirm`（仅给扩展用），故门控必须挂在
 * tool_call 事件上，confirm 仅作防御性兜底。
 *
 * 纯函数、无 Node 副作用（仅用 node:path 做路径归一化），便于单测。
 */

import path from 'node:path';
import { classifyToolKind } from './event-model';

export type PermissionRisk = 'risky' | 'benign';
export type PermissionDecision = 'auto_allow' | 'ask';

export interface ConfirmRiskInput {
  /** confirm 请求的标题（pi confirm 的 title）。 */
  title?: string;
  /** confirm 请求的正文（常含命令 / 路径）。 */
  message?: string;
  /** 关联到的工具名（取最近一次 tool_use）。 */
  toolName?: string;
  /** 关联工具的入参（用于解析文件路径是否在项目内）。 */
  toolInput?: unknown;
  /** 项目根目录，用于判断路径是否越界。 */
  cwd?: string;
}

const NETWORK_TEXT_RE = /(https?:\/\/|\b(?:curl|wget|fetch|download)\b)/i;
const DESTRUCTIVE_NAME_RE = /(delete|remove|unlink|\brm\b|rmdir|destroy|drop)/i;
const DESTRUCTIVE_TEXT_RE = /\b(sudo|rm\s+-[rf]+|rmdir|mkfs|shutdown|reboot|dd\s+if=|kill(?:all)?)\b/i;

const FILE_PATH_KEYS = [
  'path',
  'file_path',
  'filePath',
  'filepath',
  'target',
  'targetPath',
  'target_path',
  'uri',
  'file',
  'fileName',
  'filename',
];
const FILE_EDIT_OLD_KEYS = ['oldString', 'old_string', 'oldText', 'old_text', 'before', 'original', 'old'];
const FILE_EDIT_NEW_KEYS = ['newString', 'new_string', 'newText', 'new_text', 'after', 'replacement', 'replace', 'new'];

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

function recordFromUnknown(v: unknown): Record<string, unknown> | undefined {
  const direct = asRecord(v);
  if (direct) return direct;
  if (typeof v !== 'string' || !v.trim().startsWith('{')) return undefined;
  try {
    return asRecord(JSON.parse(v));
  } catch {
    return undefined;
  }
}

function pickStringDeep(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  const nestedKeys = ['input', 'args', 'arguments', 'params', 'data', 'payload', 'file', 'target', 'options'];
  for (const key of nestedKeys) {
    const value = pickStringDeep(recordFromUnknown(record[key]), keys);
    if (value) return value;
  }

  for (const value of Object.values(record)) {
    const found = pickStringDeep(recordFromUnknown(value), keys);
    if (found) return found;
  }
  return undefined;
}

/** 是否文件编辑类工具：工具名命中编辑动词，或入参里同时含路径 + 旧/新文本。 */
export function isFileEditTool(name: string | undefined, input: unknown): boolean {
  const normalized = String(name || '').toLowerCase();
  const args = recordFromUnknown(input);
  if (/(edit|write|create|overwrite|patch|apply|replace|delete|remove|unlink)/.test(normalized)) {
    return true;
  }
  return Boolean(
    pickStringDeep(args, FILE_PATH_KEYS) &&
      pickStringDeep(args, [...FILE_EDIT_OLD_KEYS, ...FILE_EDIT_NEW_KEYS]),
  );
}

/** 把工具入参里的文件路径解析为项目内绝对路径；越界 / 不可解析时返回 null。 */
export function resolveSnapshotPath(cwd: string | undefined, input: unknown): string | null {
  if (!cwd) return null;
  const args = recordFromUnknown(input);
  const rawPath = pickStringDeep(args, FILE_PATH_KEYS);
  if (!rawPath || rawPath.startsWith('file://')) return null;
  const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
  const relative = path.relative(cwd, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

/**
 * 把一次 pi confirm 请求判为 risky / benign。
 *
 * pi 的 confirm 请求本身不透明（仅 title/message），故综合：工具名（kind）、
 * confirm 文案、以及工具入参里的文件路径（是否越出项目目录）。
 * 无法判定时从严（risky），保证 tiered 模式下不误放行风险操作。
 */
export function classifyConfirmRisk(input: ConfirmRiskInput): PermissionRisk {
  const name = input.toolName ?? '';
  const text = `${input.title ?? ''}\n${input.message ?? ''}`;
  const kind = classifyToolKind(name);

  // 执行命令 / 网络访问：始终高风险。
  if (kind === 'execute' || kind === 'fetch') return 'risky';
  if (NETWORK_TEXT_RE.test(text)) return 'risky';

  // 删除 / 破坏性操作：高风险。
  if (DESTRUCTIVE_NAME_RE.test(name) || DESTRUCTIVE_TEXT_RE.test(text)) return 'risky';

  // 文件编辑：仅当路径解析在项目目录内才算 benign，否则（越界 / 不可解析）从严。
  if (kind === 'edit' || isFileEditTool(name, input.toolInput)) {
    return resolveSnapshotPath(input.cwd, input.toolInput) ? 'benign' : 'risky';
  }

  // 纯读取：benign。
  if (kind === 'read') return 'benign';

  // 其它无法判定：从严。
  return 'risky';
}

/**
 * 按策略 + 风险等级决定：auto_allow（自动放行）还是 ask（弹卡片）。
 *   auto_approve → 全放行；always_ask → 全询问；tiered（默认） → 仅 risky 询问。
 */
export function decidePermission(policy: string, risk: PermissionRisk): PermissionDecision {
  if (policy === 'auto_approve') return 'auto_allow';
  if (policy === 'always_ask') return 'ask';
  return risk === 'risky' ? 'ask' : 'auto_allow';
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * 一次 pi `tool_call` 的门控组合判定：风险分类 + 策略决策一步到位。
 *
 * 策略缺省（undefined / 空串）时保留旧行为自动放行（legacy）。否则把结构化 input
 * 序列化进 message，使 classifyConfirmRisk 的命令/URL 文本规则仍可扫描 rm -rf、
 * https:// 等，再按策略决定 auto_allow / ask。
 */
export function evaluateToolCallGate(
  policy: string | undefined,
  call: { toolName?: string; input?: unknown; cwd?: string },
): PermissionDecision {
  if (!policy) return 'auto_allow';
  const risk = classifyConfirmRisk({
    title: call.toolName,
    message: safeStringify(call.input),
    toolName: call.toolName,
    toolInput: call.input,
    cwd: call.cwd,
  });
  return decidePermission(policy, risk);
}

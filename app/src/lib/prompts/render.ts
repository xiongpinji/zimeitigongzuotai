import YAML from 'yaml';
import {
  PROMPT_KIND_META,
  type PromptCategory,
  type PromptKind,
  type PromptTemplate,
  type UserPromptEntry,
} from './types';

const TEMPLATE_VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(TEMPLATE_VAR_RE, (_, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * 渲染用户可编辑的 user 段，并在末尾自动拼接该 kind 的 lockedContract（如果声明了）。
 * lockedContract.content 是内置契约文本，不参与变量替换，不可被用户编辑。
 */
export function renderUserPromptWithLock(
  kind: PromptKind,
  template: PromptTemplate,
  vars: Record<string, string | number | undefined>,
): string {
  const rendered = renderTemplate(template.user, vars);
  const locked = PROMPT_KIND_META[kind].lockedContract;
  if (!locked) return rendered;
  if (locked.position === 'user-tail') {
    return `${rendered}\n\n${locked.content}`;
  }
  return rendered;
}

export interface PromptYamlParseResult {
  template: PromptTemplate;
  warnings: string[];
}

export function parsePromptYaml(raw: string, kind: PromptKind): PromptYamlParseResult {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`YAML 解析失败（${kind}）：${message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`YAML 顶层必须是对象（${kind}）`);
  }

  const obj = data as Record<string, unknown>;
  const user = typeof obj.user === 'string' ? obj.user : '';
  if (!user.trim()) {
    throw new Error(`提示词 user 字段不能为空（${kind}）`);
  }

  const name = typeof obj.name === 'string' ? obj.name : kind;
  const description = typeof obj.description === 'string' ? obj.description : undefined;
  const version = typeof obj.version === 'number' ? obj.version : undefined;
  const system = typeof obj.system === 'string' ? obj.system : undefined;

  return {
    template: { name, description, version, system, user },
    warnings,
  };
}

export function serializePromptYaml(template: PromptTemplate): string {
  return YAML.stringify(template, {
    lineWidth: 0,
    blockQuote: 'literal',
  });
}

export function createPromptYamlFromUserText(
  base: PromptTemplate,
  userText: string,
): string {
  return serializePromptYaml({
    ...base,
    user: userText,
  });
}

export interface UserPromptYamlBody {
  name: string;
  description: string;
  version?: number;
  system: string;
  user: string;
  createdAt?: string;
  updatedAt?: string;
  ttsStyle?: string;
  ttsAnnotateHint?: string;
}

export function parseUserPromptYaml(
  raw: string,
  ctx: { id: string; category: PromptCategory },
): UserPromptEntry {
  let data: unknown;
  try {
    data = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`用户提示词 YAML 解析失败（${ctx.category}/${ctx.id}）：${message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`用户提示词 YAML 顶层必须是对象（${ctx.category}/${ctx.id}）`);
  }

  const obj = data as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const description = typeof obj.description === 'string' ? obj.description : '';
  const system = typeof obj.system === 'string' ? obj.system : '';
  const user = typeof obj.user === 'string' ? obj.user : '';
  const version = typeof obj.version === 'number' ? obj.version : undefined;
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : undefined;
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined;
  const ttsStyle = typeof obj.ttsStyle === 'string' ? obj.ttsStyle : undefined;
  const ttsAnnotateHint = typeof obj.ttsAnnotateHint === 'string' ? obj.ttsAnnotateHint : undefined;

  if (!name) {
    throw new Error(`用户提示词 name 字段不能为空（${ctx.category}/${ctx.id}）`);
  }
  if (!user.trim()) {
    throw new Error(`用户提示词 user 字段不能为空（${ctx.category}/${ctx.id}）`);
  }

  return {
    id: ctx.id,
    category: ctx.category,
    name,
    description,
    version,
    system,
    user,
    isBuiltin: false,
    createdAt,
    updatedAt,
    ttsStyle,
    ttsAnnotateHint,
  };
}

export function serializeUserPromptYaml(body: UserPromptYamlBody): string {
  const payload: Record<string, unknown> = {
    name: body.name,
    description: body.description,
  };
  if (typeof body.version === 'number') payload.version = body.version;
  payload.system = body.system;
  payload.user = body.user;
  if (body.createdAt) payload.createdAt = body.createdAt;
  if (body.updatedAt) payload.updatedAt = body.updatedAt;
  if (typeof body.ttsStyle === 'string' && body.ttsStyle.trim()) payload.ttsStyle = body.ttsStyle;
  if (typeof body.ttsAnnotateHint === 'string' && body.ttsAnnotateHint.trim()) payload.ttsAnnotateHint = body.ttsAnnotateHint;

  return YAML.stringify(payload, {
    lineWidth: 0,
    blockQuote: 'literal',
  });
}

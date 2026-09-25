import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PROMPT_YAML,
  PROMPT_KINDS,
  createPromptYamlFromUserText,
  getBuiltinPromptTemplate,
  parsePromptYaml,
  type EffectivePromptTemplate,
  type PromptKind,
  type PromptScope,
  type PromptTemplate,
} from '../src/lib/prompts';

const GLOBAL_SUBDIR = 'prompts';
const PROJECT_SUBDIR = path.join('configs', 'prompts');

function kindToRelativePath(kind: PromptKind): string {
  return `${kind.replace(/\./g, path.sep)}.yaml`;
}

function globalPromptFilePath(userDataPath: string, kind: PromptKind): string {
  return path.join(userDataPath, GLOBAL_SUBDIR, kindToRelativePath(kind));
}

function projectPromptFilePath(projectDir: string, kind: PromptKind): string {
  return path.join(projectDir, PROJECT_SUBDIR, kindToRelativePath(kind));
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function readFileIfExistsSync(filePath: string): string | null {
  try {
    return fsSync.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readRawPromptYaml(
  scope: PromptScope,
  kind: PromptKind,
  ctx: { userDataPath: string; projectDir?: string },
): Promise<string | null> {
  if (scope === 'builtin') return DEFAULT_PROMPT_YAML[kind];
  if (scope === 'global') return readFileIfExists(globalPromptFilePath(ctx.userDataPath, kind));
  if (scope === 'project') {
    if (!ctx.projectDir) return null;
    return readFileIfExists(projectPromptFilePath(ctx.projectDir, kind));
  }
  return null;
}

export async function readPromptUserText(
  scope: PromptScope,
  kind: PromptKind,
  ctx: { userDataPath: string; projectDir?: string },
): Promise<string | null> {
  const raw = await readRawPromptYaml(scope, kind, ctx);
  if (!raw || !raw.trim()) return null;
  try {
    const { template } = parsePromptYaml(raw, kind);
    return template.user;
  } catch {
    return null;
  }
}

export async function writePromptYaml(
  scope: 'global' | 'project',
  kind: PromptKind,
  content: string,
  ctx: { userDataPath: string; projectDir?: string },
): Promise<string> {
  const filePath =
    scope === 'global'
      ? globalPromptFilePath(ctx.userDataPath, kind)
      : (() => {
          if (!ctx.projectDir) throw new Error('项目级提示词写入需要 projectDir');
          return projectPromptFilePath(ctx.projectDir, kind);
        })();

  // 先校验 YAML 与必要字段
  parsePromptYaml(content, kind);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

export async function writePromptUserText(
  scope: 'global' | 'project',
  kind: PromptKind,
  userText: string,
  ctx: { userDataPath: string; projectDir?: string },
): Promise<string> {
  const currentRaw = await readRawPromptYaml(scope, kind, ctx);
  let base = getBuiltinPromptTemplate(kind);
  if (currentRaw && currentRaw.trim()) {
    try {
      base = parsePromptYaml(currentRaw, kind).template;
    } catch {
      // 覆盖文件可能是用户过去手写坏的 YAML；纯文本保存时用内置元数据重建。
    }
  }
  const content = createPromptYamlFromUserText(base, userText);
  return writePromptYaml(scope, kind, content, ctx);
}

export async function deletePromptYaml(
  scope: 'global' | 'project',
  kind: PromptKind,
  ctx: { userDataPath: string; projectDir?: string },
): Promise<boolean> {
  const filePath =
    scope === 'global'
      ? globalPromptFilePath(ctx.userDataPath, kind)
      : (() => {
          if (!ctx.projectDir) throw new Error('项目级提示词删除需要 projectDir');
          return projectPromptFilePath(ctx.projectDir, kind);
        })();

  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export async function loadEffectivePromptTemplate(
  kind: PromptKind,
  ctx: { userDataPath: string; projectDir?: string },
): Promise<EffectivePromptTemplate> {
  // project > global > builtin
  if (ctx.projectDir) {
    const projectRaw = await readFileIfExists(projectPromptFilePath(ctx.projectDir, kind));
    if (projectRaw && projectRaw.trim()) {
      try {
        const { template } = parsePromptYaml(projectRaw, kind);
        return { ...template, sourceScope: 'project' };
      } catch (err) {
        console.warn(`[prompts] 项目级 ${kind} YAML 解析失败，回退到全局：`, err);
      }
    }
  }

  const globalRaw = await readFileIfExists(globalPromptFilePath(ctx.userDataPath, kind));
  if (globalRaw && globalRaw.trim()) {
    try {
      const { template } = parsePromptYaml(globalRaw, kind);
      return { ...template, sourceScope: 'global' };
    } catch (err) {
      console.warn(`[prompts] 全局 ${kind} YAML 解析失败，回退到内置：`, err);
    }
  }

  return { ...getBuiltinPromptTemplate(kind), sourceScope: 'builtin' };
}

export function loadEffectivePromptTemplateSync(
  kind: PromptKind,
  ctx: { userDataPath: string; projectDir?: string },
): EffectivePromptTemplate {
  if (ctx.projectDir) {
    const projectRaw = readFileIfExistsSync(projectPromptFilePath(ctx.projectDir, kind));
    if (projectRaw && projectRaw.trim()) {
      try {
        const { template } = parsePromptYaml(projectRaw, kind);
        return { ...template, sourceScope: 'project' };
      } catch {
        /* fallthrough */
      }
    }
  }
  const globalRaw = readFileIfExistsSync(globalPromptFilePath(ctx.userDataPath, kind));
  if (globalRaw && globalRaw.trim()) {
    try {
      const { template } = parsePromptYaml(globalRaw, kind);
      return { ...template, sourceScope: 'global' };
    } catch {
      /* fallthrough */
    }
  }
  return { ...getBuiltinPromptTemplate(kind), sourceScope: 'builtin' };
}

export interface PromptKindOverview {
  kind: PromptKind;
  effectiveScope: PromptScope;
  hasGlobal: boolean;
  hasProject: boolean;
}

export async function listPromptOverview(
  ctx: { userDataPath: string; projectDir?: string },
): Promise<PromptKindOverview[]> {
  const result: PromptKindOverview[] = [];
  for (const kind of PROMPT_KINDS) {
    const hasGlobal = Boolean(await readFileIfExists(globalPromptFilePath(ctx.userDataPath, kind)));
    const hasProject = ctx.projectDir
      ? Boolean(await readFileIfExists(projectPromptFilePath(ctx.projectDir, kind)))
      : false;
    const effectiveScope: PromptScope = hasProject ? 'project' : hasGlobal ? 'global' : 'builtin';
    result.push({ kind, effectiveScope, hasGlobal, hasProject });
  }
  return result;
}

export type { PromptTemplate };

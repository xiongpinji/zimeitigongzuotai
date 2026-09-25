import fs from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_SKILL_ID } from './constants';
import { parseFrontmatter } from './frontmatter';

export interface EnsureBundledOptions {
  /** 内置种子根目录（含 <skillId>/ 子目录）。 */
  seedRoot: string;
  /** 用户配置目录 ~/.lingji/agent-skills。 */
  targetRoot: string;
}

/** 递归复制（用 readdir+readFile+writeFile，兼容 asar 只读源）。 */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      const buf = await fs.readFile(s);
      await fs.writeFile(d, buf);
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 读取 SKILL.md frontmatter 的 version（缺失 / 不可读 → undefined）。 */
async function readSkillVersion(skillMdPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(skillMdPath, 'utf-8');
    return parseFrontmatter(raw)?.version;
  } catch {
    return undefined;
  }
}

/**
 * 确保内置 skill 已同步到用户配置目录（启动自检调用）。
 * - 种子缺失 → 返回 false，不抛错（由上层记录日志 / 设置页展示）。
 * - 目标缺失 → 复制种子。
 * - 目标已存在：按 version 决定。种子 version 存在且与目标不一致 → **强制同步**
 *   （先清空目标 skill 目录，删除种子已移除的文件，再整目录复制）；
 *   版本一致或种子无 version → 保持目标不动（保护用户本地调整 / 兼容旧种子）。
 * - 返回 true 表示种子存在（已复制 / 已同步 / 已最新）。
 */
export async function ensureBundledAgentSkills(
  opts: EnsureBundledOptions,
): Promise<boolean> {
  const seedSkill = path.join(opts.seedRoot, BUILTIN_SKILL_ID);
  const seedMd = path.join(seedSkill, 'SKILL.md');
  if (!(await exists(seedMd))) {
    return false;
  }
  const targetSkill = path.join(opts.targetRoot, BUILTIN_SKILL_ID);
  const targetMd = path.join(targetSkill, 'SKILL.md');
  if (!(await exists(targetMd))) {
    await copyDir(seedSkill, targetSkill);
    return true;
  }

  const seedVersion = await readSkillVersion(seedMd);
  const targetVersion = await readSkillVersion(targetMd);
  if (seedVersion != null && seedVersion !== targetVersion) {
    // 强制同步：清空目标后整目录复制，确保与种子逐字节一致。
    await fs.rm(targetSkill, { recursive: true, force: true });
    await copyDir(seedSkill, targetSkill);
  }
  return true;
}

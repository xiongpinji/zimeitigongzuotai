import YAML from 'yaml';

export interface SkillFrontmatter {
  name: string;
  description: string;
  /** 内置 skill 版本号（用于启动时强制同步种子→用户目录）。归一为字符串。 */
  version?: string;
}

/**
 * 解析 markdown 顶部的 `--- ... ---` YAML frontmatter。
 * 纯函数（仅依赖 yaml）：无 frontmatter 或解析失败 / 缺 name 时返回 null。
 */
export function parseFrontmatter(raw: string): SkillFrontmatter | null {
  const text = raw.replace(/^﻿/, '');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) return null;
  const description =
    typeof obj.description === 'string' ? obj.description.trim() : '';
  const version =
    typeof obj.version === 'string'
      ? obj.version.trim()
      : typeof obj.version === 'number'
        ? String(obj.version)
        : undefined;
  return { name, description, version };
}

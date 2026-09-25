import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type {
  AgentSkillConfig,
  AgentSkillDefinition,
  AgentSkillStatus,
  ResolvedAgentSkill,
  SkillFileContent,
  SkillTreeNode,
} from '../acp/types';
import { BUILTIN_SKILL_ID, LOAD_MODES_BY_AGENT } from './constants';
import { ensureBundledAgentSkills, copyDir } from './bundled';
import { parseFrontmatter } from './frontmatter';

export interface SkillRegistryOptions {
  /** 内置种子根目录。 */
  seedRoot: string;
  /** 用户配置目录 ~/.lingji/agent-skills。 */
  targetRoot: string;
}

/** 默认元数据兜底（种子里 frontmatter/openai.yaml 缺字段时用）。 */
const BUILTIN_DEFAULTS: Record<string, { displayName: string; description: string }> = {
  [BUILTIN_SKILL_ID]: {
    displayName: '灵机剪影视频工作流',
    description: '连接稿件输入、灵机剪影项目生成、视频精修与导出协作流程',
  },
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 读 agents/openai.yaml 的 interface.display_name / short_description（可选）。 */
async function readOpenAiInterface(
  skillDir: string,
): Promise<{ displayName?: string; description?: string }> {
  const p = path.join(skillDir, 'agents', 'openai.yaml');
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const parsed = YAML.parse(raw) as { interface?: Record<string, unknown> } | null;
    const iface = parsed?.interface ?? {};
    const displayName =
      typeof iface.display_name === 'string' ? iface.display_name.trim() : undefined;
    const description =
      typeof iface.short_description === 'string'
        ? iface.short_description.trim()
        : undefined;
    return { displayName, description };
  } catch {
    return {};
  }
}

/**
 * 内置 skill registry（main 侧）。
 * 职责单一：确保种子已复制、解析元数据、按 agent + 配置返回 enabled skills、
 * 读取主 SKILL.md 供 $skill 注入。Renderer 不直接读文件，只经 IPC 拿元数据。
 */
export class SkillRegistry {
  private readonly seedRoot: string;
  private readonly targetRoot: string;
  private ensured = false;

  constructor(opts: SkillRegistryOptions) {
    this.seedRoot = opts.seedRoot;
    this.targetRoot = opts.targetRoot;
  }

  /** 幂等确保种子已复制（首次调用真正复制，之后跳过）。 */
  async ensureBundled(): Promise<void> {
    if (this.ensured) return;
    try {
      await ensureBundledAgentSkills({
        seedRoot: this.seedRoot,
        targetRoot: this.targetRoot,
      });
    } catch (err) {
      console.warn('[agent-skills] ensureBundled 失败:', err);
    }
    this.ensured = true;
  }

  /**
   * 返回用户目录下扫描到的全部 skill 定义（内置 + 用户导入）。
   * 仅含 `<id>/SKILL.md` 存在的子目录；目录缺失 / 无 skill 时返回空数组。
   * 内置（种子里存在的）排在前，其余按 id 字母序。
   */
  async list(): Promise<AgentSkillDefinition[]> {
    await this.ensureBundled();
    const ids = await this.discoverSkillIds();
    const defs: AgentSkillDefinition[] = [];
    for (const id of ids) {
      const def = await this.readDefinition(id);
      if (def) defs.push(def);
    }
    return defs.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  }

  /** 扫描用户目录下含 SKILL.md 的子目录 id。 */
  private async discoverSkillIds(): Promise<string[]> {
    const entries = await fs.readdir(this.targetRoot, { withFileTypes: true }).catch(() => []);
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (await exists(path.join(this.targetRoot, entry.name, 'SKILL.md'))) {
        ids.push(entry.name);
      }
    }
    return ids;
  }

  /** id 是否为内置 skill（种子目录里存在同名 SKILL.md）。 */
  private async isBuiltin(id: string): Promise<boolean> {
    return exists(path.join(this.seedRoot, id, 'SKILL.md'));
  }

  private async readDefinition(id: string): Promise<AgentSkillDefinition | null> {
    const rootPath = path.join(this.targetRoot, id);
    const skillFilePath = path.join(rootPath, 'SKILL.md');
    if (!(await exists(skillFilePath))) return null;

    const builtin = await this.isBuiltin(id);
    const fallback = BUILTIN_DEFAULTS[id] ?? { displayName: id, description: '' };
    let displayName = fallback.displayName;
    let description = fallback.description;

    try {
      const raw = await fs.readFile(skillFilePath, 'utf-8');
      const fm = parseFrontmatter(raw);
      // 用户 skill 无内置兜底：以 frontmatter 的 name/description 为准。
      if (fm?.name && !BUILTIN_DEFAULTS[id]) displayName = fm.name;
      if (fm?.description) description = fm.description;
    } catch {
      // 读取失败用兜底
    }
    // display_name 仍以 openai.yaml 优先；description 一律以 SKILL.md frontmatter
    // 为准（不再被 openai.yaml.short_description 覆盖），列表展示侧再截断到 100 字符。
    const iface = await readOpenAiInterface(rootPath);
    if (iface.displayName) displayName = iface.displayName;

    return {
      id,
      displayName,
      description,
      source: builtin ? 'builtin' : 'user',
      rootPath,
      skillFilePath,
      defaultEnabled: true,
      loadModesByAgent: LOAD_MODES_BY_AGENT,
    };
  }

  /**
   * 按 agent + 已保存配置返回 resolved skills。
   * 未知 id 的配置项忽略（不出现在结果里，原值保留在配置文件由 config 层负责）。
   * status 按 SKILL.md 实际可读性判定（available / missing）。
   */
  async resolveForAgent(
    _agentId: string,
    configs: AgentSkillConfig[] | undefined,
  ): Promise<ResolvedAgentSkill[]> {
    const defs = await this.list();
    const byId = new Map((configs ?? []).map((c) => [c.id, c]));
    const resolved: ResolvedAgentSkill[] = [];
    for (const def of defs) {
      const cfg = byId.get(def.id);
      // 内置 skill 强制启用：无视配置残留（旧数据可能写了 enabled:false）。
      const enabled =
        def.source === 'builtin' ? true : cfg ? cfg.enabled : def.defaultEnabled;
      let status: AgentSkillStatus = 'available';
      let error: string | undefined;
      if (!(await exists(def.skillFilePath))) {
        status = 'missing';
        error = 'SKILL.md 不存在';
      }
      resolved.push({ ...def, enabled, status, error });
    }
    return resolved;
  }

  /**
   * 从本地文件夹导入用户 skill：校验含 SKILL.md 且 frontmatter 有 name，
   * 取 frontmatter name（或目录名）为 id，复制到 ~/.lingji/agent-skills/<id>。
   * id 冲突（已存在同名 skill，含内置）则抛错，不覆盖。返回新 skill id。
   */
  async addSkillFromDirectory(srcDir: string): Promise<string> {
    const srcMd = path.join(srcDir, 'SKILL.md');
    let raw: string;
    try {
      raw = await fs.readFile(srcMd, 'utf-8');
    } catch {
      throw new Error('所选文件夹缺少 SKILL.md');
    }
    const fm = parseFrontmatter(raw);
    const rawId = (fm?.name || path.basename(srcDir)).trim().toLowerCase();
    const id = rawId.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) throw new Error('无法从 SKILL.md 的 name 或目录名解析出合法 skill id');

    const targetSkill = path.join(this.targetRoot, id);
    if (await exists(path.join(targetSkill, 'SKILL.md'))) {
      throw new Error(`已存在同名 skill：${id}`);
    }
    await copyDir(srcDir, targetSkill);
    return id;
  }

  /** 删除用户导入的 skill；内置 skill 不可删除（抛错）。 */
  async removeSkill(id: string): Promise<void> {
    if (await this.isBuiltin(id)) {
      throw new Error('内置 skill 不可删除');
    }
    const targetSkill = path.join(this.targetRoot, id);
    if (!(await exists(targetSkill))) return;
    await fs.rm(targetSkill, { recursive: true, force: true });
  }

  /** 读取主 SKILL.md 内容（供 $skill 注入）；失败抛错由上层兜底。 */
  async readSkillMarkdown(id: string): Promise<string> {
    await this.ensureBundled();
    const skillFilePath = path.join(this.targetRoot, id, 'SKILL.md');
    return fs.readFile(skillFilePath, 'utf-8');
  }

  /** 用户 skill 库根目录（外层「打开目录」按钮用）。 */
  getSkillsRoot(): string {
    return this.targetRoot;
  }

  /** 单个 skill 根目录绝对路径（不校验存在性，仅拼路径）。 */
  getSkillRootPath(id: string): string {
    return path.join(this.targetRoot, this.assertSafeId(id));
  }

  /**
   * 读取 skill 目录树（仅根目录内，相对路径用 POSIX 分隔）。
   * 防御：限制递归深度，避免异常软链 / 超深目录拖垮主进程。
   */
  async readSkillTree(id: string): Promise<SkillTreeNode> {
    await this.ensureBundled();
    const root = this.getSkillRootPath(id);
    if (!(await exists(root))) throw new Error('skill 目录不存在');
    return this.walkTree(root, '', id, 0);
  }

  private async walkTree(
    abs: string,
    relPath: string,
    id: string,
    depth: number,
  ): Promise<SkillTreeNode> {
    const name = relPath === '' ? id : path.basename(relPath);
    const node: SkillTreeNode = { name, relPath, isDir: true, children: [] };
    if (depth >= MAX_TREE_DEPTH) return node;
    const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
    const children: SkillTreeNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // 跳过隐藏文件
      const childRel = relPath === '' ? entry.name : `${relPath}/${entry.name}`;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        children.push(await this.walkTree(childAbs, childRel, id, depth + 1));
      } else if (entry.isFile()) {
        children.push({ name: entry.name, relPath: childRel, isDir: false });
      }
    }
    children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children = children;
    return node;
  }

  /**
   * 读取 skill 内单个文件，做大小 / 二进制保护。
   * 路径穿越（relPath 逃出 skill 根目录）一律拒绝。
   */
  async readSkillFile(id: string, relPath: string): Promise<SkillFileContent> {
    await this.ensureBundled();
    const root = this.getSkillRootPath(id);
    const abs = this.resolveWithin(root, relPath);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error('目标不是文件');
    const size = stat.size;
    const buf = await fs.readFile(abs);
    const binary = isBinary(abs, buf);
    if (binary) {
      return { relPath, size, binary: true, truncated: false };
    }
    const truncated = buf.length > MAX_TEXT_BYTES;
    const text = buf.subarray(0, MAX_TEXT_BYTES).toString('utf-8');
    return { relPath, size, binary: false, truncated, text };
  }

  /** skill id 合法性兜底（防止 '..'、分隔符注入）。 */
  private assertSafeId(id: string): string {
    if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new Error('非法 skill id');
    }
    return id;
  }

  /** 把 relPath 解析为绝对路径并断言仍在 root 内，否则抛错。 */
  private resolveWithin(root: string, relPath: string): string {
    const abs = path.resolve(root, relPath);
    const rel = path.relative(root, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('非法路径');
    }
    return abs;
  }
}

/** 目录树最大递归深度（skill 通常很浅，足够覆盖）。 */
const MAX_TREE_DEPTH = 8;
/** 文本文件预览上限：256KB，超出截断。 */
const MAX_TEXT_BYTES = 256 * 1024;
/** 按内容嗅探判定二进制的采样字节数。 */
const SNIFF_BYTES = 8000;

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.icns', '.svg',
  '.pdf', '.zip', '.gz', '.tar', '.mp3', '.mp4', '.mov', '.wav', '.woff',
  '.woff2', '.ttf', '.otf', '.eot', '.wasm', '.bin', '.node',
]);

/** 二进制判定：先看扩展名，再嗅探前若干字节是否含 NUL。 */
function isBinary(filePath: string, buf: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return true;
  const len = Math.min(buf.length, SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

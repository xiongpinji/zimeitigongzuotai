import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry } from '../electron/agent-skills/registry';

let seedRoot = '';
let targetRoot = '';

async function makeSeed(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-seed-'));
  const skill = path.join(dir, 'lingji-video-workflow');
  await fs.mkdir(path.join(skill, 'agents'), { recursive: true });
  await fs.writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: lingji-video-workflow\ndescription: 测试描述\n---\n# 正文\nHELLO',
    'utf-8',
  );
  await fs.writeFile(
    path.join(skill, 'agents', 'openai.yaml'),
    'interface:\n  display_name: "灵机剪影视频工作流"\n  short_description: "短说明"\n',
    'utf-8',
  );
  return dir;
}

beforeEach(async () => {
  seedRoot = await makeSeed();
  targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-target-'));
});
afterEach(async () => {
  await fs.rm(seedRoot, { recursive: true, force: true });
  await fs.rm(targetRoot, { recursive: true, force: true });
});

describe('SkillRegistry', () => {
  it('list() 复制种子并解析元数据（display_name 取 openai.yaml，description 取 frontmatter）', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const defs = await reg.list();
    expect(defs).toHaveLength(1);
    expect(defs[0].id).toBe('lingji-video-workflow');
    expect(defs[0].displayName).toBe('灵机剪影视频工作流');
    // description 一律以 SKILL.md frontmatter 为准，不被 openai.yaml.short_description 覆盖。
    expect(defs[0].description).toBe('测试描述');
    expect(defs[0].source).toBe('builtin');
    expect(defs[0].rootPath).toBe(path.join(targetRoot, 'lingji-video-workflow'));
    expect(defs[0].loadModesByAgent.pi).toContain('native');
  });

  it('resolveForAgent 内置强制启用：配置 enabled:false 也保持 true', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const resolved = await reg.resolveForAgent('pi', [
      { id: 'lingji-video-workflow', enabled: false },
      { id: 'unknown-skill', enabled: true },
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].source).toBe('builtin');
    expect(resolved[0].enabled).toBe(true);
    expect(resolved[0].status).toBe('available');
  });

  it('resolveForAgent 用户 skill 按配置合并 enabled', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list();
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-merge-'));
    await fs.writeFile(path.join(src, 'SKILL.md'), '---\nname: merge-skill\ndescription: x\n---\n', 'utf-8');
    await reg.addSkillFromDirectory(src);
    const resolved = await reg.resolveForAgent('pi', [{ id: 'merge-skill', enabled: false }]);
    const user = resolved.find((r) => r.id === 'merge-skill')!;
    expect(user.enabled).toBe(false);
    await fs.rm(src, { recursive: true, force: true });
  });

  it('无配置时按 defaultEnabled 解析（默认启用）', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const resolved = await reg.resolveForAgent('claude', undefined);
    expect(resolved[0].enabled).toBe(true);
  });

  it('readSkillMarkdown 返回主 SKILL.md 内容', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    const md = await reg.readSkillMarkdown('lingji-video-workflow');
    expect(md).toContain('HELLO');
  });

  it('种子缺失时 list() 返回空数组（不抛错）', async () => {
    const reg = new SkillRegistry({
      seedRoot: path.join(seedRoot, 'nope'),
      targetRoot,
    });
    expect(await reg.list()).toEqual([]);
  });

  it('addSkillFromDirectory 导入用户 skill（source:user），内置排在前', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list(); // 触发种子复制

    // 准备一个待导入的源文件夹
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-src-'));
    await fs.writeFile(
      path.join(src, 'SKILL.md'),
      '---\nname: My Cool Skill\ndescription: 用户技能\n---\n正文',
      'utf-8',
    );

    const id = await reg.addSkillFromDirectory(src);
    expect(id).toBe('my-cool-skill'); // name kebab 化

    const defs = await reg.list();
    expect(defs.map((d) => d.id)).toEqual(['lingji-video-workflow', 'my-cool-skill']);
    const user = defs.find((d) => d.id === 'my-cool-skill')!;
    expect(user.source).toBe('user');
    expect(user.displayName).toBe('My Cool Skill');

    await fs.rm(src, { recursive: true, force: true });
  });

  it('addSkillFromDirectory 缺 SKILL.md 抛错；同名冲突抛错', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list();
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-empty-'));
    await expect(reg.addSkillFromDirectory(empty)).rejects.toThrow(/SKILL\.md/);

    const dup = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-dup-'));
    await fs.writeFile(
      path.join(dup, 'SKILL.md'),
      '---\nname: lingji-video-workflow\ndescription: x\n---\n',
      'utf-8',
    );
    await expect(reg.addSkillFromDirectory(dup)).rejects.toThrow(/已存在/);
    await fs.rm(empty, { recursive: true, force: true });
    await fs.rm(dup, { recursive: true, force: true });
  });

  it('removeSkill 删除用户 skill；内置不可删除（抛错）', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list();
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rm-'));
    await fs.writeFile(path.join(src, 'SKILL.md'), '---\nname: tmp-skill\ndescription: x\n---\n', 'utf-8');
    const id = await reg.addSkillFromDirectory(src);

    await reg.removeSkill(id);
    expect((await reg.list()).map((d) => d.id)).not.toContain(id);

    await expect(reg.removeSkill('lingji-video-workflow')).rejects.toThrow(/内置/);
    await fs.rm(src, { recursive: true, force: true });
  });

  it('readSkillTree 返回目录树（目录在前、跳过隐藏文件）', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list();
    const tree = await reg.readSkillTree('lingji-video-workflow');
    expect(tree.isDir).toBe(true);
    expect(tree.relPath).toBe('');
    const names = (tree.children ?? []).map((c) => c.name);
    // agents/（目录）应排在 SKILL.md（文件）之前
    expect(names).toEqual(['agents', 'SKILL.md']);
    const agents = tree.children!.find((c) => c.name === 'agents')!;
    expect(agents.isDir).toBe(true);
    expect((agents.children ?? []).map((c) => c.name)).toContain('openai.yaml');
  });

  it('readSkillFile 读取文本文件内容', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list();
    const file = await reg.readSkillFile('lingji-video-workflow', 'SKILL.md');
    expect(file.binary).toBe(false);
    expect(file.text).toContain('HELLO');
    expect(file.truncated).toBe(false);
  });

  it('readSkillFile 二进制文件不返回 text', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list();
    const root = path.join(targetRoot, 'lingji-video-workflow');
    await fs.writeFile(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const file = await reg.readSkillFile('lingji-video-workflow', 'logo.png');
    expect(file.binary).toBe(true);
    expect(file.text).toBeUndefined();
  });

  it('readSkillFile 拒绝路径穿越', async () => {
    const reg = new SkillRegistry({ seedRoot, targetRoot });
    await reg.list();
    await expect(
      reg.readSkillFile('lingji-video-workflow', '../../../etc/passwd'),
    ).rejects.toThrow(/非法路径/);
  });
});

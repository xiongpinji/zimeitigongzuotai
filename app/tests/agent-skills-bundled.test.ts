import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureBundledAgentSkills } from '../electron/agent-skills/bundled';

let seedRoot = '';
let targetRoot = '';

async function makeSeed(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-'));
  const skill = path.join(dir, 'lingji-video-workflow');
  await fs.mkdir(path.join(skill, 'references'), { recursive: true });
  await fs.writeFile(path.join(skill, 'SKILL.md'), '---\nname: lingji-video-workflow\n---\nbody', 'utf-8');
  await fs.writeFile(path.join(skill, 'references', 'a.md'), 'ref-a', 'utf-8');
  return dir;
}

beforeEach(async () => {
  seedRoot = await makeSeed();
  targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'target-'));
});
afterEach(async () => {
  await fs.rm(seedRoot, { recursive: true, force: true });
  await fs.rm(targetRoot, { recursive: true, force: true });
});

describe('ensureBundledAgentSkills', () => {
  it('目标缺失时递归复制种子（含子目录）', async () => {
    await ensureBundledAgentSkills({ seedRoot, targetRoot });
    const skillMd = await fs.readFile(
      path.join(targetRoot, 'lingji-video-workflow', 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('name: lingji-video-workflow');
    const refA = await fs.readFile(
      path.join(targetRoot, 'lingji-video-workflow', 'references', 'a.md'), 'utf-8');
    expect(refA).toBe('ref-a');
  });

  it('目标已存在 SKILL.md 时不覆盖用户文件', async () => {
    const skillDir = path.join(targetRoot, 'lingji-video-workflow');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'USER EDITED', 'utf-8');
    await ensureBundledAgentSkills({ seedRoot, targetRoot });
    const content = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
    expect(content).toBe('USER EDITED');
  });

  it('种子缺失时安静返回 false（不抛错）', async () => {
    const ok = await ensureBundledAgentSkills({
      seedRoot: path.join(seedRoot, 'does-not-exist'),
      targetRoot,
    });
    expect(ok).toBe(false);
  });

  it('种子版本与目标不一致时强制同步：覆盖并删除目标多余文件', async () => {
    // 种子带 version: 2，只含 SKILL.md + references/a.md
    const seedSkill = path.join(seedRoot, 'lingji-video-workflow');
    await fs.writeFile(
      path.join(seedSkill, 'SKILL.md'),
      '---\nname: lingji-video-workflow\nversion: 2\n---\nNEW BODY',
      'utf-8',
    );
    // 目标是旧版 version: 1，且有一个种子已删除的残留文件 references/stale.md
    const targetSkill = path.join(targetRoot, 'lingji-video-workflow');
    await fs.mkdir(path.join(targetSkill, 'references'), { recursive: true });
    await fs.writeFile(
      path.join(targetSkill, 'SKILL.md'),
      '---\nname: lingji-video-workflow\nversion: 1\n---\nOLD BODY',
      'utf-8',
    );
    await fs.writeFile(path.join(targetSkill, 'references', 'stale.md'), 'STALE', 'utf-8');

    await ensureBundledAgentSkills({ seedRoot, targetRoot });

    const md = await fs.readFile(path.join(targetSkill, 'SKILL.md'), 'utf-8');
    expect(md).toContain('version: 2');
    expect(md).toContain('NEW BODY');
    // 残留文件被清除
    await expect(
      fs.access(path.join(targetSkill, 'references', 'stale.md')),
    ).rejects.toThrow();
    // 种子新文件落地
    const refA = await fs.readFile(path.join(targetSkill, 'references', 'a.md'), 'utf-8');
    expect(refA).toBe('ref-a');
  });

  it('版本一致时不覆盖目标', async () => {
    const seedSkill = path.join(seedRoot, 'lingji-video-workflow');
    await fs.writeFile(
      path.join(seedSkill, 'SKILL.md'),
      '---\nname: lingji-video-workflow\nversion: 2\n---\nSEED',
      'utf-8',
    );
    const targetSkill = path.join(targetRoot, 'lingji-video-workflow');
    await fs.mkdir(targetSkill, { recursive: true });
    await fs.writeFile(
      path.join(targetSkill, 'SKILL.md'),
      '---\nname: lingji-video-workflow\nversion: 2\n---\nUSER EDITED',
      'utf-8',
    );
    await ensureBundledAgentSkills({ seedRoot, targetRoot });
    const md = await fs.readFile(path.join(targetSkill, 'SKILL.md'), 'utf-8');
    expect(md).toContain('USER EDITED');
  });
});

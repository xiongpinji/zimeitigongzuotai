import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deletePromptYaml,
  listPromptOverview,
  loadEffectivePromptTemplate,
  readPromptUserText,
  readRawPromptYaml,
  writePromptUserText,
  writePromptYaml,
} from '../electron/prompts-io';

let tmpRoot: string;
let userDataPath: string;
let projectDir: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prompts-test-'));
  userDataPath = path.join(tmpRoot, 'userData');
  projectDir = path.join(tmpRoot, 'project');
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('loadEffectivePromptTemplate fallback chain', () => {
  it('falls back to builtin when no overrides exist', async () => {
    const tpl = await loadEffectivePromptTemplate('planning.segment', { userDataPath, projectDir });
    expect(tpl.sourceScope).toBe('builtin');
    expect(tpl.user).toContain('播客内容分析助手');
  });

  it('uses global override when only global is present', async () => {
    const yaml = 'name: planning.segment\nuser: |-\n  GLOBAL VERSION {{globalPromptLine}}\n';
    await writePromptYaml('global', 'planning.segment', yaml, { userDataPath });
    const tpl = await loadEffectivePromptTemplate('planning.segment', { userDataPath, projectDir });
    expect(tpl.sourceScope).toBe('global');
    expect(tpl.user).toContain('GLOBAL VERSION');
  });

  it('prefers project override over global', async () => {
    await writePromptYaml(
      'global',
      'cards.segment',
      'name: cards.segment\nuser: |-\n  GLOBAL {{fullTranscript}}\n',
      { userDataPath },
    );
    await writePromptYaml(
      'project',
      'cards.segment',
      'name: cards.segment\nuser: |-\n  PROJECT {{fullTranscript}}\n',
      { userDataPath, projectDir },
    );
    const tpl = await loadEffectivePromptTemplate('cards.segment', { userDataPath, projectDir });
    expect(tpl.sourceScope).toBe('project');
    expect(tpl.user).toContain('PROJECT');
  });

  it('falls back to global when project is missing', async () => {
    await writePromptYaml(
      'global',
      'cover.regeneration',
      'name: cover.regeneration\nuser: |-\n  GLOBAL COVER {{globalPrompt}}\n',
      { userDataPath },
    );
    const tpl = await loadEffectivePromptTemplate('cover.regeneration', { userDataPath, projectDir });
    expect(tpl.sourceScope).toBe('global');
    expect(tpl.user).toContain('GLOBAL COVER');
  });

  it('skips a malformed override and falls back', async () => {
    // 写一个肉眼合法但会让 parsePromptYaml 报错的内容（user 缺失）
    const file = path.join(userDataPath, 'prompts', 'planning', 'segment.yaml');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'name: broken\n', 'utf-8');
    const tpl = await loadEffectivePromptTemplate('planning.segment', { userDataPath });
    expect(tpl.sourceScope).toBe('builtin');
  });
});

describe('write / read / delete', () => {
  it('writes then reads raw global YAML', async () => {
    const yaml = 'name: cover.regeneration\nuser: |-\n  X {{globalPrompt}}\n';
    await writePromptYaml('global', 'cover.regeneration', yaml, { userDataPath });
    const raw = await readRawPromptYaml('global', 'cover.regeneration', { userDataPath });
    expect(raw).toBe(yaml);
  });

  it('rejects writing invalid YAML', async () => {
    await expect(
      writePromptYaml('global', 'planning.segment', 'name: x\nuser: ""\n', { userDataPath }),
    ).rejects.toThrow();
  });

  it('writes user text as valid YAML while users only edit plain text', async () => {
    const userText = [
      '请按下面要求生成内容：',
      '- 使用中文冒号：不用转义',
      '{{globalPrompt}}',
    ].join('\n');

    await writePromptUserText('global', 'cover.regeneration', userText, { userDataPath });

    const raw = await readRawPromptYaml('global', 'cover.regeneration', { userDataPath });
    expect(raw).toContain('user:');
    expect(raw).toContain('请按下面要求生成内容');

    const text = await readPromptUserText('global', 'cover.regeneration', { userDataPath });
    expect(text).toBe(userText);

    const tpl = await loadEffectivePromptTemplate('cover.regeneration', { userDataPath });
    expect(tpl.sourceScope).toBe('global');
    expect(tpl.user).toBe(userText);
  });

  it('preserves existing YAML metadata when replacing user text', async () => {
    await writePromptYaml(
      'global',
      'script.review',
      [
        'name: 自定义审查',
        'description: 已有描述',
        'version: 9',
        'system: |-',
        '  你是审查编辑。',
        'user: |-',
        '  旧正文',
        '',
      ].join('\n'),
      { userDataPath },
    );

    await writePromptUserText('global', 'script.review', '新正文 {{scriptText}}', {
      userDataPath,
    });

    const tpl = await loadEffectivePromptTemplate('script.review', { userDataPath });
    expect(tpl.name).toBe('自定义审查');
    expect(tpl.description).toBe('已有描述');
    expect(tpl.version).toBe(9);
    expect(tpl.system).toBe('你是审查编辑。');
    expect(tpl.user).toBe('新正文 {{scriptText}}');
  });

  it('deletes an existing override', async () => {
    const yaml = 'name: cards.segment\nuser: |-\n  hi {{programContext}}\n';
    await writePromptYaml('global', 'cards.segment', yaml, { userDataPath });
    const removed = await deletePromptYaml('global', 'cards.segment', { userDataPath });
    expect(removed).toBe(true);
    const raw = await readRawPromptYaml('global', 'cards.segment', { userDataPath });
    expect(raw).toBeNull();
  });

  it('returns false when deleting a non-existing override', async () => {
    const removed = await deletePromptYaml('project', 'cover.regeneration', {
      userDataPath,
      projectDir,
    });
    expect(removed).toBe(false);
  });
});

describe('listPromptOverview', () => {
  it('reports effective scope per kind', async () => {
    await writePromptYaml(
      'global',
      'cover.regeneration',
      'name: cover.regeneration\nuser: |-\n  G {{globalPrompt}}\n',
      { userDataPath },
    );
    await writePromptYaml(
      'project',
      'cards.segment',
      'name: cards.segment\nuser: |-\n  P {{programContext}}\n',
      { userDataPath, projectDir },
    );
    const items = await listPromptOverview({ userDataPath, projectDir });
    const map = Object.fromEntries(items.map((i) => [i.kind, i]));
    expect(map['cover.regeneration'].effectiveScope).toBe('global');
    expect(map['cover.regeneration'].hasGlobal).toBe(true);
    expect(map['cards.segment'].effectiveScope).toBe('project');
    expect(map['cards.segment'].hasProject).toBe(true);
    expect(map['planning.segment'].effectiveScope).toBe('builtin');
  });
});

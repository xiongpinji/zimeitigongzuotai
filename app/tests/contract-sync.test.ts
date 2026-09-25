import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureProjectAgentContracts, FILE_FIRST_MARKER, buildFileFirstContractBlock } from '../electron/acp/contract-sync';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingji-contract-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('ensureProjectAgentContracts', () => {
  it('三个 agent 文件都写入契约块', async () => {
    await ensureProjectAgentContracts(dir);
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
      const txt = await fs.readFile(path.join(dir, f), 'utf-8');
      expect(txt).toContain(FILE_FIRST_MARKER);
    }
  });
  it('重复调用幂等（marker 对数不增长）', async () => {
    await ensureProjectAgentContracts(dir);
    await ensureProjectAgentContracts(dir);
    const txt = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf-8');
    // 一对 marker = 出现 2 次
    expect(txt.match(new RegExp(FILE_FIRST_MARKER, 'g'))!.length).toBe(2);
  });
  it('保留已有文件原内容（追加而非覆盖）', async () => {
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# 既有内容\n保留我\n', 'utf-8');
    await ensureProjectAgentContracts(dir);
    const txt = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf-8');
    expect(txt).toContain('保留我');
    expect(txt).toContain(FILE_FIRST_MARKER);
  });
  it('契约块含内置工作流引导段落', () => {
    const block = buildFileFirstContractBlock();
    expect(block).toContain('可用内置工作流');
    expect(block).toContain('$lingji-video-workflow');
  });
});

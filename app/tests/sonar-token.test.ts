import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getOrCreateSonarToken } from '../electron/sonar/token';

describe('getOrCreateSonarToken', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sonar-token-'));
    file = path.join(dir, 'sonar-token');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('首次生成并持久化一个足够长的 token', async () => {
    const token = await getOrCreateSonarToken(file);
    expect(token).toMatch(/^[a-f0-9]{32,}$/);
    expect(readFileSync(file, 'utf-8').trim()).toBe(token);
  });

  it('再次调用返回同一个 token（持久）', async () => {
    const first = await getOrCreateSonarToken(file);
    const second = await getOrCreateSonarToken(file);
    expect(second).toBe(first);
  });

  it('读取已存在文件中的 token（去除空白）', async () => {
    writeFileSync(file, '  deadbeefdeadbeefdeadbeefdeadbeef  \n', 'utf-8');
    expect(await getOrCreateSonarToken(file)).toBe('deadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('已存在文件为空时重新生成', async () => {
    writeFileSync(file, '   \n', 'utf-8');
    const token = await getOrCreateSonarToken(file);
    expect(token).toMatch(/^[a-f0-9]{32,}$/);
  });

  it('文件权限为 0600（仅本人可读写）', async () => {
    await getOrCreateSonarToken(file);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

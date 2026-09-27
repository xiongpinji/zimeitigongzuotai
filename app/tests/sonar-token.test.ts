import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { getOrCreateSonarToken } from '../electron/sonar/token';

function readWindowsAcl(file: string): { protected: boolean; allowedSids: string[]; selfSid: string } {
  const script = [
    '$acl = [System.IO.File]::GetAccessControl($env:SONAR_TEST_TOKEN_FILE)',
    '$allowed = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq "Allow" } | ForEach-Object { $_.IdentityReference.Value })',
    '[pscustomobject]@{ protected = $acl.AreAccessRulesProtected; allowedSids = $allowed; selfSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress',
  ].join('; ');
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, SONAR_TEST_TOKEN_FILE: file },
    encoding: 'utf8',
    windowsHide: true,
  }).trim());
}

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

  it('已有只读 token 可在收紧权限后继续复用', async () => {
    const existing = 'deadbeefdeadbeefdeadbeefdeadbeef';
    writeFileSync(file, existing, 'utf8');
    chmodSync(file, 0o400);
    try {
      expect(await getOrCreateSonarToken(file)).toBe(existing);
    } finally {
      chmodSync(file, 0o600);
    }
  });

  it('已存在文件为空时重新生成', async () => {
    writeFileSync(file, '   \n', 'utf-8');
    const token = await getOrCreateSonarToken(file);
    expect(token).toMatch(/^[a-f0-9]{32,}$/);
  });

  it.skipIf(process.platform === 'win32')('POSIX 文件权限为 0600', async () => {
    await getOrCreateSonarToken(file);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.skipIf(process.platform !== 'win32')('Windows 新 token 只授权当前用户', async () => {
    await getOrCreateSonarToken(file);
    const acl = readWindowsAcl(file);
    expect(acl.protected).toBe(true);
    expect(acl.allowedSids).toEqual([acl.selfSid]);
  });

  it.skipIf(process.platform !== 'win32')('Windows 已有 token 先收紧 ACL 再复用', async () => {
    const existing = 'deadbeefdeadbeefdeadbeefdeadbeef';
    writeFileSync(file, existing, 'utf8');
    expect(await getOrCreateSonarToken(file)).toBe(existing);
    const acl = readWindowsAcl(file);
    expect(acl.protected).toBe(true);
    expect(acl.allowedSids).toEqual([acl.selfSid]);
  });

  it.skipIf(process.platform !== 'win32')('Windows ACL 工具不可用时不写入新 token', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(getOrCreateSonarToken(file)).rejects.toThrow('sonar_token_acl_failed');
      expect(readFileSync(file, 'utf8')).toBe('');
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

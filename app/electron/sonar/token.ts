/**
 * 声呐桥共享 token（设计文档第 5、9 节）。
 *
 * 首次生成持久化到 ~/.lingji/sonar-token，后续读取复用。
 * POSIX 使用 0600；Windows 使用只授权当前用户的受保护 ACL。
 * 扩展把该 token 复制进设置，/sonar/enqueue 以 x-sonar-token 头比对。
 * 仅 loopback + token，防本机其它程序乱投。
 */
import { readFile, writeFile, mkdir, open, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const SONAR_TOKEN_FILE = join(homedir(), '.lingji', 'sonar-token');

const execFileAsync = promisify(execFile);

// 文件路径只经子进程环境变量传递，绝不拼入 PowerShell 命令文本。
const WINDOWS_RESTRICT_ACL_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
  '$acl = New-Object System.Security.AccessControl.FileSecurity',
  // 保留文件原 Owner；在项目盘重复设置 Owner 可能导致 SetAccessControl 拒绝访问。
  '$acl.SetAccessRuleProtection($true, $false)',
  '$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)',
  '$acl.AddAccessRule($rule)',
  '[System.IO.File]::SetAccessControl($env:SONAR_TOKEN_ACL_FILE, $acl)',
].join('; ');

async function restrictTokenAccess(file: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_RESTRICT_ACL_SCRIPT], {
        env: { ...process.env, SONAR_TOKEN_ACL_FILE: file },
        windowsHide: true,
        timeout: 10_000,
      });
    } else {
      await chmod(file, 0o600);
    }
  } catch {
    throw new Error('sonar_token_acl_failed');
  }
}

/** 先收紧文件权限，再读取已有 token；不存在或为空则生成并持久化。 */
export async function getOrCreateSonarToken(file: string = SONAR_TOKEN_FILE): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  // 新文件先以空内容创建，收紧 ACL 成功后才写入秘密；已有文件也先收紧再读取。
  try {
    const handle = await open(file, 'wx', 0o600);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await restrictTokenAccess(file);
  const existing = (await readFile(file, 'utf-8')).trim();
  if (existing) return existing;
  const token = randomBytes(24).toString('hex'); // 48 hex chars
  await writeFile(file, token, { encoding: 'utf-8', mode: 0o600 });
  return token;
}

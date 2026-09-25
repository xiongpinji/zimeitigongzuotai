/**
 * 声呐桥共享 token（设计文档第 5、9 节）。
 *
 * 首次生成持久化到 ~/.lingji/sonar-token（0600），后续读取复用。
 * 扩展把该 token 复制进设置，/sonar/enqueue 以 x-sonar-token 头比对。
 * 仅 loopback + token，防本机其它程序乱投。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const SONAR_TOKEN_FILE = join(homedir(), '.lingji', 'sonar-token');

/** 读取已有 token；不存在或为空则生成并持久化（0600）。 */
export async function getOrCreateSonarToken(file: string = SONAR_TOKEN_FILE): Promise<string> {
  try {
    const existing = (await readFile(file, 'utf-8')).trim();
    if (existing) return existing;
  } catch {
    // 文件不存在 → 继续生成。
  }
  const token = randomBytes(24).toString('hex'); // 48 hex chars
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, token, { encoding: 'utf-8', mode: 0o600 });
  return token;
}

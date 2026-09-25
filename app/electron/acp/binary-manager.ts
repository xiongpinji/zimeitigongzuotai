import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acpLog } from './acp-log';

const execFileAsync = promisify(execFile);

const AGENT_NPM_PACKAGE = '@agentclientprotocol/claude-agent-acp';
const AGENT_BIN_NAME = 'claude-agent-acp';
const NPM_OFFICIAL_REGISTRY = 'https://registry.npmjs.org';
const LOG_SCOPE = 'acp-binary';

export class BinaryManager {
  private cachePath: string;
  private userNpmPrefix: string;

  constructor(cacheBase?: string) {
    const homeDir = getHomeDir();
    this.cachePath = cacheBase ?? path.join(homeDir, '.lingji', 'acp-binaries', 'claude-acp');
    this.userNpmPrefix = path.join(homeDir, '.lingji', 'npm-global');
  }

  /**
   * 在应用启动时调用，确保 nvm/fnm/volta 管理的 node 在 PATH 中。
   * 同时将用户本地 npm prefix 的 bin 目录、常见系统级 node 目录加入 PATH。
   */
  ensureNodeInPath(): void {
    // Homebrew / 系统级 node 兜底：macOS 打包后的 .app 默认 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin
    for (const sysBin of ['/opt/homebrew/bin', '/usr/local/bin']) {
      if (existsSync(sysBin)) {
        this.prependToPathIfMissing(sysBin);
      }
    }

    // 如果 node 已在 PATH 中，跳过 nvm/fnm/volta 检测
    const nodePath = this.whichSync('node');
    if (!nodePath) {
      const binDir = this.findNodeBinDir();
      if (binDir) {
        this.prependToPathIfMissing(binDir);
      }
    }

    // 确保用户本地 npm prefix bin 目录在 PATH 中
    for (const userBinDir of this.getUserPrefixBinDirs()) {
      this.prependToPathIfMissing(userBinDir);
    }
  }

  /**
   * 在所有 nvm/fnm/volta 管理的 node 版本 bin 目录中查找指定二进制。
   * 用于解决 “default node 版本没装 X，但其他版本装了 X” 的场景。
   */
  findBinaryInNodeVersions(binName: string): string | null {
    for (const binDir of this.collectNodeVersionBinDirs()) {
      const candidate = path.join(binDir, binName);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** 移除 npm_* 环境变量，避免 npm run dev 时继承的 npm 内部配置干扰子进程 */
  private getCleanEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith('npm_')) {
        env[key] = value;
      }
    }
    return env;
  }

  async findNpxPath(): Promise<string | null> {
    return this.findBinaryPath('npx');
  }

  async findNodePath(): Promise<string | null> {
    return this.findBinaryPath('node');
  }

  async getNodeVersion(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('node', ['--version'], {
        timeout: 10_000,
        env: this.getCleanEnv(),
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async getInstalledVersion(): Promise<string | null> {
    try {
      const versionFile = path.join(this.cachePath, 'version.txt');
      return (await fs.readFile(versionFile, 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  async getLatestVersion(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'npm',
        ['view', AGENT_NPM_PACKAGE, 'version', `--registry=${NPM_OFFICIAL_REGISTRY}`],
        { timeout: 15_000, env: this.getCleanEnv() },
      );
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * 通过 npm install -g 安装 agent 二进制。
   * 参考 codeg 实现：使用官方 registry、EACCES 回退到用户本地 prefix。
   */
  async install(version: string): Promise<void> {
    await fs.mkdir(this.cachePath, { recursive: true });

    const pkg = `${AGENT_NPM_PACKAGE}@${version}`;
    const registryArg = `--registry=${NPM_OFFICIAL_REGISTRY}`;
    const env = this.getCleanEnv();

    try {
      await this.npmInstallGlobal(pkg, registryArg, env);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      // EACCES: 权限不足 → 回退到用户本地 prefix
      if (stderr.includes('EACCES')) {
        await this.installToUserPrefix(pkg, registryArg, env);
      } else if (stderr.includes('EEXIST')) {
        // EEXIST: 文件冲突 → --force 重试
        try {
          await this.npmInstallGlobal(pkg, registryArg, env, true);
        } catch (retryErr) {
          const retryStderr = (retryErr as { stderr?: string }).stderr ?? String(retryErr);
          if (retryStderr.includes('EACCES')) {
            await this.installToUserPrefix(pkg, registryArg, env);
          } else {
            throw new Error(`npm install -g --force 失败: ${retryStderr}`);
          }
        }
      } else {
        throw new Error(`npm install -g 失败: ${stderr}`);
      }
    }

    await fs.writeFile(path.join(this.cachePath, 'version.txt'), version, 'utf-8');
  }

  async uninstall(): Promise<void> {
    try {
      await fs.rm(this.cachePath, { recursive: true, force: true });
    } catch {
      // 目录不存在
    }
  }

  /**
   * 返回 spawn 命令：直接使用全局安装的二进制名称，而非 npx 包装。
   * 调用方应在 spawn 时传入 getCleanEnv() 的环境变量。
   *
   * 查找顺序：
   * 1. PATH 上的 `which claude-agent-acp`
   * 2. 扫描所有 nvm/fnm/volta 管理的 node 版本 bin 目录
   * 3. 用户本地 npm prefix (`~/.lingji/npm-global/bin`)
   * 4. 回退到裸二进制名（由 spawn 自行解析 PATH；通常会 ENOENT）
   */
  getSpawnCommand(_version: string): { command: string; args: string[] } {
    const resolved = this.whichSync(AGENT_BIN_NAME);
    if (resolved) {
      acpLog('info', LOG_SCOPE, 'getSpawnCommand: 命中 PATH (which)', { command: resolved });
      return { command: resolved, args: [] };
    }

    const scanned = this.findBinaryInNodeVersions(AGENT_BIN_NAME);
    if (scanned) {
      // 将该版本 bin 目录加入 PATH，方便子进程内部再次 spawn 同目录工具
      this.prependToPathIfMissing(path.dirname(scanned));
      acpLog('info', LOG_SCOPE, 'getSpawnCommand: 命中 nvm/fnm/volta 版本目录', { command: scanned });
      return { command: scanned, args: [] };
    }

    const userPrefixCandidate = this.findExistingExecutable(
      this.getUserPrefixBinDirs(),
      AGENT_BIN_NAME,
    );
    if (userPrefixCandidate) {
      acpLog('info', LOG_SCOPE, 'getSpawnCommand: 命中用户本地 npm prefix', { command: userPrefixCandidate });
      return { command: userPrefixCandidate, args: [] };
    }

    acpLog('error', LOG_SCOPE, 'getSpawnCommand: 未找到二进制，回退裸名（极可能 ENOENT）', {
      binName: AGENT_BIN_NAME,
      triedUserPrefix: `${this.userNpmPrefix}/bin`,
    });
    console.warn(
      `[ACP] 未找到 ${AGENT_BIN_NAME} 二进制；spawn 将依赖 PATH 解析，可能触发 ENOENT。` +
        ` 已尝试路径：which、nvm/fnm/volta 全部版本、${this.userNpmPrefix}/bin`,
    );
    return { command: AGENT_BIN_NAME, args: [] };
  }

  /** 公开：在 nvm 版本目录 / PATH 解析某依赖二进制（供 preflight 查 pi）。返回绝对路径或 null。 */
  async resolveBinary(name: string): Promise<string | null> {
    const inVersions = this.findBinaryInNodeVersions(name);
    if (inVersions) return inVersions;
    return this.findBinaryPath(name);
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────

  private async npmInstallGlobal(
    pkg: string,
    registryArg: string,
    env: NodeJS.ProcessEnv,
    force = false,
  ): Promise<void> {
    const args = ['install', '-g', registryArg, pkg];
    if (force) args.splice(2, 0, '--force');

    const { stderr } = await execFileAsync('npm', args, {
      timeout: 120_000,
      env,
    });
    // execFileAsync 在非零退出码时自动 throw，这里处理 stderr 中有警告但退出码为 0 的情况
    if (stderr && (stderr.includes('ERR!') || stderr.includes('EACCES') || stderr.includes('EEXIST'))) {
      const err = new Error(`npm install failed: ${stderr}`);
      (err as Error & { stderr?: string }).stderr = stderr;
      throw err;
    }
  }

  /** 回退：安装到用户本地 prefix (~/.lingji/npm-global/) */
  private async installToUserPrefix(
    pkg: string,
    registryArg: string,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    await fs.mkdir(this.userNpmPrefix, { recursive: true });
    const prefixArg = `--prefix=${this.userNpmPrefix}`;

    const { stderr } = await execFileAsync(
      'npm',
      ['install', '-g', prefixArg, registryArg, pkg],
      { timeout: 120_000, env },
    );
    if (stderr && stderr.includes('ERR!')) {
      // EEXIST in user prefix: --force 重试
      if (stderr.includes('EEXIST')) {
        await execFileAsync(
          'npm',
          ['install', '-g', '--force', prefixArg, registryArg, pkg],
          { timeout: 120_000, env },
        );
        return;
      }
      throw new Error(`npm install to user prefix 失败: ${stderr}`);
    }
  }

  async findBinaryPath(name: string): Promise<string | null> {
    return this.whichSync(name);
  }

  private whichSync(name: string): string | null {
    const pathValue = this.getCleanEnv().PATH ?? this.getCleanEnv().Path ?? '';
    const dirs = pathValue.split(path.delimiter).filter(Boolean);
    return this.findExistingExecutable(dirs, name);
  }

  private findExistingExecutable(dirs: string[], name: string): string | null {
    for (const dir of dirs) {
      for (const executableName of getExecutableNames(name)) {
        const candidate = path.join(dir, executableName);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  /** 首选的 node bin 目录：nvm default → nvm 最新 → fnm 最新 → volta */
  private findNodeBinDir(): string | null {
    for (const binDir of this.collectNodeVersionBinDirs()) {
      if (existsSync(path.join(binDir, 'node'))) return binDir;
    }
    return null;
  }

  /**
   * 枚举所有 nvm/fnm/volta 版本 bin 目录。
   * 顺序：nvm default（若存在）→ nvm 其余版本（新→旧）→ fnm（新→旧）→ volta。
   */
  private collectNodeVersionBinDirs(): string[] {
    const dirs: string[] = [];
    const home = getHomeDir();

    // nvm
    const nvmDir = process.env.NVM_DIR ?? path.join(home, '.nvm');
    const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
    if (existsSync(nvmVersionsDir)) {
      const entries = safeReaddir(nvmVersionsDir).sort().reverse();
      let defaultEntry: string | null = null;

      const defaultAlias = path.join(nvmDir, 'alias', 'default');
      if (existsSync(defaultAlias)) {
        try {
          const alias = readFileSync(defaultAlias, 'utf-8').trim();
          defaultEntry =
            entries.find((entry) => {
              const stripped = entry.replace(/^v/, '');
              return stripped.startsWith(alias) || entry.startsWith(alias);
            }) ?? null;
        } catch {
          // ignore
        }
      }

      if (defaultEntry) {
        dirs.push(path.join(nvmVersionsDir, defaultEntry, 'bin'));
      }
      for (const entry of entries) {
        if (entry === defaultEntry) continue;
        dirs.push(path.join(nvmVersionsDir, entry, 'bin'));
      }
    }

    // nvm-windows
    const nvmWindowsSymlink = process.env.NVM_SYMLINK;
    if (nvmWindowsSymlink && existsSync(nvmWindowsSymlink)) {
      dirs.push(nvmWindowsSymlink);
    }

    const nvmWindowsDir = process.env.NVM_HOME;
    if (nvmWindowsDir && existsSync(nvmWindowsDir)) {
      for (const entry of safeReaddir(nvmWindowsDir).sort().reverse()) {
        dirs.push(path.join(nvmWindowsDir, entry));
      }
    }

    // fnm
    const fnmDir = process.env.FNM_DIR ?? path.join(home, '.local', 'share', 'fnm');
    const fnmVersions = path.join(fnmDir, 'node-versions');
    if (existsSync(fnmVersions)) {
      for (const entry of safeReaddir(fnmVersions).sort().reverse()) {
        dirs.push(path.join(fnmVersions, entry, 'installation', 'bin'));
        dirs.push(path.join(fnmVersions, entry, 'installation'));
      }
    }

    // volta
    const voltaHome = process.env.VOLTA_HOME ?? path.join(home, '.volta');
    const voltaBin = path.join(voltaHome, 'bin');
    if (existsSync(path.join(voltaBin, 'node'))) {
      dirs.push(voltaBin);
    }

    return dirs;
  }

  private prependToPathIfMissing(dir: string): void {
    const current = process.env.PATH ?? '';
    if (current.split(path.delimiter).includes(dir)) return;
    process.env.PATH = current ? `${dir}${path.delimiter}${current}` : dir;
  }

  private getUserPrefixBinDirs(): string[] {
    if (process.platform === 'win32') {
      return [this.userNpmPrefix, path.join(this.userNpmPrefix, 'bin')];
    }

    return [path.join(this.userNpmPrefix, 'bin')];
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function getExecutableNames(name: string): string[] {
  if (process.platform !== 'win32' || path.extname(name)) {
    return [name];
  }

  return [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`];
}

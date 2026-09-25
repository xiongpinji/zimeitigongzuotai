import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { JsonRpcMessage, JsonRpcRequest, JsonRpcResponse } from './types';
import { isJsonRpcNotification, isJsonRpcRequest, isJsonRpcResponse } from './types';
import { acpLog, clip, nowMs } from './acp-log';

const LOG_SCOPE = 'acp-client';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface AcpClientOptions {
  requestTimeout?: number;
}

export class AcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
  private nextId = 1;
  private requestTimeout: number;

  constructor(options: AcpClientOptions = {}) {
    super();
    this.requestTimeout = options.requestTimeout ?? 30_000;
  }

  async spawn(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
    // 移除 npm_* 环境变量，避免 npm run dev 上下文干扰子进程
    const cleanEnv: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith('npm_')) {
        cleanEnv[key] = value;
      }
    }

    const spawnStartedAt = nowMs();
    // 只记录 env key 名，避免泄露 API Key / token 等敏感 value
    const extraEnvKeys = env ? Object.keys(env) : [];
    acpLog('info', LOG_SCOPE, '准备 spawn agent 进程', {
      command,
      args,
      cwd,
      extraEnvKeys,
      hasPathOverride: extraEnvKeys.includes('PATH'),
    });

    return new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(command, args, {
          cwd,
          env: { ...cleanEnv, ...env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        acpLog('error', LOG_SCOPE, 'spawn 同步抛错（命令不可执行？）', {
          command,
          error: err instanceof Error ? err.message : String(err),
        });
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.process = child;

      child.on('error', (err) => {
        acpLog('error', LOG_SCOPE, 'agent 进程 error 事件', {
          command,
          error: err.message,
          // ENOENT 通常意味着二进制路径解析失败
          hint: /ENOENT/i.test(err.message) ? '二进制未找到，检查 claude-agent-acp 是否安装/在 PATH' : undefined,
        });
        this.emit('disconnected', err);
        reject(err);
      });

      child.on('exit', (code, signal) => {
        acpLog(
          code === 0 ? 'info' : 'warn',
          LOG_SCOPE,
          'agent 进程退出',
          { pid: child.pid, code, signal, aliveMs: nowMs() - spawnStartedAt, pendingRequests: this.pendingRequests.size },
        );
        this.rejectAllPending(new Error(`Agent process exited (code=${code}, signal=${signal})`));
        this.emit('disconnected', { code, signal });
      });

      if (!child.stdout || !child.stdin) {
        acpLog('error', LOG_SCOPE, 'spawn 后 stdio 管道创建失败', { pid: child.pid });
        reject(new Error('Failed to create stdio pipes'));
        return;
      }

      this.readline = createInterface({ input: child.stdout });
      this.readline.on('line', (line) => this.handleLine(line));

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        // agent 的认证失败 / 崩溃栈 / 警告都在 stderr，这是排查卡死的关键信息
        acpLog('warn', LOG_SCOPE, 'agent stderr', { pid: child.pid, text: clip(text, 1000) });
        this.emit('stderr', text);
      });

      const onSpawn = () => {
        child.removeListener('error', onError);
        acpLog('info', LOG_SCOPE, 'agent 进程已 spawn', {
          pid: child.pid,
          spawnMs: nowMs() - spawnStartedAt,
        });
        resolve();
      };
      const onError = (err: Error) => {
        child.removeListener('spawn', onSpawn);
        reject(err);
      };

      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  disconnect(): void {
    acpLog('info', LOG_SCOPE, 'disconnect 被调用', {
      pid: this.process?.pid,
      pendingRequests: this.pendingRequests.size,
    });
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    this.rejectAllPending(new Error('Client disconnected'));
  }

  async disconnectAndWait(timeoutMs = 2_000): Promise<void> {
    const child = this.process;
    this.disconnect();

    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async sendRequest(method: string, params: unknown, timeout?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        acpLog('error', LOG_SCOPE, 'sendRequest 时连接不可用', {
          method,
          hasProcess: Boolean(this.process),
          stdinWritable: Boolean(this.process?.stdin?.writable),
        });
        reject(new Error('Not connected'));
        return;
      }

      const id = this.nextId++;
      const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

      const effectiveTimeout = timeout ?? this.requestTimeout;
      const startedAt = nowMs();
      acpLog('info', LOG_SCOPE, '→ RPC 请求', {
        method,
        id,
        // timeout=0 表示无超时上限：session/prompt 走这条路，是最容易静默卡死的请求
        timeoutMs: effectiveTimeout,
        noTimeout: effectiveTimeout <= 0,
      });
      const timer = effectiveTimeout > 0
        ? setTimeout(() => {
            this.pendingRequests.delete(id);
            acpLog('error', LOG_SCOPE, '✗ RPC 请求超时', {
              method,
              id,
              timeoutMs: effectiveTimeout,
              waitedMs: nowMs() - startedAt,
            });
            reject(new Error(`Request timeout: ${method} (id=${id})`));
          }, effectiveTimeout)
        : undefined;

      const wrappedResolve = (value: unknown) => {
        acpLog('info', LOG_SCOPE, '← RPC 响应', { method, id, waitedMs: nowMs() - startedAt });
        resolve(value);
      };
      const wrappedReject = (reason: Error) => {
        acpLog('warn', LOG_SCOPE, '← RPC 失败', { method, id, waitedMs: nowMs() - startedAt, error: reason.message });
        reject(reason);
      };

      this.pendingRequests.set(id, { resolve: wrappedResolve, reject: wrappedReject, timer: timer! });
      this.process.stdin.write(JSON.stringify(message) + '\n');
    });
  }

  sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const message = { jsonrpc: '2.0', method, params };
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
    this.requestHandlers.set(method, handler);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      acpLog('warn', LOG_SCOPE, 'agent 输出无法解析为 JSON-RPC', { line: clip(line, 500) });
      this.emit('parse_error', line);
      return;
    }

    if (isJsonRpcResponse(msg)) {
      this.handleResponse(msg);
    } else if (isJsonRpcRequest(msg)) {
      void this.handleIncomingRequest(msg);
    } else if (isJsonRpcNotification(msg)) {
      this.emit('notification', msg.method, msg.params);
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    this.pendingRequests.delete(msg.id);
    clearTimeout(pending.timer);

    if (msg.error) {
      pending.reject(new Error(`JSON-RPC error: ${msg.error.message} (code=${msg.error.code})`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async handleIncomingRequest(msg: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(msg.method);

    if (!handler) {
      this.sendResponse(msg.id, undefined, {
        code: -32601,
        message: `Method not found: ${msg.method}`,
      });
      return;
    }

    try {
      const result = await handler(msg.params);
      this.sendResponse(msg.id, result);
    } catch (err) {
      this.sendResponse(msg.id, undefined, {
        code: -32603,
        message: err instanceof Error ? err.message : 'Internal error',
      });
    }
  }

  private sendResponse(id: number, result?: unknown, error?: { code: number; message: string }): void {
    if (!this.process?.stdin?.writable) return;
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, ...(error ? { error } : { result }) };
    this.process.stdin.write(JSON.stringify(response) + '\n');
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

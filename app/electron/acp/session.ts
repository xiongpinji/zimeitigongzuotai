import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acpLog, nowMs } from './acp-log';
import type { AcpClient } from './client';
import type {
  AcpEvent,
  ConnectionStatus,
  InitializeParams,
  InitializeResult,
  NewSessionResult,
  PermissionPolicy,
  PromptInputBlock,
} from './types';

interface PendingPermission {
  resolve: (response: { outcome: { outcome: string; optionId?: string } }) => void;
}

export interface SessionManagerOptions {
  agentType?: string;
  clientCapabilities?: InitializeParams['clientCapabilities'];
  permissionRequestBehavior?: 'interactive' | 'reject';
}

const DEFAULT_CLIENT_CAPABILITIES: InitializeParams['clientCapabilities'] = {
  terminal: true,
  fs: { readTextFile: true, writeTextFile: true },
};

export class SessionManager extends EventEmitter {
  private client: AcpClient;
  private pendingPermissions = new Map<number, PendingPermission>();
  private permissionSeq = 0;
  private permissionPolicy: PermissionPolicy;
  private options: SessionManagerOptions;

  private status: ConnectionStatus = 'disconnected';
  private sessionId: string | null = null;
  private projectDir: string | null = null;
  private initializeResult: InitializeResult | null = null;

  constructor(
    client: AcpClient,
    permissionPolicy: PermissionPolicy,
    options: SessionManagerOptions = {},
  ) {
    super();
    this.client = client;
    this.permissionPolicy = permissionPolicy;
    this.options = options;

    // 监听 client 通知 — ACP 协议中所有事件均通过 session/update 通知传递
    this.client.on('notification', (method: string, params: unknown) => {
      if (method === 'session/update') {
        this.handleSessionUpdate(params);
      }
    });

    this.client.on('disconnected', () => {
      this.log('warn', 'client 报告 disconnected，待处理权限请求将被取消', {
        pendingPermissions: this.pendingPermissions.size,
        sessionId: this.sessionId,
        status: this.status,
      });
      this.setStatus('disconnected');
      // 拒绝所有待处理的权限请求
      for (const [, pending] of this.pendingPermissions) {
        pending.resolve({ outcome: { outcome: 'cancelled' } });
      }
      this.pendingPermissions.clear();
    });
  }

  /** 统一日志入口，自动带上 agentType 上下文以区分 editor / headless-llm 会话。 */
  private log(
    level: 'info' | 'warn' | 'error',
    message: string,
    details?: Record<string, unknown>,
  ): void {
    acpLog(level, 'acp-session', message, {
      agentType: this.options.agentType ?? 'unknown',
      ...details,
    });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getCapabilities(): InitializeResult | null {
    return this.initializeResult;
  }

  setPermissionPolicy(policy: PermissionPolicy): void {
    this.permissionPolicy = policy;
  }

  getPermissionPolicy(): PermissionPolicy {
    return this.permissionPolicy;
  }

  /**
   * 根据策略为权限请求选择自动响应方案。
   * - auto_approve：优先返回 allow_always，降级到 allow_once；都没有则返回 null 走交互流程。
   * - 其它策略：始终返回 null，由 UI 让用户二次确认。
   */
  private autoResolvePermission(
    options: { optionId: string; name: string; kind: string }[],
  ): { outcome: { outcome: 'selected'; optionId: string } } | null {
    if (this.permissionPolicy !== 'auto_approve') return null;
    const preferred =
      options.find((o) => o.kind === 'allow_always') ??
      options.find((o) => o.kind === 'allow_once') ??
      options.find((o) => typeof o.kind === 'string' && o.kind.startsWith('allow'));
    if (!preferred) return null;
    return { outcome: { outcome: 'selected', optionId: preferred.optionId } };
  }

  async connect(
    projectDir: string,
    spawnCommand: string,
    spawnArgs: string[],
    env?: Record<string, string>,
    sessionId?: string | null,
  ): Promise<void> {
    this.projectDir = projectDir;
    this.setStatus('connecting');
    const connectStartedAt = nowMs();
    this.log('info', 'connect 开始', {
      projectDir,
      spawnCommand,
      spawnArgs,
      permissionPolicy: this.permissionPolicy,
      permissionRequestBehavior: this.options.permissionRequestBehavior,
      resumeSessionId: sessionId ?? null,
    });

    // 注册 runtime handlers（仅保留 elicitation 和权限请求）
    this.registerRuntimeHandlers();

    // spawn agent 进程
    this.log('info', 'connect: 开始 spawn agent');
    await this.client.spawn(spawnCommand, spawnArgs, projectDir, env);
    this.log('info', 'connect: spawn 完成，发送 initialize', { spawnMs: nowMs() - connectStartedAt });

    // initialize（protocolVersion 必须为数字）
    this.initializeResult = (await this.client.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: this.options.clientCapabilities ?? DEFAULT_CLIENT_CAPABILITIES,
    })) as InitializeResult;
    this.log('info', 'connect: initialize 完成', {
      elapsedMs: nowMs() - connectStartedAt,
      agentName: this.initializeResult?.agentInfo?.name,
      authMethods: (this.initializeResult as { authMethods?: unknown[] })?.authMethods?.length ?? 0,
    });

    let sessionResult: NewSessionResult;

    if (sessionId) {
      try {
        this.log('info', 'connect: 尝试 session/load 恢复会话', { sessionId });
        sessionResult = (await this.client.sendRequest('session/load', {
          sessionId,
          cwd: projectDir,
          mcpServers: [],
        })) as NewSessionResult;
      } catch (err) {
        // 指定会话恢复失败，回退为新会话
        this.log('warn', 'connect: session/load 失败，回退 session/new', {
          error: err instanceof Error ? err.message : String(err),
        });
        sessionResult = (await this.client.sendRequest('session/new', {
          cwd: projectDir,
          mcpServers: [],
        })) as NewSessionResult;
      }
    } else {
      this.log('info', 'connect: 发送 session/new');
      sessionResult = (await this.client.sendRequest('session/new', {
        cwd: projectDir,
        mcpServers: [],
      })) as NewSessionResult;
    }

    this.sessionId = sessionResult.sessionId;

    if (this.sessionId) {
      this.handleEvent({
        type: 'session_started',
        sessionId: this.sessionId,
      });
    }

    this.setStatus('connected');
    this.log('info', 'connect 完成，会话就绪', {
      sessionId: this.sessionId,
      totalMs: nowMs() - connectStartedAt,
      availableModels: Array.isArray(sessionResult.models?.availableModels)
        ? sessionResult.models?.availableModels?.length
        : undefined,
    });

    // 从 session 结果和 initialize 结果中提取 capabilities
    const capabilities = {
      modes: sessionResult.modes?.availableModes?.map((m: { id: string; name: string; description?: string; decription?: string }) => ({
        modeId: m.id,
        name: m.name,
        description: m.description || m.decription || '',
      })) ?? [],
      configOptions: sessionResult.configOptions ?? [],
      currentModeId: sessionResult.modes?.currentModeId,
      models: sessionResult.models,
      agentInfo: this.initializeResult?.agentInfo,
    };
    this.emit('capabilities', capabilities);
  }

  async sendPrompt(contents: PromptInputBlock[] | unknown[]): Promise<void> {
    if (!this.sessionId) {
      this.log('error', 'sendPrompt 时无活动会话', { status: this.status });
      throw new Error('No active session');
    }
    this.setStatus('prompting');
    // 将 resource 等非标准 block 转换为 ACP 协议支持的 text block
    const prompt = await this.normalizePromptBlocks(contents as unknown[]);
    const promptStartedAt = nowMs();
    const promptChars = JSON.stringify(prompt).length;
    // 注意：session/prompt 用 timeout=0（无超时），turn 结束前会一直阻塞。
    // 若 agent 失联且不发 turn_complete/error，这里会永久挂起 —— 是已知的静默卡死点。
    this.log('warn', 'sendPrompt: 发送 session/prompt（无超时上限，等待 turn 结束）', {
      sessionId: this.sessionId,
      blocks: Array.isArray(prompt) ? prompt.length : 0,
      promptChars,
    });
    let stopReason = 'end_turn';
    let usage: { used: number; size: number } | undefined;
    try {
      // session/prompt 阻塞到 turn 结束，可能需要数分钟，不设超时
      const result = await this.client.sendRequest('session/prompt', {
        sessionId: this.sessionId,
        prompt,
      }, 0);
      const res = result as { stopReason?: string; usage?: { used: number; size: number } } | undefined;
      stopReason = res?.stopReason ?? 'end_turn';
      usage = res?.usage;
      this.log('info', 'sendPrompt: session/prompt 返回', {
        stopReason,
        usage,
        elapsedMs: nowMs() - promptStartedAt,
      });
    } catch (err) {
      stopReason = 'error';
      this.log('error', 'sendPrompt: session/prompt 失败', {
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: nowMs() - promptStartedAt,
      });
      this.emit('event', {
        type: 'error' as const,
        message: err instanceof Error ? err.message : 'Prompt request failed',
      });
    } finally {
      this.handleEvent({
        type: 'turn_complete',
        sessionId: this.sessionId!,
        stopReason,
        agentType: this.options.agentType ?? 'claude-acp',
        usage,
      });
    }
  }

  async cancelTurn(): Promise<void> {
    if (!this.sessionId) {
      this.log('info', 'cancelTurn: 无活动会话，跳过');
      return;
    }
    this.log('warn', 'cancelTurn: 发送 session/cancel', {
      sessionId: this.sessionId,
      pendingPermissions: this.pendingPermissions.size,
    });
    this.client.sendNotification('session/cancel', { sessionId: this.sessionId });
    // 取消所有待处理的权限请求
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.pendingPermissions.clear();
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.sessionId) return;
    await this.client.sendRequest('session/set_mode', {
      sessionId: this.sessionId,
      modeId,
    });
  }

  async setConfigOption(configId: string, valueId: string): Promise<void> {
    if (!this.sessionId) return;
    await this.client.sendRequest('session/set_config_option', {
      sessionId: this.sessionId,
      configId,
      valueId,
    });
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.sessionId) return;
    await this.client.sendRequest('session/set_model', {
      sessionId: this.sessionId,
      modelId,
    });
  }

  async respondPermission(requestId: string, optionId: string): Promise<void> {
    const seq = parseInt(requestId, 10);
    const pending = this.pendingPermissions.get(seq);
    if (!pending) return;
    this.pendingPermissions.delete(seq);
    pending.resolve({ outcome: { outcome: 'selected', optionId } });
  }

  disconnect(): void {
    this.client.disconnect();
    this.sessionId = null;
    this.setStatus('disconnected');
  }

  /**
   * 将前端传来的 prompt blocks 转换为 ACP 协议支持的格式。
   * ACP session/prompt 只接受 text / image 类型，resource 需转为 text。
   */
  private async normalizePromptBlocks(blocks: unknown[]): Promise<unknown[]> {
    const result: unknown[] = [];
    for (const block of blocks) {
      const b = block as Record<string, unknown>;
      if (b.type === 'resource') {
        let textContent = b.text as string | undefined;
        if (!textContent && typeof b.uri === 'string' && b.uri.startsWith('file://')) {
          const filePath = decodeURIComponent(b.uri.slice(7));
          try {
            textContent = await fs.readFile(filePath, 'utf-8');
          } catch {
            textContent = `[无法读取文件: ${filePath}]`;
          }
        }
        if (!textContent && typeof b.blob === 'string') {
          textContent = '[二进制文件附件]';
        }
        const uri = typeof b.uri === 'string' ? b.uri : '';
        const fileName = uri.split('/').pop() || uri;
        result.push({
          type: 'text',
          text: textContent
            ? `<file path="${fileName}">\n${textContent}\n</file>`
            : `[资源: ${uri}]`,
        });
      } else {
        result.push(block);
      }
    }
    return result;
  }

  private registerRuntimeHandlers(): void {
    // ─── 文件系统 handlers ─────────────────────────────────────
    // Claude Code 内置工具的文件操作通过 ACP 协议路由到这些 handler
    if (this.options.clientCapabilities?.fs?.readTextFile !== false) {
      this.client.onRequest('fs/read_text_file', async (params) => {
        const { path: filePath } = params as { path: string };
        const resolved = path.isAbsolute(filePath) ? filePath : path.join(this.projectDir ?? '', filePath);
        try {
          const content = await fs.readFile(resolved, 'utf-8');
          return { content };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Read failed' };
        }
      });
    }

    if (this.options.clientCapabilities?.fs?.writeTextFile !== false) {
      this.client.onRequest('fs/write_text_file', async (params) => {
        const { path: filePath, content } = params as { path: string; content: string };
        const resolved = path.isAbsolute(filePath) ? filePath : path.join(this.projectDir ?? '', filePath);
        try {
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await fs.writeFile(resolved, content, 'utf-8');
          // 通知前端文件已变更
          this.emit('file_changed', { path: resolved, before: null, after: content });
          return { success: true };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Write failed' };
        }
      });
    }

    // ─── 权限请求 ─────────────────────────────────────────────
    // 权限请求 — Agent 发送 session/request_permission 请求，Client 异步返回用户决定
    this.client.onRequest('session/request_permission', async (params) => {
      const { toolCall, options, sessionId } = params as {
        toolCall: unknown;
        options: { optionId: string; name: string; kind: string }[];
        sessionId: string;
      };

      const toolTitle = (toolCall as { title?: string } | undefined)?.title;
      this.log('info', '收到 session/request_permission', {
        behavior: this.options.permissionRequestBehavior,
        policy: this.permissionPolicy,
        toolTitle,
        optionKinds: options.map((o) => o.kind),
      });

      if (this.options.permissionRequestBehavior === 'reject') {
        const rejectOption =
          options.find((o) => o.kind === 'reject_always') ??
          options.find((o) => o.kind === 'reject_once');
        this.log('warn', '权限请求按 reject 策略自动拒绝', {
          toolTitle,
          picked: rejectOption?.kind ?? 'cancelled',
        });
        if (rejectOption) {
          return { outcome: { outcome: 'selected', optionId: rejectOption.optionId } };
        }
        return { outcome: { outcome: 'cancelled' } };
      }

      // auto_approve 策略：直接放行，不弹 UI
      const autoResponse = this.autoResolvePermission(options);
      if (autoResponse) {
        this.log('info', '权限请求按 auto_approve 自动放行', { toolTitle });
        return autoResponse;
      }

      const seq = this.permissionSeq++;
      // 交互模式：等待用户在 UI 上点选，期间该请求会一直 pending（潜在卡点）
      this.log('warn', '权限请求进入等待用户响应（交互模式，pending）', { toolTitle, seq });

      // 通知前端显示权限请求 UI
      this.emit('event', {
        type: 'permission_request',
        requestId: String(seq),
        toolCall,
        options,
        sessionId,
      });

      // 等待用户响应（通过 respondPermission 方法 resolve）
      return new Promise<{ outcome: { outcome: string; optionId?: string } }>((resolve) => {
        this.pendingPermissions.set(seq, { resolve });
      });
    });

    // session/elicitation — Agent 询问用户输入
    this.client.onRequest('session/elicitation', async (_params) => {
      // 暂不支持 elicitation，直接返回取消
      return { action: 'dismiss' };
    });
  }

  private handleEvent(event: AcpEvent): void {
    if (event.type === 'turn_complete') {
      this.setStatus('connected');
    }
    this.emit('event', event);
  }

  /**
   * 处理 ACP session/update 通知 — 将协议格式转换为前端 AcpEvent
   * 通知结构: { sessionId, update: { sessionUpdate: "...", ...data } }
   */
  private handleSessionUpdate(params: unknown): void {
    const data = params as {
      sessionId?: string;
      update?: { sessionUpdate?: string; [key: string]: unknown };
    };
    if (!data?.update) return;

    const { sessionUpdate } = data.update;
    const resolvedSessionId = data.sessionId ?? this.sessionId ?? undefined;

    switch (sessionUpdate) {
      case 'agent_message_chunk': {
        const content = data.update.content as { type: string; text?: string } | undefined;
        if (content?.text) {
          this.handleEvent({ type: 'content_delta', text: content.text, sessionId: resolvedSessionId });
        }
        break;
      }
      case 'agent_thought_chunk': {
        const content = data.update.content as { type: string; text?: string } | undefined;
        if (content?.text) {
          this.handleEvent({ type: 'thinking', text: content.text, sessionId: resolvedSessionId });
        }
        break;
      }
      case 'tool_call': {
        const tc = data.update as {
          toolCallId: string;
          title: string;
          kind?: string;
          status?: string;
          content?: unknown[];
          rawInput?: unknown;
          rawOutput?: unknown;
        };
        this.handleEvent({
          type: 'tool_call',
          toolCallId: tc.toolCallId,
          title: tc.title,
          kind: tc.kind ?? 'unknown',
          status: tc.status ?? 'running',
          content: typeof tc.content === 'string' ? tc.content : undefined,
          rawInput: tc.rawInput != null ? JSON.stringify(tc.rawInput) : undefined,
          rawOutput: tc.rawOutput != null ? JSON.stringify(tc.rawOutput) : undefined,
          sessionId: resolvedSessionId,
        });
        break;
      }
      case 'tool_call_update': {
        const tcu = data.update as {
          toolCallId: string;
          title?: string;
          status?: string;
          content?: unknown[];
          rawInput?: unknown;
          rawOutput?: unknown;
        };
        this.handleEvent({
          type: 'tool_call_update',
          toolCallId: tcu.toolCallId,
          title: tcu.title,
          status: tcu.status,
          content: typeof tcu.content === 'string' ? tcu.content : undefined,
          rawInput: tcu.rawInput != null ? JSON.stringify(tcu.rawInput) : undefined,
          rawOutput: tcu.rawOutput != null ? JSON.stringify(tcu.rawOutput) : undefined,
          sessionId: resolvedSessionId,
        });
        break;
      }
      case 'usage_update': {
        const usage = data.update as { used: number; size: number };
        this.handleEvent({
          type: 'usage',
          used: usage.used,
          size: usage.size,
          sessionId: resolvedSessionId,
        });
        break;
      }
      case 'current_mode_update': {
        this.emit('event', {
          type: 'mode_update',
          currentModeId: data.update.currentModeId,
          sessionId: resolvedSessionId,
        });
        break;
      }
      case 'available_commands_update': {
        this.emit('event', {
          type: 'available_commands',
          commands: data.update.availableCommands,
          sessionId: resolvedSessionId,
        });
        break;
      }
      case 'config_option_update': {
        this.emit('event', {
          type: 'config_update',
          configOptions: data.update.configOptions,
          sessionId: resolvedSessionId,
        });
        break;
      }
      case 'plan': {
        this.emit('event', {
          type: 'plan_update',
          entries: data.update.entries,
          sessionId: resolvedSessionId,
        });
        break;
      }
      case 'user_message_chunk':
        // 用户消息回显，通常忽略
        break;
      default:
        // 未知 sessionUpdate 类型，静默忽略
        break;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit('status', status);
  }
}

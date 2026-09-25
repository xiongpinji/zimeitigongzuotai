import os from 'node:os';
import path from 'node:path';
import { AcpClient } from './client';
import { AgentConfig } from './config';
import { BinaryManager } from './binary-manager';
import { SessionManager } from './session';
import { acpLog, nowMs, ChunkLogThrottle } from './acp-log';
import type { AcpEvent } from './types';

const CONFIG_PATH = path.join(os.homedir(), '.lingji', 'agent-config.json');
const DEFAULT_MODEL_ID = 'claude-code-default';
const DEFAULT_PROJECT_DIR = os.homedir();
const LOG_SCOPE = 'acp-provider';

export type HeadlessAcpProviderEvent =
  | { type: 'content_delta'; text: string }
  | { type: 'thinking'; text: string };

export interface HeadlessAcpProviderRequest {
  requestId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  projectDir?: string | null;
  jsonMode?: boolean;
}

export interface HeadlessAcpProviderResult {
  text: string;
}

export interface HeadlessAcpProviderModel {
  modelId: string;
  name: string;
  description?: string;
}

interface Runtime {
  manager: SessionManager;
  chunks: string[];
  onEvent: (event: AcpEvent | Record<string, unknown>) => void;
  settle: {
    resolve: (result: HeadlessAcpProviderResult) => void;
    reject: (error: Error) => void;
  };
  done: boolean;
  startedAt: number;
  model: string;
  contentThrottle: ChunkLogThrottle;
  thinkingThrottle: ChunkLogThrottle;
  toolCalls: number;
}

type EventSink = (requestId: string, event: HeadlessAcpProviderEvent) => void;

export class HeadlessAcpProvider {
  private readonly config: AgentConfig;
  private readonly binaryManager: BinaryManager;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly eventSink: EventSink;

  constructor(options: {
    config?: AgentConfig;
    binaryManager?: BinaryManager;
    eventSink: EventSink;
  }) {
    this.config = options.config ?? new AgentConfig(CONFIG_PATH);
    this.binaryManager = options.binaryManager ?? new BinaryManager();
    this.eventSink = options.eventSink;
  }

  async runPrompt(input: HeadlessAcpProviderRequest): Promise<HeadlessAcpProviderResult> {
    const runStartedAt = nowMs();
    if (!input.requestId.trim()) {
      throw new Error('缺少 ACP Provider 请求 ID');
    }
    if (this.runtimes.has(input.requestId)) {
      throw new Error(`ACP Provider 请求已存在：${input.requestId}`);
    }

    const totalChars = input.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    acpLog('info', LOG_SCOPE, 'runPrompt 开始', {
      requestId: input.requestId,
      model: input.model,
      projectDir: input.projectDir ?? null,
      jsonMode: Boolean(input.jsonMode),
      messageCount: input.messages.length,
      roles: input.messages.map((m) => m.role),
      totalChars,
      activeRuntimes: this.runtimes.size,
    });

    const configData = await this.config.load();
    const agentEntry = configData.agents['claude-acp'];
    if (agentEntry && agentEntry.enabled === false) {
      acpLog('error', LOG_SCOPE, 'agent 未启用，runPrompt 中止', { requestId: input.requestId });
      throw new Error('Claude Code ACP Agent 未启用，请先在 Claude Code 设置中启用');
    }
    acpLog('info', LOG_SCOPE, '已加载 agent 配置', {
      requestId: input.requestId,
      enabled: agentEntry?.enabled !== false,
      authMode: agentEntry?.authMode,
      configuredModel: agentEntry?.model,
      version: agentEntry?.version,
      apiBaseUrl: agentEntry?.apiBaseUrl,
    });

    const version = agentEntry?.version || '0.25.0';
    const { command, args } = this.binaryManager.getSpawnCommand(version);
    const env = await this.buildEnv(agentEntry);
    const projectDir = input.projectDir?.trim() || DEFAULT_PROJECT_DIR;
    acpLog('info', LOG_SCOPE, '已解析 spawn 命令与环境', {
      requestId: input.requestId,
      command,
      args,
      injectedEnvKeys: Object.keys(env),
      projectDir,
    });
    const manager = new SessionManager(new AcpClient(), 'always_ask', {
      agentType: 'claude-code-acp-provider',
      clientCapabilities: {
        terminal: false,
        fs: { readTextFile: false, writeTextFile: false },
      },
      permissionRequestBehavior: 'reject',
    });

    let runtime: Runtime;
    const resultPromise = new Promise<HeadlessAcpProviderResult>((resolve, reject) => {
      runtime = {
        manager,
        chunks: [],
        onEvent: (event) => this.handleEvent(input.requestId, event, runtime),
        settle: { resolve, reject },
        done: false,
        startedAt: runStartedAt,
        model: input.model,
        contentThrottle: new ChunkLogThrottle(LOG_SCOPE, 'content_delta'),
        thinkingThrottle: new ChunkLogThrottle(LOG_SCOPE, 'thinking'),
        toolCalls: 0,
      };
      manager.on('event', runtime.onEvent);
      this.runtimes.set(input.requestId, runtime);
    });

    try {
      acpLog('info', LOG_SCOPE, 'runPrompt: 开始 connect', { requestId: input.requestId });
      await manager.connect(projectDir, command, args, env);
      acpLog('info', LOG_SCOPE, 'runPrompt: connect 成功，应用模型', {
        requestId: input.requestId,
        connectMs: nowMs() - runStartedAt,
      });
      await this.applyModelIfSupported(manager, input.model);
      acpLog('info', LOG_SCOPE, 'runPrompt: 发送 prompt（之后等待 turn_complete 事件）', {
        requestId: input.requestId,
        preMs: nowMs() - runStartedAt,
      });
      await manager.sendPrompt([{ type: 'text', text: formatPrompt(input.messages, input.jsonMode) }]);
      return await resultPromise;
    } catch (error) {
      acpLog('error', LOG_SCOPE, 'runPrompt: connect/sendPrompt 阶段抛错', {
        requestId: input.requestId,
        elapsedMs: nowMs() - runStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      this.finish(
        input.requestId,
        runtime!,
        normalizeProviderError(error),
      );
      return await resultPromise;
    }
  }

  async cancel(requestId: string): Promise<{ ok: true }> {
    const runtime = this.runtimes.get(requestId);
    if (!runtime) {
      acpLog('info', LOG_SCOPE, 'cancel: 未找到对应 runtime（可能已结束）', { requestId });
      return { ok: true };
    }
    acpLog('warn', LOG_SCOPE, 'cancel: 取消请求', {
      requestId,
      elapsedMs: nowMs() - runtime.startedAt,
      receivedChars: runtime.chunks.join('').length,
    });
    try {
      await runtime.manager.cancelTurn();
    } finally {
      this.finish(requestId, runtime, new Error('Claude Code ACP Provider 请求已取消'));
    }
    return { ok: true };
  }

  listModels(): HeadlessAcpProviderModel[] {
    return [{ modelId: DEFAULT_MODEL_ID, name: DEFAULT_MODEL_ID }];
  }

  private async buildEnv(agentEntry: Awaited<ReturnType<AgentConfig['load']>>['agents'][string] | undefined) {
    const env: Record<string, string> = {};
    if (agentEntry?.authMode === 'custom_api') {
      const apiKey = await this.config.getApiKey('claude-acp');
      if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
      if (agentEntry.apiBaseUrl) env.ANTHROPIC_BASE_URL = agentEntry.apiBaseUrl;
      if (agentEntry.model) env.ANTHROPIC_MODEL = agentEntry.model;
    }
    if (agentEntry?.envText) {
      for (const line of agentEntry.envText.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
        }
      }
    }
    return env;
  }

  private async applyModelIfSupported(manager: SessionManager, model: string): Promise<void> {
    const trimmed = model.trim();
    if (!trimmed || trimmed === DEFAULT_MODEL_ID || typeof manager.setModel !== 'function') {
      return;
    }
    try {
      await manager.setModel(trimmed);
    } catch {
      // 当前 claude-agent-acp 版本未必支持 session/set_model；保持 Claude Code 默认模型继续执行。
    }
  }

  private handleEvent(
    requestId: string,
    rawEvent: AcpEvent | Record<string, unknown>,
    runtime: Runtime,
  ): void {
    const event = rawEvent as Record<string, unknown>;
    const type = String(event.type ?? '');
    if (type === 'content_delta') {
      const text = String(event.text ?? '');
      if (text) {
        runtime.chunks.push(text);
        runtime.contentThrottle.record(text.length);
        this.eventSink(requestId, { type: 'content_delta', text });
      }
      return;
    }
    if (type === 'thinking') {
      const text = String(event.text ?? '');
      if (text) {
        runtime.thinkingThrottle.record(text.length);
        this.eventSink(requestId, { type: 'thinking', text });
      }
      return;
    }
    if (type === 'tool_call' || type === 'tool_call_update') {
      runtime.toolCalls += type === 'tool_call' ? 1 : 0;
      acpLog('info', LOG_SCOPE, `agent ${type}`, {
        requestId,
        title: event.title,
        kind: event.kind,
        status: event.status,
        elapsedMs: nowMs() - runtime.startedAt,
      });
      return;
    }
    if (type === 'usage') {
      acpLog('info', LOG_SCOPE, 'agent usage 更新', {
        requestId,
        used: event.used,
        size: event.size,
      });
      return;
    }
    if (type === 'error') {
      acpLog('error', LOG_SCOPE, 'agent error 事件', {
        requestId,
        message: event.message,
        elapsedMs: nowMs() - runtime.startedAt,
      });
      this.finish(requestId, runtime, new Error(String(event.message ?? 'Claude Code ACP Provider 调用失败')));
      return;
    }
    if (type === 'turn_complete') {
      const stopReason = String(event.stopReason ?? 'end_turn');
      acpLog(stopReason === 'error' ? 'error' : 'info', LOG_SCOPE, 'agent turn_complete', {
        requestId,
        stopReason,
        usage: event.usage,
        elapsedMs: nowMs() - runtime.startedAt,
        contentChunks: runtime.contentThrottle.summary().chunks,
        thinkingChunks: runtime.thinkingThrottle.summary().chunks,
        toolCalls: runtime.toolCalls,
      });
      if (stopReason === 'error') {
        this.finish(requestId, runtime, new Error('Claude Code ACP Provider 调用失败'));
        return;
      }
      this.finish(requestId, runtime);
    }
  }

  private finish(requestId: string, runtime: Runtime, error?: Error): void {
    if (runtime.done) return;
    runtime.done = true;
    runtime.manager.off('event', runtime.onEvent);
    runtime.manager.disconnect();
    this.runtimes.delete(requestId);
    const fullText = runtime.chunks.join('');
    if (error) {
      acpLog('error', LOG_SCOPE, 'runPrompt 结束（失败）', {
        requestId,
        error: error.message,
        elapsedMs: nowMs() - runtime.startedAt,
        receivedChars: fullText.length,
        contentChunks: runtime.contentThrottle.summary().chunks,
        thinkingChunks: runtime.thinkingThrottle.summary().chunks,
      });
      runtime.settle.reject(error);
      return;
    }
    acpLog('info', LOG_SCOPE, 'runPrompt 结束（成功）', {
      requestId,
      elapsedMs: nowMs() - runtime.startedAt,
      outputChars: fullText.length,
      empty: fullText.length === 0,
      contentChunks: runtime.contentThrottle.summary().chunks,
      thinkingChunks: runtime.thinkingThrottle.summary().chunks,
      toolCalls: runtime.toolCalls,
    });
    runtime.settle.resolve({ text: fullText });
  }
}

function formatPrompt(
  messages: Array<{ role: string; content: string }>,
  jsonMode?: boolean,
): string {
  const body = messages
    .map((message) => {
      const role = message.role === 'system'
        ? 'System'
        : message.role === 'assistant'
          ? 'Assistant'
          : 'User';
      return `<${role}>\n${message.content}\n</${role}>`;
    })
    .join('\n\n');

  if (!jsonMode) return body;
  return `${body}\n\n请严格只输出一个完整 JSON 对象，不要使用 Markdown 代码块，不要追加解释文字。`;
}

function normalizeProviderError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|failed to spawn/i.test(message)) {
    return new Error('未找到 Claude Code ACP 运行时，请先在 Claude Code 设置中安装并启用');
  }
  if (/Agent process exited|Client disconnected/i.test(message)) {
    return new Error(`Claude Code ACP 进程已退出：${message}`);
  }
  return error instanceof Error ? error : new Error(message);
}

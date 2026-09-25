import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import type { ClaudeCodeAcpLLMRunRequest } from '../electron-api';

export const CLAUDE_CODE_ACP_DEFAULT_MODEL = 'claude-code-default';

type AcpChunk =
  | { content: string }
  | { content: { reasoning_content: string } };

type Runtime = Pick<
  Window['electronAPI'],
  | 'runClaudeCodeAcpLLM'
  | 'cancelClaudeCodeAcpLLM'
  | 'onClaudeCodeAcpLLMEvent'
>;

let injectedRuntime: Runtime | null = null;

export function setClaudeCodeAcpRuntime(runtime: Runtime | null): void {
  injectedRuntime = runtime;
}

export interface ClaudeCodeAcpChatModelOptions {
  model: string;
  projectDir?: string | null;
  jsonMode?: boolean;
  runtime?: Runtime;
}

export class ClaudeCodeAcpChatModel {
  private readonly model: string;
  private readonly projectDir: string | null;
  private readonly jsonMode: boolean;
  private readonly runtime?: Runtime;

  constructor(options: ClaudeCodeAcpChatModelOptions) {
    this.model = options.model || CLAUDE_CODE_ACP_DEFAULT_MODEL;
    this.projectDir = options.projectDir ?? null;
    this.jsonMode = options.jsonMode ?? false;
    this.runtime = options.runtime;
  }

  bind(kwargs: Record<string, unknown>): ClaudeCodeAcpChatModel {
    const responseFormat = kwargs.response_format as { type?: string } | undefined;
    return new ClaudeCodeAcpChatModel({
      model: this.model,
      projectDir: this.projectDir,
      jsonMode: this.jsonMode || responseFormat?.type === 'json_object',
      runtime: this.runtime,
    });
  }

  async invoke(messages: unknown[]): Promise<AIMessage> {
    const stream = await this.stream(messages);
    const chunks: AcpChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const content = chunks
      .map((chunk) => (typeof chunk.content === 'string' ? chunk.content : ''))
      .join('');
    return new AIMessage(content);
  }

  async stream(messages: unknown[]): Promise<AsyncIterable<AcpChunk>> {
    const runtime = this.resolveRuntime();
    const requestId = createRequestId();
    return createRuntimeStream(runtime, {
      requestId,
      model: this.model,
      projectDir: this.projectDir,
      jsonMode: this.jsonMode,
      messages: normalizeMessages(messages),
    });
  }

  private resolveRuntime(): Runtime {
    const runtime = this.runtime ?? injectedRuntime ?? globalThis.window?.electronAPI;
    if (
      !runtime?.runClaudeCodeAcpLLM ||
      !runtime.cancelClaudeCodeAcpLLM ||
      !runtime.onClaudeCodeAcpLLMEvent
    ) {
      throw new Error('Claude Code ACP Provider 仅支持在 Electron 运行时使用');
    }
    return runtime;
  }
}

function createRuntimeStream(
  runtime: Runtime,
  request: ClaudeCodeAcpLLMRunRequest,
): AsyncIterable<AcpChunk> {
  const queue: AcpChunk[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<AcpChunk>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let done = false;
  let error: unknown = null;
  let sawText = false;
  let unsubscribe: () => void = () => undefined;

  const flush = () => {
    while (waiters.length > 0 && queue.length > 0) {
      waiters.shift()!.resolve({ value: queue.shift()!, done: false });
    }
    if (waiters.length === 0 || !done) return;
    const pending = waiters.splice(0);
    for (const waiter of pending) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve({ value: undefined, done: true });
      }
    }
  };

  const push = (chunk: AcpChunk) => {
    if (done) return;
    if (typeof chunk.content === 'string') sawText = true;
    queue.push(chunk);
    flush();
  };

  const finish = (err?: unknown) => {
    if (done) return;
    done = true;
    error = err ?? null;
    unsubscribe();
    flush();
  };

  unsubscribe = runtime.onClaudeCodeAcpLLMEvent((payload) => {
    if (payload.requestId !== request.requestId) return;
    if (payload.event.type === 'content_delta') {
      push({ content: payload.event.text });
      return;
    }
    push({ content: { reasoning_content: payload.event.text } });
  });

  void runtime.runClaudeCodeAcpLLM(request).then(
    (result) => {
      if (!sawText && result.text) {
        push({ content: result.text });
      }
      finish();
    },
    (err) => finish(err),
  );

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<AcpChunk>> {
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          if (done) {
            if (error) throw error;
            return { value: undefined, done: true };
          }
          return new Promise<IteratorResult<AcpChunk>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
        async return(): Promise<IteratorResult<AcpChunk>> {
          await runtime.cancelClaudeCodeAcpLLM(request.requestId).catch(() => undefined);
          finish();
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `claude-acp-${crypto.randomUUID()}`;
  }
  return `claude-acp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeMessages(messages: unknown[]): ClaudeCodeAcpLLMRunRequest['messages'] {
  return messages.map((message) => {
    const record = message as Partial<BaseMessage> & Record<string, unknown>;
    const role = inferRole(record);
    const content = extractMessageContent(record.content);
    return { role, content };
  });
}

function inferRole(message: Record<string, unknown>): string {
  const direct = message.role;
  if (typeof direct === 'string') return direct;
  const type = message._getType;
  if (typeof type === 'function') {
    const value = type.call(message);
    if (value === 'system') return 'system';
    if (value === 'ai') return 'assistant';
  }
  const name = message.constructor && typeof message.constructor === 'function'
    ? message.constructor.name
    : '';
  if (/system/i.test(name)) return 'system';
  if (/ai|assistant/i.test(name)) return 'assistant';
  return 'user';
}

function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(extractMessageContent).join('');
  }
  if (!content || typeof content !== 'object') return '';
  const record = content as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if ('content' in record) return extractMessageContent(record.content);
  return '';
}

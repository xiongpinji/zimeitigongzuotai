import { describe, expect, it, vi } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ClaudeCodeAcpChatModel } from '../src/lib/llm/claude-code-acp-model';

function createRuntime() {
  const listeners: Array<(payload: { requestId: string; event: any }) => void> = [];
  const runClaudeCodeAcpLLM = vi.fn(async (request: { requestId: string }) => {
    listeners.forEach((listener) =>
      listener({ requestId: request.requestId, event: { type: 'thinking', text: '思考' } }),
    );
    listeners.forEach((listener) =>
      listener({ requestId: request.requestId, event: { type: 'content_delta', text: '你' } }),
    );
    listeners.forEach((listener) =>
      listener({ requestId: request.requestId, event: { type: 'content_delta', text: '好' } }),
    );
    return { text: '你好' };
  });
  const cancelClaudeCodeAcpLLM = vi.fn(async () => ({ ok: true as const }));
  const onClaudeCodeAcpLLMEvent = vi.fn((listener) => {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  });
  return { runClaudeCodeAcpLLM, cancelClaudeCodeAcpLLM, onClaudeCodeAcpLLMEvent };
}

describe('ClaudeCodeAcpChatModel', () => {
  it('streams ACP content and thinking chunks through the Electron runtime', async () => {
    const runtime = createRuntime();
    const model = new ClaudeCodeAcpChatModel({ model: 'claude-code-default', runtime });

    const stream = await model.stream([new SystemMessage('sys'), new HumanMessage('ping')]);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: { reasoning_content: '思考' } },
      { content: '你' },
      { content: '好' },
    ]);
    expect(runtime.runClaudeCodeAcpLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-code-default',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'ping' },
        ],
      }),
    );
  });

  it('invoke collects only text chunks into an AIMessage', async () => {
    const runtime = createRuntime();
    const model = new ClaudeCodeAcpChatModel({ model: 'claude-code-default', runtime });

    const message = await model.invoke([new HumanMessage('ping')]);

    expect(message.content).toBe('你好');
  });

  it('bind enables JSON mode without losing runtime wiring', async () => {
    const runtime = createRuntime();
    const model = new ClaudeCodeAcpChatModel({ model: 'claude-code-default', runtime });
    const bound = model.bind({ response_format: { type: 'json_object' } });

    await bound.invoke([new HumanMessage('json')]);

    expect(runtime.runClaudeCodeAcpLLM).toHaveBeenCalledWith(
      expect.objectContaining({ jsonMode: true }),
    );
  });

  it('throws a clear error outside Electron runtime', async () => {
    const model = new ClaudeCodeAcpChatModel({ model: 'claude-code-default' });

    await expect(model.invoke([new HumanMessage('ping')])).rejects.toThrow(/Electron/);
  });

  it('cancels ACP turn when stream iterator is returned early', async () => {
    const runtime = createRuntime();
    runtime.runClaudeCodeAcpLLM.mockImplementation(
      () => new Promise(() => undefined),
    );
    const model = new ClaudeCodeAcpChatModel({ model: 'claude-code-default', runtime });

    const stream = await model.stream([new HumanMessage('ping')]);
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.return?.();

    expect(runtime.cancelClaudeCodeAcpLLM).toHaveBeenCalledTimes(1);
  });
});

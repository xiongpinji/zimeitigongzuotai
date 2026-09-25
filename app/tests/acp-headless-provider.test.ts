import { describe, expect, it, vi } from 'vitest';
import { HeadlessAcpProvider } from '../electron/acp/headless-provider';

const { MockAcpClient, clientInstances, mockClientState } = vi.hoisted(() => {
  const instances: MockAcpClient[] = [];
  const state: { spawnError: Error | null } = { spawnError: null };

  class MockAcpClient {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    spawn = vi.fn(async () => {
      if (state.spawnError) {
        const error = state.spawnError;
        state.spawnError = null;
        throw error;
      }
    });
    sendNotification = vi.fn();
    requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
    sendRequest = vi.fn(async (method: string) => {
      if (method === 'initialize') {
        return { protocolVersion: 1, agentInfo: { name: 'mock-agent' } };
      }
      if (method === 'session/new') {
        return {
          sessionId: 'session-1',
          configOptions: [],
          modes: { currentModeId: 'code', availableModes: [] },
        };
      }
      if (method === 'session/prompt') {
        this.emit('notification', 'session/update', {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: '想一下' },
          },
        });
        this.emit('notification', 'session/update', {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: '你好' },
          },
        });
        return { stopReason: 'end_turn' };
      }
      return {};
    });

    constructor() {
      instances.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => void): void {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }

    onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
      this.requestHandlers.set(method, handler);
    }

    disconnect(): void {
      this.emit('disconnected');
    }
  }

  return { MockAcpClient, clientInstances: instances, mockClientState: state };
});

class MockConfig {
  constructor(private readonly data = { agents: {}, permissionPolicy: 'tiered' }) {}

  load = vi.fn(async () => this.data);
  getApiKey = vi.fn(async () => 'sk-test');
}

class MockBinaryManager {
  getSpawnCommand = vi.fn(() => ({ command: 'claude-agent-acp', args: [] }));
}

vi.mock('../electron/acp/client', () => ({ AcpClient: MockAcpClient }));

function createProvider(options: { config?: MockConfig; binaryManager?: MockBinaryManager } = {}) {
  const events: Array<{ requestId: string; event: unknown }> = [];
  const provider = new HeadlessAcpProvider({
    config: (options.config ?? new MockConfig()) as never,
    binaryManager: (options.binaryManager ?? new MockBinaryManager()) as never,
    eventSink: (requestId, event) => events.push({ requestId, event }),
  });
  return { provider, events };
}

describe('HeadlessAcpProvider', () => {
  it('runs a prompt in restricted headless ACP mode and returns collected text', async () => {
    clientInstances.length = 0;
    const { provider, events } = createProvider();

    const result = await provider.runPrompt({
      requestId: 'r1',
      model: 'claude-code-default',
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(result).toEqual({ text: '你好' });
    expect(events).toEqual([
      { requestId: 'r1', event: { type: 'thinking', text: '想一下' } },
      { requestId: 'r1', event: { type: 'content_delta', text: '你好' } },
    ]);

    const client = clientInstances[0];
    expect(client.sendRequest).toHaveBeenCalledWith('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        terminal: false,
        fs: { readTextFile: false, writeTextFile: false },
      },
    });
    expect(client.requestHandlers.has('fs/read_text_file')).toBe(false);
    expect(client.requestHandlers.has('fs/write_text_file')).toBe(false);
  });

  it('rejects permission requests instead of surfacing interactive UI', async () => {
    clientInstances.length = 0;
    const { provider } = createProvider();

    await provider.runPrompt({
      requestId: 'r2',
      model: 'claude-code-default',
      messages: [{ role: 'user', content: 'ping' }],
    });

    const handler = clientInstances[0].requestHandlers.get('session/request_permission');
    await expect(
      handler?.({
        sessionId: 'session-1',
        toolCall: {},
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      }),
    ).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'deny' } });
  });

  it('tries to set a non-default ACP model when requested', async () => {
    clientInstances.length = 0;
    const { provider } = createProvider();

    await provider.runPrompt({
      requestId: 'r3',
      model: 'sonnet-custom',
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(clientInstances[0].sendRequest).toHaveBeenCalledWith('session/set_model', {
      sessionId: 'session-1',
      modelId: 'sonnet-custom',
    });
  });

  it('adds strict JSON instruction when JSON mode is bound by the adapter', async () => {
    clientInstances.length = 0;
    const { provider } = createProvider();

    await provider.runPrompt({
      requestId: 'r4',
      model: 'claude-code-default',
      jsonMode: true,
      messages: [{ role: 'user', content: '给我 JSON' }],
    });

    expect(clientInstances[0].sendRequest).toHaveBeenCalledWith(
      'session/prompt',
      expect.objectContaining({
        prompt: [
          expect.objectContaining({
            text: expect.stringContaining('请严格只输出一个完整 JSON 对象'),
          }),
        ],
      }),
      0,
    );
  });

  it('returns a readable error when the ACP binary is unavailable', async () => {
    clientInstances.length = 0;
    const { provider } = createProvider();
    mockClientState.spawnError = new Error('spawn claude-agent-acp ENOENT');

    await expect(
      provider.runPrompt({
        requestId: 'r5',
        model: 'claude-code-default',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    ).rejects.toThrow('未找到 Claude Code ACP 运行时');
  });
});

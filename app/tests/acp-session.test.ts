import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { SessionManager } from '../electron/acp/session';

class MockAcpClient extends EventEmitter {
  spawn = vi.fn(async () => {});
  sendNotification = vi.fn();
  requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
  sendRequest = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        agentInfo: { name: 'mock-agent' },
      };
    }

    if (method === 'session/new') {
      return {
        sessionId: 'new-session-id',
        configOptions: [],
        modes: { currentModeId: 'code', availableModes: [] },
      };
    }

    if (method === 'session/load') {
      const payload = params as { sessionId?: string };
      if (payload.sessionId === 'resume-session-id') {
        return {
          sessionId: payload.sessionId,
          configOptions: [],
          modes: { currentModeId: 'code', availableModes: [] },
        };
      }
      throw new Error('session not found');
    }

    return {};
  });

  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
    this.requestHandlers.set(method, handler);
  }
}

describe('SessionManager', () => {
  let client: MockAcpClient;

  beforeEach(() => {
    client = new MockAcpClient();
  });

  it('starts a fresh session by default instead of implicit project resume', async () => {
    const manager = new SessionManager(client as never, 'tiered');

    await manager.connect('/tmp/project', 'node', ['mock-agent.cjs']);

    expect(client.sendRequest).toHaveBeenCalledWith('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        terminal: true,
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
    expect(client.sendRequest).toHaveBeenCalledWith('session/new', {
      cwd: '/tmp/project',
      mcpServers: [],
    });
    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'session/load',
      expect.anything(),
    );
    expect(manager.getSessionId()).toBe('new-session-id');
  });

  it('loads an explicit session id and emits session_started', async () => {
    const manager = new SessionManager(client as never, 'tiered');
    const events: unknown[] = [];

    manager.on('event', (event) => {
      events.push(event);
    });

    await manager.connect(
      '/tmp/project',
      'node',
      ['mock-agent.cjs'],
      undefined,
      'resume-session-id',
    );

    expect(client.sendRequest).toHaveBeenCalledWith('session/load', {
      sessionId: 'resume-session-id',
      cwd: '/tmp/project',
      mcpServers: [],
    });
    expect(events).toContainEqual({
      type: 'session_started',
      sessionId: 'resume-session-id',
    });
    expect(manager.getSessionId()).toBe('resume-session-id');
  });

  it('falls back to session/new when explicit resume fails', async () => {
    const manager = new SessionManager(client as never, 'tiered');

    await manager.connect(
      '/tmp/project',
      'node',
      ['mock-agent.cjs'],
      undefined,
      'missing-session-id',
    );

    expect(client.sendRequest).toHaveBeenCalledWith('session/load', {
      sessionId: 'missing-session-id',
      cwd: '/tmp/project',
      mcpServers: [],
    });
    expect(client.sendRequest).toHaveBeenCalledWith('session/new', {
      cwd: '/tmp/project',
      mcpServers: [],
    });
    expect(manager.getSessionId()).toBe('new-session-id');
  });

  it('attaches sessionId to session/update derived events', async () => {
    const manager = new SessionManager(client as never, 'tiered');
    const events: unknown[] = [];

    manager.on('event', (event) => {
      events.push(event);
    });

    await manager.connect('/tmp/project', 'node', ['mock-agent.cjs']);

    client.emit('notification', 'session/update', {
      sessionId: 'new-session-id',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    });
    client.emit('notification', 'session/update', {
      sessionId: 'new-session-id',
      update: {
        sessionUpdate: 'usage_update',
        used: 12,
        size: 128,
      },
    });

    expect(events).toContainEqual({
      type: 'content_delta',
      text: 'hello',
      sessionId: 'new-session-id',
    });
    expect(events).toContainEqual({
      type: 'usage',
      used: 12,
      size: 128,
      sessionId: 'new-session-id',
    });
  });

  it('can connect with restricted client capabilities for headless provider use', async () => {
    const manager = new SessionManager(client as never, 'always_ask', {
      clientCapabilities: {
        terminal: false,
        fs: { readTextFile: false, writeTextFile: false },
      },
      permissionRequestBehavior: 'reject',
    });

    await manager.connect('/tmp/project', 'node', ['mock-agent.cjs']);

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
});

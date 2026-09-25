import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { AcpClient } from '../electron/acp/client';

let mockScriptPath: string;
let tmpDir: string;
let clients: AcpClient[] = [];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-client-test-'));
  clients = [];
  mockScriptPath = path.join(tmpDir, 'mock-agent.cjs');
  await fs.writeFile(
    mockScriptPath,
    `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: 'latest',
          serverCapabilities: {
            prompting: { modes: [{ modeId: 'code', name: 'Code' }], configOptions: [] },
          },
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (msg.method === 'session/new') {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'test-session' } }) + '\\n',
      );
    } else if (msg.method === 'prompt') {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'session/event', params: { type: 'content_delta', text: 'Hello' } }) + '\\n',
      );
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'session/event', params: { type: 'turn_complete', sessionId: 'test-session', stopReason: 'end', agentType: 'claude' } }) + '\\n',
      );
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\\n',
      );
    } else if (msg.method === 'echo_request') {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: 9999, method: 'read_text_file', params: { path: '/test.txt' } }) + '\\n',
      );
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { forwarded: true } }) + '\\n',
      );
    } else {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n',
      );
    }
  } catch {}
});
`,
    'utf-8',
  );
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.disconnectAndWait()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function createClient(options?: ConstructorParameters<typeof AcpClient>[0]): AcpClient {
  const client = new AcpClient(options);
  clients.push(client);
  return client;
}

describe('AcpClient', () => {
  it('sends a request and receives a response', async () => {
    const client = createClient();
    await client.spawn('node', [mockScriptPath], tmpDir);

    const result = await client.sendRequest('initialize', {
      protocolVersion: 'latest',
      clientCapabilities: { terminal: true, fs: { readTextFile: true, writeTextFile: true } },
    });

    expect(result).toHaveProperty('protocolVersion', 'latest');
    expect(result).toHaveProperty('serverCapabilities');
    await client.disconnectAndWait();
  });

  it('receives notifications as events', async () => {
    const client = createClient();
    await client.spawn('node', [mockScriptPath], tmpDir);

    await client.sendRequest('initialize', {
      protocolVersion: 'latest',
      clientCapabilities: { terminal: true, fs: { readTextFile: true, writeTextFile: true } },
    });

    const events: unknown[] = [];
    client.on('notification', (method: string, params: unknown) => {
      events.push({ method, params });
    });

    await client.sendRequest('prompt', {
      sessionId: 'test-session',
      contents: [{ type: 'text', text: 'hi' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toHaveProperty('method', 'session/event');
    await client.disconnectAndWait();
  });

  it('handles request handlers (Agent→Client)', async () => {
    const client = createClient();
    await client.spawn('node', [mockScriptPath], tmpDir);

    client.onRequest('read_text_file', async (params: unknown) => {
      const p = params as { path: string };
      return { content: `content of ${p.path}` };
    });

    await client.sendRequest('echo_request', {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    await client.disconnectAndWait();
  });

  it('rejects on timeout', async () => {
    const client = createClient({ requestTimeout: 100 });
    const silentScript = path.join(tmpDir, 'silent.cjs');
    await fs.writeFile(silentScript, 'process.stdin.resume();', 'utf-8');
    await client.spawn('node', [silentScript], tmpDir);

    await expect(client.sendRequest('initialize', {})).rejects.toThrow(/timeout/i);
    await client.disconnectAndWait();
  });

  it('emits disconnected on process exit', async () => {
    const client = createClient();
    const exitScript = path.join(tmpDir, 'exit.cjs');
    await fs.writeFile(exitScript, 'process.exit(1);', 'utf-8');

    let disconnected = false;
    client.on('disconnected', () => { disconnected = true; });

    await client.spawn('node', [exitScript], tmpDir);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(disconnected).toBe(true);
  });
});

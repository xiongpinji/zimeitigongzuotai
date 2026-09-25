// tests/cli-endpoint.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveServerUrl } from '../cli/src/endpoint';

describe('resolveServerUrl', () => {
  it('prefers --server flag and appends /mcp when missing', () => {
    expect(resolveServerUrl({ serverFlag: 'http://127.0.0.1:9000', env: {}, endpointFile: '/no' }))
      .toBe('http://127.0.0.1:9000/mcp');
    expect(resolveServerUrl({ serverFlag: 'http://127.0.0.1:9000/mcp', env: {}, endpointFile: '/no' }))
      .toBe('http://127.0.0.1:9000/mcp');
  });

  it('falls back to LINGJI_MCP_URL env', () => {
    expect(resolveServerUrl({ env: { LINGJI_MCP_URL: 'http://h:1/mcp' }, endpointFile: '/no' }))
      .toBe('http://h:1/mcp');
  });

  it('reads url from endpoint file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-rf-'));
    const file = path.join(dir, 'mcp-endpoint.json');
    try {
      writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:7777/mcp', port: 7777 }));
      expect(resolveServerUrl({ env: {}, endpointFile: file })).toBe('http://127.0.0.1:7777/mcp');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to 19820 when nothing else resolves', () => {
    expect(resolveServerUrl({ env: {}, endpointFile: '/definitely/missing' }))
      .toBe('http://127.0.0.1:19820/mcp');
  });
});

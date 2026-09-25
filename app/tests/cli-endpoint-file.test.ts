import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeEndpointFile, removeEndpointFile } from '../electron/mcp/endpoint-file';
import { readFileSync as readSrc } from 'node:fs';

describe('endpoint-file', () => {
  it('writes endpoint json with url/port/pid/startedAt then removes it', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-ep-'));
    const file = path.join(dir, 'sub', 'mcp-endpoint.json');
    try {
      await writeEndpointFile(19820, file);
      expect(existsSync(file)).toBe(true);
      const info = JSON.parse(readFileSync(file, 'utf-8'));
      expect(info.url).toBe('http://127.0.0.1:19820/mcp');
      expect(info.port).toBe(19820);
      expect(typeof info.pid).toBe('number');
      expect(typeof info.startedAt).toBe('number');
      await removeEndpointFile(file);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removeEndpointFile is a no-op when file missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-ep-'));
    try {
      await expect(removeEndpointFile(path.join(dir, 'nope.json'))).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('server.ts endpoint wiring', () => {
  it('startMcpServer writes and stopMcpServer removes the endpoint file', () => {
    const src = readSrc(new URL('../electron/mcp/server.ts', import.meta.url), 'utf8');
    expect(src).toContain("from './endpoint-file'");
    expect(src).toContain('writeEndpointFile(');
    expect(src).toContain('removeEndpointFile(');
  });
});

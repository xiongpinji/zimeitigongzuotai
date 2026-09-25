import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { registerPipelineMcpTools } from '../electron/pipeline/tools/register';

class FakeMcpServer {
  tools = new Map<string, { def: unknown; handler: (args: unknown) => unknown }>();
  registerTool(name: string, def: unknown, handler: (args: unknown) => unknown): void {
    this.tools.set(name, { def, handler });
  }
}

describe('lingji_list_recent_projects', () => {
  it('returns recent projects from userData recent-projects.json', async () => {
    const userData = mkdtempSync(path.join(os.tmpdir(), 'lingji-ud-'));
    // 同时建一个真实项目目录，loadRecentProjects 会过滤掉不存在的 path
    const proj = mkdtempSync(path.join(os.tmpdir(), 'lingji-proj-'));
    try {
      writeFileSync(
        path.join(userData, 'recent-projects.json'),
        JSON.stringify([{ path: proj, name: 'demo', lastOpenedAt: 1 }]),
      );
      const server = new FakeMcpServer();
      registerPipelineMcpTools(
        server as unknown as Parameters<typeof registerPipelineMcpTools>[0],
        () => null,
        () => userData,
      );
      const handler = server.tools.get('lingji_list_recent_projects')!.handler;
      const result = (await handler({})) as { content: { text: string }[] };
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('demo');
      expect(parsed[0].path).toBe(proj);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

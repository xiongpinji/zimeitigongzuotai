import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { emitProjectUpdated, registerGenerationTool } from '../electron/pipeline/headless-generation';
import { getPipelineService } from '../electron/pipeline';

class FakeMcpServer {
  tools = new Map<string, { def: unknown; handler: (args: unknown) => unknown }>();
  registerTool(name: string, def: unknown, handler: (args: unknown) => unknown): void {
    this.tools.set(name, { def, handler });
  }
}

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-hg-'));
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, createdAt: 'x', updatedAt: 'x', timeline: null,
    aiAnalysis: { analysisResult: null, coverCandidates: [] },
    script: { templateId: 'x', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 },
  }));
  return dir;
}

describe('emitProjectUpdated', () => {
  it('sends pipeline:project-updated with payload', () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const win = { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    emitProjectUpdated(() => win as never, '/p', ['timeline']);
    expect(sent[0].channel).toBe('pipeline:project-updated');
    expect(sent[0].payload).toEqual({ projectPath: '/p', sections: ['timeline'] });
  });

  it('is a no-op when window is null', () => {
    expect(() => emitProjectUpdated(() => null, '/p', ['timeline'])).not.toThrow();
  });
});

describe('registerGenerationTool', () => {
  it('registers the tool and returns a taskId; run executes and emits update', async () => {
    const dir = tmpProject();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const win = { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    const server = new FakeMcpServer();
    let ran = false;
    registerGenerationTool(server as never, () => win as never, () => dir, {
      name: 'lingji_test_gen',
      title: 't', description: 'd', kind: 'tts', sections: ['timeline'],
      run: async () => { ran = true; return { ok: true }; },
    });
    try {
      const handler = server.tools.get('lingji_test_gen')!.handler;
      const res = (await handler({ projectPath: dir })) as { content: { text: string }[] };
      const parsed = JSON.parse(res.content[0].text);
      expect(typeof parsed.taskId).toBe('string');
      // 等待后台 run 结算
      await getPipelineService().waitForSettle(parsed.taskId);
      expect(ran).toBe(true);
      const task = getPipelineService().getTask(parsed.taskId)!;
      expect(task.status).toBe('succeeded');
      expect(task.result).toEqual({ ok: true });
      expect(sent.find((s) => s.channel === 'pipeline:project-updated')).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns structured error on invalid project path', async () => {
    const server = new FakeMcpServer();
    registerGenerationTool(server as never, () => null, () => '/tmp', {
      name: 'lingji_test_gen2', title: 't', description: 'd', kind: 'tts', sections: [],
      run: async () => ({}),
    });
    const handler = server.tools.get('lingji_test_gen2')!.handler;
    const res = (await handler({ projectPath: '/definitely/missing/xyz' })) as { content: { text: string }[]; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0].text);
    expect(typeof parsed.error).toBe('string');
  });
});

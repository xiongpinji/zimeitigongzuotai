import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSonarHttp } from '../electron/sonar/routes';
import { createSonarInboxStore } from '../electron/sonar/inbox-store';

/**
 * 真实 HTTP 往返集成测试：用 server.ts 同款 glue（handleSonarHttp）起一个真实 http server，
 * 经 fetch 打到端点，验证 header 大小写 / body 解析 / 状态码 / 文件持久化全链路。
 */
const TOKEN = 'integration-token';

function validBody(awemeId = 'aweme-1') {
  return {
    source: 'douyin',
    awemeId,
    creatorId: 'c1',
    creatorName: '博主',
    title: '标题',
    url: `https://www.douyin.com/video/${awemeId}`,
    publishedAt: 1_700_000_000_000,
    transcript: { fullText: '转录', srtText: 'srt', segments: [{ text: '转录', startMs: 0, endMs: 1000 }] },
  };
}

describe('sonar HTTP 集成（真实 http server）', () => {
  let server: Server;
  let base: string;
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sonar-http-'));
    file = path.join(dir, 'inbox.json');
    const store = createSonarInboxStore({ file });
    server = createServer((req, res) => {
      void handleSonarHttp(req, res, { store, expectedToken: TOKEN, version: '1.0.0' });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /sonar/health → 200 ok', async () => {
    const res = await fetch(`${base}/sonar/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: 'lingji-editor' });
  });

  it('POST /sonar/enqueue 正确 token → 200 并落盘', async () => {
    const res = await fetch(`${base}/sonar/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sonar-token': TOKEN },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: true, duplicate: false });
    const persisted = JSON.parse(readFileSync(file, 'utf-8'));
    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0].awemeId).toBe('aweme-1');
  });

  it('错误 token → 401，不落盘', async () => {
    const res = await fetch(`${base}/sonar/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sonar-token': 'wrong' },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(401);
  });

  it('同 awemeId 二次推送 → duplicate', async () => {
    const post = () =>
      fetch(`${base}/sonar/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sonar-token': TOKEN },
        body: JSON.stringify(validBody('dup')),
      });
    await post();
    const res = await post();
    expect((await res.json()).duplicate).toBe(true);
  });

  it('非法 JSON body → 400', async () => {
    const res = await fetch(`${base}/sonar/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sonar-token': TOKEN },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });

  it('GET /sonar/enqueue → 405', async () => {
    const res = await fetch(`${base}/sonar/enqueue`);
    expect(res.status).toBe(405);
  });
});

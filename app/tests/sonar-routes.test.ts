import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSonarRequest, type SonarRouteDeps } from '../electron/sonar/routes';
import { createSonarInboxStore, type SonarEnqueueInput } from '../electron/sonar/inbox-store';

const TOKEN = 'secret-token';
let tmpDir: string;

function deps(): SonarRouteDeps {
  let clock = 100;
  const file = path.join(tmpDir, `inbox-${Math.random().toString(36).slice(2)}.json`);
  return {
    store: createSonarInboxStore({ file, now: () => ++clock, newId: () => `id-${clock}` }),
    expectedToken: TOKEN,
    version: '1.0.0',
  };
}

function validBody(over: Partial<SonarEnqueueInput> = {}): SonarEnqueueInput {
  return {
    source: 'douyin',
    awemeId: 'aweme-1',
    creatorId: 'c1',
    creatorName: '博主',
    title: '标题',
    url: 'https://www.douyin.com/video/aweme-1',
    publishedAt: 1_700_000_000_000,
    transcript: { fullText: '转录', srtText: 'srt', segments: [{ text: '转录', startMs: 0, endMs: 1000 }] },
    ...over,
  };
}

describe('handleSonarRequest', () => {
  let d: SonarRouteDeps;
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sonar-routes-'));
    d = deps();
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('GET /sonar/health 不需要 token，返回 ok', async () => {
    const res = await handleSonarRequest({ method: 'GET', path: '/sonar/health' }, d);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, name: 'lingji-editor', version: '1.0.0' });
  });

  it('GET /sonar/pair 回传 endpoint+token（一键自动配置）', async () => {
    const dd: SonarRouteDeps = { ...d, endpoint: 'http://127.0.0.1:19820' };
    const res = await handleSonarRequest({ method: 'GET', path: '/sonar/pair' }, dd);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      endpoint: 'http://127.0.0.1:19820',
      token: TOKEN,
      name: 'lingji-editor',
    });
  });

  it('POST /sonar/enqueue 正确 token 入队', async () => {
    const res = await handleSonarRequest(
      { method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: validBody() },
      d,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ queued: true, duplicate: false });
    expect((res.body as { itemId: string }).itemId).toBeTruthy();
    expect(await d.store.list()).toHaveLength(1);
  });

  it('POST /sonar/enqueue token 错误 → 401', async () => {
    const res = await handleSonarRequest(
      { method: 'POST', path: '/sonar/enqueue', token: 'wrong', body: validBody() },
      d,
    );
    expect(res.status).toBe(401);
    expect(await d.store.list()).toHaveLength(0);
  });

  it('POST /sonar/enqueue 缺 token → 401', async () => {
    const res = await handleSonarRequest(
      { method: 'POST', path: '/sonar/enqueue', body: validBody() },
      d,
    );
    expect(res.status).toBe(401);
  });

  it('POST /sonar/enqueue 同 awemeId 幂等返回 duplicate', async () => {
    await handleSonarRequest({ method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: validBody() }, d);
    const res = await handleSonarRequest(
      { method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: validBody({ title: '改了' }) },
      d,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ queued: true, duplicate: true });
    expect(await d.store.list()).toHaveLength(1);
  });

  it('POST /sonar/enqueue refresh:true 命中已有项时刷新（duplicate:false, refreshed:true）', async () => {
    await handleSonarRequest({ method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: validBody() }, d);
    const res = await handleSonarRequest(
      {
        method: 'POST',
        path: '/sonar/enqueue',
        token: TOKEN,
        body: { ...validBody({ title: '刷新后' }), refresh: true },
      },
      d,
    );
    expect(res.body).toMatchObject({ queued: true, duplicate: false, refreshed: true });
    const list = await d.store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('刷新后');
  });

  it('POST /sonar/enqueue 缺字段 → 400', async () => {
    const bad = { ...validBody(), awemeId: '' };
    const res = await handleSonarRequest(
      { method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: bad },
      d,
    );
    expect(res.status).toBe(400);
  });

  it('POST /sonar/enqueue transcript 缺失 → 400', async () => {
    const bad = { ...validBody() } as Record<string, unknown>;
    delete bad.transcript;
    const res = await handleSonarRequest(
      { method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: bad },
      d,
    );
    expect(res.status).toBe(400);
  });

  it('enqueue 新增/刷新触发 onInboxChanged，纯去重不触发', async () => {
    const onInboxChanged = vi.fn();
    const dd: SonarRouteDeps = { ...d, onInboxChanged };
    // 新增 → 触发
    await handleSonarRequest({ method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: validBody() }, dd);
    expect(onInboxChanged).toHaveBeenCalledTimes(1);
    // 纯去重 → 不触发
    await handleSonarRequest({ method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: validBody() }, dd);
    expect(onInboxChanged).toHaveBeenCalledTimes(1);
    // 刷新 → 再次触发
    await handleSonarRequest(
      { method: 'POST', path: '/sonar/enqueue', token: TOKEN, body: { ...validBody(), refresh: true } },
      dd,
    );
    expect(onInboxChanged).toHaveBeenCalledTimes(2);
  });

  it('POST /sonar/enqueue 携带合法 insight 时透传入库', async () => {
    const body = {
      ...validBody(),
      insight: {
        angle: '反常识',
        hook: '开头钩子',
        structure: ['一', 2, '二'],
        highlights: [],
        dataPoints: ['30%'],
        remixSuggestions: ['换案例'],
      },
    };
    await handleSonarRequest({ method: 'POST', path: '/sonar/enqueue', token: TOKEN, body }, d);
    const stored = (await d.store.list())[0]!;
    expect(stored.insight).toEqual({
      angle: '反常识',
      hook: '开头钩子',
      structure: ['一', '二'],
      highlights: [],
      dataPoints: ['30%'],
      remixSuggestions: ['换案例'],
    });
  });

  it('POST /sonar/enqueue insight 缺 angle/hook 视为无效，不入库', async () => {
    const body = { ...validBody(), insight: { structure: ['一'] } };
    await handleSonarRequest({ method: 'POST', path: '/sonar/enqueue', token: TOKEN, body }, d);
    expect((await d.store.list())[0]!.insight).toBeUndefined();
  });

  it('未知 /sonar 路径 → 404', async () => {
    const res = await handleSonarRequest({ method: 'GET', path: '/sonar/nope' }, d);
    expect(res.status).toBe(404);
  });

  it('enqueue 用错误方法 → 405', async () => {
    const res = await handleSonarRequest({ method: 'GET', path: '/sonar/enqueue', token: TOKEN }, d);
    expect(res.status).toBe(405);
  });
});

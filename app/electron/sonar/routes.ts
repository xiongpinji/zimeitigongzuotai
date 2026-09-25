/**
 * 声呐桥路由（设计文档第 5 节）。
 *
 * 纯处理器：归一化请求 → { status, body }，与 node http 解耦，便于单测。
 * server.ts 写一层薄适配把 IncomingMessage/ServerResponse 接进来。
 * 仅 loopback（由 server 绑定保证）+ x-sonar-token 比对。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SonarInboxStore, SonarEnqueueInput, SonarInsight } from './inbox-store';

export interface SonarRequest {
  method: string;
  /** URL pathname，例如 /sonar/enqueue */
  path: string;
  /** x-sonar-token 头 */
  token?: string;
  /** 已解析的 JSON body */
  body?: unknown;
}

export interface SonarResponse {
  status: number;
  body: unknown;
}

export interface SonarRouteDeps {
  store: SonarInboxStore;
  expectedToken: string;
  version?: string;
  /** 扩展 POST 应使用的本机端点基址，如 http://127.0.0.1:19820；/sonar/pair 回传给扩展自动配置。 */
  endpoint?: string;
  /** 收件箱因 enqueue 发生变化（新增/刷新）时回调，用于通知渲染端实时刷新。 */
  onInboxChanged?: () => void;
}

/** 该 path 是否归声呐桥处理（server.ts 用它决定是否接管）。 */
export function isSonarPath(path: string): boolean {
  return path === '/sonar' || path.startsWith('/sonar/');
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** 容错读取字符串数组（过滤空串），用于可选的拆解字段。 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

/** 归一化可选拆解报告：缺 angle/hook 视为无效（返回 undefined），不污染存储。 */
function sanitizeInsight(value: unknown): SonarInsight | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const i = value as Record<string, unknown>;
  const angle = typeof i.angle === 'string' ? i.angle.trim() : '';
  const hook = typeof i.hook === 'string' ? i.hook.trim() : '';
  if (!angle || !hook) return undefined;
  return {
    angle,
    hook,
    structure: toStringArray(i.structure),
    highlights: toStringArray(i.highlights),
    dataPoints: toStringArray(i.dataPoints),
    remixSuggestions: toStringArray(i.remixSuggestions),
  };
}

function validateEnqueue(body: unknown): { ok: true; input: SonarEnqueueInput } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'body 必须是对象' };
  const b = body as Record<string, unknown>;
  for (const field of ['source', 'awemeId', 'creatorId', 'creatorName', 'title', 'url']) {
    if (!isNonEmptyString(b[field])) return { ok: false, message: `字段 ${field} 缺失或非法` };
  }
  if (typeof b.publishedAt !== 'number') return { ok: false, message: '字段 publishedAt 缺失或非法' };
  const t = b.transcript as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object') return { ok: false, message: 'transcript 缺失' };
  if (!isNonEmptyString(t.fullText)) return { ok: false, message: 'transcript.fullText 缺失' };
  if (typeof t.srtText !== 'string') return { ok: false, message: 'transcript.srtText 缺失' };
  if (!Array.isArray(t.segments)) return { ok: false, message: 'transcript.segments 缺失' };
  const insight = sanitizeInsight(b.insight);
  return { ok: true, input: { ...(body as SonarEnqueueInput), ...(insight ? { insight } : { insight: undefined }) } };
}

export async function handleSonarRequest(
  req: SonarRequest,
  deps: SonarRouteDeps,
): Promise<SonarResponse> {
  const { method, path } = req;

  if (path === '/sonar/health') {
    if (method !== 'GET') return { status: 405, body: { error: 'Method Not Allowed' } };
    return { status: 200, body: { ok: true, name: 'lingji-editor', version: deps.version ?? '1.0.0' } };
  }

  // 一键配对：localhost 回传 endpoint+token，扩展点「自动连接」即拉取并保存（零输入）。
  if (path === '/sonar/pair') {
    if (method !== 'GET') return { status: 405, body: { error: 'Method Not Allowed' } };
    return {
      status: 200,
      body: {
        ok: true,
        name: 'lingji-editor',
        version: deps.version ?? '1.0.0',
        endpoint: deps.endpoint ?? 'http://127.0.0.1:19820',
        token: deps.expectedToken,
      },
    };
  }

  if (path === '/sonar/enqueue') {
    if (method !== 'POST') return { status: 405, body: { error: 'Method Not Allowed' } };
    if (!req.token || req.token !== deps.expectedToken) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }
    const v = validateEnqueue(req.body);
    if (!v.ok) return { status: 400, body: { error: v.message } };
    const refresh = (req.body as { refresh?: unknown }).refresh === true;
    const { item, duplicate, refreshed } = await deps.store.enqueue(v.input, { refresh });
    // 新增或刷新（非纯去重）才算收件箱有变化 → 通知渲染端实时刷新。
    if (!duplicate) deps.onInboxChanged?.();
    return { status: 200, body: { queued: true, itemId: item.id, duplicate, refreshed: refreshed ?? false } };
  }

  return { status: 404, body: { error: 'Not Found' } };
}

/** 读取并解析 JSON 请求体（空体 → undefined，非法 JSON 抛错）。 */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * node http 适配层（server.ts 与集成测试共用，避免 glue 漂移）。
 * 读取 x-sonar-token 头与 JSON body → handleSonarRequest → 写 status + JSON。
 */
export async function handleSonarHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SonarRouteDeps,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let body: unknown;
  try {
    if (req.method === 'POST') body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Request' }));
    return;
  }
  const tokenHeader = req.headers['x-sonar-token'];
  const result = await handleSonarRequest(
    {
      method: req.method ?? 'GET',
      path: url.pathname,
      token: typeof tokenHeader === 'string' ? tokenHeader : undefined,
      body,
    },
    deps,
  );
  res.writeHead(result.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result.body));
}

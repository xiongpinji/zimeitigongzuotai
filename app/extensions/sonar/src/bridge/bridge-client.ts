/**
 * 灵机采风 → 灵机剪影 桥客户端（设计文档第 5、7 节）。
 *
 * 探活 / 入队 / pending 补推。纯逻辑：注入 fetch 与 pending 存储（生产由 chrome.storage.local 实现）。
 * 桌面端不可达 / 5xx → 入 pending 暂存，下次 alarm/启动补推；401 视为配置错误，不暂存。
 * pending 按 awemeId 幂等去重，桌面端 inbox 亦按 awemeId 幂等，双保险防重复建项目。
 */

export interface BridgeConfig {
  enabled: boolean;
  /** 桌面端本地端点根，例如 http://127.0.0.1:19820 */
  endpoint: string;
  token: string;
}

export interface BridgeTranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

/** 爆款拆解报告（随转录稿一起送进待创作箱，供二创参考）。 */
export interface BridgeInsight {
  angle: string;
  hook: string;
  structure: string[];
  highlights: string[];
  dataPoints: string[];
  remixSuggestions: string[];
}

export interface BridgePayload {
  source: 'douyin';
  awemeId: string;
  creatorId: string;
  creatorName: string;
  title: string;
  url: string;
  coverUrl?: string;
  publishedAt: number;
  durationMs?: number;
  transcript: {
    fullText: string;
    srtText: string;
    segments: BridgeTranscriptSegment[];
  };
  /** 可选：爆款拆解报告（工作流流水线产出）。 */
  insight?: BridgeInsight;
}

export interface BridgePendingStore {
  read(): Promise<BridgePayload[]>;
  write(items: BridgePayload[]): Promise<void>;
}

export interface BridgeClientDeps {
  fetchImpl?: typeof fetch;
  pending: BridgePendingStore;
}

export interface ProbeResult {
  ok: boolean;
  version?: string;
}

export interface PairResult {
  ok: boolean;
  endpoint?: string;
  token?: string;
}

export type EnqueueOutcome =
  | { status: 'sent'; duplicate: boolean }
  | { status: 'queued' }
  | { status: 'unauthorized' }
  | { status: 'disabled' };

export interface FlushResult {
  sent: number;
  remaining: number;
}

export interface EnqueueOptions {
  /** 命中已有 awemeId 时覆盖刷新并重置为待创作（手动推送用）；自动监听不传，保持去重。 */
  refresh?: boolean;
}

export interface BridgeClient {
  probe(config: BridgeConfig): Promise<ProbeResult>;
  /** 向 {endpoint}/sonar/pair 拉取本机端点与 token（一键自动配置）。 */
  pair(endpoint: string): Promise<PairResult>;
  enqueue(config: BridgeConfig, payload: BridgePayload, opts?: EnqueueOptions): Promise<EnqueueOutcome>;
  flushPending(config: BridgeConfig): Promise<FlushResult>;
}

function joinUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

type SendResult = 'sent-new' | 'sent-duplicate' | 'unauthorized' | 'retryable';

export function createBridgeClient(deps: BridgeClientDeps): BridgeClient {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const pending = deps.pending;

  /** 单次 POST 尝试；网络错误/5xx 归为 retryable。 */
  async function send(
    config: BridgeConfig,
    payload: BridgePayload,
    opts?: EnqueueOptions,
  ): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetchImpl(joinUrl(config.endpoint, 'sonar/enqueue'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sonar-token': config.token },
        body: JSON.stringify(opts?.refresh ? { ...payload, refresh: true } : payload),
      });
    } catch {
      return 'retryable';
    }
    if (res.status === 401) return 'unauthorized';
    if (!res.ok) return 'retryable';
    let duplicate = false;
    try {
      const body = (await res.json()) as { duplicate?: boolean };
      duplicate = body?.duplicate === true;
    } catch {
      // 响应体异常但 2xx：当作已送达。
    }
    return duplicate ? 'sent-duplicate' : 'sent-new';
  }

  async function queue(payload: BridgePayload): Promise<void> {
    const items = await pending.read();
    if (items.some((i) => i.awemeId === payload.awemeId)) return; // 幂等
    await pending.write([...items, payload]);
  }

  return {
    async probe(config) {
      try {
        const res = await fetchImpl(joinUrl(config.endpoint, 'sonar/health'), { method: 'GET' });
        if (!res.ok) return { ok: false };
        const body = (await res.json()) as { ok?: boolean; version?: string };
        return { ok: body?.ok === true, version: body?.version };
      } catch {
        return { ok: false };
      }
    },

    async pair(endpoint) {
      try {
        const res = await fetchImpl(joinUrl(endpoint, 'sonar/pair'), { method: 'GET' });
        if (!res.ok) return { ok: false };
        const body = (await res.json()) as { ok?: boolean; endpoint?: string; token?: string };
        if (body?.ok !== true || !body.token) return { ok: false };
        return { ok: true, endpoint: body.endpoint ?? endpoint, token: body.token };
      } catch {
        return { ok: false };
      }
    },

    async enqueue(config, payload, opts) {
      if (!config.enabled) return { status: 'disabled' };
      const result = await send(config, payload, opts);
      switch (result) {
        case 'sent-new':
          return { status: 'sent', duplicate: false };
        case 'sent-duplicate':
          return { status: 'sent', duplicate: true };
        case 'unauthorized':
          return { status: 'unauthorized' };
        case 'retryable':
          await queue(payload);
          return { status: 'queued' };
      }
    },

    async flushPending(config) {
      if (!config.enabled) {
        const items = await pending.read();
        return { sent: 0, remaining: items.length };
      }
      const items = await pending.read();
      const remaining: BridgePayload[] = [];
      let sent = 0;
      for (const item of items) {
        const result = await send(config, item);
        if (result === 'sent-new' || result === 'sent-duplicate') {
          sent += 1;
        } else {
          // unauthorized 与 retryable 均保留：前者待用户修配置，后者待桌面端恢复。
          remaining.push(item);
        }
      }
      await pending.write(remaining);
      return { sent, remaining: remaining.length };
    },
  };
}

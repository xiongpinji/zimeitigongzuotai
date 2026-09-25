/**
 * 页面响应捕获的纯逻辑：目标 URL 白名单匹配 + 页面→Content Script 消息封套。
 *
 * 这部分与浏览器 API 无关，可单测。MAIN world 的 fetch/XHR 包装（page-bridge.ts）
 * 与 Content Script 的接收（content-script.ts）都复用这里的判断与封套，确保只观察
 * 白名单 JSON 响应、限制负载大小、并用带随机会话标识的消息隔离。
 */

/** 捕获到的响应类别。适配器据此选择解析器。 */
export type ResponseCategory = 'video_detail' | 'creator_videos' | 'creator_profile';

/** 页面消息上的会话标识字段名（随机会话标识防止伪造）。 */
export const CAPTURE_MARKER_KEY = '__sonarSession' as const;

/** 单条捕获响应的默认最大负载（约 4MB），超过则丢弃，不发送截断的部分数据。 */
export const DEFAULT_MAX_PAYLOAD_BYTES = 4_000_000;

/**
 * 目标抖音 Web 接口（按 pathname 子串匹配，忽略 query / 签名参数）。
 * 仅覆盖博主资料、作品列表与作品详情三类，其余响应一律忽略。
 */
const TARGET_ENDPOINTS: ReadonlyArray<{ path: string; category: ResponseCategory }> = [
  { path: '/aweme/v1/web/aweme/detail/', category: 'video_detail' },
  { path: '/aweme/v1/web/aweme/post/', category: 'creator_videos' },
  { path: '/aweme/v1/web/user/profile/other/', category: 'creator_profile' },
];

const ALLOWED_HOSTS = new Set(['www.douyin.com']);
const CATEGORY_SET: ReadonlySet<string> = new Set<ResponseCategory>([
  'video_detail',
  'creator_videos',
  'creator_profile',
]);

/** 返回 URL 命中的响应类别，未命中返回 null。 */
export function matchTargetUrl(url: string): ResponseCategory | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://www.douyin.com');
  } catch {
    return null;
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return null;
  for (const endpoint of TARGET_ENDPOINTS) {
    if (parsed.pathname.includes(endpoint.path)) return endpoint.category;
  }
  return null;
}

export interface CapturedMessage {
  [CAPTURE_MARKER_KEY]: string;
  category: ResponseCategory;
  url: string;
  payload: unknown;
}

/**
 * 把页面成功返回的 JSON 响应包成可跨 world 传输的消息。
 * 负载不可序列化或超过 maxBytes 时返回 null（丢弃，不传部分数据）。
 */
export function buildCapturedMessage(input: {
  sessionId: string;
  category: ResponseCategory;
  url: string;
  payload: unknown;
  maxBytes?: number;
}): CapturedMessage | null {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  let serialized: string;
  try {
    serialized = JSON.stringify(input.payload);
  } catch {
    return null;
  }
  if (serialized === undefined) return null;
  if (serialized.length > maxBytes) return null;
  return {
    [CAPTURE_MARKER_KEY]: input.sessionId,
    category: input.category,
    url: input.url,
    payload: input.payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Content Script 侧校验来自页面的消息：会话标识必须匹配、类别必须已知、字段结构正确。
 * 任何不符合返回 null（丢弃）。
 */
export function parseCapturedMessage(raw: unknown, expectedSessionId: string): CapturedMessage | null {
  if (!isRecord(raw)) return null;
  if (raw[CAPTURE_MARKER_KEY] !== expectedSessionId) return null;
  if (typeof raw.category !== 'string' || !CATEGORY_SET.has(raw.category)) return null;
  if (typeof raw.url !== 'string') return null;
  if (!('payload' in raw)) return null;
  return {
    [CAPTURE_MARKER_KEY]: expectedSessionId,
    category: raw.category as ResponseCategory,
    url: raw.url,
    payload: raw.payload,
  };
}

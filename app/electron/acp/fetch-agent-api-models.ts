/**
 * fetch-agent-api-models.ts （主进程专用）
 *
 * Claude agent 的 CLI 没有「列模型」命令，但用户在「自定义 API」模式下会配置
 * apiBaseUrl + apiKey（官方 Anthropic 或 OpenAI 兼容中转）。此模块从该 API 的
 * `/v1/models` 拉取真实可用模型，喂给模型选择器。
 *
 * 约定对齐 renderer 侧 `src/lib/llm/fetch-models.ts`：按 baseUrl 末尾是否含 /vN
 * 智能拼接 /models；同时带上 Anthropic 原生与 OpenAI 两种鉴权头以兼容中转。
 * 仅主进程使用（依赖 Node 全局 fetch）；不要在 renderer 侧 import。
 */

import type { AgentModel } from '../agent-runtime/types';

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** baseUrl 已以 /vN(beta) 结尾 → 仅追加 /models；否则追加 /v1/models。 */
function joinModelsEndpoint(baseUrl: string): string {
  const normalized = trimSlashes(baseUrl);
  if (/\/v\d+(?:beta)?$/.test(normalized)) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
}

interface ModelsResponse {
  data?: Array<{ id?: string; display_name?: string }>;
}

/**
 * 从 OpenAI/Anthropic 兼容的 `/v1/models` 拉取模型列表。
 * 失败（网络/非 2xx/非法 JSON/空）一律返回 null，调用方回退兜底。
 */
export async function fetchAgentApiModels(
  baseUrl: string,
  apiKey: string,
): Promise<AgentModel[] | null> {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;

  const endpoint = joinModelsEndpoint(trimmed);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    // 同时给两种鉴权头：OpenAI 兼容用 Bearer，Anthropic 原生用 x-api-key。
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let payload: ModelsResponse;
  try {
    payload = (await response.json()) as ModelsResponse;
  } catch {
    return null;
  }

  const out: AgentModel[] = [];
  const seen = new Set<string>();
  for (const item of payload.data ?? []) {
    const id = item?.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: item?.display_name?.trim() || id });
  }
  return out.length > 0 ? out : null;
}

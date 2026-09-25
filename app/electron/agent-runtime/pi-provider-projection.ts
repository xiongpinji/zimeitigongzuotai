import type {
  AISettings,
  LLMProvider,
  PiMaxTokensField,
  PiModelCompat,
  PiModelCost,
  PiModelInputType,
  PiProviderApi,
  PiThinkingLevelMap,
} from '../../src/types/ai';
import { LMSTUDIO_DEFAULT_BASE_URL } from '../../src/types/ai';
import { getPiBuiltinProviderId } from '../../src/lib/llm/pi-provider-presets';

export interface PiModelEntry {
  id: string;
  name: string;
  api?: PiProviderApi;
  reasoning: boolean;
  input: PiModelInputType[];
  contextWindow: number;
  maxTokens: number;
  cost: PiModelCost;
  thinkingLevelMap?: PiThinkingLevelMap;
  compat: PiModelCompat & {
    supportsDeveloperRole: boolean;
    supportsStore: boolean;
    supportsReasoningEffort: boolean;
    maxTokensField: PiMaxTokensField;
  };
}

export interface PiProviderEntry {
  name: string;
  baseUrl: string;
  api: PiProviderApi;
  apiKey: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  compat?: PiModelCompat;
  models: PiModelEntry[];
}

export function llmTypeToPiApi(type: LLMProvider['type']): PiProviderApi | null {
  switch (type) {
    case 'openai_compatible':
    case 'lmstudio':
      return 'openai-completions';
    case 'openai_responses':
      return 'openai-responses';
    case 'minimax':
    case 'anthropic':
      return 'anthropic-messages';
    case 'gemini':
      return 'google-generative-ai';
    case 'claude_code_acp':
      return null;
    default:
      return null;
  }
}

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_COST: PiModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MINIMAX_ANTHROPIC_DEFAULT_BASE_URL = 'https://api.minimaxi.com/anthropic';

function resolvePiBaseUrl(provider: LLMProvider): string {
  const configured = provider.baseUrl.trim();
  if (configured) return configured;
  if (provider.type === 'gemini') return GEMINI_DEFAULT_BASE_URL;
  if (provider.type === 'lmstudio') return LMSTUDIO_DEFAULT_BASE_URL;
  if (provider.type === 'minimax') return MINIMAX_ANTHROPIC_DEFAULT_BASE_URL;
  return '';
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  return n > 0 ? n : fallback;
}

function resolveProviderCompat(provider: LLMProvider, reasoning: boolean): PiModelEntry['compat'] {
  const configured = provider.pi?.compat ?? {};
  return {
    ...configured,
    supportsDeveloperRole: configured.supportsDeveloperRole ?? false,
    supportsStore: configured.supportsStore ?? false,
    supportsReasoningEffort: configured.supportsReasoningEffort ?? reasoning,
    maxTokensField: configured.maxTokensField ?? 'max_tokens',
  };
}

function toModelEntry(
  provider: LLMProvider,
  modelId: string,
  reasoning: boolean,
  api: PiProviderApi,
): PiModelEntry {
  const modelOptions = provider.pi?.model;
  const cost = { ...DEFAULT_COST, ...(modelOptions?.cost ?? {}) };
  const entry: PiModelEntry = {
    id: modelId,
    name: modelId,
    reasoning,
    input: modelOptions?.input ?? ['text'],
    contextWindow: normalizePositiveInteger(modelOptions?.contextWindow, DEFAULT_CONTEXT_WINDOW),
    maxTokens: normalizePositiveInteger(modelOptions?.maxTokens, DEFAULT_MAX_TOKENS),
    cost,
    compat: resolveProviderCompat(provider, reasoning),
  };
  if (provider.pi?.api && provider.pi.api !== api) {
    entry.api = provider.pi.api;
  }
  if (modelOptions?.thinkingLevelMap && Object.keys(modelOptions.thinkingLevelMap).length > 0) {
    entry.thinkingLevelMap = modelOptions.thinkingLevelMap;
  }
  return {
    ...entry,
  };
}

export interface PiModelsJson {
  providers: Record<string, PiProviderEntry>;
}

export function buildPiModelsJson(ai: AISettings): PiModelsJson {
  const providers: Record<string, PiProviderEntry> = {};
  for (const provider of ai.llmProviders ?? []) {
    if (getPiBuiltinProviderId(provider)) continue;
    const projected = projectProviderToPi(provider);
    if (projected) providers[projected.key] = projected.entry;
  }
  return { providers };
}

export interface PiSettingsJson {
  defaultProvider?: string;
  defaultModel?: string;
}

export function buildPiSettingsJson(ai: AISettings): PiSettingsJson {
  // 不再写死 defaultThinkingLevel：思考程度由会话级选择器（--thinking）按需传入，
  // 缺省时交给 pi 自身默认，避免与 provider 配置脱节。
  const out: PiSettingsJson = {};
  const provider = (ai.llmProviders ?? []).find((p) => p.id === ai.defaultProviderId);
  const builtinProviderId = provider ? getPiBuiltinProviderId(provider) : null;
  if (provider && builtinProviderId) {
    out.defaultProvider = builtinProviderId;
    if (ai.defaultModel) out.defaultModel = ai.defaultModel;
    return out;
  }
  if (provider && projectProviderToPi(provider)) {
    out.defaultProvider = provider.id;
    if (ai.defaultModel) out.defaultModel = ai.defaultModel;
  }
  return out;
}

/**
 * 会话模型下拉的选项：把可投影的 llmProviders 展开为 pi `--model` 可识别的
 * `${providerId}/${modelId}` 列表（与 buildPiModelsJson 的 provider key 完全对齐，
 * 保证传给 pi 的 --model 值在投影出的 models.json 中可解析）。
 * 置顶 'default' 表示「跟随 pi 配置的 defaultProvider/defaultModel」。
 * 置顶项 label 直接用配置的默认模型名（缺省回退「默认」），避免在芯片上展示
 * 冗长的「默认（跟随配置）」文案；id 仍为 'default'（不传 --model，跟随 CLI 配置）。
 */
export function buildPiModelOptions(ai: AISettings): { id: string; label: string }[] {
  const defaultLabel = ai.defaultModel?.trim() || '默认';
  const out: { id: string; label: string }[] = [{ id: 'default', label: defaultLabel }];
  for (const provider of ai.llmProviders ?? []) {
    const builtinProviderId = getPiBuiltinProviderId(provider);
    if (builtinProviderId) {
      for (const model of provider.models ?? []) {
        out.push({
          id: `${builtinProviderId}/${model}`,
          label: `${model}（${provider.name} · Pi 内置）`,
        });
      }
      continue;
    }
    const projected = projectProviderToPi(provider);
    if (!projected) continue;
    for (const model of projected.entry.models) {
      out.push({ id: `${projected.key}/${model.id}`, label: `${model.id}（${provider.name}）` });
    }
  }
  return out;
}

export function projectProviderToPi(
  provider: LLMProvider,
): { key: string; entry: PiProviderEntry } | null {
  if (getPiBuiltinProviderId(provider)) return null;
  const api = provider.pi?.api ?? llmTypeToPiApi(provider.type);
  if (!api) return null;
  const baseUrl = resolvePiBaseUrl(provider);
  if (!baseUrl) return null;
  if (!provider.models || provider.models.length === 0) return null;
  // pi's per-model `reasoning` is a *capability* flag; we deliberately opt-in
  // only when the user has explicitly enabled thinking (`=== true`).  Defaulting
  // to true would cause pi to send `reasoning_effort` to models that don't
  // support it.  This diverges intentionally from `LLMProvider.enableThinking`'s
  // "缺省视为 true" runtime-toggle semantics — here absence means "not requested".
  const reasoning = provider.enableThinking === true;
  return {
    key: provider.id,
    entry: {
      name: provider.name,
      baseUrl,
      api,
      apiKey: provider.apiKey,
      ...(provider.pi?.authHeader !== undefined ? { authHeader: provider.pi.authHeader } : {}),
      ...(provider.pi?.headers ? { headers: provider.pi.headers } : {}),
      ...(provider.pi?.compat ? { compat: provider.pi.compat } : {}),
      models: provider.models.map((m) => toModelEntry(provider, m, reasoning, api)),
    },
  };
}

export interface PiAuthApiKeyEntry {
  type: 'api_key';
  key: string;
}

export type PiAuthJson = Record<string, unknown>;

export function buildPiAuthJson(ai: AISettings): Record<string, PiAuthApiKeyEntry> {
  const out: Record<string, PiAuthApiKeyEntry> = {};
  for (const provider of ai.llmProviders ?? []) {
    const builtinProviderId = getPiBuiltinProviderId(provider);
    const apiKey = provider.apiKey?.trim();
    if (!builtinProviderId || !apiKey) continue;
    out[builtinProviderId] = { type: 'api_key', key: apiKey };
  }
  return out;
}

/**
 * AI 设置存储（设计文档 4.6 / 8.2）。
 *
 * 内部保存明文配置（运行时实现写入 chrome.storage.local，不进 Chrome Sync、不写导出/日志）；
 * 对外只暴露遮罩后的视图（toAiSettingsView）。这里提供内存实现，chrome.storage.local 实现见
 * settings-chrome-store.ts。
 *
 * 模型：转录已固定走 bcut（零配置，不再持久化 ASR 配置）；LLM（摘要/分析）支持多 Provider
 * + 预设 + 默认选择（见 processing/provider-presets.ts）。旧的 { asr, summary } 结构由
 * migrateAiSettings 兼容迁移。
 */
import type { AiSettingsView, LlmProviderView, UpdateAiSettingsInput } from '@/domain/api-types';
import type { LlmProtocol } from '@/domain/models';
import { presetRequiresApiKey } from '@/processing/provider-presets';

export interface LlmProvider {
  id: string;
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
  /** 明文存储；不会回读到视图。 */
  apiKey?: string;
  models: string[];
  /** 来源预设 id（自定义 provider 留空）。 */
  presetId?: string;
}

export interface LlmSettings {
  providers: LlmProvider[];
  defaultProviderId?: string;
  defaultModel?: string;
  temperature?: number;
}

export interface AiSettingsInternal {
  llm: LlmSettings;
  autoAnalyze: boolean;
  dataSendConsent: boolean;
}

export interface SettingsStore {
  getAiSettings(): Promise<AiSettingsInternal>;
  updateAiSettings(input: UpdateAiSettingsInput): Promise<void>;
}

export function maskKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
}

export function emptyAiSettings(): AiSettingsInternal {
  return { llm: { providers: [] }, autoAnalyze: false, dataSendConsent: false };
}

/** 解析当前生效的默认 Provider：优先 defaultProviderId，否则取列表首个。 */
export function resolveDefaultProvider(llm: LlmSettings): LlmProvider | undefined {
  if (llm.providers.length === 0) return undefined;
  const matched = llm.defaultProviderId
    ? llm.providers.find((p) => p.id === llm.defaultProviderId)
    : undefined;
  return matched ?? llm.providers[0];
}

/**
 * 默认 Provider 是否可用：有 baseUrl、有可解析的模型（defaultModel 或列表首个），
 * 且要么有 Key、要么是免 Key 的预设。模型缺失也算未配置，否则 UI 会误以为可用、
 * 实际生成摘要时才抛 SUMMARY_NOT_CONFIGURED。
 */
function isLlmConfigured(llm: LlmSettings): boolean {
  const provider = resolveDefaultProvider(llm);
  if (!provider || !provider.baseUrl) return false;
  const hasModel = Boolean(llm.defaultModel || provider.models[0]);
  if (!hasModel) return false;
  return Boolean(provider.apiKey) || !presetRequiresApiKey(provider.presetId);
}

function toProviderView(provider: LlmProvider): LlmProviderView {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    models: provider.models,
    hasApiKey: Boolean(provider.apiKey),
    ...(provider.presetId !== undefined ? { presetId: provider.presetId } : {}),
    ...(maskKey(provider.apiKey) !== undefined ? { apiKeyMasked: maskKey(provider.apiKey) } : {}),
  };
}

/** 把内部明文设置转换为遮罩视图（API Key 一律不回读明文）。 */
export function toAiSettingsView(internal: AiSettingsInternal): AiSettingsView {
  const { llm } = internal;
  return {
    llm: {
      providers: llm.providers.map(toProviderView),
      configured: isLlmConfigured(llm),
      ...(llm.defaultProviderId !== undefined ? { defaultProviderId: llm.defaultProviderId } : {}),
      ...(llm.defaultModel !== undefined ? { defaultModel: llm.defaultModel } : {}),
      ...(llm.temperature !== undefined ? { temperature: llm.temperature } : {}),
    },
    autoAnalyze: internal.autoAnalyze,
    dataSendConsent: internal.dataSendConsent,
  };
}

interface LegacySummary {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
}

/**
 * 把存储中的任意历史结构迁移到当前结构：
 * - 已是新结构（含 llm）→ 补齐默认字段。
 * - 旧结构（含 summary）→ 把摘要配置迁成单个 OpenAI 协议 provider 并设为默认；旧 asr 配置丢弃
 *   （转录已固定走 bcut）。
 */
export function migrateAiSettings(stored: unknown): AiSettingsInternal {
  const base = emptyAiSettings();
  if (!stored || typeof stored !== 'object') return base;
  const record = stored as Record<string, unknown>;
  base.autoAnalyze = record.autoAnalyze === true;
  base.dataSendConsent = record.dataSendConsent === true;

  if (record.llm && typeof record.llm === 'object') {
    const llm = record.llm as Partial<LlmSettings>;
    base.llm = {
      providers: Array.isArray(llm.providers) ? (llm.providers as LlmProvider[]) : [],
      ...(typeof llm.defaultProviderId === 'string'
        ? { defaultProviderId: llm.defaultProviderId }
        : {}),
      ...(typeof llm.defaultModel === 'string' ? { defaultModel: llm.defaultModel } : {}),
      ...(typeof llm.temperature === 'number' ? { temperature: llm.temperature } : {}),
    };
    return base;
  }

  const summary = record.summary as LegacySummary | undefined;
  if (summary?.baseUrl && summary.model) {
    const id = 'migrated-summary';
    base.llm = {
      providers: [
        {
          id,
          name: summary.name || '已保存的摘要 Provider',
          protocol: 'openai',
          baseUrl: summary.baseUrl,
          models: [summary.model],
          ...(summary.apiKey ? { apiKey: summary.apiKey } : {}),
        },
      ],
      defaultProviderId: id,
      defaultModel: summary.model,
      ...(typeof summary.temperature === 'number' ? { temperature: summary.temperature } : {}),
    };
  }
  return base;
}

/**
 * 应用一次设置更新（纯函数，内存与 chrome 存储共用）。
 * providers 为整列表替换；某个 provider 省略 apiKey 时，保留同 id 的既有 Key（避免遮罩回写清空）。
 */
export function applyAiSettingsUpdate(
  current: AiSettingsInternal,
  input: UpdateAiSettingsInput,
): AiSettingsInternal {
  const next: AiSettingsInternal = {
    llm: { ...current.llm, providers: current.llm.providers },
    autoAnalyze: input.autoAnalyze ?? current.autoAnalyze,
    dataSendConsent: input.dataSendConsent ?? current.dataSendConsent,
  };

  if (input.llm) {
    if (input.llm.providers) {
      const previous = new Map(current.llm.providers.map((p) => [p.id, p]));
      next.llm.providers = input.llm.providers.map((p) => {
        const keptKey = p.apiKey !== undefined ? p.apiKey : previous.get(p.id)?.apiKey;
        return {
          id: p.id,
          name: p.name,
          protocol: p.protocol,
          baseUrl: p.baseUrl,
          models: p.models,
          ...(p.presetId !== undefined ? { presetId: p.presetId } : {}),
          ...(keptKey !== undefined ? { apiKey: keptKey } : {}),
        };
      });
    }
    if (input.llm.defaultProviderId !== undefined) {
      next.llm.defaultProviderId = input.llm.defaultProviderId;
    }
    if (input.llm.defaultModel !== undefined) next.llm.defaultModel = input.llm.defaultModel;
    if (input.llm.temperature !== undefined) next.llm.temperature = input.llm.temperature;
  }

  return next;
}

export function createMemorySettingsStore(initial?: Partial<AiSettingsInternal>): SettingsStore {
  let state: AiSettingsInternal = { ...emptyAiSettings(), ...initial };
  return {
    async getAiSettings() {
      return state;
    },
    async updateAiSettings(input: UpdateAiSettingsInput) {
      state = applyAiSettingsUpdate(state, input);
    },
  };
}

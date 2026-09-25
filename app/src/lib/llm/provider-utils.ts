import type { AISettings, LLMProvider } from '../../types/ai';

function inferProviderName(baseUrl: string): string {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('lmstudio') || lower.includes('localhost:1234') || lower.includes('127.0.0.1:1234')) {
    return 'LM Studio';
  }
  if (lower.includes('deepseek')) return 'DeepSeek';
  if (lower.includes('openai')) return 'OpenAI';
  if (lower.includes('anthropic')) return 'Anthropic';
  if (lower.includes('generativelanguage') || lower.includes('gemini')) return 'Gemini';
  if (lower.includes('moonshot') || lower.includes('kimi')) return 'Moonshot';
  if (lower.includes('dashscope') || lower.includes('qwen')) return 'Qwen';
  if (lower.includes('zhipu') || lower.includes('bigmodel')) return 'ZhipuAI';
  try {
    const host = new URL(baseUrl).hostname;
    return host.split('.').slice(-2, -1)[0] ?? 'Custom';
  } catch {
    return 'Custom';
  }
}

function inferProviderType(baseUrl: string): LLMProvider['type'] {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('lmstudio') || lower.includes('localhost:1234') || lower.includes('127.0.0.1:1234')) {
    return 'lmstudio';
  }
  return 'openai_compatible';
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 把旧的全局 `enableThinking` 下沉到每个 provider；
 * provider 已显式设置过则不覆盖，未设置时继承全局值。
 */
function backfillProviderThinking(settings: AISettings): AISettings {
  const globalThinking = settings.enableThinking;
  if (globalThinking === undefined) {
    return settings;
  }
  let mutated = false;
  const nextProviders = settings.llmProviders.map((provider) => {
    if (provider.enableThinking !== undefined) {
      return provider;
    }
    mutated = true;
    return { ...provider, enableThinking: globalThinking };
  });
  if (!mutated) {
    return settings;
  }
  return { ...settings, llmProviders: nextProviders };
}

export function migrateToProviders(settings: AISettings): AISettings {
  if (settings.llmProviders && settings.llmProviders.length > 0) {
    return backfillProviderThinking(settings);
  }
  if (!settings.llmBaseUrl) {
    return { ...settings, llmProviders: [], defaultProviderId: null, defaultModel: null };
  }
  const provider: LLMProvider = {
    id: generateId(),
    name: inferProviderName(settings.llmBaseUrl),
    type: inferProviderType(settings.llmBaseUrl),
    baseUrl: settings.llmBaseUrl,
    apiKey: settings.llmApiKey,
    models: settings.llmModel ? [settings.llmModel] : [],
    enableThinking: settings.enableThinking ?? true,
  };
  return {
    ...settings,
    llmProviders: [provider],
    defaultProviderId: provider.id,
    defaultModel: settings.llmModel || null,
  };
}

export function resolveProvider(
  providers: LLMProvider[],
  providerId: string | null,
  defaultProviderId: string | null,
): LLMProvider | null {
  if (providers.length === 0) return null;
  if (providerId) return providers.find((p) => p.id === providerId) ?? null;
  if (defaultProviderId) return providers.find((p) => p.id === defaultProviderId) ?? null;
  return providers[0];
}

/**
 * Provider 连通性测试（设计文档 8.2）。
 *
 * 对当前默认 LLM Provider 做最小连通+鉴权校验，不上传任何用户数据：
 * - 'openai'：GET {baseUrl}/models（Bearer）
 * - 'anthropic'：GET {baseUrl}/v1/models（x-api-key + anthropic-version）
 * 未配置默认 Provider 或缺少必需 Key 时返回 SUMMARY_NOT_CONFIGURED。
 */
import type { ProviderTestResult, TestAiProviderInput } from '@/domain/api-types';
import type { AiProviderTester } from './services';
import { resolveDefaultProvider, type SettingsStore } from './settings-store';
import { presetRequiresApiKey } from '@/processing/provider-presets';
import { makeError } from '@/domain/errors';

export interface AiProviderTesterDeps {
  settings: SettingsStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function createAiProviderTester(deps: AiProviderTesterDeps): AiProviderTester {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());

  return {
    async test(_input: TestAiProviderInput): Promise<ProviderTestResult> {
      const settings = await deps.settings.getAiSettings();
      const provider = resolveDefaultProvider(settings.llm);
      if (!provider || !provider.baseUrl) {
        return {
          ok: false,
          error: makeError('SUMMARY_NOT_CONFIGURED', '尚未配置默认 Provider 或 Base URL'),
        };
      }
      if (!provider.apiKey && presetRequiresApiKey(provider.presetId)) {
        return { ok: false, error: makeError('SUMMARY_NOT_CONFIGURED', '尚未填写 API Key') };
      }

      const isAnthropic = provider.protocol === 'anthropic';
      const url = isAnthropic
        ? joinUrl(provider.baseUrl, 'v1/models')
        : joinUrl(provider.baseUrl, 'models');
      const headers: Record<string, string> = isAnthropic
        ? {
            'x-api-key': provider.apiKey ?? '',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          }
        : { Authorization: `Bearer ${provider.apiKey ?? ''}` };

      const started = now();
      try {
        const res = await fetchImpl(url, { headers });
        if (!res.ok) {
          let detail = '';
          try {
            detail = (await res.text()).trim().slice(0, 300);
          } catch {
            /* 无响应体 */
          }
          return {
            ok: false,
            error: makeError('NETWORK_ERROR', `连通失败（HTTP ${res.status}）${detail ? `：${detail}` : ''}`, {
              retryable: true,
            }),
          };
        }
        return { ok: true, latencyMs: now() - started };
      } catch (e) {
        return {
          ok: false,
          error: makeError('NETWORK_ERROR', '无法连接 Provider', {
            retryable: true,
            detail: e instanceof Error ? e.message : String(e),
          }),
        };
      }
    },
  };
}

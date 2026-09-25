import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAISettings, saveAISettings, useAIStore } from '../src/store/ai';

const AI_SETTINGS_KEY = 'podcast-editor-ai-settings';

function createStorageMock() {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
}

describe('AI settings store helpers', () => {
  beforeEach(() => {
    const localStorage = createStorageMock();
    vi.stubGlobal('window', { localStorage });
    localStorage.clear();
    useAIStore.getState().resetWorkflow();
  });

  it('defaults enableThinking to true when loading legacy settings', async () => {
    window.localStorage.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify({
        llmBaseUrl: 'https://api.openai.com/v1',
        llmApiKey: 'sk-test',
        llmModel: 'gpt-4o',
        jimengApiUrl: 'https://jimeng.example.com',
        jimengSessionId: 'session-test',
      }),
    );

    // 加载时会依次执行 migrateToProviders + migrateImageProviders，
    // 后者会把 jimeng* 字段迁移到 imageProviders[0] 并清空旧字段。
    const loaded = await loadAISettings();
    expect(loaded).toMatchObject({
      enableThinking: true,
      jimengApiUrl: '',
      jimengSessionId: '',
      jimengModel: '',
      minimaxApiKey: '',
      minimaxVoiceId: 'male-qn-qingse',
      minimaxSpeed: 1.0,
      defaultImageProviderId: 'jimeng-default',
      defaultImageModel: 'jimeng-5.0',
    });
    expect(loaded?.imageProviders).toHaveLength(1);
    expect(loaded?.imageProviders[0]).toMatchObject({
      id: 'jimeng-default',
      type: 'jimeng',
      baseUrl: 'https://jimeng.example.com',
      apiKey: 'session-test',
      models: ['jimeng-5.0'],
    });
  });

  it('persists enableThinking and minimax settings when explicitly configured', async () => {
    // saveAISettings 也是异步的，但在没有 electronAPI 时是 no-op
    // 通过 localStorage 直接写入来模拟已保存状态
    window.localStorage.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify({
        llmBaseUrl: 'https://api.openai.com/v1',
        llmApiKey: 'sk-test',
        llmModel: 'gpt-4o',
        jimengApiUrl: 'https://jimeng.example.com',
        jimengSessionId: 'session-test',
        enableThinking: false,
        minimaxApiKey: 'mm-key',
        minimaxVoiceId: 'female-yujie',
        minimaxSpeed: 1.25,
      }),
    );

    await expect(loadAISettings()).resolves.toMatchObject({
      enableThinking: false,
      minimaxApiKey: 'mm-key',
      minimaxVoiceId: 'female-yujie',
      minimaxSpeed: 1.25,
    });
  });

  it('merges aiSettings into existing global settings instead of overwriting other sections', async () => {
    const loadGlobalSettings = vi.fn().mockResolvedValue(
      JSON.stringify({
        selectedRole: 'deep-insight-podcast',
      }),
    );
    const saveGlobalSettings = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('window', {
      electronAPI: {
        loadGlobalSettings,
        saveGlobalSettings,
      },
    });

    await saveAISettings({
      llmProviders: [],
      defaultProviderId: null,
      defaultModel: null,
      llmBaseUrl: 'https://api.openai.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o',
      jimengApiUrl: 'https://jimeng.example.com',
      jimengSessionId: 'session-test',
      minimaxApiKey: '',
      minimaxVoiceId: 'male-qn-qingse',
      minimaxSpeed: 1.0,
    });

    expect(loadGlobalSettings).toHaveBeenCalledTimes(1);
    expect(saveGlobalSettings).toHaveBeenCalledTimes(1);

    const savedPayload = JSON.parse(saveGlobalSettings.mock.calls[0][0] as string);
    expect(savedPayload.selectedRole).toBe('deep-insight-podcast');
    expect(savedPayload.aiSettings.llmApiKey).toBe('sk-test');
  });

  it('supports workflow updates and reset', () => {
    useAIStore.getState().setWorkflow({
      step: 'tts_generating',
      progress: 42,
      stepLabel: '正在生成语音…',
      canCancel: true,
    });

    expect(useAIStore.getState().workflow).toMatchObject({
      step: 'tts_generating',
      progress: 42,
      stepLabel: '正在生成语音…',
      canCancel: true,
      error: null,
    });

    useAIStore.getState().resetWorkflow();

    expect(useAIStore.getState().workflow).toEqual({
      step: 'idle',
      progress: 0,
      stepLabel: '',
      error: null,
      canCancel: false,
      failedStep: null,
    });
  });

  it('clearing analysis error does not cancel an in-flight analyze state', () => {
    useAIStore.getState().setAnalyzing(true);
    useAIStore.getState().setAnalysisError(null);

    expect(useAIStore.getState().isAnalyzing).toBe(true);
    expect(useAIStore.getState().analysisError).toBeNull();
  });
});

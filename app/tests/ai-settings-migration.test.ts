import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadAISettings } from '../src/store/ai';

describe('loadAISettings 视频字段迁移', () => {
  let originalLocal: Storage | undefined;

  beforeEach(() => {
    originalLocal = (globalThis as any).localStorage;
    const store: Record<string, string> = {};
    const fakeLocal: Storage = {
      get length() {
        return Object.keys(store).length;
      },
      clear() {
        for (const k of Object.keys(store)) delete store[k];
      },
      getItem(k) {
        return store[k] ?? null;
      },
      key(i) {
        return Object.keys(store)[i] ?? null;
      },
      removeItem(k) {
        delete store[k];
      },
      setItem(k, v) {
        store[k] = String(v);
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: fakeLocal, electronAPI: undefined },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeLocal,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalLocal !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocal,
        configurable: true,
        writable: true,
      });
    }
  });

  it('legacy settings 缺 videoProviders 三件套时补默认', async () => {
    const legacy = {
      llmProviders: [],
      defaultProviderId: null,
      defaultModel: null,
      llmBaseUrl: '',
      llmApiKey: '',
      llmModel: '',
      jimengApiUrl: '',
      jimengSessionId: '',
      minimaxApiKey: '',
      minimaxVoiceId: '',
      minimaxSpeed: 1,
      imageProviders: [],
      defaultImageProviderId: null,
      defaultImageModel: null,
      promptBindings: {},
    };
    (globalThis as any).window.localStorage.setItem(
      'podcast-editor-ai-settings',
      JSON.stringify(legacy),
    );
    const settings = await loadAISettings();
    expect(settings).not.toBeNull();
    expect(settings!.videoProviders).toEqual([]);
    expect(settings!.defaultVideoProviderId).toBeNull();
    expect(settings!.defaultVideoModel).toBeNull();
  });
});

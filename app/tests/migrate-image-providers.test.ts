import { describe, expect, it } from 'vitest';
import type { AISettings } from '../src/types/ai';
import { migrateImageProviders, migrateImageProvidersV2 } from '../src/lib/llm/migrate-image-providers';

function baseSettings(): AISettings {
  return {
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
}

describe('migrateImageProviders', () => {
  it('已迁移（imageProviders 非空）时直接返回，幂等', () => {
    const s: AISettings = {
      ...baseSettings(),
      imageProviders: [{
        id: 'x', name: 'X', type: 'custom',
        baseUrl: 'u', apiKey: 'k', models: ['m'],
        extras: {},
      }],
    };
    expect(migrateImageProviders(s)).toBe(s);
  });

  it('无即梦配置：返回空 imageProviders 列表', () => {
    const s = baseSettings();
    const next = migrateImageProviders(s);
    expect(next.imageProviders).toEqual([]);
    expect(next.defaultImageProviderId).toBeNull();
    expect(next.defaultImageModel).toBeNull();
  });

  it('已是空 imageProviders + 默认值且无 jimeng 配置：返回同引用（幂等）', () => {
    const s = baseSettings();
    expect(migrateImageProviders(s)).toBe(s);
  });

  it('有即梦配置：迁移成 imageProviders[0] 并清空旧字段', () => {
    const s: AISettings = {
      ...baseSettings(),
      jimengApiUrl: 'https://api.jimeng.com',
      jimengSessionId: 'sess-abc',
      jimengModel: 'jimeng-5.0',
    };
    const next = migrateImageProviders(s);
    expect(next.imageProviders).toHaveLength(1);
    expect(next.imageProviders[0]).toMatchObject({
      id: 'jimeng-default',
      name: '即梦',
      type: 'jimeng',
      baseUrl: 'https://api.jimeng.com',
      apiKey: 'sess-abc',
      models: ['jimeng-5.0'],
    });
    expect(next.defaultImageProviderId).toBe('jimeng-default');
    expect(next.defaultImageModel).toBe('jimeng-5.0');
    expect(next.jimengApiUrl).toBe('');
    expect(next.jimengSessionId).toBe('');
    expect(next.jimengModel).toBe('');
  });

  it('jimengModel 缺失时使用 DEFAULT_JIMENG_MODEL', () => {
    const s: AISettings = {
      ...baseSettings(),
      jimengApiUrl: 'https://api.jimeng.com',
      jimengSessionId: 'sess-abc',
    };
    const next = migrateImageProviders(s);
    expect(next.imageProviders[0].models).toEqual(['jimeng-5.0']);
    expect(next.defaultImageModel).toBe('jimeng-5.0');
  });
});

describe('migrateImageProvidersV2', () => {
  it('既有 jimeng 配置，extras 缺失 → 补 extras: {}', () => {
    const s: AISettings = {
      ...baseSettings(),
      imageProviders: [{
        id: 'jimeng-default',
        name: '即梦',
        type: 'jimeng',
        baseUrl: 'https://api.jimeng.com',
        apiKey: 'sess-abc',
        models: ['jimeng-5.0'],
        // extras 故意不提供
      }],
      defaultImageProviderId: 'jimeng-default',
      defaultImageModel: 'jimeng-5.0',
    };
    const next = migrateImageProvidersV2(s);
    expect(next.imageProviders[0].extras).toEqual({});
  });

  it('imageProviders 为空 → 直接返回同引用（不变）', () => {
    const s = baseSettings();
    expect(migrateImageProvidersV2(s)).toBe(s);
  });

  it("type='openai_image' + models=[] → 自动填 ['gpt-image-1']", () => {
    const s: AISettings = {
      ...baseSettings(),
      imageProviders: [{
        id: 'oi-1',
        name: 'OpenAI Image',
        type: 'openai_image',
        baseUrl: '',
        apiKey: 'sk-xxx',
        models: [],
      }],
      defaultImageProviderId: 'oi-1',
      defaultImageModel: null,
    };
    const next = migrateImageProvidersV2(s);
    expect(next.imageProviders[0].models).toEqual(['gpt-image-1']);
  });

  it("type='wanx' + models=['custom'] → 不覆盖（保留用户自定义）", () => {
    const s: AISettings = {
      ...baseSettings(),
      imageProviders: [{
        id: 'wanx-1',
        name: 'WanX',
        type: 'wanx',
        baseUrl: '',
        apiKey: 'k',
        models: ['custom'],
      }],
      defaultImageProviderId: 'wanx-1',
      defaultImageModel: 'custom',
    };
    const next = migrateImageProvidersV2(s);
    expect(next.imageProviders[0].models).toEqual(['custom']);
  });

  it('旧路径（jimengApiUrl 存在但 imageProviders 空）→ 完成迁移并通过 V2 兜底', () => {
    // 旧字段有配置、imageProviders 为空 → migrateImageProviders 负责 V1 迁移，然后串联 V2
    const s: AISettings = {
      ...baseSettings(),
      jimengApiUrl: 'https://api.jimeng.com',
      jimengSessionId: 'sess-xyz',
      jimengModel: 'jimeng-5.0',
    };
    const next = migrateImageProviders(s);
    // V1 迁移生成的 jimeng provider 无 extras，V2 应补上
    expect(next.imageProviders).toHaveLength(1);
    expect(next.imageProviders[0].extras).toEqual({});
    expect(next.imageProviders[0].models).toEqual(['jimeng-5.0']);
    expect(next.jimengApiUrl).toBe('');
    expect(next.jimengSessionId).toBe('');
  });
});

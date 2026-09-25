import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../src/types/ai';

vi.mock('../src/lib/llm/model', () => {
  return {
    createChatModelFromProvider: vi.fn(),
  };
});

import { testProviderModel } from '../src/lib/llm/test-provider';
import { createChatModelFromProvider } from '../src/lib/llm/model';

const provider: LLMProvider = {
  id: 'A',
  name: 'A',
  type: 'openai_compatible',
  baseUrl: 'https://example.com',
  apiKey: 'sk-x',
  models: ['gpt-test'],
};

describe('testProviderModel', () => {
  beforeEach(() => {
    vi.mocked(createChatModelFromProvider).mockReset();
  });

  it('成功路径返回耗时与回复文本', async () => {
    let nowCalls = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      nowCalls += 1;
      return nowCalls === 1 ? 100 : 237;
    });
    vi.mocked(createChatModelFromProvider).mockReturnValue({
      invoke: vi.fn(async () => ({ content: '  pong  ' })),
    } as unknown as ReturnType<typeof createChatModelFromProvider>);

    const result = await testProviderModel(provider, 'gpt-test');

    expect(result.latencyMs).toBe(137);
    expect(result.reply).toBe('pong');
    expect(createChatModelFromProvider).toHaveBeenCalledWith(provider, 'gpt-test');
    nowSpy.mockRestore();
  });

  it('模型名为空时直接抛错，不构造 chat model', async () => {
    await expect(testProviderModel(provider, '   ')).rejects.toThrow('未指定模型名');
    expect(createChatModelFromProvider).not.toHaveBeenCalled();
  });

  it('底层调用抛错时向上传递 Error', async () => {
    vi.mocked(createChatModelFromProvider).mockReturnValue({
      invoke: vi.fn(async () => {
        throw new Error('HTTP 401 - Unauthorized');
      }),
    } as unknown as ReturnType<typeof createChatModelFromProvider>);

    await expect(testProviderModel(provider, 'gpt-test')).rejects.toThrow('HTTP 401');
  });
});

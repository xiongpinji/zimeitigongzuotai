import { describe, expect, it } from 'vitest';
import {
  createChatModelFromProvider,
  resolveMiniMaxThinking,
  resolveMiniMaxMaxTokens,
} from '../src/lib/llm/model';
import type { LLMProvider } from '../src/types/ai';

describe('createChatModelFromProvider (minimax)', () => {
  const provider: LLMProvider = {
    id: 'mm',
    name: 'minimax',
    type: 'minimax',
    baseUrl: '',
    apiKey: 'sk-test',
    models: ['MiniMax-M3'],
    enableThinking: false,
  };

  it('streams for MiniMax so invoke() avoids the non-streaming null-content crash', () => {
    // MiniMax 的 Anthropic 端点非流式响应 content 为 null，会让 ChatAnthropic 读 null.length 崩溃；
    // 强制 streaming 让 invoke() 也走流式聚合路径（与真实生成一致）。
    const model = createChatModelFromProvider(provider, 'MiniMax-M3');
    expect((model as unknown as { streaming?: boolean }).streaming).toBe(true);
  });
});

describe('resolveMiniMaxThinking', () => {
  it('disables thinking when enableThinking is false', () => {
    expect(resolveMiniMaxThinking(false, 4096)).toEqual({ type: 'disabled' });
  });

  it('enables thinking with the requested budget when thinking is on', () => {
    expect(resolveMiniMaxThinking(true, 4096)).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('clamps the budget to the Anthropic minimum of 1024', () => {
    expect(resolveMiniMaxThinking(true, 200)).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('falls back to a bounded default budget when none is provided', () => {
    expect(resolveMiniMaxThinking(true, undefined)).toEqual({
      type: 'enabled',
      budget_tokens: 1024,
    });
  });
});

describe('resolveMiniMaxMaxTokens', () => {
  it('leaves room for the answer on top of the thinking budget', () => {
    // max_tokens 必须严格大于 thinking.budget_tokens，且要给正文留足空间（否则 TSX 被截断→黑屏）
    expect(resolveMiniMaxMaxTokens({ type: 'enabled', budget_tokens: 4096 })).toBeGreaterThan(4096);
    expect(resolveMiniMaxMaxTokens({ type: 'enabled', budget_tokens: 4096 })).toBe(4096 + 8192);
  });

  it('uses the plain content allowance when thinking is disabled', () => {
    expect(resolveMiniMaxMaxTokens({ type: 'disabled' })).toBe(8192);
  });
});

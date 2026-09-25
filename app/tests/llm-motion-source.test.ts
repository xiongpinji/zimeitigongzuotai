import { describe, expect, it, vi } from 'vitest';
import { extractMotionCardSource } from '../src/lib/llm/content';
import type { AISettings } from '../src/types/ai';

const COMPONENT = `import { AbsoluteFill, useCurrentFrame } from 'remotion';
export default function MotionCard() {
  const frame = useCurrentFrame();
  return <AbsoluteFill>{frame}</AbsoluteFill>;
}`;

describe('extractMotionCardSource', () => {
  it('extracts the TSX from a fenced ```tsx block surrounded by prose', () => {
    const raw = `好的，这是卡片组件：\n\n\`\`\`tsx\n${COMPONENT}\n\`\`\`\n\n希望符合要求。`;
    expect(extractMotionCardSource(raw)).toBe(COMPONENT);
  });

  it('returns raw content when there is no fence but it is a valid component', () => {
    expect(extractMotionCardSource(`\n${COMPONENT}\n`)).toBe(COMPONENT);
  });

  it('prefers the fenced block that contains export default when multiple blocks exist', () => {
    const raw = `先看依赖：\n\n\`\`\`bash\nnpm i remotion\n\`\`\`\n\n再看组件：\n\n\`\`\`tsx\n${COMPONENT}\n\`\`\``;
    expect(extractMotionCardSource(raw)).toBe(COMPONENT);
  });

  it('throws when the model returned no usable component (no export default)', () => {
    expect(() => extractMotionCardSource('抱歉，我无法生成这个卡片。')).toThrow(/motionCard/);
  });

  it('throws when the component has export default but no JSX (incomplete / stubbed body)', () => {
    // 真实失败样本：模型只搭了变量骨架就用注释收尾，没有 return 任何 JSX → 渲染全黑
    const stub = `import { useCurrentFrame } from 'remotion';
export default function PCBInsight() {
  const frame = useCurrentFrame();
  const durationInFrames = 180;
  // ... build out the rest
}`;
    expect(() => extractMotionCardSource(stub)).toThrow(/完整|JSX|请重新生成/);
  });

  it('throws when the component only returns null (renders nothing)', () => {
    expect(() => extractMotionCardSource('export default () => null;')).toThrow(/完整|JSX|请重新生成/);
  });
});

// ---- generateMotionCardSource (streaming + extraction, no json_object bind) ----

function asAsyncIterable(...chunks: Array<{ content: unknown }>) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= chunks.length) return { value: undefined, done: true } as const;
          return { value: chunks[i++], done: false } as const;
        },
        async return() {
          return { value: undefined, done: true } as const;
        },
      };
    },
  };
}

const bindSpy = vi.fn();

const DEFAULT_STREAM = async () =>
  asAsyncIterable({
    content: `这是组件：\n\n\`\`\`tsx\nimport { AbsoluteFill, useCurrentFrame } from 'remotion';\nexport default function MotionCard() {\n  const frame = useCurrentFrame();\n  return <AbsoluteFill>{frame}</AbsoluteFill>;\n}\n\`\`\``,
  });

// 各用例可覆盖 streamImpl 以控制每次 stream 的返回（含按调用次数变化）
let streamImpl: () => Promise<ReturnType<typeof asAsyncIterable>> = DEFAULT_STREAM;

vi.mock('../src/lib/llm/model', () => {
  return {
    createChatModel: vi.fn(() => ({
      // 若被绑定 json_object 则记录下来——motion 源码生成不应该走 json mode
      bind: (kwargs: Record<string, unknown>) => {
        bindSpy(kwargs);
        return { stream: async () => asAsyncIterable({ content: '{}' }) };
      },
      stream: () => streamImpl(),
    })),
    createChatModelFromProvider: vi.fn(),
  };
});

import { generateMotionCardSource } from '../src/lib/llm';

const settings: AISettings = {
  llmProviders: [],
  defaultProviderId: '',
  defaultModel: '',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  jimengApiUrl: '',
  jimengSessionId: '',
} as unknown as AISettings;

describe('generateMotionCardSource', () => {
  it('streams free text and returns the extracted TSX, without forcing json_object', async () => {
    bindSpy.mockClear();
    streamImpl = DEFAULT_STREAM;
    const tsx = await generateMotionCardSource(settings, 'system', 'user');
    expect(tsx).toContain('export default function MotionCard');
    expect(tsx).not.toContain('```');
    // 关键：不得用 response_format json_object 绑定模型（那正是旧版崩溃的根因）
    expect(bindSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ response_format: expect.anything() }),
    );
  });
});

// ---- smoke-render retry: validate 抛错应触发重试，把错误作为提示反馈给模型 ----

const BAD_TSX = `import { AbsoluteFill, useCurrentFrame } from 'remotion';
export default function MotionCard() {
  const frame = useCurrentFrame();
  const stepEnd = [s + 12, frame];
  return <AbsoluteFill>{stepEnd[1]}</AbsoluteFill>;
}`;

const GOOD_TSX = `import { AbsoluteFill, useCurrentFrame } from 'remotion';
export default function MotionCard() {
  const frame = useCurrentFrame();
  return <AbsoluteFill>{frame}</AbsoluteFill>;
}`;

function fence(tsx: string) {
  return { content: `这是组件：\n\n\`\`\`tsx\n${tsx}\n\`\`\`` };
}

describe('generateMotionCardSource + validate (smoke-render retry)', () => {
  it('retries when validate throws, returning the good component on the second attempt', async () => {
    let calls = 0;
    streamImpl = async () => {
      calls += 1;
      return asAsyncIterable(calls === 1 ? fence(BAD_TSX) : fence(GOOD_TSX));
    };
    const validate = async (tsx: string) => {
      if (tsx.includes('s + 12')) throw new Error('bad: s is not defined');
    };
    const tsx = await generateMotionCardSource(settings, 'system', 'user', undefined, {
      validate,
    });
    expect(tsx).toContain('export default function MotionCard');
    expect(tsx).not.toContain('s + 12');
    expect(calls).toBe(2);
  });

  it('rejects after exhausting retries when validate always throws', async () => {
    let calls = 0;
    streamImpl = async () => {
      calls += 1;
      return asAsyncIterable(fence(BAD_TSX));
    };
    const validate = async () => {
      throw new Error('always bad');
    };
    await expect(
      generateMotionCardSource(settings, 'system', 'user', undefined, { validate }),
    ).rejects.toThrow(/always bad/);
    // STRUCTURED_MAX_RETRIES = 2 → 3 次尝试
    expect(calls).toBe(3);
  });
});

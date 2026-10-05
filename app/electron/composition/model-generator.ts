/** Constrained model request: only approved anonymous brief fields leave the main process. */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createChatModelFromProvider } from '../../src/lib/llm/model';
import type { AISettings } from '../../src/types/ai';
import type { CompositionProposalBrief } from './plan-proposals';

const SYSTEM = `你是短视频剪辑策划。只返回一个严格 JSON 对象，形如 {"plans":[...]}, 不要 Markdown。
生成恰好三份不同中心问题、不同证据组织方式的独立叙事候选，不可只换标题、封面、BGM 或随机改顺序。
每份 plan 顶层只能有 narrativeSummary、voiceoverKind="original-audio"、aspectRatio、editorial、segments 这五个字段。plan 顶层绝不能有 visualLayer。
editorial 必须有 targetAudience、centralQuestion、openingClaim、endingMessage。
每个 segment 必须有 description、source:{kind:"highlight",sourceId,inMs,outMs}、editorial:{narrativeRole,visualIntent,audioIntent}。
可选 visualLayer 只能放在某个 segment 内，且必须是单个对象 {assetId,sourceInMs,startAtMs,durationMs,purpose}，绝不能在 plan 顶层，也不能是数组；只能引用输入 assets 中的 id。
只可引用输入提供的高光 ID 和绝对毫秒时间码；不得虚构素材、商品事实、人物承诺或权利信息。
候选不是原创判定或发布许可，后续仍需人工审阅。`;

export class CompositionModelError extends Error {
  constructor(readonly code: 'model_unavailable' | 'invalid_model_output') {
    super(code); this.name = 'CompositionModelError';
  }
}

export function configuredCompositionModel(settings: AISettings): {
  model: string;
  generate: (brief: CompositionProposalBrief) => Promise<unknown>;
} {
  const provider = settings.llmProviders.find((item) => item.id === settings.defaultProviderId);
  const model = provider?.defaultModel ?? settings.defaultModel;
  if (!provider || !model || !provider.models.includes(model)) {
    throw new CompositionModelError('model_unavailable');
  }
  return {
    model,
    async generate(brief) {
      const encoded = JSON.stringify(brief);
      if (encoded.length > 30_000) throw new CompositionModelError('invalid_model_output');
      const client = createChatModelFromProvider(provider, model);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      let content: unknown;
      try {
        const result = await client.invoke([new SystemMessage(SYSTEM),
          new HumanMessage(`已由用户审核并匿名化的素材摘要：${encoded}`)],
        { signal: controller.signal });
        content = result.content;
      } catch { throw new CompositionModelError('model_unavailable'); }
      finally { clearTimeout(timer); }
      if (typeof content !== 'string' || content.length > 100_000) {
        return null;
      }
      const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try {
        const parsed = JSON.parse(cleaned) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { plans?: unknown }).plans ?? null : null;
      } catch { return null; }
    },
  };
}

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LLMProvider } from '../../types/ai';
import { createChatModelFromProvider } from './model';
import { extractTextContent } from './content';

export interface ProviderTestResult {
  latencyMs: number;
  reply: string;
}

const PROBE_SYSTEM = 'You are a connectivity probe. Reply with a single word: pong.';
const PROBE_USER = 'ping';

/**
 * 对指定 Provider+模型发送最小探针消息，返回耗时（毫秒）与去空白后的回复文本。
 * 失败统一抛出携带可读 message 的 Error，调用方负责展示。
 */
export async function testProviderModel(
  provider: LLMProvider,
  model: string,
): Promise<ProviderTestResult> {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    throw new Error('未指定模型名');
  }

  const chatModel = createChatModelFromProvider(provider, trimmedModel);
  const started = performance.now();
  const response = await chatModel.invoke([
    new SystemMessage(PROBE_SYSTEM),
    new HumanMessage(PROBE_USER),
  ]);
  const latencyMs = Math.round(performance.now() - started);
  const reply = extractTextContent(response.content).trim();
  return { latencyMs, reply };
}

import type { UserPromptEntry } from '../prompts/types';

/** 模板未配置 ttsStyle 时的兜底演绎人设。 */
export const DEFAULT_MIMO_STYLE =
  '用自然、亲切、有分享欲的口播状态来念，像在跟懂行的朋友交流而不是照稿播报；语速中等偏快、有节奏感；抛出观点或关键数据前可略作停顿，讲到亮点时语气微微上扬，陈述事实时沉稳清晰；避免平铺直叙的播音腔与机械感。';

export function resolveMimoStyleInstruction(template: UserPromptEntry | undefined): string {
  const style = template?.ttsStyle?.trim();
  return style || DEFAULT_MIMO_STYLE;
}

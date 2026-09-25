export const PROMPT_KINDS = [
  'planning.segment',
  'cover.regeneration',
  'cards.segment',
  'cards.animation',
  'script.review',
  'card.image',
  'card.video',
  'publish.metadata',
  'publish.partition',
] as const;

export type PromptKind = (typeof PROMPT_KINDS)[number];

export function isPromptKind(value: unknown): value is PromptKind {
  return typeof value === 'string' && (PROMPT_KINDS as readonly string[]).includes(value);
}

export type PromptScope = 'builtin' | 'global' | 'project';

export type PromptGroup = 'project' | 'ai-analysis' | 'script';

export const PROMPT_CATEGORIES = ['script-template'] as const;
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export function isPromptCategory(value: unknown): value is PromptCategory {
  return typeof value === 'string' && (PROMPT_CATEGORIES as readonly string[]).includes(value);
}

export interface PromptCategoryMeta {
  category: PromptCategory;
  label: string;
  description: string;
  group: PromptGroup;
  variables: { name: string; description: string }[];
  allowAdd: boolean;
  allowDelete: boolean;
}

export const PROMPT_CATEGORY_META: Record<PromptCategory, PromptCategoryMeta> = {
  'script-template': {
    category: 'script-template',
    label: '口播模板',
    description: '写稿风格模板。system 段放写作指令，user 段会被原始素材替换',
    group: 'script',
    variables: [
      { name: 'rawText', description: '原始素材内容（用户提供的 original.md）' },
    ],
    allowAdd: true,
    allowDelete: true,
  },
};

export interface UserPromptEntry {
  id: string;
  category: PromptCategory;
  name: string;
  description: string;
  version?: number;
  system: string;
  user: string;
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** MiMo 演绎人设：原样作为 MiMo role:user 指令；仅 MiMo 使用 */
  ttsStyle?: string;
  /** 打标风格倾向：注入打标 prompt 的一句话偏好 */
  ttsAnnotateHint?: string;
}

export interface UserPromptSeed {
  id: string;
  category: PromptCategory;
  name: string;
  description: string;
  version: number;
  system: string;
  user: string;
  /** MiMo 演绎人设：原样作为 MiMo role:user 指令；仅 MiMo 使用 */
  ttsStyle?: string;
  /** 打标风格倾向：注入打标 prompt 的一句话偏好 */
  ttsAnnotateHint?: string;
}

/**
 * 用户自定义提示词条目的绑定 key。与 PromptKind 共享 PromptBindingMap 的 key 空间，
 * 但通过 `user:` 前缀隔离，避免与内置 kind 冲突。
 */
export function userPromptBindingKey(category: PromptCategory, id: string): string {
  return `user:${category}:${id}`;
}

/** 解析用户提示词绑定 key；非 user 前缀返回 null */
export function parseUserPromptBindingKey(
  key: string,
): { category: PromptCategory; id: string } | null {
  if (!key.startsWith('user:')) return null;
  const rest = key.slice('user:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const category = rest.slice(0, sep);
  const id = rest.slice(sep + 1);
  if (!isPromptCategory(category)) return null;
  if (!id) return null;
  return { category, id };
}

export interface PromptTemplate {
  name: string;
  description?: string;
  version?: number;
  system?: string;
  user: string;
}

export interface EffectivePromptTemplate extends PromptTemplate {
  sourceScope: PromptScope;
}

export interface LockedContract {
  /** 拼接位置；当前统一用 user-tail，保留扩展性 */
  position: 'user-tail';
  /** 实际拼进 prompt 的文本 */
  content: string;
  /** 给用户的说明，解释为何不可编辑 */
  reason: string;
}

export interface PromptKindMeta {
  kind: PromptKind;
  label: string;
  description: string;
  group: PromptGroup;
  variables: { name: string; description: string }[];
  /** 业务契约段：每次请求自动拼接，UI 只读展示 */
  lockedContract?: LockedContract;
}

const LOCKED_PLANNING_SEGMENT = `【系统契约 · 不可修改】
输出必须是严格 JSON，且只返回 JSON，不要附加解释。

顶层结构必须包含：
- segments: 按整期时长动态规划；短稿 4-8 段，中稿 8-16 段，长稿按 30-45 秒拆分，可超过 30 段
- coverPrompts: 数组，且只能包含 1 条字符串
- summary: 一句话总结
- keywords: 关键词数组
- globalPrompt: 沿用输入的整期创作提示词，没有则返回空字符串

segments 中每一项必须包含：
- id
- title
- summary
- startMs (number, 毫秒)
- endMs (number, 毫秒)
- transcriptExcerpt
- semanticType: data | explanation | chapter-transition | quote | narration
- complexityLevel: low | medium | high
- visualizationScore: 0-100
- pacingNeed: steady | accent | transition
- keywords: 该段关键词数组
- entities: 该段关键实体数组`;

const LOCKED_COVER_REGENERATION = `【系统契约 · 不可修改】
输出必须是严格 JSON，且只返回 JSON，不要附加解释。

顶层结构必须包含：
- coverPrompts: 数组，且只能包含 1 条字符串`;

const LOCKED_CARDS_SEGMENT = `【系统契约 · 不可修改】
只输出**一个 \`\`\`tsx 代码块**，块内是单文件 Remotion 函数组件并 export default；代码块之外不要写任何文字、解释或 JSON。
组件从 "remotion" 引入 useCurrentFrame/useVideoConfig/interpolate/spring/Easing/AbsoluteFill/Sequence，从 "react" 引入所需 API；动画必须是 useCurrentFrame() 的纯函数；禁止 fetch/setTimeout/setInterval/Math.random/new Date/requestAnimationFrame 等非确定性或副作用 API。
组件必须完整：函数体内必须 return 真实 JSX（至少一个 <AbsoluteFill> 根节点），严禁用 “// ... build out the rest”/“// TODO”/“…” 等注释收尾或 return null，否则渲染黑屏视为失败。
卡片的标题 / 时间 / 类型 / 样式等元信息由系统从 segment 合成，不需要、也不要在代码里或代码外输出这些字段。`;

const LOCKED_SCRIPT_REVIEW = `【系统契约 · 不可修改】
请以严格 JSON 格式返回审查结果，且只返回 JSON：
{
  "annotations": [
    {
      "originalText": "需要标注的原文片段（必须是稿件中的精确子串）",
      "issue": "问题描述",
      "suggestion": "修改建议（替换后的完整文本）",
      "severity": "error | warning | info"
    }
  ]
}

字段约束：
- originalText 必须是稿件中能精确匹配的子串
- severity 必须是 error | warning | info 之一
- suggestion 必须是可以直接替换 originalText 的完整文本`;

const LOCKED_CARD_IMAGE = `【系统契约 · 不可修改】
只输出**一段连续的简体中文文生图提示词**，不要附加任何前缀、后缀、解释、标题、列表、JSON 或 markdown 代码块。
不要包裹引号；不要换行；不要标注"提示词："或"Prompt:"等前导文本。
画面中禁止出现任何文字 / UI 元素 / Logo / 水印 / 字幕条。`;

const LOCKED_PUBLISH_METADATA = `【系统契约 · 不可修改】
只返回严格 JSON，不要任何解释、前后缀或多余文本，结构如下：
{ "title": "字符串", "desc": "字符串", "tags": ["标签1", "标签2"] }`;

const LOCKED_PUBLISH_PARTITION = `【系统契约 · 不可修改】
只返回严格 JSON，不要任何解释、前后缀或多余文本，结构如下：
{ "tid": 数字 }
其中 tid 必须是【可选分区清单】里列出的某个 tid，不得自创、不得返回主分区或清单外的数字。`;

export const PROMPT_KIND_META: Record<PromptKind, PromptKindMeta> = {
  'planning.segment': {
    kind: 'planning.segment',
    label: '字幕分段规划',
    description: '整篇字幕拆分为多个语义段落，并给出 1 条封面提示词、总结、关键词',
    group: 'ai-analysis',
    variables: [
      { name: 'globalPromptLine', description: '额外创作要求行；有值时形如"额外创作要求：xxx"，无值为空字符串' },
    ],
    lockedContract: {
      position: 'user-tail',
      content: LOCKED_PLANNING_SEGMENT,
      reason: '业务侧按此 schema 解析分段数据、封面提示词、关键词；修改会导致分析结果无法落库。',
    },
  },
  'cover.regeneration': {
    kind: 'cover.regeneration',
    label: '封面提示词重生成',
    description: '根据字幕与现有提示词重生成单条 16:9 播客封面提示词',
    group: 'ai-analysis',
    variables: [
      { name: 'globalPrompt', description: '整期创作提示词（为空填"无"）' },
      { name: 'currentPrompt', description: '当前封面提示词（为空填"无"）' },
      { name: 'styleSystemBlock', description: '系统风格库注入的视觉系统块；由所选风格预设的对应 facet 决定' },
    ],
    lockedContract: {
      position: 'user-tail',
      content: LOCKED_COVER_REGENERATION,
      reason: '业务侧从 JSON.coverPrompts[0] 读取提示词；修改会导致封面重生成无法解析。',
    },
  },
  'cards.segment': {
    kind: 'cards.segment',
    label: '段落信息卡片生成',
    description: '围绕单个 segment 生成一张 Motion Card（Remotion TSX 组件，需校验通过）',
    group: 'ai-analysis',
    variables: [
      { name: 'globalPrompt', description: '整期创作提示词' },
      { name: 'programSummary', description: '节目级总结' },
      { name: 'keywords', description: '节目关键词（顿号分隔）' },
      { name: 'segmentId', description: 'segment id' },
      { name: 'segmentTitle', description: 'segment 标题' },
      { name: 'segmentSummary', description: 'segment 摘要' },
      { name: 'segmentStartMs', description: 'segment 起始毫秒' },
      { name: 'segmentEndMs', description: 'segment 结束毫秒' },
      { name: 'segmentTranscriptExcerpt', description: 'segment 原始摘录' },
      { name: 'segmentCues', description: '本段逐句字幕节拍列表（[k] +秒数 文本；索引 k 与运行时 cues 数组对齐），供模型把焦点元素锚到讲出它的那一句' },
      { name: 'segmentVisualType', description: '上游判定的卡片形式：motion 或 image' },
      { name: 'cardPrompt', description: '单卡追加提示词' },
      { name: 'animationDirection', description: '本卡逐拍动画脚本（cards.animation 产出；无则为"无"）' },
      { name: 'currentCardSection', description: '当前卡片线索多行块（由调用方构造）' },
      { name: 'programContext', description: '节目级浓缩上下文（节目摘要、关键词、当前段在整期中的位置）' },
      { name: 'fullTranscript', description: '兼容旧模板：与 programContext 同值，不再注入完整全文，避免 token 爆炸' },
      { name: 'sandboxReference', description: 'Remotion Motion 组件运行时约束（cards.segment 校验 motion-card 所需）' },
      { name: 'styleSystemBlock', description: '系统风格库注入的视觉系统块；由所选风格预设的对应 facet 决定' },
    ],
    lockedContract: {
      position: 'user-tail',
      content: LOCKED_CARDS_SEGMENT,
      reason: '业务侧按此结构创建 AICard 并对 motionCard.tsx 做 Remotion 组件校验；修改会导致卡片无法渲染。',
    },
  },
  'cards.animation': {
    kind: 'cards.animation',
    label: '动画指导生成',
    description: '为单个 motion 段落生成逐拍动画脚本（自然语言），供 cards.segment 出卡时遵循其节拍与形变意图',
    group: 'ai-analysis',
    variables: [
      { name: 'globalPrompt', description: '整期创作提示词（为空填"无"）' },
      { name: 'programSummary', description: '节目级总结（为空填"无"）' },
      { name: 'keywords', description: '节目关键词（顿号分隔，无则为"无"）' },
      { name: 'segmentId', description: 'segment id' },
      { name: 'segmentTitle', description: 'segment 标题' },
      { name: 'segmentStartMs', description: 'segment 起始毫秒' },
      { name: 'segmentEndMs', description: 'segment 结束毫秒' },
      { name: 'segmentSummary', description: 'segment 摘要' },
      { name: 'segmentTranscriptExcerpt', description: 'segment 原始摘录' },
      { name: 'segmentCues', description: '本段逐句字幕节拍列表（[k] +秒数 文本；索引 k 与运行时 cues 对齐）' },
      { name: 'cardPrompt', description: '用户单卡追加提示词（风格/语气参考；无则为"无"）' },
    ],
  },
  'script.review': {
    kind: 'script.review',
    label: '文稿 AI 审查',
    description: '口播稿审稿提示词。模型返回 annotations JSON（originalText/issue/suggestion/severity）',
    group: 'script',
    variables: [
      { name: 'scriptText', description: '待审查的完整口播稿正文' },
    ],
    lockedContract: {
      position: 'user-tail',
      content: LOCKED_SCRIPT_REVIEW,
      reason: '业务侧按 annotations[] 定位批注；修改会让审查结果无法在编辑器中展示。',
    },
  },
  'card.image': {
    kind: 'card.image',
    label: '段落图片卡',
    description:
      '为单个 segment 生成中文文生图提示词；由 cards.segment 拆出 image 卡片后单独调用，产物用于 image provider 文生图',
    group: 'ai-analysis',
    variables: [
      { name: 'globalPrompt', description: '整期创作提示词（为空填"无"）' },
      { name: 'programSummary', description: '节目级总结（为空填"无"）' },
      { name: 'keywords', description: '节目关键词（顿号分隔，无则为"无"）' },
      { name: 'segmentId', description: 'segment id' },
      { name: 'segmentTitle', description: 'segment 标题' },
      { name: 'segmentSummary', description: 'segment 摘要' },
      { name: 'segmentExcerpt', description: 'segment 字幕摘录' },
      { name: 'cardTitle', description: '卡片标题（cards.segment 已确定）' },
      { name: 'cardContent', description: '卡片描述（cards.segment 已确定，承载视觉意象）' },
      { name: 'displayMode', description: '显示模式：fullscreen 或 pip' },
      { name: 'aspectRatio', description: '画幅比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4' },
      { name: 'cardPromptHint', description: '用户单卡追加提示词，可选（无则为"无"）' },
      { name: 'styleSystemBlock', description: '系统风格库注入的视觉系统块；由所选风格预设的对应 facet 决定' },
    ],
    lockedContract: {
      position: 'user-tail',
      content: LOCKED_CARD_IMAGE,
      reason:
        '业务侧直接把模型返回值作为文生图 prompt 喂给 ImageProvider；附加任何前后缀或 JSON 都会污染图像生成效果。',
    },
  },
  'card.video': {
    kind: 'card.video',
    label: '段落视频卡',
    description: '为单个 segment 生成 AI 视频卡的提示词；产物用于 video provider 文生视频',
    group: 'ai-analysis',
    variables: [
      { name: 'segmentTitle', description: 'segment 标题' },
      { name: 'segmentSummary', description: 'segment 摘要' },
      { name: 'segmentExcerpt', description: 'segment 字幕摘录' },
      { name: 'displayMode', description: '显示模式：fullscreen 或 pip' },
      { name: 'aspectRatio', description: '画幅比例：16:9 / 9:16 / 1:1' },
      { name: 'durationSeconds', description: '视频时长（秒），档位由 provider capabilities 决定' },
    ],
  },
  'publish.metadata': {
    kind: 'publish.metadata',
    label: '发布文案生成',
    description:
      '发布选项卡「AI 一键生成」标题 / 简介 / 标签。一次调用同时产出三者，标题受平台 30 字上限约束、硬控在 25 字内（含标点）。本提示词只写约束规则；【节目内容】与可选的【已有标题】由系统在请求时自动追加为内容消息，无需在此用变量占位。',
    group: 'project',
    variables: [],
    lockedContract: {
      position: 'user-tail',
      content: LOCKED_PUBLISH_METADATA,
      reason: '业务侧按 { title, desc, tags } 解析并回填发布表单；修改会导致生成结果无法落库。',
    },
  },
  'publish.partition': {
    kind: 'publish.partition',
    label: 'B站分区推荐',
    description:
      '发布选项卡「智能推荐分区」根据标题 / 描述自动选 B站投稿分区。本提示词只写选择规则；【标题】【描述】与【可选分区清单】由系统在请求时自动追加为内容消息，无需在此用变量占位。',
    group: 'project',
    variables: [],
    lockedContract: {
      position: 'user-tail',
      content: LOCKED_PUBLISH_PARTITION,
      reason: '业务侧按 { tid } 解析并校验回填分区选择器；修改会导致推荐结果无法落库。',
    },
  },
};

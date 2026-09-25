# 内容自适应动画指导（Content-Adaptive Animation Direction）设计

- 日期：2026-06-24
- 状态：设计已确认，待写实现计划
- 涉及范围：AI 卡片生成链路（Motion Card）、提示词体系、AICardInspector UI、IPC 三件套

## 1. 背景与问题

当前 Motion Card（AI 动画卡片）只走单一 PromptKind `cards.segment`（`src/lib/prompts/defaults.ts:67`），由它一把生成 `motionCard.tsx`。用户手填的「追加提示词」(`AICard.cardPrompt`) 会被截断到 240 字注入模板（`src/lib/ai-analysis.ts` `buildSegmentCardPrompt`，变量 `{{cardPrompt}}`，模板第 87 行）。

问题：用户反馈「整体动画效果不太好」。`cards.segment` 已经内置了通用「创作理念 / 节奏契约」，但它是**对所有卡片一视同仁的固定指令**，没有针对**这一张卡的具体内容**去编排动画节奏。用户希望：对每张内容不同的卡，先由 AI 生成一份**更适配该内容的动画提示词**，再喂给出卡环节。

## 2. 目标

- 在出卡前插入一步「内容 → 逐拍动画脚本」的 AI 转换，产出每张卡专属的 `animationDirection`。
- 这一步的「元提示词」纳入统一提示词配置，可全局/项目覆盖。
- 提供两档使用方式：默认全自动（无感生成），同时保留手动按钮（可单独重生成/微调、可预览后再出卡）。
- 从给定的黑白极简 MG 参考片中提炼可泛化的动画核心，写进元提示词默认内容，泛化到 PPT/解说类 MG 动画。

### 非目标（YAGNI）

- 不走 pi agent 运行时（已确认走普通 LLM 调用，理由见 §4）。
- 不为 image / video 卡生成动画指导（它们没有 tsx 动画）。
- 不改 `cards.segment` 的节奏契约/反禁忌等既有铁律，只新增一个「动画指导」注入位。
- 不引入新的渲染路径或运行时（仍是 Remotion + 帧驱动）。

## 3. 从参考提炼的动画核心（泛化到 PPT/解说 MG）

参考是一支「一镜到底连续形变」的黑白极简 MG 短片（点→线→网格→圆→球→UI→立方体→花→粒子→腕表→坍缩→LOGO）。可泛化的核心 6 条：

1. **连续形变叙事**：无硬切，上一拍的结束态 = 下一拍的开始态；元素之间靠 morph/变换衔接。
2. **单一焦点 + 固定机位**：中心不动，动效只在主体内部发生；一拍只讲一件事。
3. **分镜时序化**：内容拆成明确的时间拍，每拍一个清晰动作，跟内容节奏走。
4. **诞生→形变→消解三段式节拍**：每个元素出现、转化、再解构成下一个。
5. **有机缓动**：elastic ease-out 等「先快后慢」曲线；用脉动/高光标记转场，而非生硬出现。
6. **几何数理精准 + 极简视觉语言**：规整轨道、大留白、去装饰、单色/克制配色。

> 注：参考片的「黑白品牌片」具体美学不照搬（卡片有自己的电子杂志深色变体视觉体系），抽取的是**节奏与形变方法论**，落到 PPT/解说语境就是「跟着口播逐句、用形变而非硬切来推进单一焦点」。

## 4. 关键决策（已与用户确认）

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 触发方式 | **全自动 + 手动按钮并存**（C） | 默认无感，手动可控可预览 |
| 动画指导存放 | **新增独立字段 `AICard.animationDirection`**（B） | 与用户手写 `cardPrompt` 并存、各管各、不互相覆盖、不受 240 字截断 |
| 生成链路 | **普通 LLM 一次性调用**（A，复用 `src/lib/llm`） | 任务是纯「内容→文本」转换，不需要 agent 的工具/审批/流式 |
| PromptKind 命名 | **`cards.animation`** | 与 `cards.segment` 同族，归 `ai-analysis` 组 |
| 全自动开关 | `AISettings.autoAnimationDirection`，默认 `true` | 每卡多一次 LLM 调用，需可关 |
| 适用卡型 | **仅 motion 卡** | image/video 卡无 tsx 动画 |

## 5. 架构设计

### 5.1 数据模型

- `AICard` 新增 `animationDirection?: string`（`src/types/ai.ts`）。随 `aiAnalysis` 持久化进 `project.json`，无需迁移（旧卡读为 `undefined`，等价于「无」）。
- `PromptKind` 新增 `'cards.animation'`（`src/lib/prompts/types.ts:1-9`），并在 prompt 分组/元数据中归入 `ai-analysis` 组，使其出现在 `PromptsConfigTab`。
- `AISettings` 新增 `autoAnimationDirection?: boolean`（默认视为 `true`；`src/types/ai.ts`）。设置项 UI 放在 AI/卡片相关设置区，文案点明「每张卡会多一次 LLM 调用」。

### 5.2 生成链路（A 方案）

新增纯函数（`src/lib/ai-analysis.ts`）：

```
generateAnimationDirection(
  segment: AISegment,
  programContext: { summary; keywords; globalPrompt },
  settings: AISettings,
  options: {
    entries: SrtEntry[];          // 取本段 cues 节拍 / 句数
    cardPrompt?: string;          // 用户手写追加提示，作为风格补充上下文
    stylePresetId?: string;
    binding?: ResolvedBinding;    // cards.animation 的 project binding
    template?: PromptTemplate;    // 已解析的有效模板
    telemetry?: ...;
  },
): Promise<string>               // 返回纯文本动画脚本（非代码）
```

- 内部 `buildAnimationDirectionPrompt(...)` 渲染 `cards.animation` 模板（变量见 §6），经 `src/lib/llm` 的 `streamWithRetry` 调用（`bindJsonObject: false`，纯文本解析，去掉可能的 markdown 包裹）。
- **只对 motion 卡调用**；image/video 分支不触碰。

**全自动触发点**：在 `generateCardForSegment`（`src/lib/ai-analysis.ts`）的 motion 分支，出卡前：
- 若 `options.animationDirection` 已传入（手动场景）→ 直接用；
- 否则若 `settings.autoAnimationDirection !== false` 且当前为 motion 卡 → 先 `generateAnimationDirection(...)` 得到 direction；
- 失败兜底：catch 后以空串继续出卡（不阻断主流程，`cards.segment` 退回原有通用节奏契约），并在 telemetry/日志记一条 warning。

初始批量分析与单卡重生成（`regenerateAICard` → `generateCardForSegment`）都经此分支，自动覆盖两条路径。

**注入出卡**：`buildSegmentCardPrompt` 新增变量 `{{animationDirection}}`，在 `cards.segment` 模板 `{{cardPrompt}}`（第 87 行）之后并列注入；`animationDirection` 放宽截断至约 1200 字（`cardPrompt` 仍维持 240 字）。`cards.segment` 模板对应位置加一行引导：

```
- 动画指导（针对本卡内容编排的逐拍动画脚本，若有则在不违反上述铁律的前提下优先遵循其节拍与形变意图）：
{{animationDirection}}
```

### 5.3 持久化与 IPC

- `animationDirection` 走既有 `aiAnalysis` 持久化，无新增存储。
- 新增 IPC `generate-animation-direction`（手动按钮用），三件套同步：
  - `electron/main.ts`：注册 handler，内部走 `electron/pipeline/runs/card-run.ts` 复用 `loadEffectivePromptTemplate('cards.animation', ...)` + `buildRegenerateOptions` 同款加载逻辑，调用 `generateAnimationDirection`。
  - `electron/preload.ts`：暴露 `generateAnimationDirection(args)`。
  - `src/lib/electron-api.ts`：补类型契约，禁止与 preload 漂移。
- 入参对齐现有 `regenerateAICard` 的上下文（entries / card / segment / settings / globalPrompt / programSummary / keywords / projectDir / projectBindings）。

### 5.4 UI（C 的手动档）

`src/components/AICardInspector.tsx`（及其 hook `src/hooks/useAICardInspector.ts`）：

- 在「追加提示词」区域下方新增一块「**动画指导**」：
  - 一个 `Textarea` 显示/可编辑 `animationDirection`（rows 多一些，承载较长脚本）。
  - 一个「✨ 生成动画指导」按钮：调用新 IPC，**只重生成这段脚本写回 textarea，不立即出卡**；用户看/改后再点既有「重新生成」按钮出卡（此时 `animationDirection` 随 draft 一起带入）。
  - 仅 motion 卡显示该区块（image/video 卡隐藏）。
- 该操作 ≥2s，接入底部统一进度系统（`startTask`/`updateTask`/`completeTask`/`failTask`，`src/store/task-progress.ts`），不另起弹窗/内联进度。

## 6. 元提示词默认内容（`cards.animation` 草稿）

> 输出是**给 `cards.segment` 看的自然语言动画脚本**，不是代码。变量沿用 `cards.segment` 已有上下文变量，保证可复用渲染管线。

```
name: cards.animation
description: 内容自适应动画指导生成（输出逐拍动画脚本，供 cards.segment 出卡时遵循）
version: 1
user: |-
  任务：你是 MG / 解说视频动效导演。给定下面这一段口播的内容，为它编排一份**逐拍动画脚本**，用于指导后续生成 Remotion Motion Card。只输出脚本本身，不要代码、不要解释、不要 markdown 代码块。

  ===== 动效方法论（必须贯彻，源自高端 MG 短片的可泛化核心）=====
  1. 连续形变叙事：拍与拍之间用「变换/morph」衔接，上一拍的结束态尽量成为下一拍的起点；避免一切硬切与闪现。
  2. 单一焦点：任一时刻屏幕只有一个视觉焦点，一拍只讲一件事；宁缺毋滥、大量留白。
  3. 跟口播逐句推进：每个焦点元素锚定到「它的内容被讲到」的那一句（见下方逐句节拍），讲到哪、哪才亮；可略提前，绝不迟到。
  4. 三段式节拍：每个元素「诞生 → 转化 → 让位/解构成下一个」，而不是出现后僵在原地。
  5. 有机缓动：用先快后慢（ease-out / 弹性缓出）推进，转场处可加一次轻微脉动或高光提示，杜绝匀速与机械感。
  6. 几何与克制：构图规整、对齐网格、去装饰；不堆叠并列、不滥用特效。

  ===== 输入上下文 =====
  - 全局提示：{{globalPrompt}}
  - 节目总结：{{programSummary}}
  - 关键词：{{keywords}}
  - segment：{{segmentId}}｜{{segmentTitle}}｜{{segmentStartMs}}-{{segmentEndMs}}ms
  - 摘要：{{segmentSummary}}
  - 摘录：{{segmentTranscriptExcerpt}}
  - 逐句字幕节拍（索引 k 对应运行时 cues[k]，用于把元素锚到讲出它的那一句）：
  {{segmentCues}}
  - 用户风格补充（可选，作为视觉/语气偏好参考，不得与上述方法论冲突）：{{cardPrompt}}

  ===== 输出格式（严格遵守）=====
  先用一句话给出「视觉母题」：本卡用什么核心视觉意象贯穿（呼应内容，便于连续形变）。
  然后给出 1~4 拍，每拍一行，格式：
  「拍i ｜ 锚:cues[k]（或 入场/兜底）｜ 焦点元素：<一句话> ｜ 动作/形变：<如何出现与如何转化> ｜ 缓动：<ease-out/弹性/脉动等>」
  最后一行可选「收束：<整卡如何收尾或最后焦点如何沉淀>」。

  ===== 约束 =====
  - 焦点元素个数 1~4，且必须与口播顺序一致（k 单调不减）。
  - 只描述节奏与形变意图，不写具体颜色十六进制、不写代码、不规定像素坐标。
  - 忠于内容，不臆造数字与人名；不要求画面出现水印/署名。
  - 全文控制在 ~400 字以内，密度高、可执行，避免空泛形容词。
```

> 后续可按实测效果迭代 `version`。该模板与 `cards.segment` 不冲突：它产出「针对本卡的节拍意图」，`cards.segment` 仍是最终铁律与代码约束的拥有者（§5.2 引导语已声明「不违反上述铁律的前提下优先遵循」）。

## 7. 测试计划

- `tests`（ai-analysis 相关）：
  - `generateAnimationDirection` 渲染 `cards.animation` 变量正确、纯文本解析去包裹、LLM mock 返回被正确返回。
  - motion-only：image/video 卡不触发动画指导生成。
  - 全自动开关：`autoAnimationDirection === false` 时不调用；为空/未设时默认调用。
  - 失败兜底：`generateAnimationDirection` 抛错时主出卡流程仍继续（direction 为空）。
- prompt override 单测：`cards.animation` 的全局/项目覆盖、project binding 生效（对齐现有 prompt 覆盖测试模式）。
- `card-run` 集成（`tests` 下对应文件）：`buildRegenerateOptions` 注入 `cards.animation` 模板；direction 被并入 `cards.segment` 渲染结果（断言 `{{animationDirection}}` 被填充）。
- IPC：手动 `generate-animation-direction` 三件套连通（按既有 IPC 测试惯例补一处 main/preload/electron-api 校验）。

## 8. 影响面与风险

- 触及共享类型 `AICard` / `AISettings` 与 `PromptKind` 列表 → 属高风险清单，需同步调用方与测试。
- 全自动每卡 +1 次 LLM 调用：批量分析时长/成本上升 → 由 `autoAnimationDirection` 开关与失败兜底缓解；初始默认 `true`，可在实测后调整默认值。
- `cards.segment` 模板改动（新增注入位与引导语）→ 需确保不破坏既有节奏契约/反禁忌，仅做增量。

## 9. 实施顺序（供后续写计划参考）

1. 类型与 PromptKind：`AICard.animationDirection`、`AISettings.autoAnimationDirection`、`'cards.animation'` + 分组元数据。
2. `cards.animation` 默认模板（§6）入 `defaults.ts`。
3. `generateAnimationDirection` + `buildAnimationDirectionPrompt`；`buildSegmentCardPrompt` 注入 `{{animationDirection}}`；`cards.segment` 模板加引导语。
4. `generateCardForSegment` 自动触发 + 兜底。
5. IPC 三件套 + `card-run` 加载逻辑。
6. AICardInspector 「动画指导」UI + 手动按钮 + 统一进度接入。
7. 测试（§7）。

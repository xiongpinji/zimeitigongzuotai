# MiMo TTS 表现力增强 + 长文本分块合成（口播模板一体化）

- 日期：2026-05-29
- 状态：设计已确认，待写实现计划
- 范围：仅 Xiaomi MiMo（`xiaomi_mimo`）TTS provider；MiniMax 维持原路径不变
- 交付：一期全部完成（口播模板 TTS 字段 + AI 句级打标 + 长文本分块合成 + 按块字幕 + UI）

## 1. 背景与问题

科技博主用户反馈两点，本设计一并解决：

### 问题 A：声音太平、没有灵活感

根因（已核实代码）：`src/lib/xiaomi-mimo-tts.ts` 的 `buildXiaomiMimoTtsRequestBody` 把请求写死：

```js
messages: [
  { role: 'user',      content: '请使用自然、清晰、适合视频口播的语气朗读下面的文本。' },
  { role: 'assistant', content: options.text },
]
```

MiMo v2.5-tts 文档说明，风格表现力恰由这两个位置控制：

- `role: user` content = 自然语言风格指令（语速/情绪/角色/场景）。当前"自然、清晰"是一句**要求平淡中性**的指令，等于主动关闭情感。
- `role: assistant` 文本 = 可在句首/句中插入音频标签（`(强调)`、`(停顿)` 等）做细粒度控制。当前是纯文本、零标签。

### 问题 B：整段脚本一次性丢给引擎

根因（已核实代码）：`useAIVideoWorkflow.ts:552` 把整个 `scriptText` 传进 `generateTTS`，`runXiaomiMimoTTS` 直接 `content: options.text` 发**一个阻塞请求**。TTS 路径零分段逻辑。

真实风险：长度/配额上限（MiMo 文档未写、但几乎必然存在；用户跑过 3000–8000 字稿）、超时全损（流式"暂未上线"，非流式一请求等 30~120s，一失败整段白合成）、大 base64 响应内存压力。

## 2. 核心设计取向：口播逻辑一体化

TTS 演绎风格与口播角色高度绑定（如本节目主持人「一叶知秋」）。因此**不新增独立的全局 TTS 提示词 kind**，而是把 TTS 配置作为**口播模板**（`UserPromptEntry`，category `script-template`）的字段——一个模板自带「写稿 system + TTS 演绎人设 + 打标风格倾向」，按节目角色一体管理、一体切换。

现有事实（已核实）：
- 口播模板 = `AIStore.userPromptEntries['script-template']` 的 `UserPromptEntry`，内置 3 个 seed（新闻播报/科技评测/知识科普），用户可增删改（`PromptsConfigTab`）。
- 持久化走 `electron/user-prompts-io.ts` + preload 桥。
- 项目当前模板由 `script.templateId`（store `selectedTemplate`）记录，默认 `news-broadcast`。

## 3. 目标

1. 给口播模板增加 **`ttsStyle`（演绎人设）** 字段，作为 MiMo 的 `role: user` content。
2. 给口播模板增加 **`ttsAnnotateHint`（打标风格倾向，可选）** 字段。
3. 合成前用 LLM 对脚本做**句级首标签**（结构化输出）；打标引擎的结构性规则（白名单 + JSON 格式）固定在代码里，模板的 `ttsAnnotateHint` 作为风格微调注入。
4. MiMo 长文本**按句分块**：每块一次请求，ffmpeg 拼接成单个音频。
5. **按块真实时长**构建多条字幕（比整段一个估算更准）。
6. 打标默认开、可在 TTS 设置全局关闭。
7. **硬保证**：标签只进音频不进字幕；打标绝不改字词；打标/分块失败有明确兜底。

## 4. 非目标（YAGNI）

- 句中内嵌标签（`(深呼吸)`、`(笑)`、重音）——一期只做句级首标签。
- 打标结果可视化预览/手动编辑 UI。
- 把完整**撰稿人设**（原创见解/大国叙事/比喻转化等）接进写稿链路——本期只做 TTS 演绎层；撰稿人设属 planning/script，另议。
- 每个克隆音色单独人设（人设走口播模板，不绑音色）。
- 每模板独立的"打标开关 / 自定义白名单"——一期用全局开关 + 固定 8 标签；模板级覆盖留待后续。
- MiniMax 分块（自带逐句时间戳、另一套接口）——维持原单请求路径。

## 5. 关键决策（已与用户确认）

| 决策点 | 选择 |
|---|---|
| 表现力来源 | 可配置人设 + AI 自动打标 |
| "专业名词"含义 | 实为 MiMo 控制标记，非名词本身 |
| 打标触发 | 合成前自动跑，带全局开关，默认开 |
| **配置位置** | **作为口播模板的字段（不新增独立 PromptKind）** |
| 打标粒度 | 句级首标签 + 结构化输出（最低风险） |
| 长文本分块 | 并进本期；按句分块 + ffmpeg 拼接 + 按块字幕 |
| 撰稿人设 | 本期不碰；只做 TTS 演绎人设 |
| 标签白名单 | 固定 8 个：强调/停顿/轻松/认真/好奇/感叹/加快/放慢 |
| 目标稿长 | 3000–8000 字；分块预算按此优化 |
| 交付节奏 | 一期全部完成 |

## 6. 架构与数据流

LLM 调用（`createChatModel`）与 TTS 触发都在 **renderer**；文件 I/O、ffmpeg、ffprobe 在 **main**。分工：renderer 负责"取模板 TTS 配置 + 分句 + 打标"，main 负责"分块 + 逐块请求 + 拼接 + 按块字幕"。

```
[renderer] 合成前置（仅 provider.type === 'xiaomi_mimo'）：
  tpl       = userPromptEntries['script-template'].find(e => e.id === selectedTemplate)
  persona   = tpl?.ttsStyle?.trim() || 内置默认演绎人设
  hint      = tpl?.ttsAnnotateHint?.trim() || ''
  clean[]   = splitIntoSentences(text)                            // 确定性分句
  tags[]    = []
  if (settings.ttsMimoAutoAnnotate !== false) {
     const ann = await annotateForMimo(clean, hint, settings, project)  // LLM → 每句白名单标签或 null
     if (isAnnotationFaithful(ann, clean)) tags = ann.map(a => a.tag)
  }
  units = clean.map((s, i) => ({ subtitle: s, speak: tags[i] ? `(${tags[i]})${s}` : s }))
  await electronAPI.generateTTS({ text, styleInstruction: persona, sentences: units, ... })

  // 非 MiMo（MiniMax）：不传 sentences / styleInstruction，走原 text 路径。

[main] generate-tts，当 provider=xiaomi_mimo 且 sentences 非空：
  chunks = groupSentencesByBudget(units, MIMO_TTS_CHUNK_CHAR_BUDGET) // 连续句打包，绝不切句
  parts  = []
  for (const [i, chunk] of chunks.entries()) {
     const buf = await runXiaomiMimoChunk({ speakText: chunk.map(u=>u.speak).join(''),
                                            styleInstruction: persona, provider, voice, signal })  // 失败重试 2 次
     const p = tmp `chunk-${i}.wav`; write(buf)
     parts.push({ path: p, durMs: await readAudioDurationMs(p,{ffprobePath}), units: chunk })
     更新统一进度（i+1 / chunks.length）
  }
  concatWavFiles(parts.map(p=>p.path), audioPath, {ffmpegPath})    // concat demuxer，-c copy
  srtText    = buildSrtFromChunks(parts)                          // 块间累加偏移，块内按字数分摊；文本取 subtitle
  durationMs = Σ parts.durMs
  清理临时 chunk 文件 → return { audioPath, srtPath, durationMs }
```

字幕文本始终取 `units.subtitle`（干净），标签永不进字幕。

## 7. 组件与文件改动

| 层 | 文件 | 改动 |
|---|---|---|
| 模板类型 | `src/lib/prompts/types.ts` | `UserPromptEntry` / `UserPromptSeed` 增可选 `ttsStyle?: string`、`ttsAnnotateHint?: string` |
| 模板默认 | `src/lib/prompts/script-template-defaults.ts` | 3 个 seed 各补一段贴合风格的 `ttsStyle` 默认值（见 §8） |
| 设置类型 | `src/types/ai.ts` | `AISettings` 增 `ttsMimoAutoAnnotate?: boolean`（缺省视为 true） |
| 模板持久化 | `electron/user-prompts-io.ts`、规范化逻辑 | 读写保留新字段；旧条目缺字段时不报错（视为未设置→走默认） |
| 模板编辑 UI | `src/components/settings/PromptsConfigTab.tsx`（及模板编辑组件） | 口播模板编辑器增「TTS 演绎人设 / 打标风格倾向」两段输入 |
| 分句 | `src/lib/tts/sentence-split.ts`（新） | `splitIntoSentences(text)`：按中英句末标点切分、保留标点、合并空白；纯函数 |
| 打标引擎 | `src/lib/tts/mimo-annotate.ts`（新） | 固定 system（白名单 8 标签 + JSON 规则）作代码常量；`annotateForMimo(clean, hint, …)` 调 LLM；`isAnnotationFaithful()`；`MIMO_TAG_WHITELIST` |
| 取人设 | `src/lib/tts/mimo-style.ts`（新） | `resolveMimoStyleInstruction(template, …)`：模板 `ttsStyle` 优先，空则内置默认 |
| 编排 | `src/hooks/useAIVideoWorkflow.ts` | 取当前模板 TTS 配置→分句→打标→构造 `units`→注入 `generateTTS`；接统一进度 |
| IPC 桥 | `src/lib/electron-api.ts`、`electron/preload.ts` | `generateTTS` 增 `styleInstruction?: string`、`sentences?: Array<{subtitle:string;speak:string}>` |
| 分块（纯） | `electron/tts-chunking.ts`（新） | `groupSentencesByBudget(units,budget)`；`buildSrtFromChunks(parts)`；`MIMO_TTS_CHUNK_CHAR_BUDGET` |
| 合成 | `electron/tts-provider-runner.ts`、`src/lib/xiaomi-mimo-tts.ts` | runner 支持"按给定 speak 文本 + styleInstruction 合成一块"；`buildXiaomiMimoTtsRequestBody` 用 styleInstruction 作 user、speak 作 assistant |
| 主进程 | `electron/main.ts` | `generate-tts`：MiMo+sentences→分块循环 + 拼接 + 按块字幕；否则走原路径 |
| 拼接 | `electron/media-concat.ts`（新） | `concatWavFiles(paths,out,{ffmpegPath,execFile})`，concat demuxer `-c copy`，可注入 execFile 便于测试 |

## 8. 口播模板 TTS 字段与默认值（已确认）

### `ttsStyle`（演绎人设，原样作 MiMo 的 user 指令；不触发 LLM）

每个口播模板可填一段"怎么念"的自然语言指令。3 个内置 seed 的默认值：

- **新闻播报**：用专业新闻主播的状态播读——沉稳、客观、清晰、可信；语速平稳、咬字清楚；陈述数据与事实时坚定有力，段落过渡自然。避免夸张情绪与口水音。
- **科技评测**：用科技自媒体主播的状态来念——轻松、专业、有分享欲，像跟朋友聊技术；语速中等偏快、有节奏；讲到亮点或反差时语气微微上扬带点兴奋，解释概念时清晰耐心；抛关键数据前略作停顿。避免播音腔与机械感。
- **知识科普**：用知识科普主播的状态来念——亲切、生动、有引导感；语速适中、抑扬有致；提问句略带好奇上扬，讲比喻或故事时柔和有画面感，点要点时清晰强调。避免枯燥平铺。

> 用户自有节目「一叶知秋」可新建/编辑一个口播模板，把上一轮提炼的演绎人设填进该模板的 `ttsStyle`（沉稳清晰、富有洞察力、有温度，随内容调节奏，智识谦逊）。撰稿层人设不在本期范围。
> 取值优先级：模板 `ttsStyle` > 内置默认演绎人设（代码兜底常量）。

### `ttsAnnotateHint`（打标风格倾向，可选）

一句话风格偏好，注入固定打标 prompt。示例：「本节目偏深度分析，多用停顿/认真，少用感叹」。留空则只用通用规则。

### 打标引擎固定 prompt（代码常量，非用户模板）

- 白名单（固定 8）：`强调 / 停顿 / 轻松 / 认真 / 好奇 / 感叹 / 加快 / 放慢`
- system 规则要点：**绝不改动任何字词、标点、顺序**；只能为每句可选附加一个白名单标签；多数句子应不打标；按修辞角色选标签；输出**纯 JSON** 数组 `[{"sentence":"原句原文","tag":"强调"|null}]`，无多余文本；如有 `ttsAnnotateHint` 则在不破坏上述规则前提下纳入风格偏好。
- 输入变量：`{{hint}}`、`{{sentences}}`（编号句子列表）。

## 9. 错误处理与回退

- **忠实性校验**：`ann.map(a=>a.sentence).join('')` 归一化后必须等于 `clean.join('')` 归一化；不一致 → 丢弃全部标签（仍分块合成）。绝不让被改写文本进合成。
- **标签白名单校验**：非白名单标签 → 该句置 null。
- **打标失败兜底**：LLM 报错/超时/非法 JSON/开关关闭/非 MiMo → 全 null，合成照常。打标永不阻断合成。
- **取模板兜底**：模板缺失或 `ttsStyle` 为空 → 用内置默认演绎人设。
- **分块合成失败**：单块失败重试默认 2 次；仍失败 → 整体失败报错（不允许音频缺口）；临时块 finally 清理。
- **拼接失败**：ffmpeg concat 非零退出 → 抛错；不返回半成品。
- **字幕**：始终来自 `units.subtitle`，与打标/分块状态解耦。

## 10. 测试方案

- `tests/sentence-split.test.ts`（新）：中英混排、句末标点保留、空行/换行归一、空文本。
- `tests/tts-chunking.test.ts`（新）：`groupSentencesByBudget`（不超预算、绝不切句、单句超预算自成一块、空输入）；`buildSrtFromChunks`（块间偏移累加、块内按字数分摊、末块 endMs=总时长、cue 无换行、可被 `parseSrt` 解析）。
- `tests/mimo-annotate.test.ts`（新）：`isAnnotationFaithful`（一致 true / 改字 false / 仅标签差异 true）；`annotateForMimo`（mock 合法→产标签；改写文本→回退全 null；抛错→回退；开关关/非 MiMo→跳过；hint 注入 prompt）。
- `tests/mimo-style.test.ts`（新）：`resolveMimoStyleInstruction`（模板 ttsStyle 优先；空→默认）。
- `tests/xiaomi-mimo-tts.test.ts`（扩展）：请求体 user=人设、assistant=带标签；未传时回退默认人设+原文。
- `tests/media-concat.test.ts`（新）：`concatWavFiles` 注入 execFile mock 验证 ffmpeg 参数（concat demuxer、`-c copy`、输出路径）。
- 模板持久化：`user-prompts-io` 读写 round-trip 保留 `ttsStyle`/`ttsAnnotateHint`；旧条目缺字段不报错。
- LLM 与 ffmpeg 一律 mock/注入。
- 回归：`npx vitest run tests/sentence-split.test.ts tests/tts-chunking.test.ts tests/mimo-annotate.test.ts tests/mimo-style.test.ts tests/xiaomi-mimo-tts.test.ts tests/srt-resegment.test.ts`。

## 11. 风险与待验证

- **MiMo voiceclone 是否支持 user 风格指令 / 句首标签**：文档为通用描述，默认模型 `mimo-v2.5-tts-voiceclone` 需真机验证；不生效时人设/标签均无害（被忽略）。
- **分块字数预算**：限制未文档化。目标稿长 3000–8000 字，默认 `MIMO_TTS_CHUNK_CHAR_BUDGET ≈ 800`（8000 字约 10 块、3000 字约 4 块），常量易调。
- **concat `-c copy` 假设各块格式一致**：MiMo 输出固定 PCM s16le/24kHz/单声道成立；不一致需回退重编码。
- **多块=多次请求**：总延迟随块数上升；进度反映 `i/N`。
- **真实听感/对齐**：只能由用户在 `npm run dev` 下重新合成确认。

## 12. 兼容性

- `UserPromptEntry` 新增字段均可选；旧持久化数据缺字段时按"未设置→默认"处理，无需迁移。
- `ttsMimoAutoAnnotate` 缺省视为 `true`，仅对 MiMo 生效。
- `generateTTS` 新增入参均可选；不传时等价于"默认人设 + 整段原文单请求"，对 MiniMax 与旧调用完全向后兼容。
- 不改 `project.json` 结构（`script.templateId` 已存在）；仅改变运行时合成/字幕行为。

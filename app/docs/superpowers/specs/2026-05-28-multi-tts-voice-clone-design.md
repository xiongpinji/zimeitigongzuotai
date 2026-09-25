# 多 TTS Provider 与克隆音色设计

## 目标

让灵机剪影的一键成稿语音合成从单一 MiniMax 配置升级为可扩展的 TTS Provider 体系，并支持用户在设置中保存可复用的克隆音色。首个必须可用的克隆链路是小米 MiMo `mimo-v2.5-tts-voiceclone`。

## 范围

P0 必须完成：

- 在系统设置的 TTS 页配置多个 TTS Provider。
- 支持 MiniMax 现有 T2A v2 Provider，旧配置自动迁移为默认 Provider 和默认音色。
- 支持 Xiaomi MiMo Provider，用户可填写 API Key、Base URL、模型。
- 支持保存克隆音色：名称、所属 Provider、参考音频文件路径、模型、默认语速/音量/音调/情绪。
- 一键成稿和“重新生成口播”使用默认 TTS Provider + 默认音色生成口播音频。
- MiMo 克隆音色生成时读取本地参考音频，Base64 上传到 MiMo 接口，输出可播放音频。
- 生成产物仍写入当前项目的 `podcast-audio.*` 和 `podcast-subtitles.srt`，后续 AI 分析、封面、排版流程不需要感知 Provider 差异。

P0 不做：

- 云端音色训练任务管理。
- 音色市场、批量导入、云同步。
- 对 MiMo 返回字幕时间戳的强依赖；若 Provider 不返回字幕，先按整段字幕兜底。
- TTS 素材库和时间线局部 Clip 替换的完整闭环。

## 当前系统约束

- `AISettings` 当前只有 MiniMax 专用字段：`minimaxApiKey`、`minimaxVoiceId`、`minimaxSpeed`、`minimaxModel` 等。
- `TTSConfigTab` 是单一 MiniMax 表单。
- `electron/main.ts` 的 `generate-tts` IPC 直接调用 MiniMax `https://api.minimaxi.com/v1/t2a_v2`。
- `useAIVideoWorkflow` 直接读取 `settings.minimax*` 并传给 `generateTTS`。
- 旧项目和旧设置必须继续可用，不能要求用户手动迁移。

## 数据模型

在 `src/types/ai.ts` 中新增：

```ts
export type TTSProviderType = 'minimax' | 'xiaomi_mimo' | 'custom_openai_audio';

export interface TTSProvider {
  id: string;
  name: string;
  type: TTSProviderType;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface TTSVoicePreset {
  id: string;
  name: string;
  providerId: string;
  providerType: TTSProviderType;
  model: string | null;
  voiceId?: string;
  source: 'system' | 'cloned';
  referenceAudioPath?: string;
  referenceAudioName?: string;
  referenceAudioMime?: 'audio/mpeg' | 'audio/wav';
  params: {
    speed: number;
    vol?: number;
    pitch?: number;
    emotion?: string;
  };
  createdAt: number;
  updatedAt: number;
}
```

扩展 `AISettings`：

```ts
ttsProviders: TTSProvider[];
defaultTtsProviderId: string | null;
defaultTtsVoiceId: string | null;
ttsVoices: TTSVoicePreset[];
```

保留旧 MiniMax 字段作为 deprecated 兼容字段。加载设置时如果 `ttsProviders` 为空但旧字段存在，则迁移出一个 MiniMax Provider 和一个默认系统音色。

## Provider 行为

### MiniMax

复用现有 `buildMinimaxTtsRequestBody`、字幕解析和音频解码逻辑。Provider 参数映射为：

- `apiKey` -> Authorization Bearer
- `baseUrl` 默认 `https://api.minimaxi.com`
- `model` 默认 `speech-2.8-hd`
- `voiceId` 来自系统音色或用户填入的克隆音色 ID

MiniMax 继续输出 MP3，字幕优先使用接口返回的字幕数据或字幕文件。

### Xiaomi MiMo

新增 `src/lib/xiaomi-mimo-tts.ts`：

- 构造 `/v1/chat/completions` 请求。
- `model` 默认 `mimo-v2.5-tts-voiceclone`。
- `messages` 使用用户文本作为 assistant content，system/user content 只传轻量朗读要求。
- `audio.format` 使用 `wav`。
- 克隆音色必须有 `referenceAudioPath`，支持 `.mp3` 和 `.wav`。
- 读取参考音频为 Base64 后写入 `audio.voice = data:<mime>;base64,<data>`。
- 从 `choices[0].message.audio.data` 解码音频。

MiMo 不返回 SRT 时，主进程用原文生成单条 SRT，时间范围使用最终音频时长。

### Custom OpenAI Audio

P0 只提供配置预留，不作为默认可用目标。若用户选择该 Provider 生成，提示“该 Provider 类型暂未接入生成实现”。

## 主进程架构

新增高层分发：

```ts
generateTtsWithProvider(args): Promise<{
  audioBuffer: Buffer;
  audioExtension: 'mp3' | 'wav';
  subtitleText?: string;
  durationMs?: number;
}>
```

`generate-tts` IPC 参数改为：

```ts
{
  requestId: string;
  text: string;
  provider: TTSProvider;
  voice: TTSVoicePreset;
  projectDir: string;
  telemetryRunId?: string | null;
}
```

为了兼容旧调用，IPC 仍接受旧字段，并在主进程内转换为 MiniMax Provider + VoicePreset。

输出路径：

- MiniMax：`podcast-audio.mp3`
- MiMo：`podcast-audio.wav`
- 字幕：`podcast-subtitles.srt` 和 `podcast-subtitles.original.srt`

## 设置页设计

`TTSConfigTab` 拆成两个区块：

1. TTS Provider
   - 列表展示名称、类型、模型数、默认标记。
   - 支持新增/编辑/删除/设为默认。
   - 类型选项：MiniMax、Xiaomi MiMo、自定义 OpenAI Audio。

2. 音色库
   - 列表展示名称、来源、Provider、模型、参考音频。
   - 支持新增系统音色：手填 voice id，适合 MiniMax。
   - 支持新增克隆音色：选择 Provider，选择本地 mp3/wav，保存路径引用。
   - 支持设为默认音色。

保存时统一写回 `settings.json` 的 `aiSettings`。API Key 不出现在日志和最终错误消息中。

## 工作流接入

`useAIVideoWorkflow` 生成 TTS 前解析：

1. 从 `settings.ttsProviders` 找默认 Provider。
2. 从 `settings.ttsVoices` 找默认 Voice。
3. 若缺失，则从旧 `minimax*` 字段构造兼容 Provider/Voice。
4. 若 Provider 或 Voice 不完整，工作流进入 `error`，提示用户到 TTS 设置补全。
5. 调用 `window.electronAPI.generateTTS({ requestId, text, provider, voice, projectDir, telemetryRunId })`。

## 验证

必须完成：

- `npm test -- --run` 或现有测试命令中相关单测通过。
- `npx tsc --noEmit` 或项目可用的类型检查通过；若仓库没有单独脚本，用 `npm run build` 覆盖类型和打包验证。
- 本地用用户提供的 `/Users/yoqu/Downloads/最新宣传视频.mp3` 配置 MiMo 克隆音色，调用主进程同源 helper 或等价 Node 脚本，确认生成非空音频并能被 `ffprobe` 识别。
- 启动应用，打开设置页，确认 TTS Provider 和音色库 UI 渲染不崩溃。

## 风险

- MiMo 参考音频路径如果被用户移动，生成会失败。错误信息必须指明“参考音频不存在或不可读取”。
- MiMo 输出 WAV 而 MiniMax 输出 MP3，时间线已有 `setPodcast` 能接收任意音频路径，但导出链路仍需用 `ffprobe` 验证。
- 旧字段和新字段短期并存，保存逻辑必须避免丢失 LLM、图像、视频 Provider 配置。

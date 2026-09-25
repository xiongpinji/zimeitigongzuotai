# 音频/字幕二次加工 + TTS 配音替换设计

**创建日期**：2026-04-14
**状态**：草案（等待复核）
**负责人**：yoqu
**关联模块**：`src/store/timeline.ts` · `src/components/EditorInspector.tsx` · `src/components/AssetPanel.tsx` · `src/remotion/index.ts` · `src/lib/minimax-tts.ts`

---

## 1. 背景与目标

### 1.1 背景

灵机剪影当前的音频与字幕流程只支持「导入」与「整段替换」，不具备二次加工能力：

- 字幕只能通过外部修改 SRT 文件后重新导入，缺少所见即所得的编辑界面
- 音频是单一 `podcast.audioPath`，没有片段（Clip）概念，无法针对某一句话做替换或删除
- MiniMax TTS 基础设施已就绪（`src/lib/minimax-tts.ts`、`AISettings` 中的音色字段），但没有面向创作者的 TTS 素材生成与配音替换工作流

### 1.2 目标

让创作者能够在不离开编辑器的前提下完成：

1. **字幕二次编辑**：查看、修改、新增、删除字幕，支持查找替换与时间轴微调
2. **音频片段化**：把整段口播按字幕切分为可引用的 Clip 序列
3. **AI 重新配音**：对任意 Clip 用 TTS 重新生成音频并替换原片段
4. **TTS 素材库**：TTS 生成的音频持久化，可以反复使用
5. **音色预设管理**：跨项目的全局音色预设

### 1.3 非目标（本期不做）

- 音频波形编辑器（淡入淡出、音量包络）
- 多音频轨道 / 混音
- 音色克隆（仅预留数据字段）
- 视频 AI 剪辑联动
- 字幕合并拆分、导出 SRT
- TTS 试听

---

## 2. 核心决策记录

| # | 决策项 | 选择 | 关键约束 |
|---|--------|------|---------|
| 1 | 字幕编辑范围 | 精简版：查看 / 查找替换 / 单条编辑 / 增删 / 时间轴调整 / 自动定位 | 不做合并拆分、不做 SRT 导出 |
| 2 | 音频编辑范围 | 片段级 Clip（P0 只读切分显示，P1 手动操作） | Clip 由 SRT 自动初始化 |
| 3 | 音频-字幕联动 | **脱钩**：音频 Clip 操作不自动调整字幕 | 字幕由用户独立维护 |
| 4 | TTS 产物定位 | **替换主口播 Clip** | 不作为独立轨道叠加 |
| 5 | TTS 时长策略 | **禁止拉伸**：使用自然时长 + 后续 Clip 顺延 | 硬约束 |
| 6 | TTS 替换字幕处理 | 按字级时间戳重生成；后续字幕不偏移 | 依赖 MiniMax API 支持，不支持时降级为整段一条 |
| 7 | 音色配置作用域 | **全局预设管理** + 单次微调 | 跨项目复用 |
| 8 | 音色克隆 | MVP 不做，预留 `voiceSource: 'system' \| 'cloned'` | P1 扩展点 |
| 9 | Clip 初始化方式 | 按字幕自动切分，P1 支持合并/拆分 | 一字幕 = 一 Clip |
| 10 | TTS 触发入口 | **双入口**：右键 Clip「重新配音」+ 左侧素材区「新建 TTS」+ 拖拽替换 | 快慢场景兼顾 |
| 11 | TTS 素材持久化 | `<projectDir>/tts/<uuid>.mp3` + `timeline.ttsAssets` 元数据 | 手动清理按钮延后到 P1 |
| 12 | 波形方案 | 复用现有 `TimelineAudioWaveform` + peaks 缓存按 Clip 切片 | 非破坏性 |
| 13 | 音频存储模型 | **虚拟合成（非破坏性）**：原始 MP3 不动，Clip 存引用 | 核心架构 |
| 14 | 字幕编辑器 UI | 右侧 `EditorInspector` 新增「字幕」Tab | 不开新页面 |
| 15 | 导出 / 预览 | Remotion `<Sequence>` + 多 `<Audio>` 合成 | Fallback：ffmpeg 预合成（延后） |
| 16 | 分期节奏 | **方案丙（2 期）**：P0 打通核心闭环 → P1 完整版 | 本文档聚焦 P0 |

---

## 3. 总体架构

### 3.1 三个独立数据域

```
┌─────────────────────────────────────────────────────────────────┐
│                          Timeline                               │
│                                                                 │
│  ┌───────────────── Audio Track (virtual) ───────────────────┐  │
│  │  [Clip#1] [Clip#2] [Clip#3-TTS] [Clip#4] [Clip#5-TTS] ... │  │
│  │     │        │         │           │          │          │  │
│  │     ▼        ▼         ▼           ▼          ▼          │  │
│  │  origin   origin   tts/a.mp3   origin    tts/b.mp3       │  │
│  │  podcast.mp3 (单一原始 MP3)     + project/tts/*.mp3       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────── Subtitle Track (独立) ────────────────────┐  │
│  │  [sub#1] [sub#2] [sub#3 新字级时间戳] [sub#4] [sub#5] ... │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                   ┌─────────────────────┐
                   │  PodcastComposition │  (Remotion)
                   │  → 多个 <Audio>      │
                   │  → 字幕 / 视觉图层    │
                   └─────────────────────┘
```

- **原始音频资产** — `podcast.audioPath` 保持只读快照
- **音频 Clip 序列** — 虚拟合成视图，引用原始音频或 TTS 素材
- **字幕时间轴** — 完全独立，与音频 Clip 脱钩

### 3.2 模块责任边界

| 模块 | 新增职责 |
|------|---------|
| `src/types.ts` | `AudioClip` / `TTSAsset` / `VoicePreset` / `WordTimestamp` / `VoiceParams` 类型定义 |
| `src/store/timeline.ts` | `audioClips` / `ttsAssets` / `subtitles` 状态 + 对应 CRUD + `replaceClipWithTTS` |
| `src/store/voice-presets.ts` (新) | 全局音色预设（跨项目），通过 IPC 持久化到 userData |
| `electron/main.ts` | 新增 IPC：`voice-presets:list/save/delete`、`tts:write-file`、`tts:read-file` |
| `electron/preload.ts` | 暴露上述 IPC 到 `window.electronAPI` |
| `src/lib/electron-api.ts` | 类型安全封装 |
| `src/lib/tts-service.ts` (新) | 高层 TTS 调用 + 落盘 + 元数据生成 |
| `src/lib/clip-init.ts` (新) | 按字幕初始化 Clip 的纯函数 |
| `src/lib/subtitle-builder.ts` (新) | `buildSubtitlesFromWordTimestamps` |
| `src/components/EditorInspector.tsx` | 新增「字幕」Tab |
| `src/components/SubtitleTabPanel.tsx` (新) | 字幕列表编辑组件 |
| `src/components/AssetPanel.tsx` | 音频分类 Tab 改造 + TTS 素材区 |
| `src/components/NewTTSDialog.tsx` (新) | 新建 TTS 对话框 |
| `src/components/VoicePresetManager.tsx` (新) | 预设管理界面 |
| `src/components/ReVoiceDialog.tsx` (新) | 右键重新配音对话框 |
| `src/components/TimelineClipWaveform.tsx` (新) | 按 Clip 切片渲染波形 |
| `src/remotion/PodcastComposition.tsx` | 改造为按 Clip 序列渲染多 `<Audio>` |

---

## 4. 数据模型

### 4.1 新增类型定义

```ts
// src/types.ts 新增

/** TTS 素材（持久化到 project/tts/） */
export interface TTSAsset {
  id: string;                    // uuid
  filePath: string;              // 绝对路径 project/tts/xxx.mp3
  text: string;                  // 生成时使用的文本
  durationMs: number;            // TTS 输出时长（实际测量）
  voicePresetId: string;         // 引用音色预设 id（仅作元数据快照）
  voicePresetSnapshot: VoicePreset;  // 生成时的预设完整快照，防止预设被删导致失效
  voiceOverrides?: Partial<VoiceParams>;
  wordTimestamps?: WordTimestamp[];  // TTS 返回的字级时间戳（若支持）
  createdAt: number;
  voiceSource?: 'system' | 'cloned'; // 未来克隆扩展点
}

export interface WordTimestamp {
  text: string;
  startMs: number;
  endMs: number;
}

/** 音频 Clip —— 虚拟合成的基本单元 */
export interface AudioClip {
  id: string;
  source:
    | { kind: 'origin'; startMs: number; endMs: number }
    | { kind: 'tts'; assetId: string };
  timelineStartMs: number;       // 在时间线上的起点
  durationMs: number;            // Clip 在时间线上占用的时长
  linkedSubtitleIndexes: number[]; // 初始化时关联的字幕 index
  muted?: boolean;               // 静音占位（P1 功能，P0 预留字段）
}

/** 音色预设 */
export interface VoicePreset {
  id: string;
  name: string;
  provider: 'minimax';           // 未来扩展其他 provider
  voiceId: string;               // MiniMax voice_id
  params: VoiceParams;
  voiceSource: 'system' | 'cloned';
  createdAt: number;
  updatedAt: number;
}

export interface VoiceParams {
  speed: number;                 // 默认 1.0
  vol?: number;                  // 默认 1.0
  pitch?: number;                // 默认 0
  emotion?: string;              // minimax 支持的情绪枚举
}
```

### 4.2 TimelineData 增量字段

```ts
export interface TimelineData {
  // 原有字段保持不变
  podcast: { audioPath: string; srtPath: string; durationMs: number };

  // 新增（全部可选，保证向后兼容）
  audioClips?: AudioClip[];
  ttsAssets?: TTSAsset[];
  subtitles?: SrtEntry[];        // 字幕权威副本（用户编辑后的状态）
}
```

**向后兼容策略**：
- 旧项目打开时 `audioClips === undefined`，走原有的单一 `<Audio>` 渲染路径
- 首次进入字幕 Tab 或点击音频 Clip 操作时，惰性初始化 `audioClips` 和 `subtitles`
- `ttsAssets` 初始化为空数组
- 初次保存 `timeline.json` 时写入新字段

### 4.3 持久化位置

| 数据 | 位置 | 说明 |
|------|------|------|
| 原始音频 | `podcast.audioPath`（不动） | 只读快照 |
| TTS 音频文件 | `<projectDir>/tts/<uuid>.mp3` | 每次生成落盘 |
| TTS 元数据 | `timeline.json` 的 `ttsAssets` 字段 | 随时间线保存 |
| AudioClip 序列 | `timeline.json` 的 `audioClips` 字段 | 随时间线保存 |
| 字幕编辑副本 | `timeline.json` 的 `subtitles` 字段 | 不写回原 SRT |
| 音色预设 | `<userData>/voice-presets.json` | `app.getPath('userData')` |

Electron `userData` 路径（macOS）：`~/Library/Application Support/灵机剪影/voice-presets.json`

---

## 5. 虚拟音频合成与 Remotion 改造

### 5.1 PodcastComposition 多 Clip 渲染

```tsx
// src/remotion/PodcastComposition.tsx 伪代码
function PodcastAudio({
  clips,
  originAudioPath,
  ttsAssets,
}: {
  clips?: AudioClip[];
  originAudioPath: string;
  ttsAssets?: TTSAsset[];
}) {
  // 向后兼容：没有 Clip 走单一音频
  if (!clips || clips.length === 0) {
    return <Audio src={toFileSrc(originAudioPath)} />;
  }

  return (
    <>
      {clips.map((clip) => {
        if (clip.muted) return null;
        const { src, trimBefore, trimAfter } = resolveClipSource(
          clip,
          originAudioPath,
          ttsAssets ?? []
        );
        const startFrame = msToFrame(clip.timelineStartMs);
        const durationFrames = msToFrame(clip.durationMs);
        return (
          <Sequence
            key={clip.id}
            from={startFrame}
            durationInFrames={durationFrames}
          >
            <Audio src={src} trimBefore={trimBefore} trimAfter={trimAfter} />
          </Sequence>
        );
      })}
    </>
  );
}

function resolveClipSource(clip, originPath, ttsAssets) {
  if (clip.source.kind === 'origin') {
    return {
      src: toFileSrc(originPath),
      trimBefore: msToFrame(clip.source.startMs),
      trimAfter: msToFrame(clip.source.endMs),
    };
  }
  const asset = ttsAssets.find(a => a.id === clip.source.assetId);
  return {
    src: toFileSrc(asset.filePath),
    trimBefore: 0,
    trimAfter: msToFrame(asset.durationMs),
  };
}
```

**Composition 总时长动态计算**：
```ts
const totalDurationMs = Math.max(
  ...clips.map(c => c.timelineStartMs + c.durationMs),
  podcast.durationMs
);
```

### 5.2 波形切片渲染

新增 `TimelineClipWaveform`：复用现有 `TimelineAudioWaveform.tsx` 的 peaks 缓存（`waveformPeakCache`），按 Clip 时间范围切子区间：

```ts
// src/components/TimelineClipWaveform.tsx
function sliceClipPeaks(
  fullPeaks: number[],
  sourceDurationMs: number,
  clipSourceStartMs: number,
  clipSourceEndMs: number
): number[] {
  const ratio = fullPeaks.length / sourceDurationMs;
  return fullPeaks.slice(
    Math.floor(clipSourceStartMs * ratio),
    Math.ceil(clipSourceEndMs * ratio)
  );
}
```

- `origin` 类型 Clip：从 `podcast.audioPath` 的 peaks 切子区间
- `tts` 类型 Clip：首次渲染时按 TTS 文件路径触发 peaks 计算，缓存键 = TTS 文件绝对路径

### 5.3 性能与降级

**风险**：100+ Clip 场景下多 `<Audio>` 元素可能导致 Remotion Player 卡顿。

**P0 应对**：
1. 首次开发完成后做压测：100 / 200 / 500 Clip 规模
2. Remotion `<Sequence>` 自带 mount/unmount 行为，理论上只有当前时间窗口附近的 `<Audio>` 实际挂载
3. 若不达标，触发 P1 的 Fallback（ffmpeg 预合成 `<projectDir>/.cache/preview.wav`）

---

## 6. 字幕编辑器（Inspector 字幕 Tab）

### 6.1 UI 结构

```
┌── EditorInspector ──────────────────────┐
│  [属性] [字幕]                           │
│  ─────────────────────────────          │
│  🔍 [查找框]           [+新增]           │
│  ─────────────────────────────          │
│  #001  00:00:02,100 → 00:00:05,300    🗑│
│  大家好,欢迎收听本期播客...              │
│                                         │
│  #002  00:00:05,400 → 00:00:08,100    🗑│  ← 当前选中
│  [今天我们聊聊 AI        ]               │  ← 点击即进入内联编辑
│                                         │
│  #003  ...                            🗑│
└──────────────────────────────────────────┘
```

### 6.2 功能清单（精简版）

| 功能 | 实现要点 |
|------|---------|
| 全量浏览 | 虚拟滚动（react-window 或自实现），支持数百条流畅滚动 |
| 自动定位 | 监听时间线播放头或选中字幕变化，自动滚动到该条并高亮 |
| 内联编辑 | 点击条目 → 文本区变成 `contentEditable` / textarea，失焦或回车提交 |
| 新增字幕 | 顶部「+」按钮，在当前选中条之后插入，默认时长 2s |
| 删除字幕 | 每行最右侧 🗑 按钮 + 确认提示 |
| 查找 | 顶部搜索框，按文本匹配过滤列表（保留时间顺序） |
| 查找替换 | 搜索框旁边「替换」按钮，展开替换输入 + 「替换全部」 |
| 时间轴调整 | 内联编辑态支持点击时间显示 → 直接输入 `HH:MM:SS,mmm` 格式（带校验） |
| 双向联动 | Tab 内点字幕 → 时间线高亮 + 播放头跳转；反之亦然 |

**本期不做**：合并拆分、导出 SRT、快捷键、批量操作。

### 6.3 Store Action

```ts
// src/store/timeline.ts 扩展
interface TimelineState {
  subtitles: SrtEntry[];
  selectedSubtitleIndex: number | null;

  updateSubtitle(index: number, patch: Partial<SrtEntry>): void;
  insertSubtitle(afterIndex: number, entry: Omit<SrtEntry, 'index'>): void;
  deleteSubtitle(index: number): void;
  replaceAllSubtitles(find: string, replace: string): number; // 返回替换次数
  setSelectedSubtitleIndex(index: number | null): void;
}
```

- 所有 Action 进入现有 40 步 undo/redo 历史栈
- 每次变更后 `subtitles` 按 `startMs` 重排 + 重新编 `index`

---

## 7. TTS 素材库与音色预设

### 7.1 左侧素材区改造

`AssetPanel.tsx` 音频 Tab 顶部新增：

```
┌── AssetPanel · 音频 ─────────────────────┐
│  [全部] [视频] [音频*] [文字]            │
│  ─────────────────────────────          │
│  ╔═ 🎤 TTS 生成 ═══════════════════╗     │
│  ║  [＋ 新建 TTS 音频]              ║     │
│  ║  ─────────────────────          ║     │
│  ║  🗂 最近生成                     ║     │
│  ║  ┌──────┐ ┌──────┐ ┌──────┐    ║     │
│  ║  │ TTS  │ │ TTS  │ │ TTS  │    ║     │
│  ║  │ 3.2s │ │ 5.8s │ │ 2.1s │    ║     │
│  ║  │主播男│ │主播男│ │旁白女│    ║     │
│  ║  └──────┘ └──────┘ └──────┘    ║     │
│  ╚═════════════════════════════════╝     │
│  ╔═ 📁 本地音频文件 ═════════════════╗    │
│  ║  (现有扫描列表)                    ║   │
│  ╚═════════════════════════════════╝    │
└──────────────────────────────────────────┘
```

TTSAsset 卡片内容：时长、音色名、首行文本（截断）；支持拖拽。

### 7.2 新建 TTS 对话框

字段：
- 文本内容（多行 textarea，字数提示 ≤ 500）
- 音色预设下拉（来自全局 `voice-presets` store）
- 「⚙ 管理预设」快捷入口
- 本次微调：语速 / 音量 / 音高 / 情绪（仅覆盖当次生成，不写回预设）
- 操作：取消 / 生成

生成流程走 `generateTTSAsset()`，结束后对话框关闭，左侧「最近生成」刷新。

### 7.3 音色预设管理器

入口：
1. TTS 对话框内「⚙ 管理预设」
2. 全局设置页面 `page='settings'` 新增分区

功能：增 / 改 / 删 / 设为默认，字段同 `VoicePreset`。

MiniMax 系统音色列表**硬编码**在 `src/lib/minimax-voices.ts`，包含 `voiceId / name / description` 等字段。

### 7.4 Store（全局）

```ts
// src/store/voice-presets.ts（新建）
interface VoicePresetsState {
  presets: VoicePreset[];
  defaultPresetId: string | null;
  load(): Promise<void>;                                  // 启动时调用
  create(p: Omit<VoicePreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<VoicePreset>;
  update(id: string, patch: Partial<VoicePreset>): Promise<void>;
  remove(id: string): Promise<void>;
  setDefault(id: string): Promise<void>;
}
```

持久化经 Electron IPC → `<userData>/voice-presets.json`。

### 7.5 Electron IPC 新增

```ts
// electron/main.ts
ipcMain.handle('voice-presets:list', async () => { ... });
ipcMain.handle('voice-presets:save', async (_, preset) => { ... });
ipcMain.handle('voice-presets:delete', async (_, id) => { ... });

ipcMain.handle('tts:write-file', async (_, { projectDir, buffer, filename }) => {
  // 确保 projectDir/tts/ 存在
  // 写入文件，返回绝对路径
});
```

`preload.ts` + `src/lib/electron-api.ts` 同步类型。

### 7.6 tts-service 高层封装

```ts
// src/lib/tts-service.ts
export async function generateTTSAsset(params: {
  text: string;
  voicePreset: VoicePreset;
  overrides?: Partial<VoiceParams>;
  projectDir: string;
}): Promise<TTSAsset> {
  // 1. 合并参数（预设默认 + 本次微调）
  // 2. 调用 minimax-tts 获取 audio buffer + wordTimestamps
  // 3. 通过 IPC 写文件到 projectDir/tts/<uuid>.mp3
  // 4. 解析时长（ffprobe 或音频 metadata；优先 MiniMax 返回值）
  // 5. 构造 TTSAsset，包含预设快照
}
```

**待验证**：MiniMax T2A v2 API 响应中字级时间戳的字段名与格式（开发第一步必须确认）。

---

## 8. TTS 替换配音闭环

### 8.1 用户旅程

```
场景：主播想替换某一句说错的话

Step 1. 定位
  时间线上右键 Clip#23（字幕「今天我们聊聊 AI 大模型」）
  → 菜单「🎤 重新配音」

Step 2. 重新配音对话框
  - 显示原字幕文本（只读参考）
  - 替换文本 textarea（默认预填原字幕）
  - 音色预设下拉
  - 单次微调滑块
  - 提示「原片段时长 3.2s」、「生成后后续片段会顺延」
  - [取消] [生成并替换]

Step 3. 生成
  - 走 generateTTSAsset() → 得到 TTSAsset（含时间戳）
  - 测得实际时长 4.1s

Step 4. 替换
  - Clip#23.source 改为 { kind: 'tts', assetId: xxx }
  - Clip#23.durationMs = 4.1s
  - 后续所有 Clip.timelineStartMs += (4.1 - 3.2) = +0.9s
  - 旧 Clip#23 时间范围内的字幕删除
  - 按 wordTimestamps 生成新字幕（或降级为一条）
  - 后续字幕位置不动（字幕脱钩原则）

Step 5. 原子入栈 undo/redo
```

### 8.2 双入口

| 入口 | 流程 |
|------|------|
| 右键 Clip → 重新配音 | 对话框生成 → 自动替换当前 Clip |
| 左侧素材区 → 新建 TTS | 仅生成进入 ttsAssets，不替换 |
| TTS 卡片拖到 Clip 上 | 高亮目标 Clip → 释放确认 → 执行替换（不重新调 API） |

### 8.3 核心 Action

```ts
// src/store/timeline.ts
interface TimelineState {
  replaceClipWithTTS(clipId: string, ttsAssetId: string): void;
  regenerateClipWithTTS(params: {
    clipId: string;
    text: string;
    voicePresetId: string;
    overrides?: Partial<VoiceParams>;
  }): Promise<void>;
}
```

`regenerateClipWithTTS` 内部：调用 `generateTTSAsset` → 写入 `ttsAssets` → 调用 `replaceClipWithTTS`。

`replaceClipWithTTS` 纯计算，核心逻辑：

```ts
// 1. 更新 Clip
const newClip = {
  ...oldClip,
  source: { kind: 'tts', assetId },
  durationMs: asset.durationMs,
};
const delta = asset.durationMs - oldClip.durationMs;

// 2. 后续 Clip 顺延
const newAudioClips = audioClips.map((c, i) => {
  if (i === clipIndex) return newClip;
  if (i > clipIndex) return { ...c, timelineStartMs: c.timelineStartMs + delta };
  return c;
});

// 3. 字幕回写
const oldRange = [oldClip.timelineStartMs, oldClip.timelineStartMs + oldClip.durationMs];
const newRange = [oldClip.timelineStartMs, oldClip.timelineStartMs + asset.durationMs];

let nextSubtitles = subtitles.filter(s =>
  s.endMs <= oldRange[0] || s.startMs >= oldRange[1]
);

if (asset.wordTimestamps?.length) {
  nextSubtitles.push(
    ...buildSubtitlesFromWordTimestamps(asset.wordTimestamps, newRange[0])
  );
} else {
  nextSubtitles.push({
    index: -1,
    startMs: newRange[0],
    endMs: newRange[1],
    text: asset.text,
  });
}

nextSubtitles = nextSubtitles
  .sort((a, b) => a.startMs - b.startMs)
  .map((s, i) => ({ ...s, index: i + 1 }));
```

### 8.4 字级时间戳聚合策略

```ts
// src/lib/subtitle-builder.ts
export function buildSubtitlesFromWordTimestamps(
  timestamps: WordTimestamp[],
  offsetMs: number
): SrtEntry[] {
  const result: SrtEntry[] = [];
  let bucket: WordTimestamp[] = [];

  const flush = () => {
    if (!bucket.length) return;
    result.push({
      index: -1,
      startMs: bucket[0].startMs + offsetMs,
      endMs: bucket[bucket.length - 1].endMs + offsetMs,
      text: bucket.map(b => b.text).join(''),
    });
    bucket = [];
  };

  for (const ts of timestamps) {
    bucket.push(ts);
    const isPunct = /[，。？！,.?!]/.test(ts.text);
    const tooLong =
      bucket.length >= 20 ||
      bucket[bucket.length - 1].endMs - bucket[0].startMs >= 3000;
    if (isPunct || tooLong) flush();
  }
  flush();
  return result;
}
```

### 8.5 进度反馈

接入 `src/store/task-progress.ts`（项目铁律 PROGRESS-SPEC.md），分类 `type: 'tts'`（粉色）：

```ts
const taskId = taskProgress.startTask({ type: 'tts', label: '生成 TTS 音频' });
try {
  taskProgress.updateTask(taskId, { progress: 0.3, hint: '调用 MiniMax...' });
  const asset = await generateTTSAsset(...);
  taskProgress.updateTask(taskId, { progress: 0.8, hint: '写入文件...' });
  taskProgress.completeTask(taskId);
} catch (e) {
  taskProgress.failTask(taskId, e.message);
}
```

AI 操作视觉反馈（虚拟光标、打字机）不涉及本流程。

---

## 9. 向后兼容与迁移

1. 所有新增 `TimelineData` 字段可选，旧项目打开不报错
2. `audioClips === undefined` 时：
   - Remotion 渲染走单一 `<Audio>` 路径
   - 音频轨道仍复用 `TimelineAudioWaveform`
3. 首次进入字幕 Tab 或点击右键「重新配音」时，惰性初始化：
   - 解析 `podcast.srtPath` → 填充 `subtitles`
   - 按字幕时间切分 → 填充 `audioClips`
   - 初始化 `ttsAssets = []`
4. 下次保存 `timeline.json` 时持久化新字段

---

## 10. P0 范围与交付清单

| # | 模块 | 交付内容 |
|---|------|---------|
| 1 | 数据模型 | `AudioClip` / `TTSAsset` / `VoicePreset` / `WordTimestamp` 类型 + `TimelineData` 增量 |
| 2 | Store | `voice-presets` 全局 store + `timeline` 扩展（`audioClips`/`ttsAssets`/`subtitles` + CRUD + `replaceClipWithTTS`） |
| 3 | Electron IPC | `voice-presets:list/save/delete`、`tts:write-file`，preload + electron-api 同步 |
| 4 | Clip 初始化 | `clip-init.ts` 按字幕自动切分 |
| 5 | 虚拟合成 | `PodcastComposition` 改造，兼容旧项目 |
| 6 | 波形切片 | `TimelineClipWaveform` 组件 |
| 7 | 字幕 Tab（精简） | 列表 / 内联编辑 / 新增 / 删除（行末按钮）/ 查找 / 查找替换 / 时间轴调整 / 自动定位 / 双向联动 |
| 8 | 左侧素材区 TTS 入口 | 音频 Tab 顶部「+ 新建 TTS」+「最近生成」卡片列表 |
| 9 | 新建 TTS 对话框 | 文本 + 预设 + 单次微调 + 生成（无试听） |
| 10 | 预设管理器 | 增删改查 + 设为默认，硬编码 MiniMax 音色 |
| 11 | 右键重新配音 | Clip 右键菜单 + `ReVoiceDialog` + 生成替换 |
| 12 | 拖拽替换 | TTS 卡片拖到 Clip 上 |
| 13 | TTS 替换核心 | `replaceClipWithTTS` + 字幕回写 + 后续顺延 |
| 14 | 进度反馈 | TTS 生成接入 `task-progress`（type: 'tts'） |
| 15 | 持久化 | `timeline.json` 新字段 + `project/tts/` 落盘 + 向后兼容 |

**P0 明确不做**：
- 音频 Clip 的手动合并 / 拆分 / 删除 / 静音
- 字幕合并 / 拆分 / 导出 SRT
- 音色克隆
- TTS 素材手动清理
- 试听功能
- Ffmpeg 预合成 Fallback

## 11. P1 规划

- 音频 Clip 手动操作（拆分 / 合并 / 删除 / 重排 / 静音）
- 字幕合并 / 拆分 / 导出 SRT
- TTS 素材手动清理（未引用素材一键清理）
- Ffmpeg 预合成 Fallback（如 P0 多 `<Audio>` 性能不达标）
- 音色克隆（接入 MiniMax 克隆接口 + 参考音频上传）
- Clip 高级功能：淡入淡出 / 音量包络

---

## 12. 风险与应对

| 风险 | 等级 | 应对 |
|------|------|------|
| MiniMax API 不返回字级时间戳 | 高 | 降级：整段字幕给一条；开发首步验证 API 响应结构 |
| Remotion 多 `<Audio>` 性能（100+ Clip 卡顿） | 中 | P0 做压测（100/200/500 Clip）；不达标触发 P1 Fallback |
| 字幕 index 重排导致的引用断裂 | 中 | `subtitles` 每次变更后按 `startMs` 排序重编 `index`；`AudioClip.linkedSubtitleIndexes` 在重排时一致维护 |
| 预设被删除后历史 TTSAsset 引用失效 | 低 | `TTSAsset.voicePresetSnapshot` 存快照副本 |
| 向后兼容：旧项目没有 `audioClips` | 低 | 惰性初始化 + 所有新字段可选 |
| TTS 生成失败的数据一致性 | 中 | 失败时不写入任何状态；错误 toast 提示 |
| 替换后时间线总时长变化 | 中 | Remotion `durationInFrames` 动态计算；视觉图层和字幕位置不自动调整（用户自负） |

## 13. 待验证依赖（开发第一步）

1. MiniMax T2A v2 API 响应中字级时间戳的字段名与格式
2. 整理硬编码 MiniMax 系统音色列表（ID + 显示名 + 适用场景）
3. Remotion `<Audio>` 的 `trimBefore` / `trimAfter` 毫秒精度验证
4. Remotion 多 `<Sequence>` 性能基准（100 / 200 / 500 Clip）

## 14. 测试策略

**Level 0（定向验证）**：
- `clip-init.ts`：给定 SRT + 音频时长 → 期望 Clip 数组
- `buildSubtitlesFromWordTimestamps`：各种时间戳输入的聚合结果
- `replaceClipWithTTS`：给定 state + clip + asset → 期望 state diff（Clip 顺延 / 字幕回写）
- 数据模型 JSON 往返相等

**Level 1（回归）**：
- 旧项目打开后行为保持（`audioClips` 为空走单一音频路径）
- 字幕编辑 + undo/redo 完整链路
- TTS 替换 + undo/redo 完整链路

**Level 2（集成）**：
- 完整跑一遍「导入 → 编辑字幕 → 生成 TTS → 替换 Clip → 导出」
- 100 Clip 规模下 Remotion Player 流畅度压测

## 15. 验收标准

P0 完成的标志：

1. 用户能在字幕 Tab 中查看、修改、新增、删除字幕，并持久化到 `timeline.json`
2. 用户能在左侧素材区新建 TTS 音频，看到生成结果出现在「最近生成」
3. 用户能右键 Clip 触发重新配音，生成后原 Clip 被替换、后续 Clip 顺延、字幕范围被重写
4. 用户能拖拽已生成的 TTS 素材到任意 Clip 触发替换
5. 用户能在全局设置中管理音色预设（增 / 删 / 改 / 默认）
6. 预览和导出基于 Clip 序列都能正常工作
7. 旧项目打开无错误，行为与改造前一致
8. TTS 生成过程在 AppStatusBar 有可见进度，失败有明确错误提示

---

## 16. 工作量估算

| 阶段 | 模块 | 人日 |
|------|------|------|
| P0 | 数据模型 + Store + IPC | 1.5 |
| P0 | 虚拟合成 + Remotion 改造 | 2.0 |
| P0 | Clip 初始化 + 波形切片 | 1.0 |
| P0 | 字幕 Tab（精简版） | 2.0 |
| P0 | 音色预设管理 + Modal | 1.5 |
| P0 | TTS 素材库 UI（左侧面板） | 1.0 |
| P0 | 新建 TTS 对话框 + 生成服务 | 1.5 |
| P0 | 右键重新配音 + 替换核心逻辑 | 2.0 |
| P0 | 拖拽替换交互 | 0.5 |
| P0 | 进度反馈接入 | 0.3 |
| P0 | 持久化 + 向后兼容 | 0.5 |
| P0 | 联调 + bug fix + 测试 | 2.0 |
| **P0 合计** |  | **≈ 15.8 人日** |
| P1 | Clip 手动操作 | 3.0 |
| P1 | 字幕合并拆分 + 导出 | 1.0 |
| P1 | 音色克隆 | 2.0 |
| P1 | 其他 | 2.0 |
| **P1 合计** |  | **≈ 8 人日** |

---

## 附录 A：关键文件新增 / 修改

### 新增文件
- `src/store/voice-presets.ts`
- `src/lib/tts-service.ts`
- `src/lib/clip-init.ts`
- `src/lib/subtitle-builder.ts`
- `src/lib/minimax-voices.ts`
- `src/components/SubtitleTabPanel.tsx`
- `src/components/NewTTSDialog.tsx`
- `src/components/ReVoiceDialog.tsx`
- `src/components/VoicePresetManager.tsx`
- `src/components/TimelineClipWaveform.tsx`

### 修改文件
- `src/types.ts`
- `src/store/timeline.ts`
- `src/components/EditorInspector.tsx`
- `src/components/AssetPanel.tsx`
- `src/remotion/PodcastComposition.tsx`（或 `src/remotion/index.ts` 对应入口）
- `electron/main.ts`
- `electron/preload.ts`
- `src/lib/electron-api.ts`
- `src/lib/minimax-tts.ts`（按需扩展）

## 附录 B：Electron IPC 清单

| IPC 通道 | 参数 | 返回 |
|---------|------|------|
| `voice-presets:list` | — | `VoicePreset[]` |
| `voice-presets:save` | `VoicePreset` | `VoicePreset`（含 id） |
| `voice-presets:delete` | `id: string` | `void` |
| `tts:write-file` | `{ projectDir, buffer, filename }` | `string`（绝对路径） |

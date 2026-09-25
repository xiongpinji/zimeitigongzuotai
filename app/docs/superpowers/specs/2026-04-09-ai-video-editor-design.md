# AI 视频剪辑完整流程 + Editor 手动导入设计文档

**日期**：2026-04-09  
**范围**：两个独立功能模块

---

## 一、背景与目标

### Feature 1：Editor 手动导入 MP3/SRT

当用户从目录加载项目进入 Editor 时，目前无法在 Editor 内替换或添加口播 MP3 和 SRT 字幕文件（只能通过 Setup 页面操作）。需在 AssetPanel 内新增「口播资源」专属区块，支持在 Editor 里直接替换 MP3 / SRT。

### Feature 2：AI 一键视频剪辑完整流程

在文稿创作完成后，通过 AI 自动完成：
1. MiniMax TTS 生成口播 MP3 + SRT 字幕
2. 导入时间轴
3. AI 卡片分析与生成
4. AI 封面图生成（随机选一张）
5. 自动排布时间轴（音频 + 字幕 + AI 卡片 + 封面背景）
6. 提供可二次编辑的最终预览

全程有 AI 视觉反馈（进度提示 + 时间轴块飞入动画 + floating 虚拟光标）。

---

## 二、Feature 1：AssetPanel 口播资源区块

### 2.1 组件结构

在 `AssetPanel.tsx` 顶部（现有素材列表上方）新增 `PodcastResourceSection` 子组件：

```
AssetPanel
└── PodcastResourceSection（折叠展开）
    ├── AudioRow：当前 MP3 文件名 + [替换] 按钮
    └── SrtRow：当前 SRT 文件名 + [替换] 按钮
```

- **无文件时**：显示「未设置」灰色 + 「+ 添加」按钮
- **有文件时**：显示文件名（截断） + 「替换」按钮

### 2.2 数据流

**替换 MP3：**
```
用户点击「替换 MP3」
  → electronAPI.openFileDialog(['mp3'])
  → electronAPI.getAudioDuration(path)
  → timelineStore.setPodcast(newAudioPath, currentSrtPath, durationMs)
  → 自动保存 timeline.json
```

**替换 SRT：**
```
用户点击「替换 SRT」
  → electronAPI.openFileDialog(['srt'])
  → electronAPI.parseSrtFile(path)  // 获取条目 + 时长
  → timelineStore.setPodcast(currentAudioPath, newSrtPath, durationMs)
  → 弹出确认：「AI 卡片将失效，是否重新分析？」
      是 → aiStore.clearAnalysis() + analyzeSrt() + 持久化 ai-analysis.json
      否 → 仅更新路径
```

### 2.3 文件改动范围

| 文件 | 改动说明 |
|------|---------|
| `src/components/AssetPanel.tsx` | 新增 PodcastResourceSection，读取 `timeline.podcast` |
| `src/components/AssetPanel.module.css` | 新增区块样式 |
| `src/lib/electron-api.ts` | 确认 `openFileDialog` 支持扩展名过滤（按需补充） |

---

## 三、Feature 2：AI 一键剪辑完整流程

### 3.1 MiniMax TTS 接入

**新增文件**：`src/lib/minimax-tts.ts`

#### 接口调用

使用 MiniMax T2A v2 接口，开启 `subtitle_enable: true` 获取词级时间戳，本地组装 SRT。

```typescript
interface TTSOptions {
  text: string;        // 文稿内容
  voiceId: string;     // 发音人 ID
  speed?: number;      // 语速 0.5~2.0，默认 1.0
  apiKey: string;
  groupId: string;
}

interface TTSResult {
  audioPath: string;   // {projectDir}/podcast-audio.mp3
  srtPath: string;     // {projectDir}/podcast-subtitles.srt
  durationMs: number;
}

async function generateTTS(
  options: TTSOptions,
  projectDir: string,
  onProgress: (pct: number) => void
): Promise<TTSResult>
```

#### 取消语义

- Renderer 侧 `cancel()` 不能只重置 UI
- 必须同时中断主进程中的 TTS 请求与流式读取
- 主进程需维护当前 TTS 任务句柄，接收 cancel IPC 后真正 `abort`

#### SRT 组装规则

- 遍历 MiniMax 返回的 `words[]`（每个 word 含 `start_time`、`end_time`，单位 ms）
- 遇到句末标点（。！？…）或累计超过 20 字时断句
- 生成标准 SRT 格式写入文件

#### AI 配置扩展

在 `AISettings` 新增 MiniMax 字段（向后兼容，新字段默认空字符串）：

```typescript
interface AISettings {
  // 现有字段保持不变...
  minimaxApiKey: string;
  minimaxGroupId: string;
  minimaxVoiceId: string;   // 默认 'male-qn-qingse'
  minimaxSpeed: number;     // 默认 1.0
}
```

`AISettingsModal.tsx` 同步新增对应输入项。

---

### 3.2 工作流状态机

**扩展** `src/store/ai.ts`，新增 `WorkflowState` 字段：

```typescript
type WorkflowStep =
  | 'idle'
  | 'tts_generating'    // MiniMax TTS 生成中
  | 'tts_done'          // MP3+SRT 已生成，等待后续步骤
  | 'ai_analyzing'      // SRT → AI 卡片分析中
  | 'cover_generating'  // AI 封面图生成中
  | 'arranging'         // 自动排布时间轴
  | 'done'              // 完成，用户可编辑
  | 'error'

interface WorkflowState {
  step: WorkflowStep;
  progress: number;      // 0~100，当前步骤内进度
  stepLabel: string;     // UI 显示文字
  error: string | null;
  canCancel: boolean;    // 仅 tts_generating 阶段为 true
}
```

#### 步骤流转

```
idle
  → tts_generating  （MiniMax 流式请求，onProgress 更新 progress）
  → tts_done        （写入 MP3+SRT，调 setPodcast()）
  → ai_analyzing    （调现有 analyzeSrt()）
  → cover_generating（调现有 generateCoverImages()，随机选一张）
  → arranging       （自动排布时间轴，触发飞入动画）
  → done

任意步骤异常 → error（保留已完成结果，支持断点重试）
```

#### 状态持久化

- `ai_analyzing` 完成后，需将分析结果写入 `ai-analysis.json`
- `cover_generating` 完成后，需将封面候选与选中状态写入 `ai-analysis.json`
- 这样即使关闭并重新打开项目，也能恢复 AI 卡片和封面候选

#### 断点重试策略

| 失败步骤 | 重试行为 |
|----------|---------|
| `tts_generating` | 从头重新请求 TTS |
| `ai_analyzing` | 跳过 TTS（文件已存在），直接重跑分析 |
| `cover_generating` | 跳过前两步，直接重跑封面生成 |
| `arranging` | 跳过前三步，直接重跑排布 |

---

### 3.3 核心 Hook

**新增文件**：`src/hooks/useAIVideoWorkflow.ts`

```typescript
function useAIVideoWorkflow(projectDir: string) {
  return {
    start(scriptText: string): void  // 两端入口统一调用
    cancel(): void                   // AbortController 取消 TTS 请求
    retry(): void                    // 从 error 步骤断点重试
    workflow: WorkflowState          // 从 ai store 读取
  }
}
```

`start()` 内部串行调用各步骤，每步完成后 dispatch 到 store，通过 `AbortController` 支持取消。

---

### 3.4 两端入口

**ScriptWorkbench**：
- QuickActionBar 新增「生成视频」按钮，文稿非空时可用
- 点击 → `useAIVideoWorkflow.start(scriptText)` → 工作台显示进度覆盖层
- `tts_done` 后自动跳转到 Editor，Editor 接管剩余步骤
- WorkflowState 存于 Zustand ai store（内存），Electron 单窗口内页面导航不会丢失状态；Editor 挂载时检测 `workflow.step === 'tts_done'` 自动继续

**Editor**：
- 顶部工具栏新增「AI 一键剪辑」按钮，`script.md` 存在时可用
- 点击 → 读取 `script.md` 内容 → `useAIVideoWorkflow.start(scriptText)`
- 从 `idle` 启动完整流程

---

### 3.5 Editor 动画层

**新增文件**：`src/components/TimelineAIOverlay.tsx`

挂载在 `Editor.tsx` 的时间轴区域上方（`position: absolute`，全覆盖），`step` 非 `idle`/`done` 时显示。

#### 布局结构

```
┌──────────────────────────────────────────┐
│ [进度条]  正在生成语音... 67%  [取消]     │  ← 顶部横幅
└──────────────────────────────────────────┘
  时间轴区域（半透明遮罩，阻止用户交互）
  + 飞入动画层（arranging 阶段）
```

#### 飞入动画（`arranging` 阶段）

每个 overlay 块（AI 卡片、封面、字幕条目）使用 CSS 动画逐个飞入：
- `transform: translateY(-40px)` + `opacity: 0 → 1`
- 每块间隔 80ms，模拟 AI 逐个拖放节奏
- 飞入完成后遮罩淡出，Timeline 恢复可交互

#### 时间轴自动排布内容

排布完成后，时间轴包含：
1. **Audio 轨**：口播 MP3 贯穿全长
2. **Subtitle 轨**：SRT 条目逐一展开
3. **Visual 轨**：AI 内容卡片按 SRT 时间戳定位
4. **背景层**：随机选中的封面图铺满全长

---

### 3.6 虚拟光标（Editor 上下文）

Editor 内无 CodeMirror，使用 **floating div**（`position: fixed`）复用 CLAUDE.md 铁律视觉语言：

```typescript
interface EditorAICursor {
  visible: boolean;
  x: number;       // 对应当前操作 overlay 的屏幕 X 坐标
  y: number;       // 对应当前轨道的屏幕 Y 坐标
  label: string;   // '🤖 AI 正在排布...'
  color: '#a78bfa' // 生成阶段紫色（与 CLAUDE.md 铁律一致）
}
```

坐标通过 `Timeline 容器 getBoundingClientRect()` + `startMs → px` 换算，`transition: 0.2s ease-out` 平滑移动。

#### 三阶段对应（复用 CLAUDE.md 铁律 2）

| 阶段 | Editor 表现 |
|------|------------|
| 等待/准备 | 顶部横幅呼吸闪烁，遮罩显示，光标不可见 |
| 执行中 | floating 光标在时间轴上移动，blocks 逐个飞入 |
| 完成 | 遮罩淡出，光标消失，Timeline 恢复交互 |

---

## 四、文件改动总表

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/lib/minimax-tts.ts` | 新增 | MiniMax T2A 接入 + SRT 组装 |
| `src/hooks/useAIVideoWorkflow.ts` | 新增 | 工作流状态机 hook |
| `src/components/TimelineAIOverlay.tsx` | 新增 | Editor 动画层 + floating 光标 |
| `src/store/ai.ts` | 修改 | 新增 WorkflowState 字段 |
| `src/components/AssetPanel.tsx` | 修改 | 新增 PodcastResourceSection |
| `src/components/AssetPanel.module.css` | 修改 | 新增区块样式 |
| `src/components/AISettingsModal.tsx` | 修改 | 新增 MiniMax 配置输入项 |
| `src/pages/ScriptWorkbench.tsx` | 修改 | 新增「生成视频」按钮 + 进度覆盖 |
| `src/pages/Editor.tsx` | 修改 | 挂载 TimelineAIOverlay，新增「AI 一键剪辑」按钮 |
| `src/lib/electron-api.ts` | 按需修改 | 确认/补充文件对话框扩展名过滤 |

---

## 五、不在本次范围内

- 多发音人切换 UI（仅配置 voiceId 字符串，不做选择器）
- TTS 生成的音频试听
- 时间轴 AI 排布的智能卡片间距优化（初版按 SRT 时间戳直接放置）
- AI 剪辑流程的暂停/恢复（仅支持取消重来）

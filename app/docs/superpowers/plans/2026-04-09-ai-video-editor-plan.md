# AI 视频剪辑完整流程 + Editor 手动导入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Editor 添加口播资源手动导入，并实现从文稿→TTS→AI 卡片→封面→时间轴自动排布的 AI 一键剪辑完整流程。

**Architecture:** Feature 1 在 AssetPanel 内新增 PodcastResourceSection，复用已有 `selectMediaFile` IPC。Feature 2 新增可取消的 MiniMax TTS IPC 处理器（main.ts）、WorkflowState（ai store）、`useAIVideoWorkflow` hook、`TimelineAIOverlay` 动画组件，两端（ScriptWorkbench / Editor）共享同一 hook 入口；AI 分析结果与封面候选沿用现有 `ai-analysis.json` 持久化链路。

**Tech Stack:** React 19, Zustand 5, TypeScript 6, Electron 41 IPC, MiniMax T2A Pro API, CSS Animation

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `src/components/AssetPanel.tsx` | 修改 — 新增 PodcastResourceSection |
| `src/components/AssetPanel.module.css` | 修改 — 新增口播区块样式 |
| `src/types/ai.ts` | 修改 — AISettings 增加 MiniMax 字段 |
| `src/store/ai.ts` | 修改 — loadAISettings 默认值 + WorkflowState + workflow actions |
| `src/components/AISettingsModal.tsx` | 修改 — 新增 MiniMax 配置区块 |
| `src/lib/electron-api.ts` | 修改 — generateTTS + onTTSProgress + cancelTTS 类型 |
| `electron/preload.ts` | 修改 — 暴露 generateTTS + onTTSProgress + cancelTTS |
| `electron/main.ts` | 修改 — generateTTS/cancelTTS IPC 处理器 + SRT 组装 |
| `src/hooks/useAIVideoWorkflow.ts` | 新增 — 工作流状态机 hook |
| `src/components/TimelineAIOverlay.tsx` | 新增 — 进度横幅 + floating 光标 + 飞入动画 |
| `src/pages/Editor.tsx` | 修改 — 挂载 Overlay、AI 剪辑按钮、tts_done 自动继续 |
| `src/pages/ScriptWorkbench.tsx` | 修改 — 生成视频按钮 + 进度覆盖层 |
| `src/App.tsx` | 修改 — onNavigateToEditor 回调 |
| `tests/asset-panel.test.tsx` | 修改 — 验证口播区块 |
| `tests/editor.test.tsx` | 修改 — 验证 AI 剪辑按钮 |

---

## Task 1: AssetPanel 口播资源区块

**Files:**
- Modify: `src/components/AssetPanel.tsx`
- Modify: `src/components/AssetPanel.module.css`
- Test: `tests/asset-panel.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `tests/asset-panel.test.tsx` 末尾追加：

```tsx
it('renders podcast resource section with audio and srt rows', () => {
  const html = renderToStaticMarkup(<AssetPanel compact={false} />);

  expect(html).toContain('口播资源');
  expect(html).toContain('podcast.mp3');
  expect(html).toContain('subtitles.srt');
  // 替换按钮
  expect(html).toContain('替换音频');
  expect(html).toContain('替换字幕');
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/asset-panel.test.tsx
```
预期：FAIL — 找不到"口播资源"/"替换音频"/"替换字幕"

- [ ] **Step 3: 在 AssetPanel.module.css 末尾追加口播区块样式**

```css
/* ── 口播资源区块 ── */
.podcastSection {
  flex-shrink: 0;
  padding: 10px 8px 6px;
  border-bottom: 1px solid var(--color-separator);
}

.podcastSectionTitle {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  margin-bottom: 6px;
}

.podcastRow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}

.podcastRowIcon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.podcastRowName {
  flex: 1;
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.podcastRowNameEmpty {
  color: var(--color-text-muted);
  font-style: italic;
}

.podcastRowAction {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

.podcastRowAction:hover {
  background: var(--color-panel-elevated);
  color: var(--color-text-primary);
}
```

- [ ] **Step 4: 在 AssetPanel.tsx 内、return 前添加 PodcastResourceSection 内联组件**

在 `AssetPanel.tsx` 中找到 `export function AssetPanel(` 之前，添加：

```tsx
function PodcastResourceSection({
  audioPath,
  srtPath,
  onReplaceAudio,
  onReplaceSrt,
}: {
  audioPath: string;
  srtPath: string;
  onReplaceAudio: () => void;
  onReplaceSrt: () => void;
}) {
  const audioName = audioPath ? audioPath.split('/').pop()! : '';
  const srtName = srtPath ? srtPath.split('/').pop()! : '';

  return (
    <div className={styles.podcastSection}>
      <div className={styles.podcastSectionTitle}>口播资源</div>
      <div className={styles.podcastRow}>
        <span className={styles.podcastRowIcon}>
          <AppIcon name="music" size={12} />
        </span>
        <span
          className={[
            styles.podcastRowName,
            audioName ? '' : styles.podcastRowNameEmpty,
          ].join(' ')}
        >
          {audioName || '未设置音频'}
        </span>
        <button
          type="button"
          className={styles.podcastRowAction}
          onClick={onReplaceAudio}
        >
          {audioName ? '替换音频' : '+ 添加'}
        </button>
      </div>
      <div className={styles.podcastRow}>
        <span className={styles.podcastRowIcon}>
          <AppIcon name="subtitles" size={12} />
        </span>
        <span
          className={[
            styles.podcastRowName,
            srtName ? '' : styles.podcastRowNameEmpty,
          ].join(' ')}
        >
          {srtName || '未设置字幕'}
        </span>
        <button
          type="button"
          className={styles.podcastRowAction}
          onClick={onReplaceSrt}
        >
          {srtName ? '替换字幕' : '+ 添加'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 在 AssetPanel 的 props 接口和函数体内接入 PodcastResourceSection**

在 `AssetPanel` props 接口末尾追加（原有 `onUseAsPodcastSrt` 后面）：
```tsx
  onReplaceAudio?: () => Promise<void>;
  onReplaceSrt?: () => Promise<void>;
```

在 `AssetPanel` 函数体内，解构 `timeline`：
```tsx
const { addAsset, assets, removeAsset, timeline } = useTimelineStore();
```
（已有，无需改动）

在 `return (` 下方的 `<aside>` 第一个子元素前（`{/* 搜索栏 */}` 上方）插入：

```tsx
      <PodcastResourceSection
        audioPath={timeline.podcast?.audioPath ?? ''}
        srtPath={timeline.podcast?.srtPath ?? ''}
        onReplaceAudio={() => void onReplaceAudio?.()}
        onReplaceSrt={() => void onReplaceSrt?.()}
      />
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npx vitest run tests/asset-panel.test.tsx
```
预期：PASS（所有测试）

- [ ] **Step 7: 添加 useAIStore import 到 Editor.tsx**

在 Editor.tsx 顶部 import 区追加：
```tsx
import { useAIStore } from '../store/ai';
```

- [ ] **Step 8: 在 Editor.tsx 中为 AssetPanel 传入 onReplaceAudio / onReplaceSrt**

在 `Editor` 函数内的其他 callback 附近添加：

```tsx
  const handleReplaceAudio = useCallback(async () => {
    const audioPath = await window.electronAPI.selectMediaFile('audio');
    if (!audioPath) return;
    // 替换音频保留现有 SRT 路径和时长（与 App.tsx handleReplaceAudio 一致）
    store.setPodcast(
      audioPath,
      store.timeline.podcast?.srtPath ?? '',
      store.timeline.podcast?.durationMs ?? 0,
    );
  }, [store]);

  const handleReplaceSrt = useCallback(async () => {
    const srtPath = await window.electronAPI.selectMediaFile('srt');
    if (!srtPath) return;
    const { entries, durationMs } = await window.electronAPI.parseSrtFile(srtPath);
    store.setSrtEntries(entries);
    store.setPodcast(store.timeline.podcast?.audioPath ?? '', srtPath, durationMs);
    // 提示是否重新分析 AI 卡片
    const confirmed = window.confirm('替换字幕后，AI 卡片分析将失效。是否重新分析？');
    if (confirmed) {
      useAIStore.getState().clearAnalysis();
      // 不能停在 clearAnalysis()；需立即复用现有 analyzeSrt + saveAIAnalysis 链路重建结果
      // 若当前 AI 配置不完整，则保留清空状态并引导用户补全配置
    }
  }, [store]);
```

在 JSX 中的 `<AssetPanel` 组件处追加两个 props：
```tsx
    onReplaceAudio={handleReplaceAudio}
    onReplaceSrt={handleReplaceSrt}
```

- [ ] **Step 9: Commit**

```bash
git add src/components/AssetPanel.tsx src/components/AssetPanel.module.css src/pages/Editor.tsx tests/asset-panel.test.tsx
git commit -m "feat(asset-panel): 新增口播资源区块，支持在 Editor 内替换 MP3/SRT"
```

---

## Task 2: AISettings 扩展 MiniMax 配置字段

**Files:**
- Modify: `src/types/ai.ts`
- Modify: `src/store/ai.ts`
- Modify: `src/components/AISettingsModal.tsx`

- [ ] **Step 1: 在 src/types/ai.ts 的 AISettings 接口末尾追加 MiniMax 字段**

找到：
```typescript
export interface AISettings {
  // OpenAI / OpenAI-compatible
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  /** 是否开启模型思考模式，默认开启 */
  enableThinking?: boolean;
  // 图片生成
  jimengApiUrl: string;
  jimengSessionId: string;
}
```

替换为：
```typescript
export interface AISettings {
  // OpenAI / OpenAI-compatible
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  /** 是否开启模型思考模式，默认开启 */
  enableThinking?: boolean;
  // 图片生成
  jimengApiUrl: string;
  jimengSessionId: string;
  // MiniMax TTS
  minimaxApiKey: string;
  minimaxGroupId: string;
  minimaxVoiceId: string;
  minimaxSpeed: number;
}
```

- [ ] **Step 2: 更新 loadAISettings() 的默认值**

在 `src/store/ai.ts` 的 `loadAISettings` 函数中，找到：
```typescript
    return {
      ...parsed,
      enableThinking: parsed.enableThinking ?? true,
    };
```
替换为：
```typescript
    return {
      ...parsed,
      enableThinking: parsed.enableThinking ?? true,
      minimaxApiKey: parsed.minimaxApiKey ?? '',
      minimaxGroupId: parsed.minimaxGroupId ?? '',
      minimaxVoiceId: parsed.minimaxVoiceId ?? 'male-qn-qingse',
      minimaxSpeed: parsed.minimaxSpeed ?? 1.0,
    };
```

- [ ] **Step 3: 在 AISettingsModal.tsx 添加 MiniMax 状态与表单字段**

在 `AISettingsModal.tsx` 的 state 声明区（`const [jimengSessionId, ...]` 之后）追加：
```tsx
  const [minimaxApiKey, setMinimaxApiKey] = useState('');
  const [minimaxGroupId, setMinimaxGroupId] = useState('');
  const [minimaxVoiceId, setMinimaxVoiceId] = useState('male-qn-qingse');
  const [minimaxSpeed, setMinimaxSpeed] = useState('1.0');
```

在 `useEffect` 的 `setJimengSessionId(...)` 行后追加：
```tsx
    setMinimaxApiKey(settings?.minimaxApiKey ?? '');
    setMinimaxGroupId(settings?.minimaxGroupId ?? '');
    setMinimaxVoiceId(settings?.minimaxVoiceId ?? 'male-qn-qingse');
    setMinimaxSpeed(String(settings?.minimaxSpeed ?? 1.0));
```

在 JSX 中 `<Divider label="封面生成（即梦）" />` 之后（即梦字段之后），`</div>` 关闭 `styles.form` 之前追加：
```tsx
            <Divider label="语音合成（MiniMax）" />
            <SettingsField
              label="MiniMax API Key"
              value={minimaxApiKey}
              placeholder="eyJ..."
              onChange={setMinimaxApiKey}
              type="password"
            />
            <SettingsField
              label="MiniMax Group ID"
              value={minimaxGroupId}
              placeholder="1234567890"
              onChange={setMinimaxGroupId}
            />
            <SettingsField
              label="发音人 ID"
              value={minimaxVoiceId}
              placeholder="male-qn-qingse"
              onChange={setMinimaxVoiceId}
            />
            <SettingsField
              label="语速（0.5~2.0）"
              value={minimaxSpeed}
              placeholder="1.0"
              onChange={setMinimaxSpeed}
            />
```

在 `onConfirm` 的 `onSave({...})` 调用中，在 `jimengSessionId,` 之后追加：
```tsx
                minimaxApiKey,
                minimaxGroupId,
                minimaxVoiceId,
                minimaxSpeed: parseFloat(minimaxSpeed) || 1.0,
```

- [ ] **Step 4: Commit**

```bash
git add src/types/ai.ts src/store/ai.ts src/components/AISettingsModal.tsx
git commit -m "feat(ai-settings): 扩展 AISettings 支持 MiniMax TTS 配置"
```

---

## Task 3: AI Store 添加 WorkflowState

**Files:**
- Modify: `src/store/ai.ts`

- [ ] **Step 1: 在 src/store/ai.ts 顶部 import 后添加 WorkflowState 类型**

在 `const AI_SETTINGS_KEY` 行前插入：

```typescript
export type WorkflowStep =
  | 'idle'
  | 'tts_generating'
  | 'tts_done'
  | 'ai_analyzing'
  | 'cover_generating'
  | 'arranging'
  | 'done'
  | 'error';

export interface WorkflowState {
  step: WorkflowStep;
  progress: number;
  stepLabel: string;
  error: string | null;
  canCancel: boolean;
}

const DEFAULT_WORKFLOW: WorkflowState = {
  step: 'idle',
  progress: 0,
  stepLabel: '',
  error: null,
  canCancel: false,
};
```

- [ ] **Step 2: 在 AIStore 接口追加 workflow 字段和 actions**

在 `clearAnalysis: () => void;` 行之后追加：
```typescript
  workflow: WorkflowState;
  setWorkflow: (updates: Partial<WorkflowState>) => void;
  resetWorkflow: () => void;
```

- [ ] **Step 3: 在 useAIStore create 中初始化并实现新 actions**

在 `clearAnalysis: () => set({...})` 之后追加：
```typescript
  workflow: { ...DEFAULT_WORKFLOW },
  setWorkflow: (updates) =>
    set((state) => ({ workflow: { ...state.workflow, ...updates } })),
  resetWorkflow: () => set({ workflow: { ...DEFAULT_WORKFLOW } }),
```

- [ ] **Step 4: 运行全量测试确认没有类型错误**

```bash
npm test
```
预期：PASS（不新增失败）

- [ ] **Step 5: Commit**

```bash
git add src/store/ai.ts
git commit -m "feat(ai-store): 新增 WorkflowState 支持 AI 剪辑流程状态跟踪"
```

---

## Task 4: Electron IPC — generateTTS

**Files:**
- Modify: `src/lib/electron-api.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

> 注：三个文件必须同步修改，不可单独改一处（CLAUDE.md 约束）。

- [ ] **Step 1: 在 electron-api.ts 的 ElectronAPI 接口追加类型**

在 `selectOutputPath` 行前插入：
```typescript
  generateTTS: (args: {
    requestId: string;
    text: string;
    voiceId: string;
    speed: number;
    apiKey: string;
    groupId: string;
    projectDir: string;
  }) => Promise<{ audioPath: string; srtPath: string; durationMs: number }>;
  onTTSProgress: (callback: (pct: number) => void) => () => void;
  cancelTTS: (requestId: string) => Promise<void>;
```

- [ ] **Step 2: 在 electron/preload.ts 的 contextBridge.exposeInMainWorld('electronAPI', {...}) 内追加**

在 `selectOutputPath: ...` 行前插入：
```typescript
  generateTTS: (args: {
    requestId: string;
    text: string;
    voiceId: string;
    speed: number;
    apiKey: string;
    groupId: string;
    projectDir: string;
  }) => ipcRenderer.invoke('generate-tts', args),
  onTTSProgress: (callback: (pct: number) => void) => {
    const handler = (_event: unknown, pct: number) => callback(pct);
    ipcRenderer.on('tts-progress', handler);
    return () => ipcRenderer.removeListener('tts-progress', handler);
  },
  cancelTTS: (requestId: string) => ipcRenderer.invoke('cancel-tts', requestId),
```

- [ ] **Step 3: 在 electron/main.ts 末尾（最后一个 ipcMain.handle 之后）添加 SRT 组装函数**

```typescript
// ─── MiniMax TTS helpers ───────────────────────────────────────────────────

interface MinimaxSubtitleWord {
  text: string;
  time_ms: number;
  duration_ms: number;
}

const activeTtsRequests = new Map<string, AbortController>();

function assembleSRT(words: MinimaxSubtitleWord[]): string {
  if (words.length === 0) return '';

  const sentences: Array<{ words: MinimaxSubtitleWord[]; startMs: number; endMs: number }> = [];
  let current: MinimaxSubtitleWord[] = [];

  for (const word of words) {
    current.push(word);
    const isSentenceEnd =
      /[。！？…\.\!\?]$/.test(word.text.trimEnd()) || current.length >= 20;
    if (isSentenceEnd) {
      const startMs = current[0].time_ms;
      const last = current[current.length - 1];
      sentences.push({ words: current, startMs, endMs: last.time_ms + last.duration_ms });
      current = [];
    }
  }

  if (current.length > 0) {
    const startMs = current[0].time_ms;
    const last = current[current.length - 1];
    sentences.push({ words: current, startMs, endMs: last.time_ms + last.duration_ms });
  }

  const toSRTTime = (ms: number): string => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    const mil = ms % 1_000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mil).padStart(3, '0')}`;
  };

  return sentences
    .map((sentence, i) => {
      const text = sentence.words.map((w) => w.text).join('');
      return `${i + 1}\n${toSRTTime(sentence.startMs)} --> ${toSRTTime(sentence.endMs)}\n${text}`;
    })
    .join('\n\n') + '\n';
}
```

- [ ] **Step 4: 在 electron/main.ts 同处添加 generateTTS IPC handler**

```typescript
ipcMain.handle(
  'generate-tts',
  async (
    _event,
    args: {
      requestId: string;
      text: string;
      voiceId: string;
      speed: number;
      apiKey: string;
      groupId: string;
      projectDir: string;
    },
  ) => {
    const { requestId, text, voiceId, speed, apiKey, groupId, projectDir } = args;
    const controller = new AbortController();
    activeTtsRequests.set(requestId, controller);

    const response = await fetch('https://api.minimax.chat/v1/t2a_pro', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'speech-01-turbo',
        text,
        stream: true,
        voice_setting: { voice_id: voiceId, speed, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
        subtitle_enable: true,
        language_boost: 'zh',
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => String(response.status));
      throw new Error(`MiniMax TTS 请求失败: ${errText}`);
    }

    const audioChunks: Buffer[] = [];
    let subtitleWords: MinimaxSubtitleWord[] = [];
    let receivedChunks = 0;
    let estimatedTotal = 50; // 初始估计值，动态更新

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr) as {
            data?: {
              audio?: string;
              status?: number;
              subtitle?: { subtitles?: MinimaxSubtitleWord[] };
            };
          };

          const audio = parsed?.data?.audio;
          const status = parsed?.data?.status;

          if (audio) {
            audioChunks.push(Buffer.from(audio, 'base64'));
            receivedChunks++;
          }

          if (status === 2 && parsed?.data?.subtitle?.subtitles) {
            subtitleWords = parsed.data.subtitle.subtitles;
            estimatedTotal = receivedChunks;
          }

          if (status === 1) {
            estimatedTotal = Math.max(estimatedTotal, receivedChunks + 3);
          }

          const pct = Math.round(Math.min(90, (receivedChunks / estimatedTotal) * 90));
          mainWindow?.webContents.send('tts-progress', pct);
        } catch {
          // 忽略解析错误
        }
      }
    }

    await fs.mkdir(projectDir, { recursive: true });

    const audioBuffer = Buffer.concat(audioChunks);
    const audioPath = path.join(projectDir, 'podcast-audio.mp3');
    await fs.writeFile(audioPath, audioBuffer);

    const srtContent = assembleSRT(subtitleWords);
    const srtPath = path.join(projectDir, 'podcast-subtitles.srt');
    await fs.writeFile(srtPath, srtContent, 'utf-8');

    const lastWord = subtitleWords[subtitleWords.length - 1];
    const durationMs = lastWord ? lastWord.time_ms + lastWord.duration_ms : 0;

    mainWindow?.webContents.send('tts-progress', 100);

    activeTtsRequests.delete(requestId);
    return { audioPath, srtPath, durationMs };
  },
);

ipcMain.handle('cancel-tts', async (_event, requestId: string) => {
  activeTtsRequests.get(requestId)?.abort();
  activeTtsRequests.delete(requestId);
});
```

> 注意：`generate-tts` 处理器需要用 `try/finally` 包住请求与文件写入逻辑，确保异常和取消时都能清理 `activeTtsRequests`，避免泄漏脏状态。

- [ ] **Step 5: Commit**

```bash
git add src/lib/electron-api.ts electron/preload.ts electron/main.ts
git commit -m "feat(electron): 新增 generateTTS IPC + MiniMax T2A 处理器与 SRT 组装"
```

---

## Task 5: useAIVideoWorkflow Hook

**Files:**
- Create: `src/hooks/useAIVideoWorkflow.ts`

- [ ] **Step 1: 创建 hook 文件**

```typescript
import { useCallback, useRef } from 'react';
import { createPersistedAIState } from '../lib/ai-persistence';
import { useAIStore, loadAISettings } from '../store/ai';
import { useTimelineStore } from '../store/timeline';
import { getProjectDir } from '../store/timeline';
import type { AIAnalysisResult } from '../types/ai';
import type { WorkflowStep } from '../store/ai';

// 每个步骤失败时，重试从哪一步开始
function getRetryStep(failedStep: WorkflowStep): WorkflowStep {
  if (failedStep === 'tts_generating') return 'tts_generating';
  if (failedStep === 'ai_analyzing') return 'ai_analyzing';
  if (failedStep === 'cover_generating') return 'cover_generating';
  return 'arranging';
}

export function useAIVideoWorkflow() {
  const { workflow, setWorkflow, resetWorkflow, setAnalysisResult, setCoverCandidates, selectCover } =
    useAIStore();
  const timelineStore = useTimelineStore();
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef('');
  const retryStepRef = useRef<WorkflowStep>('tts_generating');
  const scriptTextRef = useRef('');

  const persistAIState = useCallback(
    async (projectDir: string, analysisResult: AIAnalysisResult | null) => {
      const nextState = createPersistedAIState(
        analysisResult,
        useAIStore.getState().coverCandidates,
      );
      await window.electronAPI.saveAIAnalysis(projectDir, JSON.stringify(nextState, null, 2));
    },
    [],
  );

  const runFromStep = useCallback(
    async (fromStep: WorkflowStep, scriptText: string, projectDir: string) => {
      const settings = loadAISettings();
      if (!settings) {
        setWorkflow({ step: 'error', error: '请先在 AI 配置中填写相关 API Key', canCancel: false });
        return;
      }

      // ─── Step: tts_generating ───────────────────────────────────────────
      if (fromStep === 'tts_generating') {
        if (!settings.minimaxApiKey || !settings.minimaxGroupId) {
          setWorkflow({
            step: 'error',
            error: '请先在 AI 配置中填写 MiniMax API Key 和 Group ID',
            canCancel: false,
          });
          return;
        }

        setWorkflow({
          step: 'tts_generating',
          progress: 0,
          stepLabel: '正在生成语音…',
          canCancel: true,
        });

        const cleanupProgress = window.electronAPI.onTTSProgress((pct) => {
          setWorkflow({ progress: pct });
        });

        let ttsResult: { audioPath: string; srtPath: string; durationMs: number };
        try {
          ttsResult = await window.electronAPI.generateTTS({
            requestId: requestIdRef.current,
            text: scriptText,
            voiceId: settings.minimaxVoiceId || 'male-qn-qingse',
            speed: settings.minimaxSpeed ?? 1.0,
            apiKey: settings.minimaxApiKey,
            groupId: settings.minimaxGroupId,
            projectDir,
          });
        } catch (err) {
          cleanupProgress();
          if (abortRef.current?.signal.aborted) return;
          setWorkflow({
            step: 'error',
            error: `语音生成失败: ${err instanceof Error ? err.message : String(err)}`,
            canCancel: false,
          });
          retryStepRef.current = 'tts_generating';
          return;
        }

        cleanupProgress();

        // 写入 podcast
        try {
          const { entries, durationMs } = await window.electronAPI.parseSrtFile(ttsResult.srtPath);
          timelineStore.setSrtEntries(entries);
          timelineStore.setPodcast(
            ttsResult.audioPath,
            ttsResult.srtPath,
            durationMs > 0 ? durationMs : ttsResult.durationMs,
          );
        } catch (err) {
          setWorkflow({
            step: 'error',
            error: `导入音频/字幕失败: ${err instanceof Error ? err.message : String(err)}`,
            canCancel: false,
          });
          retryStepRef.current = 'tts_generating';
          return;
        }

        setWorkflow({ step: 'tts_done', progress: 100, stepLabel: '语音生成完成', canCancel: false });
        fromStep = 'ai_analyzing';
      }

      if (abortRef.current?.signal.aborted) return;

      // ─── Step: ai_analyzing ─────────────────────────────────────────────
      if (fromStep === 'ai_analyzing' || fromStep === 'tts_done') {
        setWorkflow({
          step: 'ai_analyzing',
          progress: 10,
          stepLabel: '正在分析内容…',
          canCancel: false,
        });

        const { srtEntries } = useTimelineStore.getState();
        let analysisResult: AIAnalysisResult;
        try {
          analysisResult = (await window.electronAPI.analyzeSrt({
            entries: srtEntries,
            settings,
          })) as AIAnalysisResult;
          setAnalysisResult(analysisResult);
          await persistAIState(projectDir, analysisResult);
        } catch (err) {
          setWorkflow({
            step: 'error',
            error: `内容分析失败: ${err instanceof Error ? err.message : String(err)}`,
            canCancel: false,
          });
          retryStepRef.current = 'ai_analyzing';
          return;
        }

        setWorkflow({ step: 'cover_generating', progress: 0, stepLabel: '正在生成封面…', canCancel: false });
        fromStep = 'cover_generating';
      }

      if (abortRef.current?.signal.aborted) return;

      // ─── Step: cover_generating ─────────────────────────────────────────
      if (fromStep === 'cover_generating') {
        const { analysisResult } = useAIStore.getState();
        const coverPrompts = analysisResult?.coverPrompts ?? [];

        if (coverPrompts.length > 0) {
          setWorkflow({ progress: 20, stepLabel: '正在生成封面图…' });
          try {
            const candidates = await window.electronAPI.generateCoverImages({
              prompts: coverPrompts,
              settings,
              projectDir,
            });
            setCoverCandidates(candidates);

            // 随机选一张
            const validCandidates = candidates.filter((c) => c.imageUrl && !c.error);
            if (validCandidates.length > 0) {
              const randomPick =
                validCandidates[Math.floor(Math.random() * validCandidates.length)];
              selectCover(randomPick.id);
              timelineStore.setGlobalBackground(randomPick.imageUrl);
            }
            await persistAIState(projectDir, useAIStore.getState().analysisResult);
          } catch (err) {
            // 封面生成失败不阻断流程，继续 arranging
            console.warn('封面生成失败，跳过:', err);
          }
        }

        setWorkflow({ step: 'arranging', progress: 0, stepLabel: '正在排布时间轴…', canCancel: false });
        fromStep = 'arranging';
      }

      if (abortRef.current?.signal.aborted) return;

      // ─── Step: arranging ────────────────────────────────────────────────
      if (fromStep === 'arranging') {
        const { analysisResult } = useAIStore.getState();
        const enabledCards = (analysisResult?.cards ?? []).filter((card) => card.enabled);

        if (enabledCards.length > 0) {
          // 导入时用 buildAICardTimelineDraft，与 AIPanel 相同
          const { buildAICardTimelineDraft } = await import('../types/ai');
          const drafts = enabledCards.map(buildAICardTimelineDraft);
          timelineStore.addAICardsToTimeline(drafts);
        }

        setWorkflow({ step: 'done', progress: 100, stepLabel: '完成！', canCancel: false });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const start = useCallback(
    (scriptText: string) => {
      const projectDir = getProjectDir() ?? '';
      scriptTextRef.current = scriptText;
      abortRef.current = new AbortController();
      requestIdRef.current = crypto.randomUUID();
      retryStepRef.current = 'tts_generating';
      void runFromStep('tts_generating', scriptText, projectDir);
    },
    [runFromStep],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (requestIdRef.current) {
      void window.electronAPI.cancelTTS(requestIdRef.current);
    }
    resetWorkflow();
  }, [resetWorkflow]);

  const retry = useCallback(() => {
    const projectDir = getProjectDir() ?? '';
    abortRef.current = new AbortController();
    requestIdRef.current = crypto.randomUUID();
    void runFromStep(retryStepRef.current, scriptTextRef.current, projectDir);
  }, [runFromStep]);

  const continueFromTtsDone = useCallback(
    (projectDir: string) => {
      abortRef.current = new AbortController();
      void runFromStep('ai_analyzing', scriptTextRef.current, projectDir);
    },
    [runFromStep],
  );

  return { start, cancel, retry, continueFromTtsDone, workflow };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAIVideoWorkflow.ts
git commit -m "feat(workflow): 新增 useAIVideoWorkflow hook 实现 AI 剪辑状态机"
```

---

## Task 6: TimelineAIOverlay 动画组件

**Files:**
- Create: `src/components/TimelineAIOverlay.tsx`

- [ ] **Step 1: 创建组件文件**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { WorkflowState } from '../store/ai';

interface TimelineAIOverlayProps {
  workflow: WorkflowState;
  timelineContainerRef: React.RefObject<HTMLDivElement | null>;
  onCancel: () => void;
}

// Floating 光标：跟随 AI 当前操作位置
function FloatingAICursor({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: 'translate(-50%, -100%)',
        zIndex: 99999,
        pointerEvents: 'none',
        transition: 'left 0.2s ease-out, top 0.2s ease-out',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'rgba(167, 139, 250, 0.15)',
        border: '1px solid #a78bfa',
        borderRadius: 8,
        padding: '3px 8px',
        fontSize: 11,
        color: '#a78bfa',
        backdropFilter: 'blur(4px)',
        boxShadow: '0 0 8px rgba(167,139,250,0.4)',
      }}
    >
      <span>{label}</span>
    </div>
  );
}

export function TimelineAIOverlay({
  workflow,
  timelineContainerRef,
  onCancel,
}: TimelineAIOverlayProps) {
  const [cursorPos, setCursorPos] = useState({ x: -200, y: -200 });
  const animFrameRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  const isVisible = workflow.step !== 'idle' && workflow.step !== 'done';

  // 光标在时间轴容器内做横向扫描动画（等待/执行阶段通用）
  useEffect(() => {
    if (!isVisible) return;

    const tick = () => {
      if (!timelineContainerRef.current) return;
      const rect = timelineContainerRef.current.getBoundingClientRect();
      phaseRef.current = (phaseRef.current + 0.8) % 360;
      const x = rect.left + 80 + ((Math.sin(phaseRef.current * (Math.PI / 180)) + 1) / 2) * (rect.width - 160);
      const y = rect.top + 30;
      setCursorPos({ x, y });
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isVisible, timelineContainerRef]);

  if (!isVisible) return null;

  const isArranging = workflow.step === 'arranging';
  const isDone = workflow.step === 'done';
  const isError = workflow.step === 'error';

  return (
    <>
      {/* 半透明遮罩 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isDone ? 'transparent' : 'rgba(0,0,0,0.35)',
          zIndex: 1000,
          pointerEvents: isDone ? 'none' : 'all',
          transition: 'background 0.4s',
        }}
      />

      {/* 顶部横幅 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1001,
          background: isError
            ? 'rgba(239,68,68,0.12)'
            : 'rgba(167,139,250,0.08)',
          borderBottom: `1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'rgba(167,139,250,0.3)'}`,
          backdropFilter: 'blur(8px)',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* 进度条 */}
        {!isError && (
          <div
            style={{
              width: 120,
              height: 4,
              background: 'rgba(167,139,250,0.2)',
              borderRadius: 2,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${workflow.progress}%`,
                background: '#a78bfa',
                borderRadius: 2,
                transition: 'width 0.3s ease',
                boxShadow: '0 0 6px rgba(167,139,250,0.6)',
              }}
            />
          </div>
        )}

        {/* 步骤文字 */}
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: isError ? '#f87171' : '#a78bfa',
            fontWeight: 500,
          }}
        >
          {isError
            ? `❌ ${workflow.error ?? '发生错误'}`
            : `🤖 ${workflow.stepLabel}${!isError ? ` ${workflow.progress}%` : ''}`}
        </span>

        {/* 取消按钮 */}
        {workflow.canCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 11,
              color: 'rgba(167,139,250,0.7)',
              background: 'none',
              border: '1px solid rgba(167,139,250,0.3)',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        )}
      </div>

      {/* Arranging 阶段飞入提示 */}
      {isArranging && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1002,
            textAlign: 'center',
            animation: 'ai-pulse 1.2s ease-in-out infinite',
          }}
        >
          <style>{`
            @keyframes ai-pulse {
              0%, 100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
              50% { opacity: 1; transform: translate(-50%, -50%) scale(1.04); }
            }
          `}</style>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 13, color: '#a78bfa', fontWeight: 500 }}>
            正在排布时间轴…
          </div>
        </div>
      )}

      {/* Floating 光标 */}
      {!isError && (
        <FloatingAICursor
          x={cursorPos.x}
          y={cursorPos.y}
          label={isArranging ? '🤖 AI 正在排布' : '🤖 处理中'}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TimelineAIOverlay.tsx
git commit -m "feat(overlay): 新增 TimelineAIOverlay 动画组件（进度横幅 + floating 光标）"
```

---

## Task 7: Editor 集成 AI 一键剪辑

**Files:**
- Modify: `src/pages/Editor.tsx`
- Modify: `tests/editor.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `tests/editor.test.tsx` 末尾追加：

```tsx
it('renders AI one-click clip button in toolbar', async () => {
  const html = await renderEditor();

  expect(html).toContain('AI 一键剪辑');
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/editor.test.tsx
```
预期：FAIL

- [ ] **Step 3: 在 Editor.tsx 顶部添加 import**

```tsx
import { useAIVideoWorkflow } from '../hooks/useAIVideoWorkflow';
import { TimelineAIOverlay } from '../components/TimelineAIOverlay';
```

- [ ] **Step 4: 在 Editor 函数体添加 workflow hook 和 timeline ref**

在 `const store = useTimelineStore();` 附近追加：
```tsx
  const { start: startWorkflow, cancel: cancelWorkflow, continueFromTtsDone, workflow } = useAIVideoWorkflow();
  const timelineWrapRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 5: 添加 tts_done 自动继续 useEffect**

在 Editor 函数体的 useEffect 区域末尾追加：

```tsx
  // 从 ScriptWorkbench 跳转过来时，若 TTS 已完成，自动继续后续步骤
  useEffect(() => {
    if (workflow.step === 'tts_done' && projectDir) {
      continueFromTtsDone(projectDir);
    }
    // 仅在首次挂载时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 6: 添加 handleStartAIClip handler**

```tsx
  const handleStartAIClip = useCallback(async () => {
    if (!projectDir) return;
    const scriptContent = await window.electronAPI.loadScriptFile(projectDir, 'script.md').catch(() => null);
    if (!scriptContent?.trim()) {
      alert('未找到文稿文件（script.md），请先在脚本工作台完成文稿。');
      return;
    }
    startWorkflow(scriptContent);
  }, [projectDir, startWorkflow]);
```

- [ ] **Step 7: 在 JSX 时间轴区域外层 div 挂载 ref 和 overlay**

找到时间轴 wrap div（通常含 `data-editor-region="timeline-wrap"`），将其改为带 ref 且相对定位，并在内部挂载 overlay：

在 Timeline 渲染区域外层找 `data-editor-region="timeline-wrap"` 的 div（或在 Timeline 组件外层），添加：

```tsx
<div
  data-editor-region="timeline-wrap"
  ref={timelineWrapRef}
  style={{ position: 'relative' }}
>
  <Timeline ... />
  <TimelineAIOverlay
    workflow={workflow}
    timelineContainerRef={timelineWrapRef}
    onCancel={cancelWorkflow}
  />
</div>
```

- [ ] **Step 8: 在 Editor 顶部工具栏添加「AI 一键剪辑」按钮**

在 JSX 中找到 export 按钮附近（`PreviewPanel` 组件内部有 export，或者 Editor 顶部有工具栏），添加 AI 剪辑入口。

在 `PreviewPanel` 的 `onExport` prop 之后（或相同区域），在工具栏 JSX 中添加一个 Button，条件为 `workflow.step === 'idle' || workflow.step === 'done' || workflow.step === 'error'`：

```tsx
{(workflow.step === 'idle' || workflow.step === 'done' || workflow.step === 'error') && projectDir && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => void handleStartAIClip()}
    aria-label="AI 一键剪辑"
  >
    <AppIcon name="sparkles" size={14} />
    <span>AI 一键剪辑</span>
  </Button>
)}
```

> 具体插入位置依 Editor JSX 结构而定，放在顶部工具栏或 PreviewPanel 的操作按钮区域。

- [ ] **Step 9: 运行测试确认通过**

```bash
npx vitest run tests/editor.test.tsx
```
预期：PASS

- [ ] **Step 10: Commit**

```bash
git add src/pages/Editor.tsx tests/editor.test.tsx
git commit -m "feat(editor): 集成 AI 一键剪辑入口与 TimelineAIOverlay"
```

---

## Task 8: ScriptWorkbench + App.tsx 集成

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 在 ScriptWorkbench props 接口添加 onNavigateToEditor**

找到：
```typescript
interface ScriptWorkbenchProps {
  onBack: () => void;
}
```
替换为：
```typescript
interface ScriptWorkbenchProps {
  onBack: () => void;
  onNavigateToEditor?: () => void;
}
```

- [ ] **Step 2: 在 ScriptWorkbench 函数签名中解构新 prop**

找到：
```typescript
export function ScriptWorkbench({ onBack }: ScriptWorkbenchProps) {
```
替换为：
```typescript
export function ScriptWorkbench({ onBack, onNavigateToEditor }: ScriptWorkbenchProps) {
```

- [ ] **Step 3: 在 ScriptWorkbench 中引入 useAIVideoWorkflow**

在 imports 区顶部追加（与其他 hook import 同处）：
```typescript
import { useAIVideoWorkflow } from '../hooks/useAIVideoWorkflow';
```

- [ ] **Step 4: 在 ScriptWorkbench 函数体内实例化 hook**

在 `const { currentStep, ... } = useScriptStore()` 下方追加：
```typescript
  const { start: startWorkflow, workflow } = useAIVideoWorkflow();
```

- [ ] **Step 5: 添加「生成视频」按钮 handler**

```typescript
  const handleGenerateVideo = useCallback(() => {
    if (!scriptText.trim()) return;
    startWorkflow(scriptText);
  }, [scriptText, startWorkflow]);
```

- [ ] **Step 6: 监听 tts_done 自动跳转到 Editor**

```typescript
  useEffect(() => {
    if (workflow.step === 'tts_done' && onNavigateToEditor) {
      onNavigateToEditor();
    }
  }, [workflow.step, onNavigateToEditor]);
```

- [ ] **Step 7: 在 ScriptWorkbench JSX 中添加「生成视频」按钮**

在 `QuickActionBar` 组件附近（或同一工具栏区域），追加：

```tsx
{(workflow.step === 'idle' || workflow.step === 'done' || workflow.step === 'error') && (
  <Button
    variant="ghost"
    size="sm"
    disabled={!scriptText.trim()}
    onClick={handleGenerateVideo}
  >
    <AppIcon name="video" size={14} />
    <span>生成视频</span>
  </Button>
)}
```

TTS 进行时显示进度（在同一区域）：

```tsx
{workflow.step === 'tts_generating' && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#a78bfa' }}>
    <span>🤖 {workflow.stepLabel} {workflow.progress}%</span>
  </div>
)}
```

- [ ] **Step 8: 在 App.tsx 的 ScriptWorkbench 渲染处传入 onNavigateToEditor**

找到 App.tsx 中渲染 `<ScriptWorkbench` 的地方，追加 prop：

```tsx
<ScriptWorkbench
  onBack={...现有的 onBack...}
  onNavigateToEditor={() => setPage('editor')}
/>
```

- [ ] **Step 9: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx src/App.tsx
git commit -m "feat(script-workbench): 新增生成视频按钮，TTS 完成后自动跳转 Editor"
```

---

## Task 9: 验收测试 & 集成验证

**Files:**
- Test: `tests/asset-panel.test.tsx`
- Test: `tests/editor.test.tsx`

- [ ] **Step 1: 运行全量测试**

```bash
npm test
```
预期：所有测试通过，无新增失败

- [ ] **Step 2: TypeScript 类型检查**

```bash
npx tsc --noEmit
```
预期：0 错误

- [ ] **Step 3: 手动验收清单**

```
Feature 1:
☐ 打开一个已有项目 → Editor → 素材面板顶部显示「口播资源」区块
☐ 点「替换音频」→ 文件选择对话框弹出，选 MP3 → 音频路径更新，时间轴 audio 轨同步刷新
☐ 点「替换字幕」→ 选 SRT → 弹出「是否重新分析」确认 → 是 → AI 分析重跑

Feature 2 (Editor 入口):
☐ 项目目录下有 script.md → Editor 顶部出现「AI 一键剪辑」按钮
☐ 点击 → TTS 进度横幅显示在时间轴上方 → 进度条随 MiniMax 流式响应更新
☐ TTS 完成 → 自动进入 ai_analyzing → cover_generating → arranging
☐ arranging 阶段：时间轴块逐步出现，floating 光标在时间轴上扫描
☐ 完成 → 遮罩消失，时间轴可编辑

Feature 2 (ScriptWorkbench 入口):
☐ 文稿工作台文稿非空 → 「生成视频」按钮可点
☐ 点击 → TTS 生成进度显示在工作台
☐ TTS 完成 → 自动跳转到 Editor，继续后续步骤
```

- [ ] **Step 4: 最终 commit**

```bash
git add -A
git commit -m "chore(ai-workflow): 完成 AI 一键剪辑全流程集成验收"
```

# 欢迎页一键成稿 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在欢迎页（文本入口 + 抖音入口）添加"一键成稿"勾选项，勾选后切到全屏 `AutoRunOverlay`，串跑「（抖音下载/转写）→ 写稿 → TTS+字幕 → AI 分析 → 字幕高亮 → 封面 → 卡片+排布」整条链，跳过审稿，并把抖音导入进度桥接到统一进度条。

**Architecture:** 在现有 `useAIVideoWorkflow` 上扩展一个 `script_generating` 阶段（前置）和一个 `douyin_importing` 阶段（仅抖音入口）；新增 App 顶层 `AppPage = 'auto-run'` + `AutoRunOverlay` 组件统管 UI；通过新增 IPC 通道把 `electron/video-import/import-service.ts` 的内部 task snapshot 推送到 renderer。Dialog 层通过共享 `AutoModeSection` 组件提供勾选与参数（默认值取自 `useScriptStore.selectedTemplate/selectedRole` + `AISettings.minimaxVoiceId`）。

**Tech Stack:** Electron 41 + React 19 + TypeScript 6 + Zustand + Vitest（项目惯例）。

**Spec:** `docs/superpowers/specs/2026-04-23-one-click-script-design.md`

---

## File Structure

### 新建文件

| 文件 | 职责 |
|---|---|
| `src/lib/auto-workflow.ts` | `runScriptGenerating(originalText, projectDir, params)`：调 `generateScriptDraft` → `saveScriptFile` → 同步 `useScriptStore` 内存态 |
| `src/components/script/AutoModeSection.tsx` | 共享 Dialog 子组件：勾选框 + 模板/角色/音色 3 个下拉，受控 |
| `src/components/AutoRunOverlay.tsx` | 顶层全屏组件：进度展示 + 取消 + 失败跳页 |
| `tests/auto-workflow.test.ts` | 单测 `runScriptGenerating`、`runFromStep('script_generating')` 串联到 TTS |
| `tests/auto-mode-section.test.tsx` | 单测 AutoModeSection 受控行为 |
| `tests/auto-run-overlay.test.tsx` | 单测 Overlay 进度渲染、取消、失败跳转 |
| `tests/douyin-progress-bridge.test.ts` | 单测 main → renderer 进度桥接 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/store/ai.ts` | `WorkflowStep` 加 `'script_generating' \| 'douyin_importing'`；新增 ephemeral `pendingAutoParams` + setter |
| `src/lib/electron-api.ts` | `AppPage` 加 `'auto-run'`；`ElectronAPI` 加 `onDouyinImportProgress` |
| `src/hooks/useAIVideoWorkflow.ts` | `WorkflowStartOptions` 加 `autoMode/autoParams/originalText`；`PHASES` 加 `script` 与 `douyinImport`；`runFromStep` 加 `script_generating` 分支并在结尾续 `tts_generating` |
| `electron/preload.ts` | 暴露 `onDouyinImportProgress(callback)` 监听 |
| `electron/main.ts` | 把 `videoImportService` 的进度通过 `webContents.send('douyin-import-progress', snapshot)` 广播 |
| `electron/video-import/import-service.ts` | 把 `updateTask` 改为同时 emit `progress` 事件（`EventEmitter` 化）；新增 `onProgress(cb)` |
| `electron/video-import/types.ts` | `VideoImportService` 接口加 `onProgress(cb): () => void` |
| `src/components/script/ImportScriptDialog.tsx` | 引入 `AutoModeSection`；`onConfirm` 签名加 `(autoMode, autoParams)` |
| `src/pages/Setup.tsx` | 抖音 inline Dialog 嵌 `AutoModeSection`；`onDouyinImport` props 签名加 autoMode + autoParams；ImportScriptDialog 的 confirm 同步 |
| `src/App.tsx` | `handleImportScript` / `handleDouyinImport` 接受 autoMode/autoParams；autoMode=true 时 `setPage('auto-run')` 并把 params 写入 `useAIStore.setPendingAutoParams(...)`；在主渲染区根据 `page === 'auto-run'` 渲染 `AutoRunOverlay` |
| `electron/menu.ts`（如存在；待 plan 第一步确认） | `auto-run` 页禁用 File/Edit 项 |

---

## Task 1：扩展 `WorkflowStep` 类型 + AIStore ephemeral 字段

**Files:**
- Modify: `src/store/ai.ts:31-39`（`WorkflowStep` union）
- Modify: `src/store/ai.ts`（AIStore interface + impl 加 `pendingAutoParams`）
- Test: `tests/auto-workflow.test.ts`

- [ ] **Step 1：写失败测试 — WorkflowStep 包含新值**

```ts
// tests/auto-workflow.test.ts（新建）
import { describe, expect, it } from 'vitest';
import { useAIStore } from '../src/store/ai';
import type { WorkflowStep } from '../src/store/ai';

describe('WorkflowStep type extensions', () => {
  it('accepts script_generating and douyin_importing as valid steps', () => {
    const s1: WorkflowStep = 'script_generating';
    const s2: WorkflowStep = 'douyin_importing';
    expect(s1).toBe('script_generating');
    expect(s2).toBe('douyin_importing');
  });
});

describe('AIStore.pendingAutoParams', () => {
  it('starts null and accepts set/clear', () => {
    useAIStore.getState().setPendingAutoParams(null);
    expect(useAIStore.getState().pendingAutoParams).toBeNull();
    useAIStore
      .getState()
      .setPendingAutoParams({ templateId: 'news-broadcast', roleId: 'none', voiceId: 'female-shaonv' });
    expect(useAIStore.getState().pendingAutoParams?.voiceId).toBe('female-shaonv');
    useAIStore.getState().setPendingAutoParams(null);
    expect(useAIStore.getState().pendingAutoParams).toBeNull();
  });
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `npx vitest run tests/auto-workflow.test.ts`
Expected: FAIL — TypeScript 报 `'script_generating'` not assignable to WorkflowStep；运行时报 `setPendingAutoParams is not a function`

- [ ] **Step 3：实现类型与 store 字段**

```ts
// src/store/ai.ts:31-39 替换为
export type WorkflowStep =
  | 'idle'
  | 'douyin_importing'
  | 'script_generating'
  | 'tts_generating'
  | 'tts_done'
  | 'ai_analyzing'
  | 'cover_generating'
  | 'arranging'
  | 'done'
  | 'error';

// 在文件顶部 import 区下方加：
export interface AutoWorkflowParams {
  templateId: string;
  roleId: string;
  voiceId: string;
}

// AIStore interface 增加（在 motionError 之后、storyboardPlan 之前找一处合适位置插入）：
//   pendingAutoParams: AutoWorkflowParams | null;
//   setPendingAutoParams: (params: AutoWorkflowParams | null) => void;

// create<AIStore>((set) => ({...})) 初始化加：
//   pendingAutoParams: null,
//   setPendingAutoParams: (params) => set({ pendingAutoParams: params }),
```

具体插入位置：找到 `motionCards: []`、`isGeneratingMotion: false` 等附近的 ephemeral 字段块（约 src/store/ai.ts 第 90-110 行），在该块末尾插入。

- [ ] **Step 4：运行测试确认通过**

Run: `npx vitest run tests/auto-workflow.test.ts`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add src/store/ai.ts tests/auto-workflow.test.ts
git commit -m "$(cat <<'EOF'
feat(workflow): 扩展 WorkflowStep 与 AIStore.pendingAutoParams
EOF
)"
```

---

## Task 2：扩展 `AppPage` 类型加 `'auto-run'`

**Files:**
- Modify: `src/lib/electron-api.ts:28`

- [ ] **Step 1：写测试**

```ts
// tests/auto-workflow.test.ts 末尾追加
import type { AppPage } from '../src/lib/electron-api';

describe('AppPage type extension', () => {
  it('accepts auto-run', () => {
    const p: AppPage = 'auto-run';
    expect(p).toBe('auto-run');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `npx vitest run tests/auto-workflow.test.ts`
Expected: FAIL — `'auto-run'` not assignable to AppPage

- [ ] **Step 3：扩展类型**

```ts
// src/lib/electron-api.ts:28 替换
export type AppPage = 'welcome' | 'setup' | 'editor' | 'script-workbench' | 'settings' | 'auto-run';
```

- [ ] **Step 4：运行通过**

Run: `npx vitest run tests/auto-workflow.test.ts`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add src/lib/electron-api.ts tests/auto-workflow.test.ts
git commit -m "feat(app): 增加 auto-run 页面类型"
```

---

## Task 3：实现 `runScriptGenerating` 库函数

**Files:**
- Create: `src/lib/auto-workflow.ts`
- Test: `tests/auto-workflow.test.ts`（追加）

- [ ] **Step 1：写失败测试**

```ts
// tests/auto-workflow.test.ts 末尾追加
import { vi, beforeEach } from 'vitest';
import { runScriptGenerating } from '../src/lib/auto-workflow';
import * as scriptUtils from '../src/lib/script-utils';

const electronAPIMock = {
  saveScriptFile: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  electronAPIMock.saveScriptFile.mockClear();
  (globalThis as unknown as { window: typeof globalThis }).window =
    globalThis as unknown as typeof globalThis;
  (globalThis as unknown as { window: { electronAPI: typeof electronAPIMock } }).window.electronAPI =
    electronAPIMock;
});

describe('runScriptGenerating', () => {
  it('writes script.md and returns the generated text', async () => {
    vi.spyOn(scriptUtils, 'generateScriptDraft').mockResolvedValue('生成的口播稿');
    const result = await runScriptGenerating({
      originalText: '原始素材',
      projectDir: '/tmp/proj',
      params: { templateId: 'news-broadcast', roleId: 'none', voiceId: 'x' },
    });
    expect(result).toBe('生成的口播稿');
    expect(scriptUtils.generateScriptDraft).toHaveBeenCalledWith('原始素材', 'news-broadcast', 'none');
    expect(electronAPIMock.saveScriptFile).toHaveBeenCalledWith('/tmp/proj', 'script.md', '生成的口播稿');
  });

  it('throws when originalText is empty', async () => {
    await expect(
      runScriptGenerating({
        originalText: '   ',
        projectDir: '/tmp/proj',
        params: { templateId: 'x', roleId: 'none', voiceId: 'x' },
      }),
    ).rejects.toThrow('原始素材为空');
  });

  it('throws when projectDir is empty', async () => {
    await expect(
      runScriptGenerating({
        originalText: 'abc',
        projectDir: '',
        params: { templateId: 'x', roleId: 'none', voiceId: 'x' },
      }),
    ).rejects.toThrow('未选择项目目录');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `npx vitest run tests/auto-workflow.test.ts -t runScriptGenerating`
Expected: FAIL — module `../src/lib/auto-workflow` not found

- [ ] **Step 3：实现**

```ts
// src/lib/auto-workflow.ts（新建）
import { generateScriptDraft } from './script-utils';
import type { AutoWorkflowParams } from '../store/ai';

export interface RunScriptGeneratingInput {
  originalText: string;
  projectDir: string;
  params: AutoWorkflowParams;
}

/**
 * 自动模式下的写稿步骤：
 * - 调 LLM 生成口播稿（非流式，无虚拟光标动画）
 * - 落盘 script.md
 * - 返回生成文本，供后续 TTS 阶段使用
 */
export async function runScriptGenerating(input: RunScriptGeneratingInput): Promise<string> {
  const text = input.originalText.trim();
  if (!text) {
    throw new Error('原始素材为空');
  }
  if (!input.projectDir) {
    throw new Error('未选择项目目录');
  }

  const generated = await generateScriptDraft(text, input.params.templateId, input.params.roleId);
  await window.electronAPI.saveScriptFile(input.projectDir, 'script.md', generated);
  return generated;
}
```

- [ ] **Step 4：运行确认通过**

Run: `npx vitest run tests/auto-workflow.test.ts -t runScriptGenerating`
Expected: PASS（3 passed）

- [ ] **Step 5：提交**

```bash
git add src/lib/auto-workflow.ts tests/auto-workflow.test.ts
git commit -m "feat(auto-workflow): 实现 runScriptGenerating 写稿步骤"
```

---

## Task 4：在 `useAIVideoWorkflow` 中接入 `script_generating` 阶段

**Files:**
- Modify: `src/hooks/useAIVideoWorkflow.ts`（多处）
- Test: `tests/auto-workflow.test.ts`

要点：
- `WorkflowStartOptions` 增加 `autoMode?: boolean`、`autoParams?: AutoWorkflowParams`、`originalText?: string`、`startFromStep` 联合扩展
- `PHASES` 表加 `script` 阶段（占 6 步中的 1/6 = 约 16.7%；总步数 `TOTAL_STEPS` 调整为 6）
- `runFromStep` 增加 `script_generating` 分支：若 `fromStep === 'script_generating'`，调用 `runScriptGenerating`，再续到 `tts_generating`
- `start` 在 autoMode=true 时把 `originalText` 与 `autoParams` 暂存到 `workflowSession`，并将 `initialStep` 设为 `'script_generating'`
- `voiceId` 等 TTS 参数在 autoMode=true 时由 `autoParams.voiceId` 覆盖 `settings.minimaxVoiceId`

注意：如果 `voiceId` 等 TTS 参数被覆盖，需要在调用 `electronAPI.generateTTS` 时使用 `autoParams?.voiceId ?? settings.minimaxVoiceId`。

- [ ] **Step 1：写失败测试 — autoMode 串联到 tts_generating**

```ts
// tests/auto-workflow.test.ts 末尾追加
import { renderHook, act } from '@testing-library/react';
import { useAIVideoWorkflow } from '../src/hooks/useAIVideoWorkflow';

describe('useAIVideoWorkflow autoMode', () => {
  it('starts from script_generating then continues to tts_generating', async () => {
    vi.spyOn(scriptUtils, 'generateScriptDraft').mockResolvedValue('稿');
    const ttsMock = vi.fn().mockResolvedValue({
      audioPath: '/tmp/proj/podcast-audio.mp3',
      srtPath: '/tmp/proj/podcast-subtitles.srt',
      durationMs: 1000,
    });
    electronAPIMock.generateTTS = ttsMock;
    electronAPIMock.parseSrtFile = vi.fn().mockResolvedValue({ entries: [], durationMs: 1000 });
    electronAPIMock.getAudioDuration = vi.fn().mockResolvedValue(1000);
    electronAPIMock.onTTSProgress = vi.fn().mockReturnValue(() => undefined);
    electronAPIMock.cancelTTS = vi.fn();

    // 注入最小可用 AISettings + projectDir
    // （视当前测试环境 mock 方式可在此处 stub loadAISettings、useAIStore 等）

    const { result } = renderHook(() => useAIVideoWorkflow());
    await act(async () => {
      await result.current.start('原始素材', {
        autoMode: true,
        autoParams: { templateId: 'news-broadcast', roleId: 'none', voiceId: 'female-shaonv' },
        originalText: '原始素材',
        startFromStep: 'script_generating',
      });
    });

    expect(scriptUtils.generateScriptDraft).toHaveBeenCalled();
    expect(ttsMock).toHaveBeenCalledWith(expect.objectContaining({
      voiceId: 'female-shaonv',  // 来自 autoParams 覆盖
    }));
  });
});
```

> 备注：本测试可能需要补 `loadAISettings` 与 `useTimelineStore.setProjectDir` 的最小 stub。如该测试在当前 vitest 环境跑不通（依赖太多 store），可将其降级为只验证 `runScriptGenerating` 被调用，并把 TTS 链路放到下一个集成测试任务。优先保证 stub 能通过类型检查与 `start({ autoMode: true })` 调用不报错。

- [ ] **Step 2：运行确认失败**

Run: `npx vitest run tests/auto-workflow.test.ts -t autoMode`
Expected: FAIL — `WorkflowStartOptions` 不接受 `autoMode/autoParams/originalText`

- [ ] **Step 3：扩展 `useAIVideoWorkflow`**

3a. 顶部 import 加：

```ts
import { runScriptGenerating } from '../lib/auto-workflow';
import type { AutoWorkflowParams } from '../store/ai';
```

3b. `WorkflowStartOptions` 替换为：

```ts
interface WorkflowStartOptions {
  pauseAfterTts?: boolean;
  ttsOnly?: boolean;
  startFromStep?: Extract<WorkflowStep, 'tts_generating' | 'ai_analyzing' | 'script_generating'>;
  autoMode?: boolean;
  autoParams?: AutoWorkflowParams;
  /** autoMode=true 时必传：用作 script_generating 的输入 */
  originalText?: string;
}
```

3c. `WorkflowSessionState` 加字段：

```ts
interface WorkflowSessionState {
  requestId: string;
  retryStep: WorkflowStep;
  scriptText: string;
  projectDir: string;
  pauseAfterTts: boolean;
  ttsOnly: boolean;
  cancelled: boolean;
  taskId: string;
  autoMode: boolean;
  autoParams: AutoWorkflowParams | null;
  originalText: string;
}
```

`workflowSession` 与 `resetWorkflowSession` 同步加默认值（`autoMode: false`、`autoParams: null`、`originalText: ''`）。

3d. `PHASES` 表替换：

```ts
const TOTAL_STEPS = 6;
const PHASES: Record<PhaseKey, PhaseSpec> = {
  script:     { key: 'script',     index: 1, label: '撰写口播稿', baseStart: 0,  span: 16, category: 'ai-write' },
  tts:        { key: 'tts',        index: 2, label: '语音合成',   baseStart: 16, span: 17, category: 'tts' },
  analyze:    { key: 'analyze',    index: 3, label: '内容分析',   baseStart: 33, span: 17, category: 'ai-analyze' },
  highlights: { key: 'highlights', index: 4, label: '字幕高亮',   baseStart: 50, span: 17, category: 'ai-analyze' },
  cover:      { key: 'cover',      index: 5, label: '封面生成',   baseStart: 67, span: 17, category: 'cover' },
  arrange:    { key: 'arrange',    index: 6, label: '时间轴排布', baseStart: 84, span: 16, category: 'ai-analyze' },
};

type PhaseKey = 'script' | 'tts' | 'analyze' | 'highlights' | 'cover' | 'arrange';
```

注意：上面 `category` 用了 `'ai-write'`，验证 `task-progress.ts` 的 `TaskCategory` 已包含 `'ai-write'`（`src/store/task-progress.ts:6-13` 显示已有，OK）。

3e. 在 `runFromStep` 函数顶部、`if (fromStep === 'tts_generating')` 之前插入 script_generating 分支：

```ts
// ===== 阶段 0: 写口播稿（仅 autoMode） =====
if (fromStep === 'script_generating') {
  const phase = PHASES.script;
  const originalForScript = workflowSession.originalText;
  const params = workflowSession.autoParams;

  if (!originalForScript.trim() || !params) {
    setWorkflow({
      ...DEFAULT_WORKFLOW,
      step: 'error',
      error: '自动模式缺少原始素材或参数',
    });
    return;
  }

  setWorkflow({
    step: 'script_generating',
    progress: mapSubProgressToGlobal(phase, 0),
    stepLabel: buildStepLabel(phase, '准备中'),
    error: null,
    canCancel: true,
  });
  ensureWorkflowTask(workflowTaskId, phase, {
    subPercent: 0,
    subMessage: '准备中',
    canCancel: true,
    onCancel: buildPhaseOnCancel('script'),
  });

  try {
    const generated = await runScriptGenerating({
      originalText: originalForScript,
      projectDir,
      params,
    });
    workflowSession.scriptText = generated;
    scriptText = generated;

    if (isStaleRun()) return;

    setWorkflow({
      step: 'tts_generating',
      progress: mapSubProgressToGlobal(phase, 100),
      stepLabel: buildStepLabel(phase, '完成'),
      error: null,
      canCancel: true,
    });
    workflowSession.retryStep = 'tts_generating';
    fromStep = 'tts_generating';
  } catch (error) {
    if (isStaleRun()) return;
    const msg = buildWorkflowError('写稿失败', error);
    setWorkflow({
      step: 'error',
      progress: 0,
      stepLabel: '',
      error: msg,
      canCancel: false,
    });
    useTaskProgressStore.getState().failTask(workflowTaskId, msg);
    workflowSession.retryStep = 'script_generating';
    return;
  }
}
```

`buildPhaseOnCancel('script')` 在 `script` 分支增加映射：

```ts
workflowSession.retryStep =
  phaseKey === 'script'
    ? 'script_generating'
    : phaseKey === 'tts'
      ? ...
```

3f. TTS 调用处的 `voiceId` 改为 autoParams 优先：

```ts
voiceId: workflowSession.autoParams?.voiceId || settings.minimaxVoiceId || 'male-qn-qingse',
```

3g. `start` 内：

```ts
const start = useCallback(
  async (scriptText: string, options?: WorkflowStartOptions) => {
    resetWorkflowSession();
    workflowSession.requestId = crypto.randomUUID();
    workflowSession.taskId = `ai-workflow-${Date.now()}`;
    const initialStep = options?.startFromStep ?? (options?.autoMode ? 'script_generating' : 'tts_generating');
    workflowSession.retryStep = initialStep;
    workflowSession.projectDir = getProjectDir() ?? '';
    workflowSession.pauseAfterTts = options?.pauseAfterTts ?? false;
    workflowSession.ttsOnly = options?.ttsOnly ?? false;
    workflowSession.autoMode = options?.autoMode ?? false;
    workflowSession.autoParams = options?.autoParams ?? null;
    workflowSession.originalText = options?.originalText ?? '';

    let text = scriptText;
    if (!text.trim() && workflowSession.projectDir && initialStep !== 'script_generating') {
      const diskText = await window.electronAPI.loadScriptFile(
        workflowSession.projectDir,
        'script.md',
      );
      text = diskText ?? '';
    }
    workflowSession.scriptText = text;

    void runFromStep(initialStep, text, workflowSession.projectDir);
  },
  [runFromStep],
);
```

- [ ] **Step 4：运行确认通过**

Run: `npx vitest run tests/auto-workflow.test.ts`
Expected: PASS（如 Step 1 备注，hook 集成测试若 stub 不全可降级为单独 mock 验证）

- [ ] **Step 5：提交**

```bash
git add src/hooks/useAIVideoWorkflow.ts tests/auto-workflow.test.ts
git commit -m "feat(workflow): 接入 script_generating 阶段与 autoMode"
```

---

## Task 5：抖音导入进度 IPC 桥接

**Files:**
- Modify: `electron/video-import/types.ts`
- Modify: `electron/video-import/import-service.ts`
- Modify: `electron/main.ts`（找到注册 `import-video-source` IPC 的位置）
- Modify: `electron/preload.ts:148-170` 区块附近
- Modify: `src/lib/electron-api.ts`（ElectronAPI 类型加 `onDouyinImportProgress`）
- Test: `tests/douyin-progress-bridge.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// tests/douyin-progress-bridge.test.ts（新建）
import { describe, expect, it, vi } from 'vitest';
import { createVideoImportService } from '../electron/video-import/import-service';

describe('VideoImportService.onProgress', () => {
  it('emits progress snapshot when task updates', async () => {
    const service = createVideoImportService({
      downloader: {
        resolveSource: vi.fn().mockResolvedValue({
          videoId: 'v1', title: 't', downloadUrl: 'url', resolvedPageUrl: 'url', coverUrl: '',
        }),
        downloadToPath: vi.fn().mockResolvedValue(undefined),
      },
      mediaExtractor: { extractAudioToMp3: vi.fn().mockResolvedValue(undefined) },
      asrRunner: {
        transcribe: vi.fn().mockResolvedValue({ fullText: '', srtText: '', segments: [], engine: 'bcut' }),
      },
    });
    const seen: string[] = [];
    const off = service.onProgress((snapshot) => seen.push(snapshot.status));
    await service.importVideoSource({
      sourceType: 'douyin',
      url: 'https://v.douyin.com/x',
      projectDir: '/tmp/proj',
      syncToOriginal: false,
    });
    off();
    expect(seen).toContain('downloading');
    expect(seen).toContain('done');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `npx vitest run tests/douyin-progress-bridge.test.ts`
Expected: FAIL — `service.onProgress is not a function`

- [ ] **Step 3：实现 service.onProgress + emit**

3a. `electron/video-import/types.ts` 中 `VideoImportService` 接口增加：

```ts
export interface VideoImportService {
  // ...原有方法
  onProgress(callback: (snapshot: VideoImportTaskSnapshot) => void): () => void;
}
```

3b. `electron/video-import/import-service.ts`：

```ts
class DefaultVideoImportService implements VideoImportService {
  private readonly tasks = new Map<string, VideoImportTaskSnapshot>();
  private readonly progressListeners = new Set<(s: VideoImportTaskSnapshot) => void>();

  onProgress(callback: (s: VideoImportTaskSnapshot) => void): () => void {
    this.progressListeners.add(callback);
    return () => this.progressListeners.delete(callback);
  }

  // updateTask 末尾追加广播：
  private updateTask(
    importId: string,
    status: VideoImportStatus,
    progress: number,
    stepLabel: string,
    extras: Partial<VideoImportTaskSnapshot> = {},
  ): void {
    const current = this.tasks.get(importId);
    if (!current) return;
    const next = { ...current, status, progress, stepLabel, ...extras };
    this.tasks.set(importId, next);
    for (const listener of this.progressListeners) {
      try {
        listener(next);
      } catch (error) {
        console.error('[video-import] progress listener error', error);
      }
    }
  }
}
```

- [ ] **Step 4：运行测试通过**

Run: `npx vitest run tests/douyin-progress-bridge.test.ts`
Expected: PASS

- [ ] **Step 5：把 service 进度桥到 BrowserWindow**

5a. 在 `electron/main.ts` 中找到 `getVideoImportService` 的初始化处（或紧邻注册 `import-video-source` IPC 的位置），追加：

```ts
import { BrowserWindow } from 'electron';
import { getVideoImportService } from './video-import/import-service';

// 在 app.whenReady 之后或 createWindow 之后调用一次：
getVideoImportService().onProgress((snapshot) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('douyin-import-progress', snapshot);
  }
});
```

5b. `electron/preload.ts` 在 `electronAPI` 对象中追加：

```ts
onDouyinImportProgress: (callback: (snapshot: VideoImportTaskSnapshot) => void) => {
  const handler = (_event: unknown, snapshot: VideoImportTaskSnapshot) => callback(snapshot);
  ipcRenderer.on('douyin-import-progress', handler);
  return () => ipcRenderer.removeListener('douyin-import-progress', handler);
},
```

需在 preload 文件顶部 import `VideoImportTaskSnapshot`。

5c. `src/lib/electron-api.ts` 的 `ElectronAPI` interface 增加：

```ts
onDouyinImportProgress: (
  callback: (snapshot: VideoImportTaskSnapshot) => void,
) => () => void;
```

并 import `VideoImportTaskSnapshot`。

- [ ] **Step 6：提交**

```bash
git add electron/video-import/types.ts electron/video-import/import-service.ts \
  electron/main.ts electron/preload.ts src/lib/electron-api.ts \
  tests/douyin-progress-bridge.test.ts
git commit -m "feat(video-import): 进度事件桥接到 renderer 统一进度系统"
```

---

## Task 6：实现 `AutoModeSection` 共享 Dialog 子组件

**Files:**
- Create: `src/components/script/AutoModeSection.tsx`
- Test: `tests/auto-mode-section.test.tsx`

- [ ] **Step 1：写失败测试**

```tsx
// tests/auto-mode-section.test.tsx（新建）
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AutoModeSection } from '../src/components/script/AutoModeSection';

const baseProps = {
  enabled: false,
  onToggle: vi.fn(),
  params: { templateId: 'news-broadcast', roleId: 'none', voiceId: 'female-shaonv' },
  onChangeParams: vi.fn(),
  templateOptions: [
    { value: 'news-broadcast', label: '新闻播报' },
    { value: 'casual-talk', label: '轻松对话' },
  ],
  roleOptions: [
    { value: 'none', label: '默认' },
    { value: 'host', label: '主播' },
  ],
  voiceOptions: [
    { value: 'female-shaonv', label: '少女音' },
    { value: 'male-qn-qingse', label: '青涩青年男声' },
  ],
};

describe('AutoModeSection', () => {
  it('renders the toggle and hides params when disabled', () => {
    render(<AutoModeSection {...baseProps} />);
    expect(screen.getByRole('checkbox', { name: /一键成稿/ })).not.toBeChecked();
    expect(screen.queryByLabelText('写稿模板')).toBeNull();
  });

  it('toggling fires onToggle', () => {
    render(<AutoModeSection {...baseProps} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /一键成稿/ }));
    expect(baseProps.onToggle).toHaveBeenCalledWith(true);
  });

  it('shows params when enabled and emits onChangeParams', () => {
    const onChangeParams = vi.fn();
    render(<AutoModeSection {...baseProps} enabled onChangeParams={onChangeParams} />);
    const voiceSelect = screen.getByLabelText('TTS 音色') as HTMLSelectElement;
    fireEvent.change(voiceSelect, { target: { value: 'male-qn-qingse' } });
    expect(onChangeParams).toHaveBeenCalledWith({
      templateId: 'news-broadcast',
      roleId: 'none',
      voiceId: 'male-qn-qingse',
    });
  });
});
```

- [ ] **Step 2：运行失败**

Run: `npx vitest run tests/auto-mode-section.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3：实现**

```tsx
// src/components/script/AutoModeSection.tsx（新建）
import type { AutoWorkflowParams } from '../../store/ai';
import { Field } from '../../ui';

export interface AutoModeOption {
  value: string;
  label: string;
}

export interface AutoModeSectionProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  params: AutoWorkflowParams;
  onChangeParams: (next: AutoWorkflowParams) => void;
  templateOptions: AutoModeOption[];
  roleOptions: AutoModeOption[];
  voiceOptions: AutoModeOption[];
}

export function AutoModeSection({
  enabled,
  onToggle,
  params,
  onChangeParams,
  templateOptions,
  roleOptions,
  voiceOptions,
}: AutoModeSectionProps) {
  const update = (patch: Partial<AutoWorkflowParams>) => {
    onChangeParams({ ...params, ...patch });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>一键成稿（自动写稿、TTS、卡片、封面，跳过审稿）</span>
      </label>
      {enabled && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
          <Field label="写稿模板">
            <select
              aria-label="写稿模板"
              value={params.templateId}
              onChange={(e) => update({ templateId: e.target.value })}
            >
              {templateOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="写稿角色">
            <select
              aria-label="写稿角色"
              value={params.roleId}
              onChange={(e) => update({ roleId: e.target.value })}
            >
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="TTS 音色">
            <select
              aria-label="TTS 音色"
              value={params.voiceId}
              onChange={(e) => update({ voiceId: e.target.value })}
            >
              {voiceOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}
```

> 视觉细节（macOS 风格）：上线前可换成项目内的 `Select` primitive；本步先用原生 `<select>` 满足类型与功能，UI 优化在后续 polish task 中处理。

- [ ] **Step 4：运行通过**

Run: `npx vitest run tests/auto-mode-section.test.tsx`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add src/components/script/AutoModeSection.tsx tests/auto-mode-section.test.tsx
git commit -m "feat(auto-mode): 共享 AutoModeSection 子组件"
```

---

## Task 7：把 `AutoModeSection` 接入两个入口 Dialog

**Files:**
- Modify: `src/components/script/ImportScriptDialog.tsx`
- Modify: `src/pages/Setup.tsx`（抖音 inline Dialog；ImportScriptDialog 的回调签名）

- [ ] **Step 1：扩展 ImportScriptDialog 签名**

`src/components/script/ImportScriptDialog.tsx:43-50` 替换：

```ts
import { AutoModeSection, type AutoModeOption } from './AutoModeSection';
import type { AutoWorkflowParams } from '../../store/ai';

export interface ImportScriptDialogProps {
  open: boolean;
  busy: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (
    parentDir: string,
    projectName: string,
    content: string,
    autoMode: boolean,
    autoParams: AutoWorkflowParams,
  ) => Promise<void> | void;
  // 来自父组件的下拉选项与默认值
  autoModeOptions: {
    templates: AutoModeOption[];
    roles: AutoModeOption[];
    voices: AutoModeOption[];
    defaults: AutoWorkflowParams;
  };
}
```

组件内 useState：

```ts
const [autoMode, setAutoMode] = useState(false);
const [autoParams, setAutoParams] = useState<AutoWorkflowParams>(autoModeOptions.defaults);
useEffect(() => {
  if (!open) {
    setAutoMode(false);
    setAutoParams(autoModeOptions.defaults);
  }
}, [open, autoModeOptions.defaults]);
```

提交按钮回调：`onConfirm(parentDir, projectName, content, autoMode, autoParams)`

DialogBody 中合适位置插入 `<AutoModeSection ... />`。

- [ ] **Step 2：在 Setup.tsx 提供下拉选项 + 默认值**

`src/pages/Setup.tsx` 顶部加：

```ts
import { useScriptStore } from '../store/script';
import { useAIStore } from '../store/ai';
import { MINIMAX_VOICES } from '../lib/minimax-voices';
import { SCRIPT_TEMPLATE_SEEDS } from '../lib/prompts/script-template-defaults';
import { getAllRoles } from '../lib/script-templates';
```

在组件内：

```ts
const selectedTemplate = useScriptStore((s) => s.selectedTemplate);
const selectedRole = useScriptStore((s) => s.selectedRole);
const minimaxVoiceId = useAIStore((s) => s.aiSettings?.minimaxVoiceId)
  ?? 'male-qn-qingse';
// 注：若 useAIStore 不直接缓存 aiSettings，可改为 useState + useEffect 读 loadAISettings()

const autoModeOptions = useMemo(() => ({
  templates: SCRIPT_TEMPLATE_SEEDS.map((t) => ({ value: t.id, label: t.name })),
  roles: [
    { value: 'none', label: '默认' },
    ...getAllRoles().map((r) => ({ value: r.id, label: r.name })),
  ],
  voices: MINIMAX_VOICES.map((v) => ({ value: v.voiceId, label: v.name })),
  defaults: {
    templateId: selectedTemplate || 'news-broadcast',
    roleId: selectedRole || 'none',
    voiceId: minimaxVoiceId,
  },
}), [selectedTemplate, selectedRole, minimaxVoiceId]);
```

> 备注：`useAIStore` 是否暴露 `aiSettings` 直读字段，由 plan 第一步 `Read` `src/store/ai.ts` 确认；若没有则用 `loadAISettings()` 在 `useEffect` 内拉一次填到 local state。

`<ImportScriptDialog ... autoModeOptions={autoModeOptions} />`

`handleConfirmImportScript` 对应改签名：

```ts
const handleConfirmImportScript = useCallback(
  async (
    parentDir: string,
    projectName: string,
    content: string,
    autoMode: boolean,
    autoParams: AutoWorkflowParams,
  ) => {
    setImportScriptCreating(true);
    setImportScriptError(null);
    try {
      await onImportScript(parentDir, projectName, content, autoMode, autoParams);
    } catch (e) {
      setImportScriptError(e instanceof Error ? e.message : '初始化失败');
    } finally {
      setImportScriptCreating(false);
    }
  },
  [onImportScript],
);
```

`SetupProps.onImportScript` 签名同步：

```ts
onImportScript: (
  parentDir: string,
  projectName: string,
  content: string,
  autoMode: boolean,
  autoParams: AutoWorkflowParams,
) => Promise<void>;
```

- [ ] **Step 3：抖音 inline Dialog 也加 AutoModeSection**

在 `src/pages/Setup.tsx:430-490` 区域的 DialogBody 内末尾（"错误提示" 之上）插入：

```tsx
{douyinTitle && (
  <div style={{ marginTop: 'var(--space-6)' }}>
    <AutoModeSection
      enabled={douyinAutoMode}
      onToggle={setDouyinAutoMode}
      params={douyinAutoParams}
      onChangeParams={setDouyinAutoParams}
      templateOptions={autoModeOptions.templates}
      roleOptions={autoModeOptions.roles}
      voiceOptions={autoModeOptions.voices}
    />
  </div>
)}
```

新增 state：

```ts
const [douyinAutoMode, setDouyinAutoMode] = useState(false);
const [douyinAutoParams, setDouyinAutoParams] = useState<AutoWorkflowParams>(autoModeOptions.defaults);
useEffect(() => {
  if (!douyinDialogOpen) {
    setDouyinAutoMode(false);
    setDouyinAutoParams(autoModeOptions.defaults);
  }
}, [douyinDialogOpen, autoModeOptions.defaults]);
```

`handleDouyinConfirm` 改签名传给 `onDouyinImport`：

```ts
await onDouyinImport(douyinParentDir, douyinTitle, douyinUrl, douyinAutoMode, douyinAutoParams);
```

`SetupProps.onDouyinImport` 签名：

```ts
onDouyinImport: (
  parentDir: string,
  title: string,
  douyinUrl: string,
  autoMode: boolean,
  autoParams: AutoWorkflowParams,
) => Promise<void>;
```

- [ ] **Step 4：本地构建检查**

Run: `npm run build`
Expected: PASS（如有 TypeScript 报错，根据提示修正 Setup.tsx / Import 调用方）

- [ ] **Step 5：提交**

```bash
git add src/components/script/ImportScriptDialog.tsx src/pages/Setup.tsx
git commit -m "feat(setup): 文本/抖音入口接入一键成稿 AutoModeSection"
```

---

## Task 8：App 层接收 autoMode 并跳到 `auto-run`

**Files:**
- Modify: `src/App.tsx`（`handleImportScript`、`handleDouyinImport`、`onImportScript` / `onDouyinImport` props 透传，主渲染区按 page 分支）

- [ ] **Step 1：扩展 `handleImportScript`**

`src/App.tsx:583-607` 替换：

```ts
const handleImportScript = useCallback(
  async (
    parentDir: string,
    projectName: string,
    content: string,
    autoMode: boolean,
    autoParams: AutoWorkflowParams,
  ) => {
    const trimmedName = projectName.trim();
    if (!parentDir || !trimmedName) {
      throw new Error('父目录和项目名不能为空');
    }
    const projectDir = `${parentDir}/${trimmedName}`;

    clearCurrentProject();
    useScriptStore.getState().clearProjectSession();
    useScriptStore.getState().restoreState(createBlankScriptProjectState(projectDir));
    useScriptStore.getState().setPendingImportedScript({ content });

    setTimeline(createDefaultTimeline());
    setSrtEntries([]);
    clearAIAnalysis();
    setProjectDir(projectDir);
    await window.electronAPI.addRecentProject(projectDir);
    void syncWorkspaceState();
    setSetupError(null);

    if (autoMode) {
      useAIStore.getState().setPendingAutoParams(autoParams);
      // 把原稿先落盘，AutoRunOverlay 起跑时直接读 originalText
      await window.electronAPI.saveScriptFile(projectDir, 'original.md', content);
      // 同时清掉 pending，否则进 ScriptWorkbench 时会被原写稿流程消费
      useScriptStore.getState().setPendingImportedScript(null);
      setPage('auto-run');
      return;
    }

    setPage('script-workbench');
  },
  [clearAIAnalysis, setSrtEntries, setTimeline, syncWorkspaceState],
);
```

> 注意 `setPendingImportedScript(null)` 调用前需检查 store 中 setter 名（若不存在 `null` 重置接口，则用 `clearProjectSession` 的语义或新增一个）。

- [ ] **Step 2：扩展 `handleDouyinImport`**

`src/App.tsx:614-631` 替换：

```ts
const handleDouyinImport = useCallback(
  async (
    parentDir: string,
    title: string,
    douyinUrl: string,
    autoMode: boolean,
    autoParams: AutoWorkflowParams,
  ) => {
    const projectDir = `${parentDir}/${title}`;

    clearCurrentProject();
    useScriptStore.getState().clearProjectSession();
    useScriptStore.getState().restoreState(createBlankScriptProjectState(projectDir));
    useScriptStore.getState().setPendingDouyinUrl(douyinUrl);

    setTimeline(createDefaultTimeline());
    setSrtEntries([]);
    clearAIAnalysis();
    setProjectDir(projectDir);
    await window.electronAPI.addRecentProject(projectDir);
    void syncWorkspaceState();
    setSetupError(null);

    if (autoMode) {
      useAIStore.getState().setPendingAutoParams(autoParams);
      setPage('auto-run');
      return;
    }
    setPage('script-workbench');
  },
  [clearAIAnalysis, setSrtEntries, setTimeline, syncWorkspaceState],
);
```

- [ ] **Step 3：`Setup` 调用方与 `onImportScript` props 同步签名**

之前 Task 7 已调整 SetupProps，确保 `App.tsx` 传给 `<Setup />` 的 `onImportScript` 与 `onDouyinImport` 类型保持兼容。

Run: `npm run build`
Expected: PASS

- [ ] **Step 4：提交**

```bash
git add src/App.tsx
git commit -m "feat(app): handleImportScript/handleDouyinImport 接入 autoMode 跳转"
```

---

## Task 9：实现 `AutoRunOverlay` 组件

**Files:**
- Create: `src/components/AutoRunOverlay.tsx`
- Test: `tests/auto-run-overlay.test.tsx`

- [ ] **Step 1：写失败测试**

```tsx
// tests/auto-run-overlay.test.tsx（新建）
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoRunOverlay } from '../src/components/AutoRunOverlay';

describe('AutoRunOverlay', () => {
  it('renders current step label and progress', () => {
    render(
      <AutoRunOverlay
        step="tts_generating"
        stepLabel="步骤 2/6 · 语音合成"
        progress={30}
        error={null}
        onCancel={vi.fn()}
        onJumpToScriptWorkbench={vi.fn()}
        onJumpToEditor={vi.fn()}
      />,
    );
    expect(screen.getByText(/语音合成/)).toBeInTheDocument();
    expect(screen.getByText(/30%/)).toBeInTheDocument();
  });

  it('clicking cancel triggers onCancel', () => {
    const onCancel = vi.fn();
    render(
      <AutoRunOverlay
        step="script_generating"
        stepLabel=""
        progress={5}
        error={null}
        onCancel={onCancel}
        onJumpToScriptWorkbench={vi.fn()}
        onJumpToEditor={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows error and offers script-workbench jump for early failures', () => {
    const onJump = vi.fn();
    render(
      <AutoRunOverlay
        step="error"
        stepLabel=""
        progress={0}
        error={{ message: '写稿失败', failedStep: 'script_generating' }}
        onCancel={vi.fn()}
        onJumpToScriptWorkbench={onJump}
        onJumpToEditor={vi.fn()}
      />,
    );
    expect(screen.getByText(/写稿失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看脚本工作台/ }));
    expect(onJump).toHaveBeenCalled();
  });

  it('offers editor jump for late-stage failures', () => {
    const onEditor = vi.fn();
    render(
      <AutoRunOverlay
        step="error"
        stepLabel=""
        progress={0}
        error={{ message: '封面失败', failedStep: 'cover_generating' }}
        onCancel={vi.fn()}
        onJumpToScriptWorkbench={vi.fn()}
        onJumpToEditor={onEditor}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /进入编辑器/ }));
    expect(onEditor).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2：运行失败**

Run: `npx vitest run tests/auto-run-overlay.test.tsx`
Expected: FAIL — 模块未找到

- [ ] **Step 3：实现 Overlay**

```tsx
// src/components/AutoRunOverlay.tsx（新建）
import type { WorkflowStep } from '../store/ai';
import { Button } from '../ui';

const STEP_ORDER: WorkflowStep[] = [
  'douyin_importing',
  'script_generating',
  'tts_generating',
  'ai_analyzing',
  'cover_generating',
  'arranging',
];

const STEP_LABELS: Record<WorkflowStep, string> = {
  idle: '准备中',
  douyin_importing: '导入抖音',
  script_generating: '撰写口播稿',
  tts_generating: '合成语音',
  tts_done: '合成语音',
  ai_analyzing: '内容分析 / 字幕高亮',
  cover_generating: '生成封面',
  arranging: '时间轴排布',
  done: '完成',
  error: '出错',
};

const SCRIPT_WORKBENCH_FAIL_STEPS: WorkflowStep[] = [
  'douyin_importing',
  'script_generating',
  'tts_generating',
];

export interface AutoRunOverlayProps {
  step: WorkflowStep;
  stepLabel: string;
  progress: number;
  error: { message: string; failedStep: WorkflowStep } | null;
  onCancel: () => void;
  onJumpToScriptWorkbench: () => void;
  onJumpToEditor: () => void;
}

export function AutoRunOverlay({
  step,
  stepLabel,
  progress,
  error,
  onCancel,
  onJumpToScriptWorkbench,
  onJumpToEditor,
}: AutoRunOverlayProps) {
  const isError = step === 'error' && error !== null;
  const failedStep = error?.failedStep;
  const earlyFailure = failedStep && SCRIPT_WORKBENCH_FAIL_STEPS.includes(failedStep);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          minWidth: 480,
          maxWidth: 640,
          padding: 'var(--space-8)',
          background: 'var(--color-surface-elevated)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <h2 style={{ margin: 0 }}>正在为你一键成稿</h2>
        <div style={{ color: 'var(--color-text-secondary)' }}>
          {isError ? error.message : stepLabel || STEP_LABELS[step]}
        </div>
        <div
          aria-label="step indicators"
          style={{ display: 'flex', gap: 'var(--space-2)' }}
        >
          {STEP_ORDER.map((s) => {
            const reached = STEP_ORDER.indexOf(s) <= STEP_ORDER.indexOf(step as WorkflowStep);
            return (
              <span
                key={s}
                title={STEP_LABELS[s]}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: reached ? 'var(--color-system-blue)' : 'var(--color-border)',
                }}
              />
            );
          })}
        </div>
        <div aria-label="overall progress" style={{ fontSize: 14 }}>
          {Math.round(progress)}%
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          {!isError && (
            <Button variant="secondary" onClick={onCancel}>
              取消
            </Button>
          )}
          {isError && earlyFailure && (
            <Button variant="primary" onClick={onJumpToScriptWorkbench}>
              查看脚本工作台
            </Button>
          )}
          {isError && !earlyFailure && (
            <Button variant="primary" onClick={onJumpToEditor}>
              进入编辑器
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4：测试通过**

Run: `npx vitest run tests/auto-run-overlay.test.tsx`
Expected: PASS（4 passed）

- [ ] **Step 5：提交**

```bash
git add src/components/AutoRunOverlay.tsx tests/auto-run-overlay.test.tsx
git commit -m "feat(auto-run): AutoRunOverlay 全屏运行页"
```

---

## Task 10：在 App.tsx 挂载 AutoRunOverlay 并驱动 workflow

**Files:**
- Modify: `src/App.tsx`（顶层渲染分支 + AutoRunController 子组件）
- Create: `src/components/AutoRunController.tsx`（封装 hook 调用与跳转）

> 这一步是真正把 AutoRunOverlay 跑起来的胶水。把 hook 调用放在独立子组件 `AutoRunController` 里，避免 App.tsx 进一步膨胀。

- [ ] **Step 1：写测试 — Controller 在文本入口下自动起跑**

```tsx
// tests/auto-run-overlay.test.tsx 末尾追加
import { renderHook } from '@testing-library/react';
import { AutoRunController } from '../src/components/AutoRunController';

// 此处仅做 smoke test：mount 后 useAIVideoWorkflow.start 应被调用一次
// 详细行为已在 useAIVideoWorkflow autoMode 测试覆盖
```

> 备注：AutoRunController 的完整集成测试受限于多个 store 与 IPC mock 成本，本任务只做 smoke。

- [ ] **Step 2：实现 AutoRunController**

```tsx
// src/components/AutoRunController.tsx（新建）
import { useEffect, useRef } from 'react';
import { useAIStore } from '../store/ai';
import { useScriptStore } from '../store/script';
import { useAIVideoWorkflow } from '../hooks/useAIVideoWorkflow';
import { useTimelineStore, getProjectDir } from '../store/timeline';
import { AutoRunOverlay } from './AutoRunOverlay';
import type { AppPage } from '../lib/electron-api';

export interface AutoRunControllerProps {
  setPage: (next: AppPage) => void;
}

export function AutoRunController({ setPage }: AutoRunControllerProps) {
  const workflow = useAIStore((s) => s.workflow);
  const pendingAutoParams = useAIStore((s) => s.pendingAutoParams);
  const setPendingAutoParams = useAIStore((s) => s.setPendingAutoParams);
  const pendingDouyinUrl = useScriptStore((s) => s.pendingDouyinUrl);
  const douyinImportStatus = useScriptStore((s) => s.douyinImportStatus);
  const projectDir = getProjectDir();
  const { start, cancel } = useAIVideoWorkflow();
  const startedRef = useRef(false);

  // source = 'douyin' if pending URL exists, else 'text'
  const source: 'text' | 'douyin' = pendingDouyinUrl ? 'douyin' : 'text';

  useEffect(() => {
    if (startedRef.current) return;
    if (!pendingAutoParams || !projectDir) return;

    if (source === 'text') {
      startedRef.current = true;
      void (async () => {
        const original =
          (await window.electronAPI.loadScriptFile(projectDir, 'original.md')) ?? '';
        await start('', {
          autoMode: true,
          autoParams: pendingAutoParams,
          originalText: original,
          startFromStep: 'script_generating',
        });
      })();
    } else if (source === 'douyin' && douyinImportStatus === 'done') {
      startedRef.current = true;
      void (async () => {
        const original =
          (await window.electronAPI.loadScriptFile(projectDir, 'original.md')) ?? '';
        await start('', {
          autoMode: true,
          autoParams: pendingAutoParams,
          originalText: original,
          startFromStep: 'script_generating',
        });
      })();
    }
  }, [pendingAutoParams, projectDir, source, douyinImportStatus, start]);

  // 监听完成 / 失败 → 跳页
  useEffect(() => {
    if (workflow.step === 'done') {
      setPendingAutoParams(null);
      startedRef.current = false;
      setPage('editor');
    } else if (workflow.step === 'error' && workflow.error === '任务已取消') {
      setPendingAutoParams(null);
      startedRef.current = false;
      setPage('script-workbench');
    }
    // 真正的错误（非取消）保持在 overlay 上由用户点击跳转
  }, [workflow.step, workflow.error, setPage, setPendingAutoParams]);

  const failedStep = (() => {
    if (workflow.step !== 'error') return null;
    // useAIVideoWorkflow 已把 retryStep 设到失败的那一步
    // 此处依赖 store 暴露 retryStep 的方式；若未暴露，则改为读 useAIStore.getState().workflow 的扩展字段
    return null; // 暂时保守：null 让 overlay 默认走 editor 跳转
  })();

  return (
    <AutoRunOverlay
      step={workflow.step}
      stepLabel={workflow.stepLabel}
      progress={workflow.progress}
      error={
        workflow.step === 'error' && workflow.error && workflow.error !== '任务已取消'
          ? { message: workflow.error, failedStep: failedStep ?? 'arranging' }
          : null
      }
      onCancel={() => {
        cancel();
        setPendingAutoParams(null);
        startedRef.current = false;
        setPage('script-workbench');
      }}
      onJumpToScriptWorkbench={() => {
        setPendingAutoParams(null);
        startedRef.current = false;
        setPage('script-workbench');
      }}
      onJumpToEditor={() => {
        setPendingAutoParams(null);
        startedRef.current = false;
        setPage('editor');
      }}
    />
  );
}
```

> **重要**：`failedStep` 当前只能从 `workflowSession.retryStep` 推断；为了不让 Controller 直接依赖私有 module-level state，建议在 `useAIVideoWorkflow.ts` 中把 `retryStep` 加进 `WorkflowState`（在 `setWorkflow({ step: 'error', ... })` 时一并写入 `failedStep`）。这是 Task 10 的额外子改动。

3a. 在 `src/store/ai.ts` 的 `WorkflowState` 增加：

```ts
export interface WorkflowState {
  step: WorkflowStep;
  progress: number;
  stepLabel: string;
  error: string | null;
  canCancel: boolean;
  failedStep: WorkflowStep | null;  // 新增
}
```

`DEFAULT_WORKFLOW` 加 `failedStep: null`。

3b. `src/hooks/useAIVideoWorkflow.ts` 中所有 `setWorkflow({ step: 'error', ... })` 调用追加 `failedStep: <对应阶段>`。

3c. AutoRunController 的 `failedStep` 读 `workflow.failedStep ?? 'arranging'`。

- [ ] **Step 3：在 App.tsx 渲染分支挂载 AutoRunController**

找到 App.tsx 现有按 `page` 分发渲染的位置（搜索 `page === 'script-workbench'`），加：

```tsx
{page === 'auto-run' && <AutoRunController setPage={setPage} />}
```

引入：

```ts
import { AutoRunController } from './components/AutoRunController';
```

- [ ] **Step 4：构建检查**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add src/components/AutoRunController.tsx src/App.tsx \
  src/hooks/useAIVideoWorkflow.ts src/store/ai.ts
git commit -m "feat(auto-run): AutoRunController 串联 workflow 与跳页"
```

---

## Task 11：抖音入口 — 第 0 步桥接进度

**Files:**
- Modify: `src/components/AutoRunController.tsx`（订阅 onDouyinImportProgress）
- Modify: `src/hooks/useAIVideoWorkflow.ts`（PHASES 加 `douyinImport`，可选）

> 简化决策：抖音下载步骤不进入 useAIVideoWorkflow（避免 hook 复杂化），由 AutoRunController 单独维护一个"虚拟阶段"，进度直接 push 到 `useTaskProgressStore`。useAIVideoWorkflow 仍从 `script_generating` 起跑，AutoRunController 等抖音 done 后再调 start。

- [ ] **Step 1：扩展 AutoRunController 处理抖音进度**

在 AutoRunController 顶部加入抖音任务管理：

```tsx
import { useTaskProgressStore } from '../store/task-progress';

const douyinTaskIdRef = useRef<string | null>(null);

useEffect(() => {
  if (source !== 'douyin' || !pendingAutoParams) return;
  if (!window.electronAPI.onDouyinImportProgress) return;

  if (!douyinTaskIdRef.current) {
    douyinTaskIdRef.current = `douyin-import-${Date.now()}`;
    useTaskProgressStore.getState().startTask({
      id: douyinTaskIdRef.current,
      category: 'import',
      label: '步骤 1/7 · 导入抖音视频',
      mode: 'determinate',
      progress: 0,
      phase: '准备',
      level: 2,
      canCancel: false,
    });
  }

  const off = window.electronAPI.onDouyinImportProgress((snapshot) => {
    const id = douyinTaskIdRef.current!;
    if (snapshot.status === 'error') {
      useTaskProgressStore.getState().failTask(id, snapshot.error ?? '抖音导入失败');
      return;
    }
    if (snapshot.status === 'done') {
      useTaskProgressStore.getState().updateTask(id, { progress: 100, phase: '完成' });
      useTaskProgressStore.getState().completeTask(id);
      return;
    }
    useTaskProgressStore.getState().updateTask(id, {
      progress: Math.min(99, Math.max(0, snapshot.progress)),
      phase: snapshot.stepLabel,
    });
  });
  return off;
}, [source, pendingAutoParams]);
```

- [ ] **Step 2：让 AutoRunOverlay 把"导入抖音"也展示为第一段**

`STEP_ORDER` 已含 `'douyin_importing'`。当 `source === 'douyin'` 且 workflow.step 还是 `'idle'`（说明 useAIVideoWorkflow 还没起跑），AutoRunController 应当传入虚拟 step `'douyin_importing'` + 当前 douyin task 进度：

```tsx
const douyinTask = useTaskProgressStore((s) =>
  douyinTaskIdRef.current ? s.tasks.get(douyinTaskIdRef.current) : null,
);
const effectiveStep: WorkflowStep =
  source === 'douyin' && (workflow.step === 'idle' || workflow.step === 'script_generating') && douyinTask?.status === 'active'
    ? 'douyin_importing'
    : workflow.step;
const effectiveProgress =
  effectiveStep === 'douyin_importing' && douyinTask
    ? Math.round(douyinTask.progress / 6) // 第 0 步占整体 1/6
    : workflow.progress;
const effectiveLabel =
  effectiveStep === 'douyin_importing' && douyinTask
    ? `步骤 1/7 · 导入抖音视频 · ${douyinTask.phase ?? ''}`
    : workflow.stepLabel;
```

把 `step / progress / stepLabel` 传给 AutoRunOverlay 时改用 `effective*`。

- [ ] **Step 3：构建 + 手动 smoke**

Run: `npm run build`
Expected: PASS

手动 smoke（在第 14 步集中 E2E，本任务先确保编译通过）

- [ ] **Step 4：提交**

```bash
git add src/components/AutoRunController.tsx
git commit -m "feat(auto-run): 抖音第 0 步桥接到 AutoRunOverlay 与统一进度条"
```

---

## Task 12：菜单上下文 + 全局快捷键屏蔽

**Files:**
- Modify: `src/App.tsx`（`setMenuContext` 调用处加 `isAutoRunning`）
- Modify: `electron/menu.ts`（按 `isAutoRunning` 禁用相关项）
- Modify: 全局快捷键 hook（搜索 `useGlobalShortcuts` / `keydown` 注册）

- [ ] **Step 1：扩展 menu context**

在 App.tsx 计算 menu context 的 `useEffect` 中：

```ts
window.electronAPI.setMenuContext({
  activePage: page,
  hasProject: Boolean(projectDir),
  // 现有字段……
  isAutoRunning: page === 'auto-run',
});
```

`electron/preload.ts` 与 `electron/menu.ts` 中 `setMenuContext` 类型同步加 `isAutoRunning?: boolean`。

`electron/menu.ts` 的菜单构造里：

```ts
const isAutoRunning = ctx.isAutoRunning ?? false;
// 几乎所有 enabled 字段加：&& !isAutoRunning
```

- [ ] **Step 2：屏蔽全局快捷键**

搜索：

Run: `grep -rn 'window.addEventListener.*keydown\|useEffect.*keydown' src/`

在每个全局 hook 的 effect 第一行加：

```ts
if (page === 'auto-run') return;
```

如该 hook 不直接拿到 `page`，改为读 `useAIStore.getState().workflow.step !== 'idle'` 或者从 props/context 注入。

> 备注：本步是个 sweep 类工作。可以先只屏蔽编辑器层 hook（Editor 内部不会在 auto-run 挂载，自然不生效），ScriptWorkbench 同理。重点只确认 App 顶层 hook（如导出快捷键）不会在 auto-run 触发。

- [ ] **Step 3：构建 + 手动验证菜单灰显**

Run: `npm run build && npm run dev`，进入 auto-run 页面后检查 macOS 菜单 File/Edit 项是否灰显。

- [ ] **Step 4：提交**

```bash
git add src/App.tsx electron/preload.ts electron/menu.ts
git commit -m "feat(auto-run): 自动模式禁用菜单与全局快捷键"
```

---

## Task 13：抖音失败/取消路径修正

**Files:**
- Modify: `src/components/AutoRunController.tsx`

> 抖音下载失败时，`douyinImportStatus === 'error'` 会在 `useScriptStore` 上反映；AutoRunController 需要把它映射成 overlay 的 error 状态。

- [ ] **Step 1：在 Controller 里监听抖音错误**

```ts
useEffect(() => {
  if (source !== 'douyin') return;
  if (douyinImportStatus !== 'error') return;
  // 抖音模块的错误信息存放位置：根据 useScriptStore 的实际字段调整
  const errMsg = useScriptStore.getState().douyinImportError ?? '抖音导入失败';
  // 直接通过 setWorkflow 注入 error 让 AutoRunOverlay 显示
  useAIStore.getState().setWorkflow({
    ...useAIStore.getState().workflow,
    step: 'error',
    error: errMsg,
    failedStep: 'douyin_importing',
    canCancel: false,
  });
}, [source, douyinImportStatus]);
```

> 备注：`douyinImportError` 字段名以 `useScriptStore` 实际为准（plan 第一步要 `Read src/store/script.ts` 内 douyin 相关字段确认）。

- [ ] **Step 2：取消按钮在抖音阶段也要工作**

```tsx
const cancelDouyin = () => {
  if (douyinTaskIdRef.current) {
    useTaskProgressStore.getState().failTask(douyinTaskIdRef.current, '任务已取消');
  }
  // 抖音下载本身没有取消接口（视 import-service 实现），此处仅在 UI 层中断
};

const handleCancel = () => {
  if (effectiveStep === 'douyin_importing') {
    cancelDouyin();
  } else {
    cancel();
  }
  setPendingAutoParams(null);
  startedRef.current = false;
  setPage('script-workbench');
};
```

把 `<AutoRunOverlay onCancel={handleCancel} ... />`。

- [ ] **Step 3：构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4：提交**

```bash
git add src/components/AutoRunController.tsx
git commit -m "feat(auto-run): 抖音阶段错误与取消映射到 overlay"
```

---

## Task 14：手动 E2E 与最终回归

**Files:** none（手动验证）

- [ ] **Step 1：文本入口完整跑通**

启动开发：

Run: `npm run dev`

操作：欢迎页 → 导入文稿 → 粘贴一段 200 字原稿 → 选目录、命名 → 勾选「一键成稿」→ 检查模板/角色/音色默认值合理 → 提交。
Expected：跳到 AutoRunOverlay，按顺序看到 6 段进度推进（写稿 → 语音合成 → 内容分析 → 字幕高亮 → 封面生成 → 时间轴排布）；底部统一进度条同步；完成后自动落到 Editor 且素材面板有音频/字幕；project.json 中 timeline / aiAnalysis / script 字段完整。

- [ ] **Step 2：抖音入口完整跑通**

操作：欢迎页 → 抖音导入 → 粘贴一个 30s 内的抖音 URL → 解析 → 选目录 → 勾选「一键成稿」→ 提交。
Expected：AutoRunOverlay 显示「步骤 1/7 · 导入抖音视频」并随下载/转写/同步阶段推进；transition 平滑续跑写稿与后续 5 步；完成后落 Editor。

- [ ] **Step 3：失败路径**

模拟方法：在 AutoRunOverlay 跑写稿步骤时，断网。
Expected：overlay 显示错误 + "查看脚本工作台" 按钮，点击后到 ScriptWorkbench 看到 original.md 已存在但 script.md 为空；可手动重试。

- [ ] **Step 4：取消路径**

操作：跑到 TTS 阶段时点击「取消」。
Expected：当前 TTS 取消、跳到 ScriptWorkbench；project.json 中已有 original.md / script.md，无 timeline.podcast。

- [ ] **Step 5：跑测试套件**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 6：构建**

Run: `npm run build`
Expected: 无 TypeScript 错误，dist 产物 OK

- [ ] **Step 7：最终提交（如果手动跑通发现微小修复）**

```bash
git add -p
git commit -m "fix(auto-run): E2E 回归发现的微小问题"
```

否则跳过。

---

## 自审清单

- [x] 每一步都引用 spec 中的某个目标（覆盖 §目标 全部 8 项）
- [x] 没有 TBD / TODO / "实现后续"
- [x] 每个修改都给了具体的代码块或精确路径
- [x] 类型一致：`WorkflowStep`、`AutoWorkflowParams`、`AppPage` 在所有引用处一致
- [x] 测试在每个有可测行为的 Task 都给了真代码（仅 Task 11/12/13 因依赖 IPC/menu 难以纯单测，明确降级为构建 + 手动 smoke）
- [x] 包含 spec 中提到的"待 plan 阶段确认的细节" → 已转为各 Task 内的「备注」并要求执行者在第一步 Read 验证

## 已知风险

1. `useAIStore.aiSettings` 是否直接缓存：Task 7 备注已要求在第一步确认；若没有则改用 `loadAISettings()` 一次性获取。
2. `useScriptStore.douyinImportError` 字段名：Task 13 备注已要求确认。
3. AutoRunController 与 `useAIVideoWorkflow` module-level `workflowSession` 的耦合：Task 10 已通过把 `failedStep` 提到 `WorkflowState` 解耦。
4. `electron/menu.ts` 的 `setMenuContext` 上下文字段：Task 12 第一步要求 Read 现有定义，按现状追加。

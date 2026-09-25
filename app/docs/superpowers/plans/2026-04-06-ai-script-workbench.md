# AI 写稿工作台（第一期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在欢迎页新增"AI 写稿创作"入口，提供五步流程将报告文件转化为口播稿 Markdown 文件，并提供全局设置页面管理 AI 配置、口播模板和审查规范。

**Architecture:** 新增独立的 `ScriptWorkbench` 页面、`Settings` 页面和 `script` Zustand store，与现有 Setup/Editor 完全解耦。复用现有的 LLM 客户端、Markdown 编辑器和 Electron IPC 模式。Welcome 页面通过重构 Setup 页面实现双入口卡片布局。口播模板和审查规范支持用户自定义，全局 localStorage 存储。

**Tech Stack:** React 19, TypeScript, Zustand, @uiw/react-md-editor, Electron IPC, OpenAI-compatible LLM API

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/store/script.ts` | Zustand store：写稿状态管理（步骤、内容、批注） |
| `src/lib/script-templates.ts` | 口播稿提示词模板库（纯数据，3 个预设模板） |
| `src/lib/script-review.ts` | AI 审查：构建审查 prompt、解析批注 JSON、应用批注修改 |
| `src/lib/script-persistence.ts` | 文件读写封装：original.md / script.md / script-state.json |
| `src/pages/ScriptWorkbench.tsx` | 写稿工作台主页面（步骤条 + 左右分栏容器） |
| `src/pages/ScriptWorkbench.module.css` | 写稿工作台样式 |
| `src/components/script/StepInitialize.tsx` | 步骤①：文件上传 + 目录选择面板 |
| `src/components/script/StepReviewOriginal.tsx` | 步骤②：原稿统计 + 操作面板 |
| `src/components/script/StepGenerate.tsx` | 步骤③：模板选择 + 生成控制面板 |
| `src/components/script/StepAIReview.tsx` | 步骤④：批注列表面板 |
| `src/components/script/StepConfirm.tsx` | 步骤⑤：保存确认面板 |
| `src/components/script/AnnotationHighlight.tsx` | Markdown 内容批注高亮处理 |
| `src/components/script/StepIndicator.tsx` | 步骤条 UI 组件 |
| `src/pages/Settings.tsx` | 全局设置页面（Tab 导航 + 内容区） |
| `src/pages/Settings.module.css` | 设置页面样式 |
| `src/components/settings/AIConfigTab.tsx` | AI 基础配置 Tab |
| `src/components/settings/TemplateManagerTab.tsx` | 口播模板管理 Tab |
| `src/components/settings/ReviewCriteriaTab.tsx` | 审查规范配置 Tab |
| `src/components/settings/TTSConfigTab.tsx` | TTS 配置 Tab（第二期预留 UI） |
| `src/lib/settings-storage.ts` | 全局设置 localStorage 读写封装 |

### Modified Files

| File | Change |
|------|--------|
| `src/App.tsx` | Page 类型扩展，新增 `'welcome'`、`'script-workbench'`、`'settings'` 路由 |
| `src/pages/Setup.tsx` | 重构为 Welcome 双入口布局 |
| `src/pages/Setup.module.css` | 新增 Welcome 页面样式 |
| `src/components/Toolbar.tsx` | page prop 类型扩展支持新页面 |
| `src/lib/electron-api.ts` | 新增 IPC 类型定义 |
| `electron/preload.ts` | 暴露新 IPC 方法 |
| `electron/main.ts` | 新增 IPC handlers |

---

## Task 1: Script Store & Types

**Files:**
- Create: `src/store/script.ts`

- [ ] **Step 1: Create the script store**

```typescript
// src/store/script.ts
import { create } from 'zustand';

export type ScriptStep = 1 | 2 | 3 | 4 | 5;

export type AnnotationSeverity = 'error' | 'warning' | 'info';
export type AnnotationStatus = 'pending' | 'accepted' | 'dismissed';

export interface Annotation {
  id: string;
  startOffset: number;
  endOffset: number;
  originalText: string;
  issue: string;
  suggestion: string;
  severity: AnnotationSeverity;
  status: AnnotationStatus;
}

interface ScriptState {
  projectDir: string | null;
  currentStep: ScriptStep;
  originalText: string;
  scriptText: string;
  selectedTemplate: string;
  annotations: Annotation[];
  generating: boolean;
  reviewing: boolean;
}

interface ScriptActions {
  setProjectDir: (dir: string | null) => void;
  setCurrentStep: (step: ScriptStep) => void;
  setOriginalText: (text: string) => void;
  setScriptText: (text: string) => void;
  setSelectedTemplate: (id: string) => void;
  setAnnotations: (annotations: Annotation[]) => void;
  setGenerating: (generating: boolean) => void;
  setReviewing: (reviewing: boolean) => void;
  acceptAnnotation: (id: string) => void;
  dismissAnnotation: (id: string) => void;
  acceptAllAnnotations: () => void;
  reset: () => void;
}

const initialState: ScriptState = {
  projectDir: null,
  currentStep: 1,
  originalText: '',
  scriptText: '',
  selectedTemplate: 'news-broadcast',
  annotations: [],
  generating: false,
  reviewing: false,
};

export const useScriptStore = create<ScriptState & ScriptActions>((set, get) => ({
  ...initialState,

  setProjectDir: (dir) => set({ projectDir: dir }),
  setCurrentStep: (step) => set({ currentStep: step }),
  setOriginalText: (text) => set({ originalText: text }),
  setScriptText: (text) => set({ scriptText: text }),
  setSelectedTemplate: (id) => set({ selectedTemplate: id }),
  setAnnotations: (annotations) => set({ annotations }),
  setGenerating: (generating) => set({ generating }),
  setReviewing: (reviewing) => set({ reviewing }),

  acceptAnnotation: (id) => {
    const { annotations, scriptText } = get();
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation || annotation.status !== 'pending') return;

    const updatedText = scriptText.replace(annotation.originalText, annotation.suggestion);
    set({
      scriptText: updatedText,
      annotations: annotations.map((a) =>
        a.id === id ? { ...a, status: 'accepted' as const } : a,
      ),
    });
  },

  dismissAnnotation: (id) => {
    set({
      annotations: get().annotations.map((a) =>
        a.id === id ? { ...a, status: 'dismissed' as const } : a,
      ),
    });
  },

  acceptAllAnnotations: () => {
    const { annotations, scriptText } = get();
    const pending = annotations.filter((a) => a.status === 'pending');
    // 按 startOffset 降序排列，避免替换时偏移错位
    const sorted = [...pending].sort((a, b) => b.startOffset - a.startOffset);

    let updatedText = scriptText;
    for (const annotation of sorted) {
      updatedText = updatedText.replace(annotation.originalText, annotation.suggestion);
    }

    set({
      scriptText: updatedText,
      annotations: annotations.map((a) =>
        a.status === 'pending' ? { ...a, status: 'accepted' as const } : a,
      ),
    });
  },

  reset: () => set(initialState),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/store/script.ts
git commit -m "feat(script): 新增写稿工作台 Zustand store"
```

---

## Task 2: Script Templates

**Files:**
- Create: `src/lib/script-templates.ts`

- [ ] **Step 1: Create the template library**

```typescript
// src/lib/script-templates.ts
export interface ScriptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'news-broadcast',
    name: '新闻播报',
    description: '严谨客观，数据驱动，适合行业资讯',
    systemPrompt: `你是一位专业的新闻口播稿撰写专家。请将用户提供的报告/文章改写为适合口播的新闻稿。

要求：
1. 保持严谨客观的语气，不添加主观评价
2. 数据和事实必须保留原文引用，不得编造
3. 使用短句，每句不超过 30 字，便于播读
4. 段落之间用自然过渡语连接（"接下来""值得注意的是""此外"等）
5. 开头用一句话概括核心要点，吸引听众
6. 结尾做简洁总结，不超过两句话
7. 总字数控制在原文的 60%~80%
8. 避免书面化表达，使用口语化的专业表述
9. 输出纯文本 Markdown 格式`,
  },
  {
    id: 'tech-review',
    name: '科技评测',
    description: '轻松专业，适合产品和技术解读',
    systemPrompt: `你是一位科技自媒体口播稿写手。请将用户提供的报告/文章改写为科技评测风格的口播稿。

要求：
1. 语气轻松但专业，像朋友之间聊天一样讲解技术
2. 适当使用类比和举例，让复杂概念易懂
3. 每段聚焦一个核心观点
4. 可以使用 "说白了""简单来说""你可以理解为" 等口语化表达
5. 保留关键数据，但用更直观的方式呈现（如"快了 3 倍"而不是"提升 200%"）
6. 开头设置悬念或提问，引发好奇心
7. 结尾给出个人看法或使用建议
8. 总字数控制在原文的 70%~90%
9. 输出纯文本 Markdown 格式`,
  },
  {
    id: 'knowledge-popular',
    name: '知识科普',
    description: '通俗易懂，生动形象，适合大众传播',
    systemPrompt: `你是一位知识科普视频的口播稿撰写专家。请将用户提供的报告/文章改写为科普风格的口播稿。

要求：
1. 使用通俗易懂的语言，避免专业术语，必须使用时要附带解释
2. 多用生活中的类比和比喻，让抽象概念具象化
3. 适当使用提问句引导思考（"你有没有想过…""为什么会这样呢？"）
4. 每段只讲一个知识点，节奏明快
5. 数据用直观对比呈现（"相当于 XX""差不多有 XX 那么大"）
6. 开头用一个有趣的事实或问题吸引注意
7. 结尾总结要点，鼓励互动
8. 总字数控制在原文的 50%~70%
9. 输出纯文本 Markdown 格式`,
  },
];

export function getTemplateById(id: string): ScriptTemplate | undefined {
  return SCRIPT_TEMPLATES.find((t) => t.id === id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/script-templates.ts
git commit -m "feat(script): 新增口播稿提示词模板库"
```

---

## Task 3: AI Review Logic

**Files:**
- Create: `src/lib/script-review.ts`

- [ ] **Step 1: Create the review module**

```typescript
// src/lib/script-review.ts
import type { AISettings } from '../types/ai';
import { callLLM, parseLLMJsonResponse } from './llm-client';
import type { Annotation, AnnotationSeverity } from '../store/script';

const REVIEW_SYSTEM_PROMPT = `你是一位专业的口播稿审查编辑。请审查用户提供的口播稿，从以下维度给出批注：

1. **事实准确性**（severity: error）：数据是否有来源、表述是否可能有误
2. **表达流畅性**（severity: warning）：是否有书面化表达、长句、不适合口播的措辞
3. **逻辑连贯性**（severity: warning）：段落过渡是否自然、论述是否有跳跃
4. **口语化程度**（severity: info）：可以更口语化的表达建议

请以 JSON 格式返回审查结果：
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

规则：
- 每条批注的 originalText 必须是稿件中能精确匹配的子串
- 批注数量控制在 3~8 条，聚焦最重要的问题
- suggestion 必须是可以直接替换 originalText 的完整文本
- 不要对标题格式（# ## 等）做批注`;

interface RawAnnotation {
  originalText?: string;
  issue?: string;
  suggestion?: string;
  severity?: string;
}

function isValidSeverity(value: unknown): value is AnnotationSeverity {
  return value === 'error' || value === 'warning' || value === 'info';
}

export function parseAnnotations(
  jsonContent: string,
  scriptText: string,
): Annotation[] {
  const parsed = parseLLMJsonResponse(jsonContent);
  if (!parsed || !Array.isArray(parsed.annotations)) {
    return [];
  }

  const annotations: Annotation[] = [];
  let counter = 0;

  for (const raw of parsed.annotations as RawAnnotation[]) {
    if (!raw.originalText || !raw.issue || !raw.suggestion) continue;
    if (!isValidSeverity(raw.severity)) continue;

    const startOffset = scriptText.indexOf(raw.originalText);
    if (startOffset === -1) continue;

    counter += 1;
    annotations.push({
      id: `ann-${counter}`,
      startOffset,
      endOffset: startOffset + raw.originalText.length,
      originalText: raw.originalText,
      issue: raw.issue,
      suggestion: raw.suggestion,
      severity: raw.severity,
      status: 'pending',
    });
  }

  return annotations;
}

export async function reviewScript(
  settings: AISettings,
  scriptText: string,
): Promise<Annotation[]> {
  const response = await callLLM(settings, REVIEW_SYSTEM_PROMPT, scriptText);
  return parseAnnotations(response, scriptText);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/script-review.ts
git commit -m "feat(script): AI 口播稿审查 prompt 与批注解析"
```

---

## Task 4: Electron IPC — 文件持久化

**Files:**
- Create: `src/lib/script-persistence.ts`
- Modify: `src/lib/electron-api.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Add IPC types to electron-api.ts**

在 `src/lib/electron-api.ts` 的 `ElectronAPI` interface 中，`selectOutputPath` 之前添加：

```typescript
  // Script workbench
  saveScriptFile: (projectDir: string, filename: string, content: string) => Promise<void>;
  loadScriptFile: (projectDir: string, filename: string) => Promise<string | null>;
  saveScriptState: (projectDir: string, state: string) => Promise<void>;
  loadScriptState: (projectDir: string) => Promise<string | null>;
  selectTextFile: () => Promise<{ path: string; content: string } | null>;
```

- [ ] **Step 2: Add IPC handlers to electron/main.ts**

在 `electron/main.ts` 文件末尾、`app.whenReady()` 之前添加：

```typescript
ipcMain.handle(
  'save-script-file',
  async (_event, projectDir: string, filename: string, content: string) => {
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, filename), content, 'utf-8');
  },
);

ipcMain.handle(
  'load-script-file',
  async (_event, projectDir: string, filename: string) => {
    const filePath = path.join(projectDir, filename);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  },
);

ipcMain.handle('save-script-state', async (_event, projectDir: string, state: string) => {
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'script-state.json'), state, 'utf-8');
});

ipcMain.handle('load-script-state', async (_event, projectDir: string) => {
  const filePath = path.join(projectDir, 'script-state.json');
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
});

ipcMain.handle('select-text-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择报告文件',
    filters: [{ name: '文本文件', extensions: ['txt', 'md'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  return { path: filePath, content };
});
```

- [ ] **Step 3: Expose IPC methods in electron/preload.ts**

在 `preload.ts` 的 `contextBridge.exposeInMainWorld` 对象中，`selectOutputPath` 之前添加：

```typescript
  saveScriptFile: (projectDir: string, filename: string, content: string) =>
    ipcRenderer.invoke('save-script-file', projectDir, filename, content),
  loadScriptFile: (projectDir: string, filename: string) =>
    ipcRenderer.invoke('load-script-file', projectDir, filename),
  saveScriptState: (projectDir: string, state: string) =>
    ipcRenderer.invoke('save-script-state', projectDir, state),
  loadScriptState: (projectDir: string) =>
    ipcRenderer.invoke('load-script-state', projectDir),
  selectTextFile: () =>
    ipcRenderer.invoke('select-text-file') as Promise<{ path: string; content: string } | null>,
```

- [ ] **Step 4: Create script-persistence.ts helper**

```typescript
// src/lib/script-persistence.ts
import type { Annotation, ScriptStep } from '../store/script';

export interface PersistedScriptState {
  version: 1;
  currentStep: ScriptStep;
  templateId: string;
  annotations: Annotation[];
  createdAt: string;
  updatedAt: string;
}

export function createPersistedScriptState(
  currentStep: ScriptStep,
  templateId: string,
  annotations: Annotation[],
  createdAt?: string,
): PersistedScriptState {
  return {
    version: 1,
    currentStep,
    templateId,
    annotations,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function parsePersistedScriptState(raw: unknown): PersistedScriptState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;
  if (typeof obj.currentStep !== 'number') return null;

  return {
    version: 1,
    currentStep: obj.currentStep as ScriptStep,
    templateId: (obj.templateId as string) ?? 'news-broadcast',
    annotations: Array.isArray(obj.annotations) ? (obj.annotations as Annotation[]) : [],
    createdAt: (obj.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (obj.updatedAt as string) ?? new Date().toISOString(),
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedSaveFile(
  projectDir: string,
  filename: string,
  content: string,
  delayMs = 1000,
): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void window.electronAPI.saveScriptFile(projectDir, filename, content);
  }, delayMs);
}

export async function saveScriptState(
  projectDir: string,
  state: PersistedScriptState,
): Promise<void> {
  await window.electronAPI.saveScriptState(projectDir, JSON.stringify(state, null, 2));
}

export async function loadScriptState(
  projectDir: string,
): Promise<PersistedScriptState | null> {
  const raw = await window.electronAPI.loadScriptState(projectDir);
  if (!raw) return null;

  try {
    return parsePersistedScriptState(JSON.parse(raw));
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/script-persistence.ts src/lib/electron-api.ts electron/preload.ts electron/main.ts
git commit -m "feat(script): Electron IPC 文件持久化接口"
```

---

## Task 5: StepIndicator 组件

**Files:**
- Create: `src/components/script/StepIndicator.tsx`

- [ ] **Step 1: Create the step indicator component**

```tsx
// src/components/script/StepIndicator.tsx
import { Check } from 'lucide-react';
import type { ScriptStep } from '../../store/script';

interface StepIndicatorProps {
  currentStep: ScriptStep;
}

const STEPS = [
  { step: 1 as const, label: '项目初始化' },
  { step: 2 as const, label: '原稿审查' },
  { step: 3 as const, label: '生成口播稿' },
  { step: 4 as const, label: 'AI 审查' },
  { step: 5 as const, label: '确认保存' },
];

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 56,
        gap: 0,
        background: 'var(--color-panel-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
        padding: '0 40px',
      }}
    >
      {STEPS.map(({ step, label }, index) => {
        const isCompleted = step < currentStep;
        const isActive = step === currentStep;
        const isPending = step > currentStep;

        return (
          <div key={step} style={{ display: 'contents' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  ...(isCompleted
                    ? { background: 'var(--color-success)', color: '#fff' }
                    : isActive
                      ? { background: 'var(--color-brand-accent)', color: '#fff' }
                      : {
                          background: 'transparent',
                          border: '1.5px solid var(--color-border-subtle)',
                          color: 'var(--color-text-muted)',
                        }),
                }}
              >
                {isCompleted ? <Check size={14} /> : step}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  color: isCompleted
                    ? 'var(--color-success)'
                    : isActive
                      ? 'var(--color-brand-accent)'
                      : 'var(--color-text-muted)',
                }}
              >
                {label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                style={{
                  width: 60,
                  height: 2,
                  borderRadius: 1,
                  background: isCompleted
                    ? 'var(--color-success)'
                    : isActive
                      ? 'var(--color-brand-accent)'
                      : 'var(--color-border-subtle)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/script/StepIndicator.tsx
git commit -m "feat(script): StepIndicator 步骤条组件"
```

---

## Task 6: Step 面板组件（①②⑤）

**Files:**
- Create: `src/components/script/StepInitialize.tsx`
- Create: `src/components/script/StepReviewOriginal.tsx`
- Create: `src/components/script/StepConfirm.tsx`

- [ ] **Step 1: Create StepInitialize**

```tsx
// src/components/script/StepInitialize.tsx
import { Upload, FolderOpen } from 'lucide-react';
import { useScriptStore } from '../../store/script';

export function StepInitialize() {
  const { projectDir, originalText, setProjectDir, setOriginalText, setCurrentStep } =
    useScriptStore();

  const handleSelectFile = async () => {
    const result = await window.electronAPI.selectTextFile();
    if (!result) return;
    setOriginalText(result.content);
  };

  const handleSelectDir = async () => {
    const dir = await window.electronAPI.selectProjectDirectory();
    if (!dir) return;
    setProjectDir(dir);
  };

  const handleNext = async () => {
    if (!projectDir || !originalText) return;
    await window.electronAPI.saveScriptFile(projectDir, 'original.md', originalText);
    setCurrentStep(2);
  };

  const hasFile = originalText.length > 0;
  const hasDir = Boolean(projectDir);
  const canProceed = hasFile && hasDir;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Upload size={16} color="var(--color-brand-accent)" />
        <span style={{ fontSize: 14, fontWeight: 600 }}>项目初始化</span>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

      {/* 文件上传 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          上传报告文件
        </span>
        <button
          type="button"
          onClick={() => { void handleSelectFile(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '20px 16px',
            borderRadius: 10,
            border: `1.5px dashed ${hasFile ? 'var(--color-success)' : 'var(--color-border-subtle)'}`,
            background: hasFile ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'var(--color-panel-bg)',
            color: hasFile ? 'var(--color-success)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <Upload size={16} />
          {hasFile ? `已加载 ${originalText.length} 字` : '选择 .txt 或 .md 文件'}
        </button>
      </div>

      {/* 目录选择 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          选择工作目录
        </span>
        <button
          type="button"
          onClick={() => { void handleSelectDir(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            borderRadius: 10,
            border: `1px solid ${hasDir ? 'var(--color-success)' : 'var(--color-border-subtle)'}`,
            background: hasDir ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'var(--color-control-bg)',
            color: hasDir ? 'var(--color-success)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
            textAlign: 'left',
          }}
        >
          <FolderOpen size={16} />
          {projectDir ?? '选择或创建工作目录'}
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        disabled={!canProceed}
        onClick={() => { void handleNext(); }}
        style={{
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          background: canProceed ? 'var(--color-brand-accent)' : 'var(--color-control-bg)',
          color: canProceed ? '#fff' : 'var(--color-text-muted)',
          fontSize: 13,
          fontWeight: 600,
          cursor: canProceed ? 'pointer' : 'default',
        }}
      >
        下一步
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create StepReviewOriginal**

```tsx
// src/components/script/StepReviewOriginal.tsx
import { FileText, ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { useScriptStore } from '../../store/script';

export function StepReviewOriginal() {
  const { originalText, setCurrentStep } = useScriptStore();

  const stats = useMemo(() => {
    const charCount = originalText.length;
    const paragraphs = originalText.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
    const readMinutes = Math.ceil(charCount / 400);
    return { charCount, paragraphs, readMinutes };
  }, [originalText]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={16} color="var(--color-brand-accent)" />
        <span style={{ fontSize: 14, fontWeight: 600 }}>原稿审查</span>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          原稿统计
        </span>
        {[
          ['总字数', stats.charCount.toLocaleString()],
          ['段落数', String(stats.paragraphs)],
          ['预估阅读', `~${stats.readMinutes} 分钟`],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
            <span style={{ fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--color-brand-accent) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-brand-accent) 25%, transparent)',
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
        }}
      >
        在左侧编辑器中审查原稿内容，确认无误后点击"下一步"生成口播稿。
      </div>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={() => setCurrentStep(3)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          background: 'var(--color-brand-accent)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        下一步
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create StepConfirm**

```tsx
// src/components/script/StepConfirm.tsx
import { CheckCircle, Save } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useScriptStore } from '../../store/script';
import {
  createPersistedScriptState,
  saveScriptState,
} from '../../lib/script-persistence';

export function StepConfirm() {
  const { projectDir, scriptText, selectedTemplate, annotations, currentStep } =
    useScriptStore();
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (!projectDir) return;

    await window.electronAPI.saveScriptFile(projectDir, 'script.md', scriptText);
    await saveScriptState(
      projectDir,
      createPersistedScriptState(currentStep, selectedTemplate, annotations),
    );
    setSaved(true);
  }, [projectDir, scriptText, selectedTemplate, annotations, currentStep]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CheckCircle size={16} color="var(--color-success)" />
        <span style={{ fontSize: 14, fontWeight: 600 }}>确认保存</span>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          保存路径
        </span>
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--color-control-bg)',
            border: '1px solid var(--color-border-subtle)',
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            wordBreak: 'break-all',
          }}
        >
          {projectDir ? `${projectDir}/script.md` : '—'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          稿件字数
        </span>
        <span style={{ fontSize: 24, fontWeight: 700 }}>
          {scriptText.length.toLocaleString()}
        </span>
      </div>

      {saved && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
            fontSize: 12,
            color: 'var(--color-success)',
          }}
        >
          口播稿已保存。第二期将支持 TTS 语音合成和视频模板生成。
        </div>
      )}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={() => { void handleSave(); }}
        disabled={saved}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          background: saved ? 'var(--color-control-bg)' : 'var(--color-brand-accent)',
          color: saved ? 'var(--color-text-muted)' : '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: saved ? 'default' : 'pointer',
        }}
      >
        <Save size={14} />
        {saved ? '已保存' : '保存口播稿'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/script/StepInitialize.tsx src/components/script/StepReviewOriginal.tsx src/components/script/StepConfirm.tsx
git commit -m "feat(script): 步骤①②⑤面板组件"
```

---

## Task 7: StepGenerate 组件（步骤③）

**Files:**
- Create: `src/components/script/StepGenerate.tsx`

- [ ] **Step 1: Create StepGenerate**

```tsx
// src/components/script/StepGenerate.tsx
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useScriptStore } from '../../store/script';
import { SCRIPT_TEMPLATES, getTemplateById } from '../../lib/script-templates';
import { callLLM } from '../../lib/llm-client';
import { loadAISettings } from '../../store/ai';
import { debouncedSaveFile } from '../../lib/script-persistence';

export function StepGenerate() {
  const {
    originalText,
    scriptText,
    selectedTemplate,
    generating,
    projectDir,
    setScriptText,
    setSelectedTemplate,
    setGenerating,
    setCurrentStep,
  } = useScriptStore();

  const stats = useMemo(() => {
    const charCount = scriptText.length;
    const readMinutes = Math.ceil(charCount / 300); // 口播语速约 300 字/分钟
    return { charCount, readMinutes };
  }, [scriptText]);

  const handleGenerate = useCallback(async () => {
    const template = getTemplateById(selectedTemplate);
    if (!template || !originalText) return;

    const settings = loadAISettings();
    if (!settings.llmApiKey) {
      alert('请先在 AI 设置中配置 LLM API Key');
      return;
    }

    setGenerating(true);
    try {
      const result = await callLLM(settings, template.systemPrompt, originalText);
      setScriptText(result);
      if (projectDir) {
        debouncedSaveFile(projectDir, 'script.md', result);
      }
    } catch (error) {
      console.error('生成口播稿失败:', error);
      alert(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setGenerating(false);
    }
  }, [originalText, selectedTemplate, projectDir, setScriptText, setGenerating]);

  const hasScript = scriptText.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={16} color="var(--color-brand-accent)" />
        <span style={{ fontSize: 14, fontWeight: 600 }}>生成口播稿</span>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

      {/* 模板选择 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          选择写稿风格
        </span>
        {SCRIPT_TEMPLATES.map((tmpl) => {
          const isSelected = tmpl.id === selectedTemplate;
          return (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => setSelectedTemplate(tmpl.id)}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${isSelected ? 'var(--color-brand-accent)' : 'var(--color-border-subtle)'}`,
                background: isSelected
                  ? 'color-mix(in srgb, var(--color-brand-accent) 10%, transparent)'
                  : 'var(--color-control-bg)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 500,
                    color: isSelected ? '#fff' : 'var(--color-text-secondary)',
                  }}
                >
                  {tmpl.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: isSelected ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                  }}
                >
                  {tmpl.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

      {/* 统计信息 */}
      {hasScript && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            生成信息
          </span>
          {[
            ['原稿字数', originalText.length.toLocaleString()],
            ['口播稿字数', stats.charCount.toLocaleString()],
            ['预估时长', `~${stats.readMinutes} 分钟`],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
              <span style={{ fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          disabled={generating}
          onClick={() => { void handleGenerate(); }}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 0',
            borderRadius: 8,
            border: 'none',
            background: hasScript ? 'var(--color-control-bg)' : 'var(--color-brand-accent)',
            color: hasScript ? 'var(--color-text-secondary)' : '#fff',
            fontSize: 13,
            fontWeight: 500,
            cursor: generating ? 'wait' : 'pointer',
          }}
        >
          <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
          {generating ? '生成中…' : hasScript ? '重新生成' : '生成口播稿'}
        </button>
        {hasScript && (
          <button
            type="button"
            onClick={() => setCurrentStep(4)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-brand-accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            下一步
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/script/StepGenerate.tsx
git commit -m "feat(script): StepGenerate 模板选择与 AI 生成组件"
```

---

## Task 8: StepAIReview & AnnotationHighlight 组件（步骤④）

**Files:**
- Create: `src/components/script/StepAIReview.tsx`
- Create: `src/components/script/AnnotationHighlight.tsx`

- [ ] **Step 1: Create AnnotationHighlight**

```tsx
// src/components/script/AnnotationHighlight.tsx
import type { Annotation } from '../../store/script';

const SEVERITY_COLORS: Record<string, { bg: string; border: string }> = {
  error: { bg: 'color-mix(in srgb, #FF453A 10%, transparent)', border: '#FF453A66' },
  warning: { bg: 'color-mix(in srgb, #FF9F0A 10%, transparent)', border: '#FF9F0A66' },
  info: { bg: 'color-mix(in srgb, #0A84FF 10%, transparent)', border: '#0A84FF66' },
};

/**
 * 将口播稿文本中的批注位置用高亮 span 包裹，返回带 HTML 标记的 Markdown 字符串。
 * 仅用于预览模式，编辑模式下不应用高亮。
 */
export function applyAnnotationHighlights(
  text: string,
  annotations: Annotation[],
): string {
  const pending = annotations
    .filter((a) => a.status === 'pending')
    .sort((a, b) => b.startOffset - a.startOffset);

  let result = text;
  for (const ann of pending) {
    const before = result.slice(0, ann.startOffset);
    const match = result.slice(ann.startOffset, ann.endOffset);
    const after = result.slice(ann.endOffset);
    const colors = SEVERITY_COLORS[ann.severity] ?? SEVERITY_COLORS.info;
    result = `${before}<mark style="background:${colors.bg};border:1px solid ${colors.border};border-radius:4px;padding:1px 4px" data-annotation-id="${ann.id}">${match}</mark>${after}`;
  }

  return result;
}
```

- [ ] **Step 2: Create StepAIReview**

```tsx
// src/components/script/StepAIReview.tsx
import {
  ArrowRight,
  CheckCheck,
  CircleX,
  Info,
  MessageSquare,
  TriangleAlert,
  CircleCheck,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useScriptStore } from '../../store/script';
import type { Annotation, AnnotationSeverity } from '../../store/script';
import { reviewScript } from '../../lib/script-review';
import { loadAISettings } from '../../store/ai';

const SEVERITY_CONFIG: Record<
  AnnotationSeverity,
  { icon: typeof Info; color: string; label: string }
> = {
  error: { icon: CircleX, color: '#FF453A', label: 'error' },
  warning: { icon: TriangleAlert, color: '#FF9F0A', label: 'warning' },
  info: { icon: Info, color: '#0A84FF', label: 'info' },
};

function AnnotationCard({
  annotation,
  index,
  onAccept,
  onDismiss,
}: {
  annotation: Annotation;
  index: number;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const config = SEVERITY_CONFIG[annotation.severity];
  const Icon = config.icon;
  const isAccepted = annotation.status === 'accepted';
  const isDismissed = annotation.status === 'dismissed';
  const isPending = annotation.status === 'pending';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 10,
        border: `1px solid ${isPending ? config.color : isAccepted ? '#32D74B66' : 'var(--color-border-subtle)'}`,
        background: isAccepted
          ? 'color-mix(in srgb, #32D74B 5%, transparent)'
          : isPending
            ? `color-mix(in srgb, ${config.color} 8%, transparent)`
            : 'var(--color-control-bg)',
        opacity: isDismissed ? 0.5 : 1,
      }}
    >
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isAccepted ? (
          <CircleCheck size={14} color="#32D74B" />
        ) : (
          <Icon size={14} color={config.color} />
        )}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: isAccepted ? '#32D74B' : config.color,
          }}
        >
          {isAccepted ? '已采纳' : isDismissed ? '已忽略' : '待处理'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          #{index + 1} · {config.label}
        </span>
      </div>

      {/* 问题描述 */}
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
        &quot;{annotation.originalText}&quot; → {annotation.issue}
      </div>

      {/* 修改建议 */}
      {isPending && annotation.suggestion !== annotation.originalText && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: `color-mix(in srgb, ${config.color} 5%, transparent)`,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: `color-mix(in srgb, ${config.color} 60%, white)`, marginBottom: 4 }}>
            建议修改为：
          </div>
          &quot;{annotation.suggestion}&quot;
        </div>
      )}

      {/* 操作按钮 */}
      {isPending && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--color-border-subtle)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            忽略
          </button>
          <button
            type="button"
            onClick={onAccept}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: config.color,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            采纳修改
          </button>
        </div>
      )}
    </div>
  );
}

export function StepAIReview() {
  const {
    scriptText,
    annotations,
    reviewing,
    setAnnotations,
    setReviewing,
    acceptAnnotation,
    dismissAnnotation,
    acceptAllAnnotations,
    setCurrentStep,
  } = useScriptStore();

  const pendingCount = useMemo(
    () => annotations.filter((a) => a.status === 'pending').length,
    [annotations],
  );
  const processedCount = annotations.length - pendingCount;

  const handleStartReview = useCallback(async () => {
    const settings = loadAISettings();
    if (!settings.llmApiKey) {
      alert('请先在 AI 设置中配置 LLM API Key');
      return;
    }

    setReviewing(true);
    try {
      const result = await reviewScript(settings, scriptText);
      setAnnotations(result);
    } catch (error) {
      console.error('AI 审查失败:', error);
      alert(`审查失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setReviewing(false);
    }
  }, [scriptText, setAnnotations, setReviewing]);

  const hasAnnotations = annotations.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <MessageSquare size={16} color="#FF9F0A" />
        <span style={{ fontSize: 14, fontWeight: 600 }}>AI 审查批注</span>
        <div style={{ flex: 1 }} />
        {hasAnnotations && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 10,
              background: pendingCount > 0 ? '#FF9F0A' : 'var(--color-success)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {processedCount}/{annotations.length}
          </span>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

      {/* 批注列表或开始按钮 */}
      {!hasAnnotations ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px 0' }}>
          <MessageSquare size={32} color="var(--color-text-muted)" />
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {reviewing ? 'AI 正在审查口播稿…' : '点击下方按钮开始 AI 审查'}
          </span>
          <button
            type="button"
            disabled={reviewing}
            onClick={() => { void handleStartReview(); }}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-brand-accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: reviewing ? 'wait' : 'pointer',
            }}
          >
            {reviewing ? '审查中…' : '开始 AI 审查'}
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          {annotations.map((ann, i) => (
            <AnnotationCard
              key={ann.id}
              annotation={ann}
              index={i}
              onAccept={() => acceptAnnotation(ann.id)}
              onDismiss={() => dismissAnnotation(ann.id)}
            />
          ))}
        </div>
      )}

      <div style={{ flex: hasAnnotations ? 0 : 1 }} />

      {/* 底部操作 */}
      {hasAnnotations && (
        <>
          <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              disabled={pendingCount === 0}
              onClick={acceptAllAnnotations}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 0',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-control-bg)',
                color: pendingCount > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                fontSize: 13,
                fontWeight: 500,
                cursor: pendingCount > 0 ? 'pointer' : 'default',
              }}
            >
              <CheckCheck size={14} />
              全部采纳
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep(5)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 0',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-brand-accent)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              完成审查
              <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/script/StepAIReview.tsx src/components/script/AnnotationHighlight.tsx
git commit -m "feat(script): AI 审查批注面板与高亮组件"
```

---

## Task 9: ScriptWorkbench 主页面

**Files:**
- Create: `src/pages/ScriptWorkbench.tsx`
- Create: `src/pages/ScriptWorkbench.module.css`

- [ ] **Step 1: Create ScriptWorkbench.module.css**

```css
/* src/pages/ScriptWorkbench.module.css */
.page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-window-bg);
  overflow: hidden;
}

.mainContent {
  display: flex;
  flex: 1;
  min-height: 0;
}

.editorPanel {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  gap: 16px;
  min-width: 0;
}

.editorHeader {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editorTitle {
  font-size: 15px;
  font-weight: 600;
}

.editorSpacer {
  flex: 1;
}

.panelDivider {
  width: 1px;
  background: var(--color-border-subtle);
}

.sidePanel {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 20px;
  background: var(--color-panel-bg);
  overflow-y: auto;
}

.editorContainer {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editorContainer [data-color-mode="dark"] {
  height: 100%;
}

.editorContainer .w-md-editor {
  height: 100% !important;
}
```

- [ ] **Step 2: Create ScriptWorkbench.tsx**

```tsx
// src/pages/ScriptWorkbench.tsx
import { useCallback, useEffect } from 'react';
import { useScriptStore } from '../store/script';
import { StepIndicator } from '../components/script/StepIndicator';
import { StepInitialize } from '../components/script/StepInitialize';
import { StepReviewOriginal } from '../components/script/StepReviewOriginal';
import { StepGenerate } from '../components/script/StepGenerate';
import { StepAIReview } from '../components/script/StepAIReview';
import { StepConfirm } from '../components/script/StepConfirm';
import { MdEditor } from '../ui/components/md-editor';
import { debouncedSaveFile } from '../lib/script-persistence';
import styles from './ScriptWorkbench.module.css';

interface ScriptWorkbenchProps {
  onBack: () => void;
}

export function ScriptWorkbench({ onBack }: ScriptWorkbenchProps) {
  const {
    currentStep,
    originalText,
    scriptText,
    projectDir,
    setOriginalText,
    setScriptText,
  } = useScriptStore();

  // 编辑器显示的内容根据步骤切换
  const isEditingOriginal = currentStep <= 2;
  const editorValue = isEditingOriginal ? originalText : scriptText;
  const editorReadonly = currentStep === 5;

  const handleEditorChange = useCallback(
    (value: string) => {
      if (isEditingOriginal) {
        setOriginalText(value);
        if (projectDir) debouncedSaveFile(projectDir, 'original.md', value);
      } else {
        setScriptText(value);
        if (projectDir) debouncedSaveFile(projectDir, 'script.md', value);
      }
    },
    [isEditingOriginal, projectDir, setOriginalText, setScriptText],
  );

  // 渲染右侧面板
  const renderSidePanel = () => {
    switch (currentStep) {
      case 1:
        return <StepInitialize />;
      case 2:
        return <StepReviewOriginal />;
      case 3:
        return <StepGenerate />;
      case 4:
        return <StepAIReview />;
      case 5:
        return <StepConfirm />;
    }
  };

  return (
    <div className={styles.page}>
      <StepIndicator currentStep={currentStep} />

      <div className={styles.mainContent}>
        {/* 左侧编辑器 */}
        <div className={styles.editorPanel}>
          <div className={styles.editorHeader}>
            <button
              type="button"
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                padding: '4px 8px',
                borderRadius: 6,
              }}
            >
              ← 返回
            </button>
            <span className={styles.editorTitle}>
              {isEditingOriginal ? '原稿编辑器' : '口播稿编辑器'}
            </span>
            <div className={styles.editorSpacer} />
          </div>

          <div className={styles.editorContainer}>
            {currentStep === 1 && !originalText ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--color-text-muted)',
                  fontSize: 14,
                }}
              >
                在右侧面板上传报告文件并选择工作目录
              </div>
            ) : (
              <MdEditor
                value={editorValue}
                onChange={handleEditorChange}
                placeholder={isEditingOriginal ? '报告原文内容…' : '口播稿内容…'}
              />
            )}
          </div>
        </div>

        {/* 分隔线 */}
        <div className={styles.panelDivider} />

        {/* 右侧面板 */}
        <div className={styles.sidePanel}>{renderSidePanel()}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx src/pages/ScriptWorkbench.module.css
git commit -m "feat(script): ScriptWorkbench 主页面（编辑器 + 步骤面板）"
```

---

## Task 10: Welcome 页面改造 & 路由集成

**Files:**
- Modify: `src/pages/Setup.tsx`
- Modify: `src/pages/Setup.module.css`
- Modify: `src/App.tsx`
- Modify: `src/components/Toolbar.tsx`

- [ ] **Step 1: Update Toolbar page type**

在 `src/components/Toolbar.tsx` 中，将 page prop 类型改为：

```typescript
page: 'welcome' | 'setup' | 'editor' | 'script-workbench';
```

注意：Toolbar 内部可能有 `page === 'setup'` 或 `page === 'editor'` 的条件判断，`'welcome'` 和 `'script-workbench'` 应与 `'setup'` 使用相同的行为分支。修改所有 `page === 'setup'` 为 `page !== 'editor'`（或根据实际逻辑调整）。

- [ ] **Step 2: Update App.tsx routing**

修改 `src/App.tsx`：

1. 在文件顶部导入 ScriptWorkbench：

```typescript
import { ScriptWorkbench } from './pages/ScriptWorkbench';
```

2. 修改 Page 类型：

```typescript
type Page = 'welcome' | 'setup' | 'editor' | 'script-workbench';
```

3. 修改初始 page 状态：

```typescript
const [page, setPage] = useState<Page>('welcome');
```

4. 修改 `resetToSetup` 函数，将 `setPage('setup')` 改为 `setPage('welcome')`。

5. 在 JSX 渲染部分，替换页面条件渲染：

```tsx
<div style={{ minHeight: 0 }}>
  {page === 'welcome' ? (
    <Setup
      busy={isSettingUp}
      errorMessage={setupError}
      onComplete={handleSetupComplete}
      onStartScriptWorkbench={() => setPage('script-workbench')}
    />
  ) : page === 'script-workbench' ? (
    <ScriptWorkbench onBack={() => setPage('welcome')} />
  ) : page === 'setup' ? (
    <Setup
      busy={isSettingUp}
      errorMessage={setupError}
      onComplete={handleSetupComplete}
      onStartScriptWorkbench={() => setPage('script-workbench')}
    />
  ) : (
    <Editor
      onAddAsset={handleAddAsset}
      exportRequestToken={exportRequestToken}
      projectDir={currentProjectDir}
    />
  )}
</div>
```

6. 更新 Toolbar 的 page prop：

```tsx
<Toolbar
  compact={viewport.width < 960}
  page={page}
  ...
/>
```

- [ ] **Step 3: Refactor Setup.tsx to Welcome layout**

修改 `src/pages/Setup.tsx`，在 `SetupProps` 中新增 `onStartScriptWorkbench` prop：

```typescript
interface SetupProps {
  busy: boolean;
  errorMessage: string | null;
  onComplete: (audioPath: string, srtPath: string) => Promise<void>;
  onStartScriptWorkbench: () => void;
}
```

重写 `Setup` 组件的 JSX，将现有布局改为 Welcome 双入口卡片布局。保留原有的 ImportCard + 导入逻辑，但将其放入右侧卡片中。左侧新增"AI 写稿创作"卡片。

核心结构变更（保留原有 state 和 handlers 不变）：

```tsx
export function Setup({ busy, errorMessage, onComplete, onStartScriptWorkbench }: SetupProps) {
  // ... 保留所有现有 state 和 handlers ...

  return (
    <div className={styles.page}>
      <div className={styles.welcomeContent}>
        {/* Hero */}
        <div className={styles.welcomeHero}>
          <div className={styles.heroEyebrow}>LOCAL PODCAST VIDEO EDITOR</div>
          <h1 className={styles.heroTitle}>选择你的创作方式</h1>
          <p className={styles.heroDescription}>
            AI 智能写稿或直接导入音频字幕，开始制作播客视频
          </p>
        </div>

        {/* 双入口卡片 */}
        <div className={styles.entryCards}>
          {/* AI 写稿卡片 */}
          <Card className={styles.entryCard} onClick={onStartScriptWorkbench}>
            <div className={styles.entryCardBadge}>
              <span className={styles.badgeIcon}>✨</span>
              <Badge variant="accent">AI 驱动</Badge>
            </div>
            <h2 className={styles.entryCardTitle}>AI 写稿创作</h2>
            <p className={styles.entryCardDesc}>
              上传报告文件，AI 自动生成口播稿{'\n'}一键生成音频、字幕和视频模板
            </p>
            <div className={styles.entrySteps}>
              {['上传报告 → 审查修改原稿', 'AI 生成口播稿 → AI 审查批注', 'TTS 语音合成 → 自动创建视频'].map((text, i) => (
                <div key={i} className={styles.entryStep}>
                  <span className={styles.entryStepDot}>{i + 1}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
            <Button variant="accent" size="lg" className={styles.entryCardAction}>
              开始创作
            </Button>
          </Card>

          {/* 导入音频卡片 */}
          <Card className={styles.entryCard}>
            <div className={styles.entryCardBadge}>
              <span className={styles.badgeIcon}>🎵</span>
              <Badge variant="secondary">经典模式</Badge>
            </div>
            <h2 className={styles.entryCardTitle}>导入音频与字幕</h2>
            <p className={styles.entryCardDesc}>
              已有播客录音和字幕文件{'\n'}直接导入即可开始编辑视频
            </p>
            <div className={styles.importGrid} style={{ gridTemplateColumns: '1fr' }}>
              <ImportCard
                label="AUDIO"
                helper="拖入 MP3 口播音频"
                value={audioPath}
                accentColor="#79c4ff"
                icon="🎙"
                selectLabel="选择 MP3"
                onPickFile={() => { void createSelectHandler('audio')(); }}
                onDrop={createDropHandler('audio')}
                compact
              />
              <ImportCard
                label="SUBTITLE"
                helper="拖入对应 SRT 字幕"
                value={srtPath}
                accentColor="#ffb547"
                icon="📝"
                selectLabel="选择 SRT"
                onPickFile={() => { void createSelectHandler('srt')(); }}
                onDrop={createDropHandler('srt')}
                compact
              />
            </div>
            {errorMessage || localError ? (
              <Alert variant="destructive">{localError || errorMessage}</Alert>
            ) : null}
            <Button
              disabled={!canStart}
              onClick={() => { if (audioPath && srtPath) void onComplete(audioPath, srtPath); }}
              variant={canStart ? 'accent' : 'secondary'}
              size="lg"
              className={styles.entryCardAction}
            >
              {busy ? '初始化中...' : '导入文件'}
            </Button>
          </Card>
        </div>

        <div className={styles.footerNote}>
          所有文件均在本地处理，不会上传至任何服务器
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add Welcome styles to Setup.module.css**

在 `src/pages/Setup.module.css` 末尾追加：

```css
.welcomeContent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  padding: 48px 80px 40px;
  height: 100%;
  overflow-y: auto;
}

.welcomeHero {
  text-align: center;
}

.entryCards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px;
  width: 100%;
  max-width: 960px;
}

.entryCard {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.entryCard:hover {
  border-color: var(--color-brand-accent);
}

.entryCardBadge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badgeIcon {
  font-size: 20px;
}

.entryCardTitle {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
}

.entryCardDesc {
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.6;
  white-space: pre-line;
  margin: 0;
}

.entrySteps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entryStep {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.entryStepDot {
  width: 24px;
  height: 24px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: color-mix(in srgb, var(--color-brand-accent) 15%, transparent);
  color: var(--color-brand-accent);
}

.entryCardAction {
  margin-top: auto;
  width: 100%;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Setup.tsx src/pages/Setup.module.css src/App.tsx src/components/Toolbar.tsx
git commit -m "feat(script): Welcome 双入口页面与路由集成"
```

---

## Task 11: Settings Storage 工具模块

**Files:**
- Create: `src/lib/settings-storage.ts`

- [ ] **Step 1: Create settings-storage.ts**

```typescript
// src/lib/settings-storage.ts
import type { AISettings } from '../types/ai';

// ── Keys ──
const CUSTOM_TEMPLATES_KEY = 'podcast-editor-custom-templates';
const REVIEW_CRITERIA_KEY = 'podcast-editor-review-criteria';
const TTS_SETTINGS_KEY = 'podcast-editor-tts-settings';

// ── Custom Templates ──
export interface CustomScriptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export function loadCustomTemplates(): CustomScriptTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as CustomScriptTemplate[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: CustomScriptTemplate[]): void {
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
}

export function addCustomTemplate(
  template: Omit<CustomScriptTemplate, 'id' | 'createdAt' | 'updatedAt'>,
): CustomScriptTemplate {
  const templates = loadCustomTemplates();
  const now = new Date().toISOString();
  const newTemplate: CustomScriptTemplate = {
    ...template,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  templates.push(newTemplate);
  saveCustomTemplates(templates);
  return newTemplate;
}

export function updateCustomTemplate(
  id: string,
  updates: Partial<Omit<CustomScriptTemplate, 'id' | 'createdAt'>>,
): void {
  const templates = loadCustomTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) return;
  templates[index] = { ...templates[index], ...updates, updatedAt: new Date().toISOString() };
  saveCustomTemplates(templates);
}

export function deleteCustomTemplate(id: string): void {
  const templates = loadCustomTemplates().filter((t) => t.id !== id);
  saveCustomTemplates(templates);
}

// ── Review Criteria ──
const DEFAULT_REVIEW_CRITERIA = `请重点关注：
1. 数据引用是否标注来源
2. 是否有过于书面化的表达
3. 段落过渡是否自然
4. 口播节奏是否合理`;

export function loadReviewCriteria(): string {
  return localStorage.getItem(REVIEW_CRITERIA_KEY) ?? DEFAULT_REVIEW_CRITERIA;
}

export function saveReviewCriteria(criteria: string): void {
  localStorage.setItem(REVIEW_CRITERIA_KEY, criteria);
}

// ── TTS Settings ──
export interface TTSSettings {
  apiKey: string;
  voiceId: string;
  speed: number;
}

const DEFAULT_TTS_SETTINGS: TTSSettings = {
  apiKey: '',
  voiceId: 'male-qn-qingse',
  speed: 1.0,
};

export function loadTTSSettings(): TTSSettings {
  try {
    const raw = localStorage.getItem(TTS_SETTINGS_KEY);
    return raw ? { ...DEFAULT_TTS_SETTINGS, ...(JSON.parse(raw) as Partial<TTSSettings>) } : DEFAULT_TTS_SETTINGS;
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

export function saveTTSSettings(settings: TTSSettings): void {
  localStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(settings));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/settings-storage.ts
git commit -m "feat(settings): 全局设置 localStorage 存储封装"
```

---

## Task 12: 更新模板库支持自定义模板

**Files:**
- Modify: `src/lib/script-templates.ts`

- [ ] **Step 1: Add getAllTemplates function**

在 `src/lib/script-templates.ts` 末尾追加：

```typescript
import { loadCustomTemplates, type CustomScriptTemplate } from './settings-storage';

export interface MergedTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  isBuiltin: boolean;
}

export function getAllTemplates(): MergedTemplate[] {
  const builtins: MergedTemplate[] = SCRIPT_TEMPLATES.map((t) => ({
    ...t,
    isBuiltin: true,
  }));
  const customs: MergedTemplate[] = loadCustomTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    systemPrompt: t.systemPrompt,
    isBuiltin: false,
  }));
  return [...builtins, ...customs];
}

export function getAnyTemplateById(id: string): MergedTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/script-templates.ts
git commit -m "feat(script): 模板库支持合并内置与自定义模板"
```

---

## Task 13: 更新 AI 审查支持用户自定义规范

**Files:**
- Modify: `src/lib/script-review.ts`

- [ ] **Step 1: Update reviewScript to include user criteria**

在 `src/lib/script-review.ts` 中修改 `reviewScript` 函数，加载用户自定义审查要点并追加到 system prompt：

```typescript
import { loadReviewCriteria } from './settings-storage';

export async function reviewScript(
  settings: AISettings,
  scriptText: string,
): Promise<Annotation[]> {
  const userCriteria = loadReviewCriteria();
  const fullPrompt = userCriteria.trim()
    ? `${REVIEW_SYSTEM_PROMPT}\n\n用户补充的审查要求：\n${userCriteria}`
    : REVIEW_SYSTEM_PROMPT;

  const response = await callLLM(settings, fullPrompt, scriptText);
  return parseAnnotations(response, scriptText);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/script-review.ts
git commit -m "feat(script): AI 审查支持用户自定义审查规范叠加"
```

---

## Task 14: 全局设置页面 — Settings Page & Tabs

**Files:**
- Create: `src/pages/Settings.tsx`
- Create: `src/pages/Settings.module.css`
- Create: `src/components/settings/AIConfigTab.tsx`
- Create: `src/components/settings/TemplateManagerTab.tsx`
- Create: `src/components/settings/ReviewCriteriaTab.tsx`
- Create: `src/components/settings/TTSConfigTab.tsx`

- [ ] **Step 1: Create Settings.module.css**

```css
/* src/pages/Settings.module.css */
.page {
  width: 100%;
  height: 100%;
  display: flex;
  background: var(--color-window-bg);
  overflow: hidden;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px 12px;
  border-right: 1px solid var(--color-border-subtle);
  background: var(--color-panel-bg);
}

.sidebarHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 16px;
}

.sidebarTitle {
  font-size: 15px;
  font-weight: 600;
}

.tabButton {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.tabButton:hover {
  background: var(--color-control-bg);
}

.tabButtonActive {
  background: color-mix(in srgb, var(--color-brand-accent) 15%, transparent);
  color: var(--color-brand-accent);
  font-weight: 600;
}

.content {
  flex: 1;
  padding: 32px 40px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 680px;
}

.sectionTitle {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.sectionDesc {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0;
}

.fieldGroup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.templateCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-control-bg);
}

.templateCardHeader {
  display: flex;
  align-items: center;
  gap: 8px;
}

.templateCardActions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
```

- [ ] **Step 2: Create AIConfigTab**

```tsx
// src/components/settings/AIConfigTab.tsx
import { useState, useEffect } from 'react';
import { loadAISettings, saveAISettings } from '../../store/ai';
import type { AISettings } from '../../types/ai';
import { Field, Input, Divider } from '../../ui';

export function AIConfigTab() {
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [jimengApiUrl, setJimengApiUrl] = useState('');
  const [jimengSessionId, setJimengSessionId] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = loadAISettings();
    setLlmBaseUrl(settings?.llmBaseUrl ?? 'https://api.openai.com/v1');
    setLlmApiKey(settings?.llmApiKey ?? '');
    setLlmModel(settings?.llmModel ?? 'gpt-4o');
    setJimengApiUrl(settings?.jimengApiUrl ?? '');
    setJimengSessionId(settings?.jimengSessionId ?? '');
  }, []);

  const handleSave = () => {
    saveAISettings({ llmBaseUrl, llmApiKey, llmModel, jimengApiUrl, jimengSessionId });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>AI 基础配置</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
          配置 LLM API 和即梦图片生成服务
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="LLM API Base URL">
          <Input value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>
        <Field label="LLM API Key">
          <Input type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} placeholder="sk-..." />
        </Field>
        <Field label="模型名称">
          <Input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="gpt-4o" />
        </Field>

        <Divider label="封面生成（即梦）" />

        <Field label="即梦 API URL">
          <Input value={jimengApiUrl} onChange={(e) => setJimengApiUrl(e.target.value)} placeholder="https://jimeng.example.com" />
        </Field>
        <Field label="即梦 Session ID">
          <Input type="password" value={jimengSessionId} onChange={(e) => setJimengSessionId(e.target.value)} placeholder="session id" />
        </Field>
      </div>

      <button
        type="button"
        onClick={handleSave}
        style={{
          alignSelf: 'flex-start',
          padding: '10px 24px',
          borderRadius: 8,
          border: 'none',
          background: saved ? 'var(--color-success)' : 'var(--color-brand-accent)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {saved ? '已保存 ✓' : '保存配置'}
      </button>
    </>
  );
}
```

- [ ] **Step 3: Create TemplateManagerTab**

```tsx
// src/components/settings/TemplateManagerTab.tsx
import { useState, useCallback } from 'react';
import { Pencil, Plus, Trash2, Eye } from 'lucide-react';
import { SCRIPT_TEMPLATES } from '../../lib/script-templates';
import {
  loadCustomTemplates,
  addCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  type CustomScriptTemplate,
} from '../../lib/settings-storage';
import { Field, Input } from '../../ui';

export function TemplateManagerTab() {
  const [customs, setCustoms] = useState(() => loadCustomTemplates());
  const [editing, setEditing] = useState<CustomScriptTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [viewingBuiltin, setViewingBuiltin] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  const startNew = () => {
    setIsNew(true);
    setEditing(null);
    setName('');
    setDescription('');
    setSystemPrompt('');
  };

  const startEdit = (t: CustomScriptTemplate) => {
    setIsNew(false);
    setEditing(t);
    setName(t.name);
    setDescription(t.description);
    setSystemPrompt(t.systemPrompt);
  };

  const handleSave = useCallback(() => {
    if (!name.trim() || !systemPrompt.trim()) return;
    if (isNew) {
      addCustomTemplate({ name, description, systemPrompt });
    } else if (editing) {
      updateCustomTemplate(editing.id, { name, description, systemPrompt });
    }
    setCustoms(loadCustomTemplates());
    setEditing(null);
    setIsNew(false);
  }, [name, description, systemPrompt, isNew, editing]);

  const handleDelete = useCallback((id: string) => {
    deleteCustomTemplate(id);
    setCustoms(loadCustomTemplates());
  }, []);

  const isEditorOpen = isNew || editing !== null;

  return (
    <>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>口播模板管理</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
          管理口播稿生成的风格模板，内置模板不可修改
        </p>
      </div>

      {/* 内置模板 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: 1 }}>
          内置模板
        </span>
        {SCRIPT_TEMPLATES.map((t) => (
          <div
            key={t.id}
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-control-bg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t.description}</span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setViewingBuiltin(viewingBuiltin === t.id ? null : t.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                <Eye size={14} />
              </button>
            </div>
            {viewingBuiltin === t.id && (
              <pre style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', marginTop: 10, lineHeight: 1.5 }}>
                {t.systemPrompt}
              </pre>
            )}
          </div>
        ))}
      </div>

      {/* 自定义模板 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: 1 }}>
            自定义模板
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={startNew}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, border: 'none',
              background: 'var(--color-brand-accent)', color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={12} /> 新增
          </button>
        </div>

        {customs.length === 0 && !isEditorOpen && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            暂无自定义模板，点击"新增"创建
          </div>
        )}

        {customs.map((t) => (
          <div
            key={t.id}
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-control-bg)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>{t.description}</span>
            </div>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => startEdit(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <Pencil size={14} />
            </button>
            <button type="button" onClick={() => handleDelete(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger, #FF453A)' }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* 编辑面板 */}
      {isEditorOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20, borderRadius: 12, border: '1px solid var(--color-brand-accent)', background: 'color-mix(in srgb, var(--color-brand-accent) 5%, transparent)' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{isNew ? '新增模板' : '编辑模板'}</span>
          <Field label="模板名称"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：财经解读" /></Field>
          <Field label="描述"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话描述风格特点" /></Field>
          <Field label="System Prompt">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="输入完整的 System Prompt…"
              rows={10}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--color-border-subtle)', background: 'var(--color-control-bg)', color: 'inherit', fontSize: 13, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setEditing(null); setIsNew(false); }} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 12, cursor: 'pointer' }}>
              取消
            </button>
            <button type="button" onClick={handleSave} disabled={!name.trim() || !systemPrompt.trim()} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--color-brand-accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              保存
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Create ReviewCriteriaTab**

```tsx
// src/components/settings/ReviewCriteriaTab.tsx
import { useState, useEffect } from 'react';
import { loadReviewCriteria, saveReviewCriteria } from '../../lib/settings-storage';

export function ReviewCriteriaTab() {
  const [criteria, setCriteria] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCriteria(loadReviewCriteria());
  }, []);

  const handleSave = () => {
    saveReviewCriteria(criteria);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>审查规范配置</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
          自定义 AI 审查口播稿时的关注要点，将叠加到系统内置审查规则之上
        </p>
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--color-brand-accent) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-brand-accent) 25%, transparent)',
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
        }}
      >
        系统已内置基础审查规则（事实准确性、表达流畅性、逻辑连贯性等），以下内容将作为补充要求追加到审查 Prompt 中。
      </div>

      <textarea
        value={criteria}
        onChange={(e) => setCriteria(e.target.value)}
        rows={12}
        placeholder="输入你希望 AI 额外关注的审查维度…"
        style={{
          width: '100%',
          padding: 16,
          borderRadius: 10,
          border: '1px solid var(--color-border-subtle)',
          background: 'var(--color-control-bg)',
          color: 'inherit',
          fontSize: 14,
          lineHeight: 1.7,
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />

      <button
        type="button"
        onClick={handleSave}
        style={{
          alignSelf: 'flex-start',
          padding: '10px 24px',
          borderRadius: 8,
          border: 'none',
          background: saved ? 'var(--color-success)' : 'var(--color-brand-accent)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {saved ? '已保存 ✓' : '保存审查规范'}
      </button>
    </>
  );
}
```

- [ ] **Step 5: Create TTSConfigTab**

```tsx
// src/components/settings/TTSConfigTab.tsx
import { useState, useEffect } from 'react';
import { loadTTSSettings, saveTTSSettings } from '../../lib/settings-storage';
import { Field, Input } from '../../ui';

const VOICE_OPTIONS = [
  { id: 'male-qn-qingse', label: '男声 · 青涩' },
  { id: 'female-tianmei', label: '女声 · 甜美' },
  { id: 'boke_male', label: '播客男声' },
];

export function TTSConfigTab() {
  const [apiKey, setApiKey] = useState('');
  const [voiceId, setVoiceId] = useState('male-qn-qingse');
  const [speed, setSpeed] = useState(1.0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = loadTTSSettings();
    setApiKey(settings.apiKey);
    setVoiceId(settings.voiceId);
    setSpeed(settings.speed);
  }, []);

  const handleSave = () => {
    saveTTSSettings({ apiKey, voiceId, speed });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>TTS 语音合成配置</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>
          配置 MiniMax TTS 服务参数（第二期功能，当前仅保存配置）
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="MiniMax API Key">
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="your-api-key" />
        </Field>

        <Field label="音色选择">
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-control-bg)', color: 'inherit',
              fontSize: 13,
            }}
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </Field>

        <Field label={`语速：${speed.toFixed(1)}x`}>
          <input
            type="range" min="0.5" max="2.0" step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={handleSave}
        style={{
          alignSelf: 'flex-start',
          padding: '10px 24px',
          borderRadius: 8,
          border: 'none',
          background: saved ? 'var(--color-success)' : 'var(--color-brand-accent)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {saved ? '已保存 ✓' : '保存 TTS 配置'}
      </button>
    </>
  );
}
```

- [ ] **Step 6: Create Settings.tsx**

```tsx
// src/pages/Settings.tsx
import { useState } from 'react';
import { ArrowLeft, Bot, FileText, MessageSquare, Volume2 } from 'lucide-react';
import { AIConfigTab } from '../components/settings/AIConfigTab';
import { TemplateManagerTab } from '../components/settings/TemplateManagerTab';
import { ReviewCriteriaTab } from '../components/settings/ReviewCriteriaTab';
import { TTSConfigTab } from '../components/settings/TTSConfigTab';
import styles from './Settings.module.css';

type SettingsTab = 'ai-config' | 'templates' | 'review' | 'tts';

const TABS: { id: SettingsTab; label: string; icon: typeof Bot }[] = [
  { id: 'ai-config', label: 'AI 基础配置', icon: Bot },
  { id: 'templates', label: '口播模板管理', icon: FileText },
  { id: 'review', label: '审查规范配置', icon: MessageSquare },
  { id: 'tts', label: 'TTS 语音合成', icon: Volume2 },
];

interface SettingsProps {
  onBack: () => void;
}

export function Settings({ onBack }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai-config');

  const renderTab = () => {
    switch (activeTab) {
      case 'ai-config': return <AIConfigTab />;
      case 'templates': return <TemplateManagerTab />;
      case 'review': return <ReviewCriteriaTab />;
      case 'tts': return <TTSConfigTab />;
    }
  };

  return (
    <div className={styles.page}>
      {/* 左侧 Tab 导航 */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <button
            type="button"
            onClick={onBack}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: 0 }}
          >
            <ArrowLeft size={18} />
          </button>
          <span className={styles.sidebarTitle}>系统设置</span>
        </div>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ''}`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 右侧内容区 */}
      <div className={styles.content}>
        {renderTab()}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/Settings.tsx src/pages/Settings.module.css src/components/settings/AIConfigTab.tsx src/components/settings/TemplateManagerTab.tsx src/components/settings/ReviewCriteriaTab.tsx src/components/settings/TTSConfigTab.tsx
git commit -m "feat(settings): 全局设置页面（AI 配置 + 模板管理 + 审查规范 + TTS）"
```

---

## Task 15: 路由集成设置页面

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/Setup.tsx`

- [ ] **Step 1: Update App.tsx**

1. 导入 Settings 页面：

```typescript
import { Settings } from './pages/Settings';
```

2. Page 类型添加 `'settings'`：

```typescript
type Page = 'welcome' | 'setup' | 'editor' | 'script-workbench' | 'settings';
```

3. 在 JSX 渲染条件中添加 settings 分支（在 script-workbench 之后）：

```tsx
) : page === 'settings' ? (
  <Settings onBack={() => setPage('welcome')} />
)
```

- [ ] **Step 2: Add settings entry to Setup.tsx (Welcome page)**

在 Welcome 页面的底部"最近项目"区域旁或双卡片区域下方，添加"系统设置"入口按钮：

```tsx
<button
  type="button"
  onClick={() => onOpenSettings()}
  style={{
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--color-text-muted)', fontSize: 12,
  }}
>
  ⚙️ 系统设置
</button>
```

Setup 组件 props 新增 `onOpenSettings: () => void`，App.tsx 传入 `() => setPage('settings')`。

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/pages/Setup.tsx
git commit -m "feat(settings): 路由集成全局设置页面入口"
```

---

## Task 16: 更新 StepGenerate 使用合并模板

**Files:**
- Modify: `src/components/script/StepGenerate.tsx`

- [ ] **Step 1: Update imports and template list**

将 StepGenerate 中的模板导入从 `SCRIPT_TEMPLATES` 改为 `getAllTemplates` + `getAnyTemplateById`：

```typescript
import { getAllTemplates, getAnyTemplateById } from '../../lib/script-templates';
```

将模板列表从 `SCRIPT_TEMPLATES.map(...)` 改为 `getAllTemplates().map(...)`。

将模板查找从 `getTemplateById(selectedTemplate)` 改为 `getAnyTemplateById(selectedTemplate)`。

- [ ] **Step 2: Commit**

```bash
git add src/components/script/StepGenerate.tsx
git commit -m "feat(script): StepGenerate 使用合并模板列表"
```

---

## Task 17: 冒烟测试 & 集成验证

- [ ] **Step 1: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。如有错误，修复后重新检查。

- [ ] **Step 2: Run dev server**

```bash
npm run dev
```

Expected: Electron 窗口正常启动，显示 Welcome 双入口页面。

- [ ] **Step 3: Manual integration test**

手动验证以下流程：

**Welcome & 导航：**
1. Welcome 页面显示两个入口卡片 + "系统设置"入口
2. 点击"系统设置" → 进入 Settings 页面，4 个 Tab 均可切换
3. 返回 Welcome

**全局设置：**
4. Settings → AI 基础配置：填入 LLM API Key 并保存，刷新后数据保持
5. Settings → 口播模板管理：查看内置模板 Prompt，新增自定义模板，编辑，删除
6. Settings → 审查规范配置：修改审查要点并保存
7. Settings → TTS 配置：填入配置并保存

**写稿流程：**
8. 点击"AI 写稿创作" → 进入 ScriptWorkbench
9. 步骤① → 上传 .txt/.md 文件 + 选择工作目录
10. 步骤② → 编辑器显示原稿，右侧显示统计
11. 步骤③ → 模板列表包含内置 + 自定义模板，选择后点击生成
12. 步骤④ → 点击 AI 审查，验证自定义审查规范生效，批注列表操作正常
13. 步骤⑤ → 确认保存，检查项目目录下生成 `original.md`、`script.md`、`script-state.json`
14. 返回 Welcome → 点击"导入音频与字幕" → 原有 Setup 流程正常

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -u
git commit -m "fix(script): 集成测试修复"
```

- [ ] **Step 5: Final commit if all clean**

```bash
git add -u
git commit -m "feat(script): AI 写稿工作台第一期完成"
```

# Motion Card — AI 生成 Remotion 动态动画组件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在编辑器 AI 面板新增"动画"标签页，用户通过对话描述动画效果，AI 生成 Remotion 原生 React 组件，支持预览、上轨和视频导出。

**Architecture:** 用户输入自然语言 → AI 生成 JSX 代码 → @babel/standalone 编译 → new Function() + 沙箱 API 注入 → Remotion Sequence 渲染。服务层（MotionCardService）统一封装生成/修改/编译逻辑，UI 层和未来 MCP 层共用。

**Tech Stack:** React 19 / Remotion 4 / @babel/standalone / Zustand / TypeScript / Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-motion-card-dynamic-remotion-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/types/motion.ts` | MotionCardPayload 接口 + 辅助类型 |
| `src/lib/motion-compiler.ts` | Babel 编译层：JSX → JS |
| `src/lib/motion-runtime.ts` | 执行层：沙箱 API 注入 + new Function() |
| `src/lib/motion-prompt.ts` | System/User prompt 构建 |
| `src/lib/motion-auto-fix.ts` | 错误捕获 → AI 重试修复 |
| `src/lib/motion-card-service.ts` | 服务层：统一 generate/modify/compile 接口 |
| `src/remotion/MotionCardOverlay.tsx` | Remotion 动态组件渲染 + ErrorBoundary |
| `src/components/MotionPanel.tsx` | AI 面板"动画"标签页主组件 |
| `src/components/MotionPanel.module.css` | MotionPanel 样式 |
| `src/components/MotionCardItem.tsx` | 单个 motion card 卡片 UI |
| `src/components/MotionCardItem.module.css` | MotionCardItem 样式 |
| `src/components/MotionCardInspector.tsx` | 右侧 Inspector 详情面板 |
| `src/components/MotionCardInspector.module.css` | Inspector 样式 |
| `tests/motion-compiler.test.ts` | 编译层测试 |
| `tests/motion-runtime.test.ts` | 执行层测试 |
| `tests/motion-auto-fix.test.ts` | 自动修复测试 |
| `tests/motion-card-service.test.ts` | 服务层测试 |
| `tests/motion-card-overlay.test.tsx` | Remotion 组件测试 |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | 新增 6 个依赖 |
| `src/types/ai.ts:1,3,27-42,98-111,122-128,132-171` | 扩展类型 + 辅助函数 |
| `src/remotion/AICardOverlay.tsx:27-64` | renderCard() 新增 motion-card 分支 |
| `src/components/AIPanel.tsx:33-36,508-525,634-646,649-663` | 新增"动画"sub-tab |
| `src/components/EditorInspector.tsx:11-16,51-59` | 新增 motion-card 选中处理 |
| `src/pages/Editor.tsx` | Inspector 入口按 cardId 解析 ai-card / motion-card |
| `src/store/ai.ts:42,43-63,65-97` | 扩展 AITab + motion cards 状态 |
| `src/lib/ai-persistence.ts` | PersistedAIState 扩展 motionCards 并更新类型守卫 |
| `src/App.tsx` | 项目打开/清空流程同步恢复与清理 motionCards |
| `src/lib/ai-analysis.ts:89-135` | normalizeCard() 兼容 motion 类型 |

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 @babel/standalone**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npm install @babel/standalone
```

Expected: package.json dependencies 中出现 `"@babel/standalone"`

- [ ] **Step 2: 安装 Remotion 扩展包**

```bash
npm install @remotion/noise @remotion/shapes @remotion/paths @remotion/transitions @remotion/motion-blur
```

Expected: 5 个新包出现在 dependencies 中，版本与已有 remotion 包一致（^4.0.443）

- [ ] **Step 3: 验证安装**

```bash
npm ls @babel/standalone @remotion/noise @remotion/shapes @remotion/paths @remotion/transitions @remotion/motion-blur
```

Expected: 全部列出，无 `MISSING` 或 `ERR`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 motion card 依赖（babel-standalone + remotion 扩展包）"
```

---

## Task 2: 类型定义

**Files:**
- Create: `src/types/motion.ts`
- Modify: `src/types/ai.ts`

- [ ] **Step 1: 创建 MotionCardPayload 类型**

Create `src/types/motion.ts`:

```typescript
/** Motion Card 专属数据 — AI 生成的 Remotion 动态动画组件 */
export interface MotionCardPayload {
  /** AI 生成的原始 JSX 源码 */
  sourceCode: string;
  /** Babel 编译后的 JS（React.createElement 形式） */
  compiledCode: string;
  /** 编译时间戳 */
  compiledAt: number;
  /** 编译错误信息（编译失败时存在） */
  compileError?: string;
  /** 用户的原始自然语言描述 */
  prompt: string;
  /** AI 自动修复重试次数 */
  retryCount: number;
}

/** Motion Card 生成状态 */
export type MotionCardStatus = 'generating' | 'compiling' | 'fixing' | 'ready' | 'error';

/** MotionCardService.generate() 入参 */
export interface MotionGenerateParams {
  prompt: string;
  durationMs?: number;
  displayMode?: 'fullscreen' | 'pip';
  canvasSize?: { width: number; height: number };
  assets?: MotionAssetInfo[];
}

/** MotionCardService.modify() 入参 */
export interface MotionModifyParams {
  sourceCode: string;
  instruction: string;
}

/** MotionCardService 返回结果 */
export interface MotionCardResult {
  success: boolean;
  sourceCode?: string;
  compiledCode?: string;
  error?: string;
  retryCount: number;
}

/** 编译结果 */
export interface MotionCompileResult {
  success: boolean;
  compiledCode?: string;
  error?: string;
}

/** 项目素材信息 */
export interface MotionAssetInfo {
  fileName: string;
  type: 'image' | 'video' | 'audio' | 'unknown';
}
```

- [ ] **Step 2: 扩展 AICardType 和 AICardRenderMode**

Modify `src/types/ai.ts` line 1:

```typescript
export type AICardType = 'summary' | 'data' | 'insight' | 'chapter' | 'quote' | 'motion';
```

Modify `src/types/ai.ts` line 3:

```typescript
export type AICardRenderMode = 'legacy' | 'web-card' | 'motion-card';
```

- [ ] **Step 3: 扩展 AICard 接口**

Modify `src/types/ai.ts`，在 `AICard` 接口（line 27-42）的 `webCard` 字段后新增：

```typescript
  motionCard?: MotionCardPayload;
```

在文件顶部新增 import:

```typescript
import type { MotionCardPayload } from './motion';
```

- [ ] **Step 4: 扩展 AICardOverlayData 接口**

Modify `src/types/ai.ts`，在 `AICardOverlayData` 接口（line 98-111）的 `webCard` 字段后新增：

```typescript
  motionCard?: MotionCardPayload;
```

- [ ] **Step 5: 更新 DEFAULT_CARD_STYLE 和辅助函数**

Modify `src/types/ai.ts`，在 `DEFAULT_CARD_STYLE`（line 122-128）中新增 motion 条目：

```typescript
  motion: { primaryColor: '#c084fc', backgroundColor: DEFAULT_CARD_BACKGROUND, fontSize: 48 },
```

Modify `isAICardType`（line 140-142），数组中新增 `'motion'`:

```typescript
export function isAICardType(value: unknown): value is AICardType {
  return ['summary', 'data', 'insight', 'chapter', 'quote', 'motion'].includes(String(value));
}
```

- [ ] **Step 6: 更新 buildAICardOverlayData 透传 motionCard**

Modify `src/types/ai.ts` `buildAICardOverlayData`（line 156-171），在返回对象中新增：

```typescript
    motionCard: card.motionCard,
```

- [ ] **Step 7: 运行类型检查**

```bash
npx tsc --noEmit
```

Expected: 无类型错误（现有代码中 `DEFAULT_CARD_STYLE[type]` 的使用会自动包含 motion）

- [ ] **Step 8: Commit**

```bash
git add src/types/motion.ts src/types/ai.ts
git commit -m "feat(types): 新增 MotionCardPayload 类型，扩展 AICard 支持 motion 类型"
```

---

## Task 3: 编译层 — motion-compiler

**Files:**
- Create: `src/lib/motion-compiler.ts`
- Create: `tests/motion-compiler.test.ts`

- [ ] **Step 1: 写失败测试 — 正常 JSX 编译**

Create `tests/motion-compiler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { compileMotionCode } from '../src/lib/motion-compiler';

describe('compileMotionCode', () => {
  it('should compile valid JSX to createElement calls', () => {
    const source = `const MotionComponent = ({ frame }) => {
      return React.createElement("div", null, "Hello ", frame);
    };`;
    const result = compileMotionCode(source);
    expect(result.success).toBe(true);
    expect(result.compiledCode).toBeDefined();
    expect(result.compiledCode).toContain('MotionComponent');
    expect(result.error).toBeUndefined();
  });

  it('should compile JSX syntax to createElement', () => {
    const source = `const MotionComponent = ({ frame }) => {
      return <div style={{ opacity: frame / 30 }}>Hello</div>;
    };`;
    const result = compileMotionCode(source);
    expect(result.success).toBe(true);
    expect(result.compiledCode).toContain('React.createElement');
  });

  it('should strip TypeScript type annotations', () => {
    const source = `const MotionComponent = ({ frame }: { frame: number }) => {
      const x: number = frame * 2;
      return <div>{x}</div>;
    };`;
    const result = compileMotionCode(source);
    expect(result.success).toBe(true);
    expect(result.compiledCode).not.toContain(': number');
  });

  it('should return error for syntax errors', () => {
    const source = `const MotionComponent = ({ frame }) => {
      return <div>unclosed
    };`;
    const result = compileMotionCode(source);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('line');
  });

  it('should return error for empty source', () => {
    const result = compileMotionCode('');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/motion-compiler.test.ts
```

Expected: FAIL — `Cannot find module '../src/lib/motion-compiler'`

- [ ] **Step 3: 实现 motion-compiler**

Create `src/lib/motion-compiler.ts`:

```typescript
import { transform } from '@babel/standalone';
import type { MotionCompileResult } from '../types/motion';

/**
 * 将 AI 生成的 JSX/TSX 源码编译为纯 JS（React.createElement 形式）。
 * 使用 @babel/standalone 的 preset-react（classic runtime）+ preset-typescript。
 */
export function compileMotionCode(sourceCode: string): MotionCompileResult {
  const trimmed = sourceCode.trim();
  if (!trimmed) {
    return { success: false, error: '源代码为空' };
  }

  try {
    const result = transform(trimmed, {
      presets: [
        ['react', { runtime: 'classic' }],
        ['typescript', { isTSX: true, allExtensions: true }],
      ],
      filename: 'MotionComponent.tsx',
      sourceType: 'script',
    });

    if (!result.code) {
      return { success: false, error: '编译结果为空' };
    }

    return { success: true, compiledCode: result.code };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Babel 错误通常包含行列信息，格式化为可读形式
    const formatted = formatBabelError(message);
    return { success: false, error: formatted };
  }
}

/** 格式化 Babel 错误，提取行号信息 */
function formatBabelError(message: string): string {
  // Babel 错误格式: "MotionComponent.tsx: ... (line:col)"
  const lineMatch = message.match(/\((\d+):(\d+)\)/);
  if (lineMatch) {
    return `编译错误 (line ${lineMatch[1]}, col ${lineMatch[2]}): ${message}`;
  }
  return `编译错误: ${message}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/motion-compiler.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/motion-compiler.ts tests/motion-compiler.test.ts
git commit -m "feat: 实现 motion-compiler 编译层（Babel JSX → JS）"
```

---

## Task 4: 执行层 — motion-runtime

**Files:**
- Create: `src/lib/motion-runtime.ts`
- Create: `tests/motion-runtime.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/motion-runtime.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createMotionComponent, SANDBOX_API_KEYS } from '../src/lib/motion-runtime';

describe('createMotionComponent', () => {
  it('should create a function from compiled code', () => {
    const compiled = `var MotionComponent = function(_ref) {
      var frame = _ref.frame;
      return React.createElement("div", null, "Frame: ", frame);
    };`;
    const result = createMotionComponent(compiled);
    expect(result.component).toBeDefined();
    expect(typeof result.component).toBe('function');
    expect(result.error).toBeUndefined();
  });

  it('should return error for code that does not define MotionComponent', () => {
    const compiled = `var SomeOtherThing = function() { return null; };`;
    const result = createMotionComponent(compiled);
    expect(result.component).toBeUndefined();
    expect(result.error).toContain('MotionComponent');
  });

  it('should return error for code with runtime errors', () => {
    const compiled = `throw new Error("intentional");
    var MotionComponent = function() { return null; };`;
    const result = createMotionComponent(compiled);
    expect(result.component).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it('should expose sandbox API keys', () => {
    expect(SANDBOX_API_KEYS).toContain('React');
    expect(SANDBOX_API_KEYS).toContain('interpolate');
    expect(SANDBOX_API_KEYS).toContain('spring');
    expect(SANDBOX_API_KEYS).toContain('AbsoluteFill');
    expect(SANDBOX_API_KEYS).toContain('useCurrentFrame');
    expect(SANDBOX_API_KEYS).toContain('noise2D');
    expect(SANDBOX_API_KEYS).toContain('TransitionSeries');
    expect(SANDBOX_API_KEYS).toContain('CameraMotionBlur');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/motion-runtime.test.ts
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 实现 motion-runtime**

Create `src/lib/motion-runtime.ts`:

```typescript
import React from 'react';
import {
  interpolate,
  interpolateColors,
  spring,
  Easing,
  random,
  useCurrentFrame,
  useVideoConfig,
  AbsoluteFill,
  Sequence,
  Series,
  Loop,
  Img,
  OffthreadVideo,
  Audio,
  IFrame,
  staticFile,
  delayRender,
  continueRender,
} from 'remotion';
import { noise2D, noise3D } from '@remotion/noise';
import {
  Circle, Rect, Triangle, Star, Pie, Ellipse,
  makeCircle, makeRect, makeTriangle, makeStar, makePie, makeEllipse,
} from '@remotion/shapes';
import {
  evolvePath, getPointAtLength, getLength, interpolatePath,
  getSubpaths, translatePath, scalePath, reversePath,
} from '@remotion/paths';
import {
  TransitionSeries, linearTiming, springTiming,
} from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { CameraMotionBlur } from '@remotion/motion-blur';

/** 沙箱注入的完整 API 映射 */
const SANDBOX: Record<string, unknown> = {
  // React
  React,

  // Remotion 核心动画
  interpolate,
  interpolateColors,
  spring,
  Easing,
  random,

  // Remotion Hooks
  useCurrentFrame,
  useVideoConfig,
  delayRender,
  continueRender,

  // Remotion 组件
  AbsoluteFill,
  Sequence,
  Series,
  Loop,
  Img,
  OffthreadVideo,
  Audio,
  IFrame,
  staticFile,

  // @remotion/noise
  noise2D,
  noise3D,

  // @remotion/shapes
  Circle, Rect, Triangle, Star, Pie, Ellipse,
  makeCircle, makeRect, makeTriangle, makeStar, makePie, makeEllipse,

  // @remotion/paths
  evolvePath, getPointAtLength, getLength, interpolatePath,
  getSubpaths, translatePath, scalePath, reversePath,

  // @remotion/transitions
  TransitionSeries, linearTiming, springTiming,
  fade, slide, wipe, flip, clockWipe,

  // @remotion/motion-blur
  CameraMotionBlur,
};

/** 沙箱 API 的 key 列表（用于测试验证） */
export const SANDBOX_API_KEYS = Object.keys(SANDBOX);

/** Prompt 构建层直接消费这份说明，避免在多个文件手写重复 API 清单 */
export const MOTION_SANDBOX_REFERENCE = `
- React: React
- Remotion Core: interpolate, interpolateColors, spring, Easing, random
- Remotion Hooks: useCurrentFrame, useVideoConfig, delayRender, continueRender
- Remotion Components: AbsoluteFill, Sequence, Series, Loop, Img, OffthreadVideo, Audio, IFrame, staticFile
- Noise / Shapes / Paths / Transitions / Motion Blur: 以安装后的真实导出为准
`.trim();

interface CreateMotionResult {
  component?: React.FC<MotionComponentProps>;
  error?: string;
}

export interface MotionComponentProps {
  frame: number;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
}

/**
 * 将编译后的 JS 代码转换为 React 组件实例。
 * 通过 new Function() 在沙箱中执行代码，注入 Remotion API。
 */
export function createMotionComponent(compiledCode: string): CreateMotionResult {
  const paramNames = Object.keys(SANDBOX);
  const paramValues = Object.values(SANDBOX);

  try {
    const factory = new Function(
      ...paramNames,
      `${compiledCode}\nif (typeof MotionComponent === 'undefined') throw new Error('代码中未定义 MotionComponent');\nreturn MotionComponent;`,
    );
    const component = factory(...paramValues) as React.FC<MotionComponentProps>;

    if (typeof component !== 'function') {
      return { error: 'MotionComponent 不是一个函数组件' };
    }

    return { component };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `运行时错误: ${message}` };
  }
}
```

**注意**:

- `motion-runtime.ts` 是 sandbox API 的唯一真相源
- `motion-prompt.ts` 不再复制粘贴一份独立 API 名单，而是直接消费 `SANDBOX_API_KEYS`
  和 `MOTION_SANDBOX_REFERENCE`
- 部分 `@remotion/shapes` / `@remotion/paths` / `@remotion/transitions` 的导出名可能与
  实际包不同，实现时以安装后的类型声明为准

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/motion-runtime.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/motion-runtime.ts tests/motion-runtime.test.ts
git commit -m "feat: 实现 motion-runtime 执行层（沙箱 API 注入 + 动态组件实例化）"
```

---

## Task 5: Prompt 构建 — motion-prompt

**Files:**
- Create: `src/lib/motion-prompt.ts`

- [ ] **Step 1: 实现 prompt 构建**

Create `src/lib/motion-prompt.ts`:

```typescript
import { MOTION_SANDBOX_REFERENCE, SANDBOX_API_KEYS } from './motion-runtime';
import type { MotionAssetInfo } from '../types/motion';

const COMPONENT_CONSTRAINTS = `## 代码约束（必须严格遵守）

1. 必须定义 \`const MotionComponent = (props) => { ... }\`
2. props 签名固定：\`{ frame, fps, durationInFrames, width, height }\`
3. 禁止使用 import/export 语句 — 所有 API 已从外部注入
4. 禁止使用 async/await — Remotion 逐帧渲染是同步的
5. 通过 \`React.\` 前缀使用 React hooks（如 \`React.useState\`、\`React.useMemo\`）
6. 画布尺寸为 1920×1080，组件应铺满整个画面
7. 只输出 JSX 代码，不要输出解释文字或 markdown 标记`;

const API_REFERENCE = `## 可用 API

以下 API 说明直接来自 motion-runtime.ts，避免与执行层脱节：

${MOTION_SANDBOX_REFERENCE}

## 示例

\`\`\`jsx
const MotionComponent = ({ frame, fps, durationInFrames, width, height }) => {
  const progress = frame / durationInFrames;
  const opacity = interpolate(progress, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);
  const scale = spring({ frame, fps, config: { damping: 12 } });

  return (
    <AbsoluteFill style={{ backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{
        opacity,
        transform: \`scale(\${scale})\`,
        fontSize: 72,
        color: '#ffffff',
        fontWeight: 'bold',
      }}>
        数据增长 320%
      </div>
    </AbsoluteFill>
  );
};
\`\`\``;

/** 构建生成 motion card 的 system prompt */
export function buildMotionSystemPrompt(): string {
  return `你是一个专业的 Remotion 动画组件生成器。你的任务是根据用户描述生成一个 React 动画组件。

${COMPONENT_CONSTRAINTS}

${API_REFERENCE}`;
}

/** 构建生成 motion card 的 user prompt */
export function buildMotionUserPrompt(params: {
  description: string;
  durationMs: number;
  canvasWidth: number;
  canvasHeight: number;
  assets: MotionAssetInfo[];
}): string {
  const { description, durationMs, canvasWidth, canvasHeight, assets } = params;
  const fps = 30;
  const durationInFrames = Math.round((durationMs / 1000) * fps);

  let prompt = `请生成一个动画组件：${description}

参数：
- 画布尺寸：${canvasWidth}×${canvasHeight}
- 动画时长：${durationMs}ms（${durationInFrames} 帧，${fps}fps）
- durationInFrames = ${durationInFrames}`;

  if (assets.length > 0) {
    prompt += `\n\n可用项目素材（仅作上下文辅助，本期不作为必过能力）：\n`;
    prompt += assets.map((a) => `- ${a.fileName} (${a.type})`).join('\n');
  }

  return prompt;
}

/** 构建修改指令的 user prompt */
export function buildMotionModifyPrompt(sourceCode: string, instruction: string): string {
  return `以下是当前动画组件代码：

\`\`\`jsx
${sourceCode}
\`\`\`

请根据以下指令修改，返回完整的修改后代码：
${instruction}`;
}

/** 构建自动修复的 user prompt */
export function buildMotionFixPrompt(sourceCode: string, error: string): string {
  return `以下动画组件代码出现错误：

\`\`\`jsx
${sourceCode}
\`\`\`

错误信息：
${error}

请修复代码中的错误，返回完整的修正后代码。只输出代码，不要解释。`;
}

/** 获取 API 参考文档（用于 MCP 外部工具） */
export function getMotionApiReference(): string {
  return `${COMPONENT_CONSTRAINTS}\n\n${API_REFERENCE}\n\n可用 API 标识符列表：\n${SANDBOX_API_KEYS.join(', ')}`;
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add src/lib/motion-prompt.ts
git commit -m "feat: 实现 motion-prompt 构建层（system/user/modify/fix prompt）"
```

---

## Task 6: 自动修复 — motion-auto-fix

**Files:**
- Create: `src/lib/motion-auto-fix.ts`
- Create: `tests/motion-auto-fix.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/motion-auto-fix.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { autoFixMotionCode, MAX_FIX_RETRIES } from '../src/lib/motion-auto-fix';

describe('autoFixMotionCode', () => {
  it('should return fixed code on first retry success', async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      '```jsx\nconst MotionComponent = ({ frame }) => {\n  return <div>{frame}</div>;\n};\n```',
    );

    const result = await autoFixMotionCode({
      sourceCode: 'broken code',
      error: 'SyntaxError at line 1',
      generateText: mockGenerate,
    });

    expect(result.success).toBe(true);
    expect(result.sourceCode).toContain('MotionComponent');
    expect(result.retryCount).toBe(1);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('should retry up to MAX_FIX_RETRIES times', async () => {
    const mockGenerate = vi.fn().mockResolvedValue('still broken {{{');

    const result = await autoFixMotionCode({
      sourceCode: 'broken code',
      error: 'SyntaxError',
      generateText: mockGenerate,
    });

    expect(result.success).toBe(false);
    expect(result.retryCount).toBe(MAX_FIX_RETRIES);
    expect(mockGenerate).toHaveBeenCalledTimes(MAX_FIX_RETRIES);
  });

  it('should expose MAX_FIX_RETRIES as 3', () => {
    expect(MAX_FIX_RETRIES).toBe(3);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/motion-auto-fix.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 motion-auto-fix**

Create `src/lib/motion-auto-fix.ts`:

```typescript
import { compileMotionCode } from './motion-compiler';
import { buildMotionFixPrompt, buildMotionSystemPrompt } from './motion-prompt';
import type { MotionCardResult } from '../types/motion';

export const MAX_FIX_RETRIES = 3;

/** 从 LLM 返回的文本中提取代码块 */
function extractCodeFromResponse(response: string): string {
  // 尝试提取 ```jsx ... ``` 或 ```tsx ... ``` 或 ``` ... ``` 代码块
  const codeBlockMatch = response.match(/```(?:jsx|tsx|javascript|js)?\s*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 如果没有代码块标记，直接返回去掉首尾空白的内容
  return response.trim();
}

interface AutoFixParams {
  sourceCode: string;
  error: string;
  generateText: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

/**
 * 自动修复 motion card 代码。
 * 将错误信息回传给 LLM，最多重试 MAX_FIX_RETRIES 次。
 */
export async function autoFixMotionCode(params: AutoFixParams): Promise<MotionCardResult> {
  const { sourceCode, error, generateText } = params;
  const systemPrompt = buildMotionSystemPrompt();

  let currentSource = sourceCode;
  let currentError = error;

  for (let attempt = 1; attempt <= MAX_FIX_RETRIES; attempt++) {
    const userPrompt = buildMotionFixPrompt(currentSource, currentError);

    let response: string;
    try {
      response = await generateText(systemPrompt, userPrompt);
    } catch (err) {
      return {
        success: false,
        error: `修复请求失败: ${err instanceof Error ? err.message : String(err)}`,
        retryCount: attempt,
      };
    }

    const fixedSource = extractCodeFromResponse(response);
    const compileResult = compileMotionCode(fixedSource);

    if (compileResult.success) {
      return {
        success: true,
        sourceCode: fixedSource,
        compiledCode: compileResult.compiledCode,
        retryCount: attempt,
      };
    }

    // 编译仍失败，用新的错误继续下一轮
    currentSource = fixedSource;
    currentError = compileResult.error!;
  }

  return {
    success: false,
    error: `经过 ${MAX_FIX_RETRIES} 次自动修复仍未成功。最后的错误: ${currentError}`,
    retryCount: MAX_FIX_RETRIES,
  };
}

export { extractCodeFromResponse };
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/motion-auto-fix.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/motion-auto-fix.ts tests/motion-auto-fix.test.ts
git commit -m "feat: 实现 motion-auto-fix 自动修复层（LLM 重试 ≤3 次）"
```

---

## Task 7: 服务层 — motion-card-service

**Files:**
- Create: `src/lib/motion-card-service.ts`
- Create: `tests/motion-card-service.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/motion-card-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MotionCardService } from '../src/lib/motion-card-service';

describe('MotionCardService', () => {
  let service: MotionCardService;
  let mockGenerateText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGenerateText = vi.fn();
    service = new MotionCardService(mockGenerateText);
  });

  describe('generate', () => {
    it('should return compiled code on success', async () => {
      mockGenerateText.mockResolvedValue(
        '```jsx\nconst MotionComponent = ({ frame }) => {\n  return <div>{frame}</div>;\n};\n```',
      );

      const result = await service.generate({ prompt: '一个淡入的文字动画' });

      expect(result.success).toBe(true);
      expect(result.sourceCode).toContain('MotionComponent');
      expect(result.compiledCode).toBeDefined();
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it('should auto-fix on compile error', async () => {
      // 第一次返回有语法错误的代码，第二次返回正确的
      mockGenerateText
        .mockResolvedValueOnce('broken code {{{')
        .mockResolvedValueOnce(
          '```jsx\nconst MotionComponent = ({ frame }) => {\n  return <div>{frame}</div>;\n};\n```',
        );

      const result = await service.generate({ prompt: '一个动画' });

      expect(result.success).toBe(true);
      // 初始生成 1 次 + 修复 1 次
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });
  });

  describe('modify', () => {
    it('should return modified code on success', async () => {
      mockGenerateText.mockResolvedValue(
        '```jsx\nconst MotionComponent = ({ frame }) => {\n  return <div style={{color:"blue"}}>{frame}</div>;\n};\n```',
      );

      const result = await service.modify({
        sourceCode: 'const MotionComponent = ({ frame }) => <div>{frame}</div>;',
        instruction: '把颜色改成蓝色',
      });

      expect(result.success).toBe(true);
      expect(result.sourceCode).toContain('blue');
    });
  });

  describe('compile', () => {
    it('should compile valid JSX', () => {
      const result = service.compile({
        sourceCode: 'const MotionComponent = ({ frame }) => React.createElement("div", null, frame);',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getApiReference', () => {
    it('should return non-empty string', () => {
      const ref = service.getApiReference();
      expect(ref.length).toBeGreaterThan(100);
      expect(ref).toContain('interpolate');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/motion-card-service.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 motion-card-service**

Create `src/lib/motion-card-service.ts`:

```typescript
import { compileMotionCode } from './motion-compiler';
import { autoFixMotionCode, extractCodeFromResponse } from './motion-auto-fix';
import {
  buildMotionSystemPrompt,
  buildMotionUserPrompt,
  buildMotionModifyPrompt,
  getMotionApiReference,
} from './motion-prompt';
import type {
  MotionCardResult,
  MotionCompileResult,
  MotionGenerateParams,
  MotionModifyParams,
  MotionAssetInfo,
} from '../types/motion';

type GenerateTextFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

/**
 * Motion Card 服务层。
 * 统一封装 generate/modify/compile 逻辑，UI 和 MCP 共用。
 */
export class MotionCardService {
  private generateText: GenerateTextFn;

  constructor(generateText: GenerateTextFn) {
    this.generateText = generateText;
  }

  /** 根据自然语言描述生成 motion card */
  async generate(params: MotionGenerateParams): Promise<MotionCardResult> {
    const {
      prompt,
      durationMs = 5000,
      canvasSize = { width: 1920, height: 1080 },
      assets = [],
    } = params;

    const systemPrompt = buildMotionSystemPrompt();
    const userPrompt = buildMotionUserPrompt({
      description: prompt,
      durationMs,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      assets,
    });

    let response: string;
    try {
      response = await this.generateText(systemPrompt, userPrompt);
    } catch (err) {
      return {
        success: false,
        error: `生成请求失败: ${err instanceof Error ? err.message : String(err)}`,
        retryCount: 0,
      };
    }

    const sourceCode = extractCodeFromResponse(response);
    const compileResult = compileMotionCode(sourceCode);

    if (compileResult.success) {
      return {
        success: true,
        sourceCode,
        compiledCode: compileResult.compiledCode,
        retryCount: 0,
      };
    }

    // 编译失败，尝试自动修复
    return autoFixMotionCode({
      sourceCode,
      error: compileResult.error!,
      generateText: this.generateText,
    });
  }

  /** 基于现有代码 + 修改指令生成新版本 */
  async modify(params: MotionModifyParams): Promise<MotionCardResult> {
    const { sourceCode, instruction } = params;
    const systemPrompt = buildMotionSystemPrompt();
    const userPrompt = buildMotionModifyPrompt(sourceCode, instruction);

    let response: string;
    try {
      response = await this.generateText(systemPrompt, userPrompt);
    } catch (err) {
      return {
        success: false,
        error: `修改请求失败: ${err instanceof Error ? err.message : String(err)}`,
        retryCount: 0,
      };
    }

    const newSource = extractCodeFromResponse(response);
    const compileResult = compileMotionCode(newSource);

    if (compileResult.success) {
      return {
        success: true,
        sourceCode: newSource,
        compiledCode: compileResult.compiledCode,
        retryCount: 0,
      };
    }

    return autoFixMotionCode({
      sourceCode: newSource,
      error: compileResult.error!,
      generateText: this.generateText,
    });
  }

  /** 编译 JSX 源码（纯编译，不涉及 LLM） */
  compile(params: { sourceCode: string }): MotionCompileResult {
    return compileMotionCode(params.sourceCode);
  }

  /** 获取可用 Remotion API 参考文档 */
  getApiReference(): string {
    return getMotionApiReference();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/motion-card-service.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/motion-card-service.ts tests/motion-card-service.test.ts
git commit -m "feat: 实现 MotionCardService 服务层（generate/modify/compile + MCP 预留）"
```

---

## Task 8: Remotion 渲染组件 — MotionCardOverlay

**Files:**
- Create: `src/remotion/MotionCardOverlay.tsx`
- Create: `tests/motion-card-overlay.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `tests/motion-card-overlay.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import React from 'react';
import { MotionCardOverlay, MotionErrorFallback } from '../src/remotion/MotionCardOverlay';
import type { MotionCardPayload } from '../src/types/motion';

describe('MotionCardOverlay', () => {
  it('should export MotionCardOverlay component', () => {
    expect(typeof MotionCardOverlay).toBe('function');
  });

  it('should export MotionErrorFallback component', () => {
    expect(typeof MotionErrorFallback).toBe('function');
  });
});

describe('MotionErrorFallback', () => {
  it('should render error message', () => {
    // MotionErrorFallback 是一个纯 React 组件，可以在 Node 中验证导出
    const element = React.createElement(MotionErrorFallback, {
      error: '测试错误',
      width: 1920,
      height: 1080,
    });
    expect(element).toBeDefined();
    expect(element.props.error).toBe('测试错误');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/motion-card-overlay.test.tsx
```

Expected: FAIL

- [ ] **Step 3: 实现 MotionCardOverlay**

Create `src/remotion/MotionCardOverlay.tsx`:

```typescript
import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { createMotionComponent, type MotionComponentProps } from '../lib/motion-runtime';
import type { MotionCardPayload } from '../types/motion';

interface MotionCardOverlayProps {
  motionCard: MotionCardPayload;
}

/** 错误占位卡片 */
export function MotionErrorFallback({
  error,
  width,
  height,
}: {
  error: string;
  width: number;
  height: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1C1C1E',
        color: '#EBEBF599',
        fontFamily: 'SF Pro Text, PingFang SC, -apple-system, sans-serif',
        fontSize: 24,
        gap: 16,
      }}
    >
      <span style={{ fontSize: 48 }}>⚠️</span>
      <span>动画渲染失败</span>
      <span style={{ fontSize: 16, maxWidth: '60%', textAlign: 'center', opacity: 0.6 }}>
        {error}
      </span>
    </div>
  );
}

/** ErrorBoundary 用于捕获动态组件的运行时渲染错误 */
class MotionErrorBoundary extends React.Component<
  { children: React.ReactNode; width: number; height: number; onError?: (error: string) => void },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error.message);
  }

  render() {
    if (this.state.error) {
      return (
        <MotionErrorFallback
          error={this.state.error}
          width={this.props.width}
          height={this.props.height}
        />
      );
    }
    return this.props.children;
  }
}

/** 动态 Remotion 组件渲染器 */
export function MotionCardOverlay({ motionCard }: MotionCardOverlayProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  // 缓存组件实例 — compiledCode 不变时不重新 new Function()
  const dynamicResult = useMemo(
    () => createMotionComponent(motionCard.compiledCode),
    [motionCard.compiledCode],
  );

  if (!dynamicResult.component) {
    return (
      <MotionErrorFallback
        error={dynamicResult.error ?? '组件实例化失败'}
        width={width}
        height={height}
      />
    );
  }

  const DynamicComponent = dynamicResult.component;
  const props: MotionComponentProps = { frame, fps, durationInFrames, width, height };

  return (
    <MotionErrorBoundary width={width} height={height}>
      <DynamicComponent {...props} />
    </MotionErrorBoundary>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/motion-card-overlay.test.tsx
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/remotion/MotionCardOverlay.tsx tests/motion-card-overlay.test.tsx
git commit -m "feat: 实现 MotionCardOverlay Remotion 渲染组件（ErrorBoundary + 动态执行）"
```

---

## Task 9: AICardOverlay 派发集成 + normalizeCard 兼容

**Files:**
- Modify: `src/remotion/AICardOverlay.tsx`
- Modify: `src/lib/ai-analysis.ts`

- [ ] **Step 1: 在 AICardOverlay 中新增 motion-card 分支**

Modify `src/remotion/AICardOverlay.tsx`，在顶部 import 区新增：

```typescript
import { MotionCardOverlay } from './MotionCardOverlay';
```

在 `renderCard` 函数（line 27-64）中，在 web-card 判断之前插入 motion-card 分支：

```typescript
function renderCard(overlay: OverlayItem, chapterIndex: number) {
  const data = overlay.aiCardData;
  if (!data) {
    return null;
  }

  if (data.renderMode === 'motion-card' && data.motionCard?.compiledCode) {
    return <MotionCardOverlay motionCard={data.motionCard} />;
  }

  if (data.renderMode === 'web-card' && hasWebCardSource(data.webCard)) {
    return <WebCardOverlay webCard={data.webCard!} />;
  }

  // ... 其余 card type 分支不变
```

同时在 `AICardOverlay` 组件（line 66-105）中，将 `isWebCard` 判断扩展为包含 motion-card：

```typescript
  const isMotionCard =
    overlay.aiCardData.renderMode === 'motion-card' && !!overlay.aiCardData.motionCard?.compiledCode;
  const isWebCard =
    overlay.aiCardData.renderMode === 'web-card' && hasWebCardSource(overlay.aiCardData.webCard);
  const isSpecialCard = isMotionCard || isWebCard;
```

将 `contentStyle` 的 `isWebCard` 条件替换为 `isSpecialCard`：

```typescript
  const contentStyle: CSSProperties = isSpecialCard
    ? { width: '100%', height: '100%' }
    : isFullscreen
      ? {}
      : { transform: `scale(${scale})`, transformOrigin: 'top left' };
```

- [ ] **Step 2: 在 normalizeCard 中兼容 motion 类型**

Modify `src/lib/ai-analysis.ts` `normalizeCard` 函数（around line 89-135），在 `renderMode` 判断处新增 motion-card 逻辑：

```typescript
  const renderMode =
    candidate.renderMode === 'motion-card'
      ? 'motion-card'
      : candidate.renderMode === 'web-card' || webCard
        ? 'web-card'
        : 'legacy';
```

在 return 对象中新增 `motionCard` 字段透传：

```typescript
    motionCard: candidate.renderMode === 'motion-card' && candidate.motionCard
      ? candidate.motionCard as MotionCardPayload
      : undefined,
```

在文件顶部新增 import：

```typescript
import type { MotionCardPayload } from '../types/motion';
```

- [ ] **Step 3: 运行类型检查和现有测试**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 类型检查通过，现有测试无回归

- [ ] **Step 4: Commit**

```bash
git add src/remotion/AICardOverlay.tsx src/lib/ai-analysis.ts
git commit -m "feat: AICardOverlay 集成 motion-card 派发 + normalizeCard 兼容 motion 类型"
```

---

## Task 10: AI Store + 持久化扩展

**Files:**
- Modify: `src/store/ai.ts`
- Modify: `src/lib/ai-persistence.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/Editor.tsx`

- [ ] **Step 1: 扩展 AITab、Store 接口与 clearAnalysis**

Modify `src/store/ai.ts`：

将 `AITab` 类型扩展为：

```typescript
export type AITab = 'cards' | 'cover' | 'motion';
```

在 `AIStore` 接口中新增 motion card 状态与 actions：

```typescript
motionCards: AICard[];
isGeneratingMotion: boolean;
motionError: string | null;
addMotionCard: (card: AICard) => void;
updateMotionCard: (cardId: string, updates: Partial<AICard>) => void;
removeMotionCard: (cardId: string) => void;
setGeneratingMotion: (generating: boolean) => void;
setMotionError: (error: string | null) => void;
```

同时要求：

- `clearAnalysis()` 必须同时清空 `motionCards` / `motionError` / `isGeneratingMotion`
- auto-save subscription 监听 `motionCards` 变化，一并写回工程文件

- [ ] **Step 2: 扩展 PersistedAIState 与类型守卫**

Modify `src/lib/ai-persistence.ts`：

```typescript
export interface PersistedAIState {
  version: 1;
  analysisResult: AIAnalysisResult | null;
  coverCandidates: CoverCandidate[];
  motionCards: AICard[];
}
```

同时更新：

- `isAICard()` 支持 `renderMode: 'motion-card'`
- `isAICard()` 校验 `motionCard?: MotionCardPayload`
- `createPersistedAIState()` 接受并返回 `motionCards`
- `parsePersistedAIState()` 在旧工程缺少 `motionCards` 时回退为 `[]`

- [ ] **Step 3: 接通项目打开 / 清空 / 重分析生命周期**

Modify `src/App.tsx` 和 `src/pages/Editor.tsx`：

- `openProject()` 从 `projectData.aiAnalysis.motionCards` 恢复 motion cards
- `resetToSetup()` / `invalidateAIAnalysis()` / 替换字幕触发的重分析流程中，不留脏的
  motionCards 状态
- `Editor.tsx` 内部的 `persistAIState()` 在保存普通 AI 分析结果时，必须保留当前
  `motionCards`，避免重分析把 motion 数据覆盖掉

- [ ] **Step 4: 运行类型检查**

```bash
npx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add src/store/ai.ts src/lib/ai-persistence.ts src/App.tsx src/pages/Editor.tsx
git commit -m "feat: 扩展 AI store 与工程持久化，支持 motion cards 生命周期"
```

---

## Task 11: MotionPanel UI 组件

**Files:**
- Create: `src/components/MotionPanel.tsx`
- Create: `src/components/MotionPanel.module.css`
- Create: `src/components/MotionCardItem.tsx`
- Create: `src/components/MotionCardItem.module.css`

- [ ] **Step 1: 创建 MotionCardItem 组件**

Create `src/components/MotionCardItem.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 4px);
  padding: var(--space-3, 6px) var(--space-4, 8px);
  border-radius: var(--radius-md, 6px);
  background: var(--color-panel-elevated, #2C2C2E);
  cursor: pointer;
  transition: background 0.15s ease;
}

.root:hover {
  background: var(--color-separator, #38383A);
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-3, 6px);
}

.checkbox {
  flex-shrink: 0;
}

.badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--radius-pill, 999px);
  font-size: var(--font-size-xs, 10px);
  font-weight: 500;
  color: #fff;
}

.badgeReady {
  background: #c084fc;
}

.badgeGenerating {
  background: #c084fc80;
}

.badgeError {
  background: var(--color-danger, #FF453A);
}

.title {
  flex: 1;
  font-size: var(--font-size-sm, 11px);
  color: var(--color-text-primary, #FFFFFF);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--space-3, 6px);
  font-size: var(--font-size-xs, 10px);
  color: var(--color-text-secondary, #EBEBF599);
}

.actions {
  display: flex;
  gap: var(--space-2, 4px);
  margin-left: auto;
}
```

Create `src/components/MotionCardItem.tsx`:

```tsx
import { useState } from 'react';
import type { AICard } from '../types/ai';
import type { MotionCardStatus } from '../types/motion';
import { Button, Checkbox, Input } from '../ui';
import { AppIcon } from './AppIcon';
import styles from './MotionCardItem.module.css';

interface MotionCardItemProps {
  card: AICard;
  status: MotionCardStatus;
  onToggleEnabled: (cardId: string) => void;
  onModify: (cardId: string, instruction: string) => void;
  onDelete: (cardId: string) => void;
  onClick: (cardId: string) => void;
}

function statusLabel(status: MotionCardStatus): string {
  switch (status) {
    case 'generating': return '生成中';
    case 'compiling': return '编译中';
    case 'fixing': return '修复中';
    case 'ready': return '就绪';
    case 'error': return '错误';
  }
}

function badgeClass(status: MotionCardStatus): string {
  if (status === 'ready') return styles.badgeReady;
  if (status === 'error') return styles.badgeError;
  return styles.badgeGenerating;
}

export function MotionCardItem({
  card,
  status,
  onToggleEnabled,
  onModify,
  onDelete,
  onClick,
}: MotionCardItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [instruction, setInstruction] = useState('');

  const handleSubmitModify = () => {
    if (instruction.trim()) {
      onModify(card.id, instruction.trim());
      setInstruction('');
      setIsEditing(false);
    }
  };

  const durationLabel = `${(card.displayDurationMs / 1000).toFixed(1)}s`;

  return (
    <div className={styles.root} onClick={() => onClick(card.id)}>
      <div className={styles.header}>
        <Checkbox
          className={styles.checkbox}
          checked={card.enabled}
          onChange={(e) => {
            e.stopPropagation();
            onToggleEnabled(card.id);
          }}
        />
        <span className={`${styles.badge} ${badgeClass(status)}`}>
          {statusLabel(status)}
        </span>
        <span className={styles.title}>{card.title}</span>
      </div>

      <div className={styles.meta}>
        <span>{durationLabel}</span>
        <span>{card.displayMode === 'fullscreen' ? '全屏' : 'PiP'}</span>
        <div className={styles.actions}>
          <Button.Icon
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(!isEditing);
            }}
            aria-label="修改"
            disabled={status !== 'ready'}
          >
            <AppIcon name="pencil" size={12} />
          </Button.Icon>
          <Button.Icon
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(card.id);
            }}
            aria-label="删除"
          >
            <AppIcon name="trash-2" size={12} />
          </Button.Icon>
        </div>
      </div>

      {isEditing ? (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <Input
            size="sm"
            placeholder="输入修改指令..."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitModify()}
            onClick={(e) => e.stopPropagation()}
          />
          <Button size="sm" variant="primary" onClick={handleSubmitModify}>
            确定
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: 创建 MotionPanel 主组件**

Create `src/components/MotionPanel.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.promptSection {
  flex-shrink: 0;
  padding: var(--space-4, 8px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 6px);
}

.promptLabel {
  font-size: var(--font-size-sm, 11px);
  color: var(--color-text-secondary, #EBEBF599);
  font-weight: 500;
}

.promptRow {
  display: flex;
  gap: var(--space-2, 4px);
}

.optionsRow {
  display: flex;
  gap: var(--space-3, 6px);
  align-items: center;
}

.optionLabel {
  font-size: var(--font-size-xs, 10px);
  color: var(--color-text-secondary, #EBEBF599);
}

.cardList {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3, 6px) var(--space-4, 8px);
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 4px);
}

.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8, 32px) var(--space-4, 8px);
  color: var(--color-text-secondary, #EBEBF599);
  font-size: var(--font-size-sm, 11px);
  text-align: center;
  gap: var(--space-3, 6px);
}

.footer {
  flex-shrink: 0;
  padding: var(--space-3, 6px) var(--space-4, 8px);
  border-top: 1px solid var(--color-separator, #38383A);
}

.footerButton {
  width: 100%;
}

.errorWrap {
  padding: 0 var(--space-4, 8px);
}
```

Create `src/components/MotionPanel.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useAIStore, loadAISettings } from '../store/ai';
import { useTimelineStore } from '../store/timeline';
import { getAISettingsIssue } from '../lib/ai-settings';
import { MotionCardService } from '../lib/motion-card-service';
import { generateText } from '../lib/llm';
import {
  buildAICardTimelineDraft,
  getDefaultCardStyle,
  type AICard,
} from '../types/ai';
import type { MotionCardPayload, MotionCardStatus } from '../types/motion';
import { Alert, Button, Input, Select, Spinner, Textarea } from '../ui';
import { AppIcon } from './AppIcon';
import { MotionCardItem } from './MotionCardItem';
import styles from './MotionPanel.module.css';

interface MotionPanelProps {
  onOpenCardInspector?: (cardId: string) => void;
  onOpenSettings?: () => void;
}

/** 获取 motion card 的运行时状态 */
function getCardStatus(card: AICard): MotionCardStatus {
  if (!card.motionCard) return 'error';
  if (card.motionCard.compileError) return 'error';
  if (card.motionCard.compiledCode) return 'ready';
  return 'generating';
}

export function MotionPanel({ onOpenCardInspector, onOpenSettings }: MotionPanelProps) {
  const {
    motionCards,
    isGeneratingMotion,
    motionError,
    addMotionCard,
    updateMotionCard,
    removeMotionCard,
    setGeneratingMotion,
    setMotionError,
  } = useAIStore();
  const { addAICardsToTimeline } = useTimelineStore();

  const [prompt, setPrompt] = useState('');
  const [durationMs, setDurationMs] = useState(5000);
  const [displayMode, setDisplayMode] = useState<'fullscreen' | 'pip'>('fullscreen');

  // 运行时状态：正在生成/修改中的 card id → status
  const [cardStatuses, setCardStatuses] = useState<Record<string, MotionCardStatus>>({});

  const setCardStatus = (cardId: string, status: MotionCardStatus) => {
    setCardStatuses((prev) => ({ ...prev, [cardId]: status }));
  };

  const clearCardStatus = (cardId: string) => {
    setCardStatuses((prev) => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    const settings = await loadAISettings();
    const issue = getAISettingsIssue(settings);
    if (issue || !settings) {
      setMotionError(issue ?? '请先完成 AI 配置');
      onOpenSettings?.();
      return;
    }

    // 创建占位卡片
    const cardId = `motion-${uuid()}`;
    const placeholderCard: AICard = {
      id: cardId,
      type: 'motion',
      title: prompt.trim().slice(0, 30) || '动画',
      content: prompt.trim(),
      startMs: 0,
      endMs: durationMs,
      displayDurationMs: durationMs,
      displayMode,
      template: 'motion-default',
      enabled: true,
      style: getDefaultCardStyle('motion'),
      renderMode: 'motion-card',
      motionCard: {
        sourceCode: '',
        compiledCode: '',
        compiledAt: 0,
        prompt: prompt.trim(),
        retryCount: 0,
      },
    };

    addMotionCard(placeholderCard);
    setCardStatus(cardId, 'generating');
    setGeneratingMotion(true);
    setMotionError(null);

    try {
      const service = new MotionCardService(
        (sys, usr) => generateText(settings, sys, usr),
      );

      const result = await service.generate({
        prompt: prompt.trim(),
        durationMs,
        displayMode,
      });

      if (result.success) {
        const motionCard: MotionCardPayload = {
          sourceCode: result.sourceCode!,
          compiledCode: result.compiledCode!,
          compiledAt: Date.now(),
          prompt: prompt.trim(),
          retryCount: result.retryCount,
        };
        updateMotionCard(cardId, { motionCard });
        setCardStatus(cardId, 'ready');
      } else {
        const motionCard: MotionCardPayload = {
          sourceCode: result.sourceCode ?? '',
          compiledCode: '',
          compiledAt: Date.now(),
          compileError: result.error,
          prompt: prompt.trim(),
          retryCount: result.retryCount,
        };
        updateMotionCard(cardId, { motionCard });
        setCardStatus(cardId, 'error');
      }
    } catch (err) {
      setMotionError(err instanceof Error ? err.message : '生成失败');
      setCardStatus(cardId, 'error');
    } finally {
      setGeneratingMotion(false);
      setPrompt('');
    }
  }, [prompt, durationMs, displayMode, addMotionCard, updateMotionCard, setGeneratingMotion, setMotionError, onOpenSettings]);

  const handleModify = useCallback(async (cardId: string, instruction: string) => {
    const card = motionCards.find((c) => c.id === cardId);
    if (!card?.motionCard?.sourceCode) return;

    const settings = await loadAISettings();
    if (!settings) return;

    setCardStatus(cardId, 'fixing');

    try {
      const service = new MotionCardService(
        (sys, usr) => generateText(settings, sys, usr),
      );

      const result = await service.modify({
        sourceCode: card.motionCard.sourceCode,
        instruction,
      });

      if (result.success) {
        const motionCard: MotionCardPayload = {
          sourceCode: result.sourceCode!,
          compiledCode: result.compiledCode!,
          compiledAt: Date.now(),
          prompt: card.motionCard.prompt,
          retryCount: result.retryCount,
        };
        updateMotionCard(cardId, { motionCard });
        setCardStatus(cardId, 'ready');
      } else {
        setCardStatus(cardId, 'error');
        updateMotionCard(cardId, {
          motionCard: { ...card.motionCard, compileError: result.error },
        });
      }
    } catch {
      setCardStatus(cardId, 'error');
    }
  }, [motionCards, updateMotionCard]);

  const handleDelete = useCallback((cardId: string) => {
    removeMotionCard(cardId);
    clearCardStatus(cardId);
  }, [removeMotionCard]);

  const handleToggleEnabled = useCallback((cardId: string) => {
    const card = motionCards.find((c) => c.id === cardId);
    if (card) {
      updateMotionCard(cardId, { enabled: !card.enabled });
    }
  }, [motionCards, updateMotionCard]);

  const handleApplyToTimeline = useCallback(() => {
    const enabledCards = motionCards.filter(
      (c) => c.enabled && c.motionCard?.compiledCode,
    );
    if (enabledCards.length === 0) return;
    addAICardsToTimeline(enabledCards.map(buildAICardTimelineDraft));
  }, [motionCards, addAICardsToTimeline]);

  const enabledReadyCount = motionCards.filter(
    (c) => c.enabled && c.motionCard?.compiledCode,
  ).length;

  return (
    <div className={styles.root}>
      <section className={styles.promptSection}>
        <label className={styles.promptLabel}>描述动画效果</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：一个从左侧飞入的柱状图，数据从 0 增长到最终值，持续 3 秒..."
          rows={3}
          size="sm"
          resize="none"
        />
        <div className={styles.optionsRow}>
          <span className={styles.optionLabel}>时长</span>
          <Input
            size="sm"
            type="number"
            value={String(durationMs / 1000)}
            onChange={(e) => setDurationMs(Math.max(1000, Number(e.target.value) * 1000))}
            style={{ width: 60 }}
          />
          <span className={styles.optionLabel}>秒</span>
          <span className={styles.optionLabel} style={{ marginLeft: 8 }}>模式</span>
          <Select
            size="sm"
            value={displayMode}
            onChange={(value) => setDisplayMode(value as 'fullscreen' | 'pip')}
            options={[
              { value: 'fullscreen', label: '全屏' },
              { value: 'pip', label: 'PiP' },
            ]}
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={!prompt.trim() || isGeneratingMotion}
        >
          {isGeneratingMotion ? (
            <>
              <Spinner size={12} color="#FFFFFF" />
              生成中...
            </>
          ) : (
            <>
              <AppIcon name="sparkles" size={14} />
              生成动画
            </>
          )}
        </Button>
      </section>

      {motionError ? (
        <div className={styles.errorWrap}>
          <Alert variant="destructive">{motionError}</Alert>
        </div>
      ) : null}

      <div className={styles.cardList}>
        {motionCards.length === 0 ? (
          <div className={styles.emptyState}>
            <AppIcon name="film" size={24} />
            <span>还没有动画卡片</span>
            <span>在上方描述你想要的动画效果，AI 会为你生成 Remotion 动画组件</span>
          </div>
        ) : (
          motionCards.map((card) => (
            <MotionCardItem
              key={card.id}
              card={card}
              status={cardStatuses[card.id] ?? getCardStatus(card)}
              onToggleEnabled={handleToggleEnabled}
              onModify={handleModify}
              onDelete={handleDelete}
              onClick={(id) => onOpenCardInspector?.(id)}
            />
          ))
        )}
      </div>

      {motionCards.length > 0 ? (
        <div className={styles.footer}>
          <Button
            variant="primary"
            size="sm"
            className={styles.footerButton}
            onClick={handleApplyToTimeline}
            disabled={enabledReadyCount === 0}
          >
            <AppIcon name="arrow-up-to-line" size={14} />
            <span>上轨 {enabledReadyCount}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit
```

Expected: 无类型错误（如 Select 组件的 `onChange` 签名不同，根据实际组件库 API 调整）

- [ ] **Step 4: Commit**

```bash
git add src/components/MotionPanel.tsx src/components/MotionPanel.module.css src/components/MotionCardItem.tsx src/components/MotionCardItem.module.css
git commit -m "feat: 实现 MotionPanel 和 MotionCardItem UI 组件"
```

---

## Task 12: MotionCardInspector + Inspector 路由集成

**Files:**
- Create: `src/components/MotionCardInspector.tsx`
- Create: `src/components/MotionCardInspector.module.css`
- Modify: `src/components/EditorInspector.tsx`
- Modify: `src/pages/Editor.tsx`

- [ ] **Step 1: 创建 MotionCardInspector**

Create `src/components/MotionCardInspector.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 8px);
  padding: var(--space-4, 8px);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 4px);
}

.fieldLabel {
  font-size: var(--font-size-xs, 10px);
  color: var(--color-text-secondary, #EBEBF599);
  font-weight: 500;
  text-transform: uppercase;
}

.fieldValue {
  font-size: var(--font-size-sm, 11px);
  color: var(--color-text-primary, #FFFFFF);
}

.promptText {
  font-size: var(--font-size-sm, 11px);
  color: var(--color-text-primary, #FFFFFF);
  line-height: 1.5;
  white-space: pre-wrap;
}

.statusBadge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2, 4px);
  padding: 2px 8px;
  border-radius: var(--radius-pill, 999px);
  font-size: var(--font-size-xs, 10px);
  font-weight: 500;
  color: #fff;
  background: #c084fc;
}

.statusError {
  background: var(--color-danger, #FF453A);
}

.errorText {
  font-size: var(--font-size-xs, 10px);
  color: var(--color-danger, #FF453A);
  line-height: 1.4;
  white-space: pre-wrap;
}

.actions {
  display: flex;
  gap: var(--space-2, 4px);
}
```

Create `src/components/MotionCardInspector.tsx`:

```tsx
import type { AICard } from '../types/ai';
import { Button } from '../ui';
import { AppIcon } from './AppIcon';
import styles from './MotionCardInspector.module.css';

interface MotionCardInspectorProps {
  card: AICard;
  onDelete: () => void;
}

export function MotionCardInspector({ card, onDelete }: MotionCardInspectorProps) {
  const mc = card.motionCard;
  const hasError = !!mc?.compileError;
  const isReady = !!mc?.compiledCode && !hasError;

  return (
    <div className={styles.root}>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>状态</span>
        <span className={`${styles.statusBadge} ${hasError ? styles.statusError : ''}`}>
          {hasError ? '错误' : isReady ? '就绪' : '生成中'}
        </span>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>描述</span>
        <span className={styles.promptText}>{mc?.prompt ?? card.title}</span>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>时长</span>
        <span className={styles.fieldValue}>{(card.displayDurationMs / 1000).toFixed(1)}s</span>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>显示模式</span>
        <span className={styles.fieldValue}>
          {card.displayMode === 'fullscreen' ? '全屏' : 'PiP'}
        </span>
      </div>

      {mc?.retryCount ? (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>自动修复次数</span>
          <span className={styles.fieldValue}>{mc.retryCount}</span>
        </div>
      ) : null}

      {hasError ? (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>错误详情</span>
          <span className={styles.errorText}>{mc.compileError}</span>
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <AppIcon name="trash-2" size={12} />
          删除
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 EditorInspector 中集成 motion card 处理**

Modify `src/components/EditorInspector.tsx`：

在顶部 import 区新增：

```typescript
import { MotionCardInspector } from './MotionCardInspector';
import { useAIStore } from '../store/ai';
```

在 `InspectorSelection` 类型（line 11-16）中新增：

```typescript
export type InspectorSelection =
  | { type: 'empty' }
  | { type: 'ai-card'; cardId: string }
  | { type: 'motion-card'; cardId: string }
  | { type: 'overlay'; overlayId: string }
  | { type: 'subtitle-style' };
```

在 `EditorInspector` 组件体内，新增 motion card 查找逻辑：

```typescript
  const { motionCards, removeMotionCard } = useAIStore();
  const motionCard = selection.type === 'motion-card'
    ? motionCards.find((c) => c.id === selection.cardId)
    : undefined;
```

在 `eyebrowLabel` 判断中新增：

```typescript
  const eyebrowLabel =
    selection.type === 'subtitle-style'
      ? 'SUBTITLE'
      : selection.type === 'ai-card'
      ? 'AI CARD'
      : selection.type === 'motion-card'
      ? 'MOTION'
      : selection.type === 'overlay'
      ? 'OVERLAY'
      : 'INSPECTOR';
```

在组件的渲染逻辑中，新增 motion card 分支（与 ai-card 分支并列）：

```tsx
  {selection.type === 'motion-card' && motionCard ? (
    <MotionCardInspector
      card={motionCard}
      onDelete={() => {
        removeMotionCard(motionCard.id);
        onClose();
      }}
    />
  ) : null}
```

- [ ] **Step 3: 在 Editor 中按 cardId 解析 Inspector 入口**

Modify `src/pages/Editor.tsx`：

将现有 `handleOpenAICardInspector(cardId)` 改为**通用卡片入口**。规则：

- 若 `useAIStore.getState().motionCards` 中存在同 id，则打开
  `{ type: 'motion-card', cardId }`
- 否则维持原有 `{ type: 'ai-card', cardId }`
- 保持 `setActivePanel('ai')` 行为不变

这样可以同时兼容：

- MotionPanel 列表点击
- 时间线已有 `overlayType: 'ai-card'` 的 overlay 点击
- 后续重开项目后，按同一入口恢复 motion card Inspector

- [ ] **Step 4: 运行类型检查**

```bash
npx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add src/components/MotionCardInspector.tsx src/components/MotionCardInspector.module.css src/components/EditorInspector.tsx src/pages/Editor.tsx
git commit -m "feat: 实现 MotionCardInspector 与 Inspector 路由集成"
```

---

## Task 13: AIPanel 集成"动画"子标签

**Files:**
- Modify: `src/components/AIPanel.tsx`

- [ ] **Step 1: 扩展 TAB_META 和 SubTabs**

Modify `src/components/AIPanel.tsx`：

更新 `TAB_META`（line 33-36）：

```typescript
const TAB_META: Record<'cards' | 'cover' | 'motion', { label: string; shortLabel: string }> = {
  cards: { label: '内容卡片', shortLabel: '卡片' },
  cover: { label: '封面', shortLabel: '封面' },
  motion: { label: '动画', shortLabel: '动画' },
};
```

新增 MotionPanel import（顶部 import 区）：

```typescript
import { MotionPanel } from './MotionPanel';
```

更新 SubTabs 的 `(['cards', 'cover'] as const)` 为 `(['cards', 'cover', 'motion'] as const)`（line 509）：

```typescript
        {(['cards', 'cover', 'motion'] as const).map((tab) => (
```

- [ ] **Step 2: 新增 motion tab body 渲染**

在 body 区域（line 527-646），在 `activeTab === 'cards'` 和 cover panel 之间，新增 motion 分支。修改 body 的 JSX：

将原来的：

```tsx
      <div className={styles.body}>
        {activeTab === 'cards' ? (
          <> ... cards content ... </>
        ) : (
          <AICoverPanel ... />
        )}
      </div>
```

改为：

```tsx
      <div className={styles.body}>
        {activeTab === 'cards' ? (
          <> ... cards content ... </>
        ) : activeTab === 'motion' ? (
          <MotionPanel
            onOpenCardInspector={onOpenCardInspector}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <AICoverPanel ... />
        )}
      </div>
```

- [ ] **Step 3: 调整 footer 条件**

现有 footer（line 649-663）只在 `activeTab === 'cards'` 时显示。motion tab 的 footer 已内置于 MotionPanel，无需修改。

- [ ] **Step 4: 运行类型检查和现有测试**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: 无类型错误，现有测试无回归

- [ ] **Step 5: Commit**

```bash
git add src/components/AIPanel.tsx
git commit -m "feat: AIPanel 新增「动画」子标签，集成 MotionPanel"
```

---

## Task 14: 端到端验证

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

Expected: Electron 窗口正常启动

- [ ] **Step 2: 验证 UI 渲染**

1. 打开编辑器页面，导入测试 MP3 + SRT
2. 点击左侧 AI 面板
3. 确认看到三个子标签：「内容卡片」「封面」「动画」
4. 切换到「动画」标签，确认 MotionPanel 正常渲染
5. 确认描述输入框、时长、模式选择器、生成按钮均正常显示

- [ ] **Step 3: 验证生成流程**

1. 在描述框输入："一个蓝色圆形从屏幕左侧滑入并放大的动画"
2. 设置时长 3 秒，模式全屏
3. 点击"生成动画"
4. 确认列表出现占位卡片（"生成中"状态）
5. 等待生成完成，确认卡片变为"就绪"状态

- [ ] **Step 4: 验证预览**

1. 勾选已生成的 motion card
2. 点击"上轨"按钮
3. 确认中央 Remotion Player 中能看到动画播放
4. 拖动进度条，确认动画帧级同步

- [ ] **Step 5: 验证修改**

1. 点击 motion card 的"修改"按钮
2. 输入："把颜色改成红色"
3. 确认修改后预览反映新效果

- [ ] **Step 6: 验证导出**

1. 执行视频导出（render-video）
2. 确认 MP4 中 motion card 动画正确渲染
3. 确认无白屏或错误帧

- [ ] **Step 7: 验证错误处理**

1. 手动测试生成一个会导致编译错误的描述
2. 确认自动修复流程执行
3. 确认最终失败时显示优雅的错误占位卡片

- [ ] **Step 8: 验证工程重开后的持久化**

1. 关闭当前工程并重新打开
2. 确认「动画」标签中的 motion cards 仍然存在
3. 确认已生成源码、错误状态、勾选状态没有丢失

- [ ] **Step 9: 运行全量测试**

```bash
npx vitest run
```

Expected: 全部 PASS，含新增的 motion 相关测试

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "feat: Motion Card 功能完成 — AI 生成 Remotion 动态动画组件"
```

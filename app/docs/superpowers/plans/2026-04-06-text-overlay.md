# Text Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add text overlay support to the podcast video editor — users can add text from the asset library, position it on the preview canvas, style it via the inspector, animate it, and export it with the video.

**Architecture:** Text overlays are a new `type: 'text'` variant of the existing `OverlayItem`. They live on visual tracks alongside video/image overlays, render via a new Remotion `TextOverlay` component, and are edited through a new `TextInspector` panel. A `CanvasInteractionLayer` overlays the Remotion Player for drag/resize interactions.

**Tech Stack:** React 19, TypeScript 6, Remotion 4, Zustand 5, Vitest, CSS Modules

**Spec:** `docs/superpowers/specs/2026-04-06-text-overlay-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/text-templates.ts` | Text template definitions, `createDefaultTextData()`, `getTextTemplateAssets()` |
| `src/lib/text-animations.ts` | `getTextAnimationStyle()` — frame-level animation calculations for Remotion |
| `src/remotion/TextOverlay.tsx` | Remotion component: maps `TextOverlayData` → CSS, applies animation styles |
| `src/components/TextInspector.tsx` | Inspector panel for editing all text overlay properties |
| `src/components/TextInspector.module.css` | Styles for TextInspector |
| `src/hooks/useCanvasInteraction.ts` | Hook: drag/resize state machine, coordinate conversion, mouse event handling |
| `src/components/CanvasInteractionLayer.tsx` | Transparent overlay on Player: selection box, 8 resize handles |
| `src/components/CanvasInteractionLayer.module.css` | Styles for interaction layer |
| `tests/text-templates.test.ts` | Tests for template definitions and defaults |
| `tests/text-animations.test.ts` | Tests for animation style calculations |
| `tests/text-overlay.test.tsx` | Tests for Remotion TextOverlay rendering |

### Modified Files

| File | Change |
|------|--------|
| `src/types.ts` | Add `TextOverlayData`, `TextAnimation`, animation union types; extend `OverlayItem.type`, `AssetType` |
| `src/store/timeline.ts` | Widen `addAsset` type param; exclude text overlays from `deriveAssetsFromTimeline` |
| `src/remotion/PodcastComposition.tsx` | Filter and render text overlays between AI cards and subtitles |
| `src/components/EditorInspector.tsx` | Add `'text-overlay'` to `InspectorSelection`; route to `TextInspector` |
| `src/components/AssetPanel.tsx` | Add `'text'` filter pill; render text template cards; handle text drag |
| `src/components/AssetCard.tsx` | Add `'text'` to `TYPE_META`; support text draggable |
| `src/components/OverlayBlock.tsx` | Add text overlay badge/label/color |
| `src/components/PreviewPanel.tsx` | Integrate `CanvasInteractionLayer` over Player |
| `src/components/Timeline.tsx` | Handle text template drops; wire `onSelect` for text overlays |
| `src/pages/Editor.tsx` | Pass `inspectorSelection`/`setInspectorSelection` to PreviewPanel and Timeline |

---

## Task 1: Type Definitions

**Files:**
- Modify: `src/types.ts`
- Test: `tests/text-templates.test.ts` (partial — type import check)

- [ ] **Step 1: Add text animation types to `src/types.ts`**

Add after the `SubtitleHighlight` interface (after line 60):

```typescript
// ── Text Overlay Types ──

export type TextEnterAnimation =
  | 'none' | 'fadeIn' | 'slideInLeft' | 'slideInRight'
  | 'slideInUp' | 'slideInDown' | 'scaleIn' | 'bounceIn';

export type TextExitAnimation =
  | 'none' | 'fadeOut' | 'slideOutLeft' | 'slideOutRight'
  | 'slideOutUp' | 'slideOutDown' | 'scaleOut' | 'bounceOut';

export type TextLoopAnimation =
  | 'none' | 'pulse' | 'float' | 'flicker' | 'typewriter';

export interface TextAnimation {
  enter: TextEnterAnimation;
  enterDurationMs: number;
  exit: TextExitAnimation;
  exitDurationMs: number;
  loop: TextLoopAnimation;
}

export interface TextOverlayData {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textAlign: 'left' | 'center' | 'right';
  backgroundColor: string;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
  letterSpacing: number;
  lineHeight: number;
  opacity: number;
  rotation: number;
  animation: TextAnimation;
}
```

- [ ] **Step 2: Extend `OverlayItem.type` and add `textData` field**

Change the existing `OverlayItem` interface in `src/types.ts`:

```typescript
export interface OverlayItem {
  id: string;
  type: 'video' | 'image' | 'text';  // add 'text'
  assetPath: string;
  trackId: string;
  startMs: number;
  durationMs: number;
  position: OverlayPosition;
  overlayType?: 'media' | 'ai-card';
  overlayRole?: OverlayRole;
  aiCardData?: AICardOverlayData;
  textData?: TextOverlayData;         // add
}
```

- [ ] **Step 3: Extend `AssetType`**

Change in `src/types.ts`:

```typescript
export type AssetType = 'video' | 'image' | 'audio' | 'srt' | 'text';
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`

Expected: May show errors in files that switch on `OverlayItem.type` or `AssetType` without handling `'text'`. Note these — they will be fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): 添加 TextOverlayData、TextAnimation 和 text overlay 类型"
```

---

## Task 2: Text Templates

**Files:**
- Create: `src/lib/text-templates.ts`
- Create: `tests/text-templates.test.ts`

- [ ] **Step 1: Write failing test for `createDefaultTextData`**

Create `tests/text-templates.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  createDefaultTextData,
  TEXT_TEMPLATES,
  getTextTemplateAssets,
} from '../src/lib/text-templates';

describe('text-templates', () => {
  describe('createDefaultTextData', () => {
    it('returns a TextOverlayData with default values', () => {
      const data = createDefaultTextData();
      expect(data.content).toBe('请输入文字');
      expect(data.fontFamily).toBe('PingFang SC');
      expect(data.fontSize).toBe(64);
      expect(data.fontColor).toBe('#FFFFFF');
      expect(data.bold).toBe(false);
      expect(data.italic).toBe(false);
      expect(data.underline).toBe(false);
      expect(data.textAlign).toBe('center');
      expect(data.backgroundColor).toBe('transparent');
      expect(data.strokeColor).toBe('#000000');
      expect(data.strokeWidth).toBe(0);
      expect(data.shadowColor).toBe('#000000');
      expect(data.shadowOffsetX).toBe(0);
      expect(data.shadowOffsetY).toBe(2);
      expect(data.shadowBlur).toBe(0);
      expect(data.letterSpacing).toBe(0);
      expect(data.lineHeight).toBe(1.5);
      expect(data.opacity).toBe(1);
      expect(data.rotation).toBe(0);
      expect(data.animation).toEqual({
        enter: 'fadeIn',
        enterDurationMs: 500,
        exit: 'fadeOut',
        exitDurationMs: 500,
        loop: 'none',
      });
    });

    it('merges overrides into defaults', () => {
      const data = createDefaultTextData({ fontSize: 80, bold: true, content: '大标题' });
      expect(data.fontSize).toBe(80);
      expect(data.bold).toBe(true);
      expect(data.content).toBe('大标题');
      expect(data.fontColor).toBe('#FFFFFF');
    });
  });

  describe('TEXT_TEMPLATES', () => {
    it('has 5 templates', () => {
      expect(TEXT_TEMPLATES).toHaveLength(5);
    });

    it('each template has id, name, and textData', () => {
      for (const template of TEXT_TEMPLATES) {
        expect(template.id).toMatch(/^text-template:/);
        expect(template.name).toBeTruthy();
        expect(template.textData.content).toBeTruthy();
      }
    });

    it('heading template has fontSize 80 and bold', () => {
      const heading = TEXT_TEMPLATES.find((t) => t.id === 'text-template:heading')!;
      expect(heading.textData.fontSize).toBe(80);
      expect(heading.textData.bold).toBe(true);
    });

    it('caption template has dark background', () => {
      const caption = TEXT_TEMPLATES.find((t) => t.id === 'text-template:caption')!;
      expect(caption.textData.backgroundColor).toBe('rgba(0,0,0,0.6)');
    });

    it('fancy template has red stroke', () => {
      const fancy = TEXT_TEMPLATES.find((t) => t.id === 'text-template:fancy')!;
      expect(fancy.textData.strokeColor).toBe('#EF4444');
      expect(fancy.textData.strokeWidth).toBe(2);
    });
  });

  describe('getTextTemplateAssets', () => {
    it('returns AssetItem[] for all templates', () => {
      const assets = getTextTemplateAssets();
      expect(assets).toHaveLength(5);
      for (const asset of assets) {
        expect(asset.type).toBe('text');
        expect(asset.durationMs).toBe(5000);
        expect(asset.path).toMatch(/^text-template:/);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/text-templates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/lib/text-templates.ts`**

```typescript
import type { AssetItem, TextOverlayData } from '../types';

export function createDefaultTextData(
  overrides?: Partial<TextOverlayData>,
): TextOverlayData {
  return {
    content: '请输入文字',
    fontFamily: 'PingFang SC',
    fontSize: 64,
    fontColor: '#FFFFFF',
    bold: false,
    italic: false,
    underline: false,
    textAlign: 'center',
    backgroundColor: 'transparent',
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowColor: '#000000',
    shadowOffsetX: 0,
    shadowOffsetY: 2,
    shadowBlur: 0,
    letterSpacing: 0,
    lineHeight: 1.5,
    opacity: 1,
    rotation: 0,
    animation: {
      enter: 'fadeIn',
      enterDurationMs: 500,
      exit: 'fadeOut',
      exitDurationMs: 500,
      loop: 'none',
    },
    ...overrides,
  };
}

export interface TextTemplate {
  id: string;
  name: string;
  textData: TextOverlayData;
}

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: 'text-template:heading',
    name: '大标题',
    textData: createDefaultTextData({ fontSize: 80, bold: true, content: '大标题' }),
  },
  {
    id: 'text-template:subheading',
    name: '小标题',
    textData: createDefaultTextData({ fontSize: 56, bold: true, content: '小标题' }),
  },
  {
    id: 'text-template:body',
    name: '正文文字',
    textData: createDefaultTextData({
      fontSize: 40,
      fontColor: '#E0E0E0',
      textAlign: 'left',
      content: '正文文字',
    }),
  },
  {
    id: 'text-template:caption',
    name: '字幕条',
    textData: createDefaultTextData({
      fontSize: 36,
      backgroundColor: 'rgba(0,0,0,0.6)',
      content: '字幕条',
    }),
  },
  {
    id: 'text-template:fancy',
    name: '花字效果',
    textData: createDefaultTextData({
      fontSize: 64,
      bold: true,
      strokeColor: '#EF4444',
      strokeWidth: 2,
      content: '花字效果',
    }),
  },
];

export function getTextTemplateAssets(): AssetItem[] {
  return TEXT_TEMPLATES.map((template) => ({
    path: template.id,
    type: 'text' as const,
    name: template.name,
    durationMs: 5000,
  }));
}

export function getTextTemplateById(id: string): TextTemplate | undefined {
  return TEXT_TEMPLATES.find((template) => template.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/text-templates.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/text-templates.ts tests/text-templates.test.ts
git commit -m "feat(text): 添加文字模板定义和 createDefaultTextData"
```

---

## Task 3: Text Animation Engine

**Files:**
- Create: `src/lib/text-animations.ts`
- Create: `tests/text-animations.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/text-animations.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getTextAnimationStyle } from '../src/lib/text-animations';
import type { TextAnimation } from '../src/types';

const NO_ANIMATION: TextAnimation = {
  enter: 'none',
  enterDurationMs: 500,
  exit: 'none',
  exitDurationMs: 500,
  loop: 'none',
};

describe('getTextAnimationStyle', () => {
  it('returns identity style when all animations are none', () => {
    const result = getTextAnimationStyle({
      frame: 15,
      fps: 30,
      durationFrames: 150,
      animation: NO_ANIMATION,
    });
    expect(result.style.opacity).toBe(1);
    expect(result.style.transform).toBeUndefined();
    expect(result.visibleText).toBeUndefined();
  });

  it('fades in during enter phase', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'fadeIn', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(0);
  });

  it('fully visible after enter phase completes', () => {
    const enterFrames = Math.ceil((500 / 1000) * 30); // 15 frames
    const result = getTextAnimationStyle({
      frame: enterFrames,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'fadeIn', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(1);
  });

  it('fades out during exit phase', () => {
    const durationFrames = 150;
    const exitFrames = Math.ceil((500 / 1000) * 30); // 15 frames
    const result = getTextAnimationStyle({
      frame: durationFrames - 1,
      fps: 30,
      durationFrames,
      animation: { ...NO_ANIMATION, exit: 'fadeOut', exitDurationMs: 500 },
    });
    expect(result.style.opacity).toBeLessThan(0.2);
  });

  it('applies slideInLeft with translateX', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'slideInLeft', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(0);
    expect(result.style.transform).toContain('translateX');
  });

  it('applies scaleIn with scale transform', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 150,
      animation: { ...NO_ANIMATION, enter: 'scaleIn', enterDurationMs: 500 },
    });
    expect(result.style.opacity).toBe(0);
    expect(result.style.transform).toContain('scale(');
  });

  it('pulse loop modulates opacity', () => {
    const enterFrames = 15;
    const result = getTextAnimationStyle({
      frame: enterFrames + 10,
      fps: 30,
      durationFrames: 300,
      animation: { ...NO_ANIMATION, loop: 'pulse' },
    });
    expect(result.style.opacity).toBeGreaterThanOrEqual(0.6);
    expect(result.style.opacity).toBeLessThanOrEqual(1);
  });

  it('typewriter returns partial visibleText', () => {
    const result = getTextAnimationStyle({
      frame: 3,
      fps: 30,
      durationFrames: 300,
      animation: { ...NO_ANIMATION, loop: 'typewriter' },
      content: 'Hello World',
    });
    expect(result.visibleText).toBeDefined();
    expect(result.visibleText!.length).toBeLessThan('Hello World'.length);
  });

  it('clamps enterDuration + exitDuration to not exceed total duration', () => {
    const result = getTextAnimationStyle({
      frame: 0,
      fps: 30,
      durationFrames: 10, // very short: 333ms
      animation: {
        enter: 'fadeIn',
        enterDurationMs: 500,
        exit: 'fadeOut',
        exitDurationMs: 500,
        loop: 'none',
      },
    });
    // Should not crash; opacity should be a number between 0 and 1
    expect(result.style.opacity).toBeGreaterThanOrEqual(0);
    expect(result.style.opacity).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/text-animations.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/lib/text-animations.ts`**

```typescript
import { interpolate, spring } from 'remotion';
import type { TextAnimation } from '../types';

interface AnimationParams {
  frame: number;
  fps: number;
  durationFrames: number;
  animation: TextAnimation;
  content?: string;
}

interface AnimationResult {
  style: {
    opacity?: number;
    transform?: string;
  };
  visibleText?: string;
}

function msToFrames(ms: number, fps: number): number {
  return Math.ceil((ms / 1000) * fps);
}

function getEnterStyle(
  enter: TextAnimation['enter'],
  progress: number,
): { opacity: number; transform?: string } {
  if (enter === 'none') return { opacity: 1 };
  const opacity = interpolate(progress, [0, 1], [0, 1], { extrapolateRight: 'clamp' });
  switch (enter) {
    case 'fadeIn':
      return { opacity };
    case 'slideInLeft':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [-100, 0])}%)` };
    case 'slideInRight':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [100, 0])}%)` };
    case 'slideInUp':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [100, 0])}%)` };
    case 'slideInDown':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [-100, 0])}%)` };
    case 'scaleIn':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [0, 1])})` };
    case 'bounceIn':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [0, 1])})` };
    default:
      return { opacity: 1 };
  }
}

function getExitStyle(
  exit: TextAnimation['exit'],
  progress: number,
): { opacity: number; transform?: string } {
  if (exit === 'none') return { opacity: 1 };
  const opacity = interpolate(progress, [0, 1], [1, 0], { extrapolateRight: 'clamp' });
  switch (exit) {
    case 'fadeOut':
      return { opacity };
    case 'slideOutLeft':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [0, -100])}%)` };
    case 'slideOutRight':
      return { opacity, transform: `translateX(${interpolate(progress, [0, 1], [0, 100])}%)` };
    case 'slideOutUp':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [0, -100])}%)` };
    case 'slideOutDown':
      return { opacity, transform: `translateY(${interpolate(progress, [0, 1], [0, 100])}%)` };
    case 'scaleOut':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [1, 0])})` };
    case 'bounceOut':
      return { opacity, transform: `scale(${interpolate(progress, [0, 1], [1, 0])})` };
    default:
      return { opacity: 1 };
  }
}

function getLoopStyle(
  loop: TextAnimation['loop'],
  frame: number,
  fps: number,
  content?: string,
): { opacity?: number; transform?: string; visibleText?: string } {
  if (loop === 'none') return {};
  const time = frame / fps;
  switch (loop) {
    case 'pulse': {
      const value = 0.8 + 0.2 * Math.sin(time * Math.PI * 2);
      return { opacity: value };
    }
    case 'float': {
      const offset = 8 * Math.sin(time * Math.PI * 2 * 0.5);
      return { transform: `translateY(${offset}px)` };
    }
    case 'flicker': {
      const value = 0.65 + 0.35 * Math.sin(time * Math.PI * 2 * 4);
      return { opacity: value };
    }
    case 'typewriter': {
      if (!content) return {};
      const charsPerSecond = 10;
      const totalChars = content.length;
      const cycleDuration = totalChars / charsPerSecond;
      const cycleTime = time % cycleDuration;
      const visibleChars = Math.min(totalChars, Math.floor(cycleTime * charsPerSecond) + 1);
      return { visibleText: content.slice(0, visibleChars) };
    }
    default:
      return {};
  }
}

export function getTextAnimationStyle(params: AnimationParams): AnimationResult {
  const { frame, fps, durationFrames, animation, content } = params;

  // 计算入场/出场帧数，确保不超过总时长
  const totalDurationMs = (durationFrames / fps) * 1000;
  const enterMs = Math.min(animation.enterDurationMs, totalDurationMs * 0.5);
  const exitMs = Math.min(animation.exitDurationMs, totalDurationMs - enterMs);
  const enterFrames = msToFrames(enterMs, fps);
  const exitFrames = msToFrames(exitMs, fps);
  const exitStart = durationFrames - exitFrames;

  // 入场阶段
  if (frame < enterFrames && animation.enter !== 'none') {
    const progress = enterFrames > 0 ? frame / enterFrames : 1;
    const enterStyle = getEnterStyle(animation.enter, progress);
    return { style: enterStyle };
  }

  // 出场阶段
  if (frame >= exitStart && animation.exit !== 'none') {
    const progress = exitFrames > 0 ? (frame - exitStart) / exitFrames : 1;
    const exitStyle = getExitStyle(animation.exit, progress);
    return { style: exitStyle };
  }

  // 循环阶段
  const loopResult = getLoopStyle(animation.loop, frame - enterFrames, fps, content);
  return {
    style: {
      opacity: loopResult.opacity ?? 1,
      transform: loopResult.transform,
    },
    visibleText: loopResult.visibleText,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/text-animations.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/text-animations.ts tests/text-animations.test.ts
git commit -m "feat(text): 添加文字动画引擎 getTextAnimationStyle"
```

---

## Task 4: Remotion TextOverlay Component

**Files:**
- Create: `src/remotion/TextOverlay.tsx`
- Modify: `src/remotion/PodcastComposition.tsx`
- Create: `tests/text-overlay.test.tsx`

- [ ] **Step 1: Write failing test for TextOverlay**

Create `tests/text-overlay.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TextOverlay } from '../src/remotion/TextOverlay';
import { createDefaultTextData } from '../src/lib/text-templates';
import type { OverlayItem } from '../src/types';

const mockOverlay: OverlayItem = {
  id: 'text-1',
  type: 'text',
  assetPath: '',
  trackId: 'visual-1',
  startMs: 0,
  durationMs: 5000,
  position: { x: 100, y: 200, width: 800, height: 200 },
  textData: createDefaultTextData({ content: '测试文字' }),
};

describe('TextOverlay', () => {
  it('renders text content', () => {
    const html = renderToStaticMarkup(
      <TextOverlay overlay={mockOverlay} fps={30} />,
    );
    expect(html).toContain('测试文字');
  });

  it('returns null when textData is missing', () => {
    const noTextOverlay: OverlayItem = {
      ...mockOverlay,
      textData: undefined,
    };
    const html = renderToStaticMarkup(
      <TextOverlay overlay={noTextOverlay} fps={30} />,
    );
    expect(html).toBe('');
  });

  it('applies bold style', () => {
    const boldOverlay: OverlayItem = {
      ...mockOverlay,
      textData: createDefaultTextData({ content: 'Bold', bold: true }),
    };
    const html = renderToStaticMarkup(
      <TextOverlay overlay={boldOverlay} fps={30} />,
    );
    expect(html).toContain('font-weight:bold');
  });

  it('applies stroke when strokeWidth > 0', () => {
    const strokeOverlay: OverlayItem = {
      ...mockOverlay,
      textData: createDefaultTextData({
        content: 'Stroke',
        strokeColor: '#FF0000',
        strokeWidth: 2,
      }),
    };
    const html = renderToStaticMarkup(
      <TextOverlay overlay={strokeOverlay} fps={30} />,
    );
    expect(html).toContain('2px #FF0000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/text-overlay.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/remotion/TextOverlay.tsx`**

```typescript
import type { CSSProperties } from 'react';
import { Sequence, useCurrentFrame } from 'remotion';
import type { OverlayItem } from '../types';
import { msToFrame } from '../lib/utils';
import { getTextAnimationStyle } from '../lib/text-animations';

interface TextOverlayProps {
  overlay: OverlayItem;
  fps: number;
}

export function TextOverlay({ overlay, fps }: TextOverlayProps) {
  const frame = useCurrentFrame();
  const { textData } = overlay;
  if (!textData) return null;

  const durationFrames = Math.max(1, msToFrame(overlay.durationMs, fps));
  const { style: animStyle, visibleText } = getTextAnimationStyle({
    frame,
    fps,
    durationFrames,
    animation: textData.animation,
    content: textData.content,
  });

  const textStyle: CSSProperties = {
    position: 'absolute',
    left: overlay.position.x,
    top: overlay.position.y,
    width: overlay.position.width,
    height: overlay.position.height,
    fontFamily: textData.fontFamily,
    fontSize: textData.fontSize,
    color: textData.fontColor,
    fontWeight: textData.bold ? 'bold' : 'normal',
    fontStyle: textData.italic ? 'italic' : 'normal',
    textDecoration: textData.underline ? 'underline' : 'none',
    textAlign: textData.textAlign,
    backgroundColor: textData.backgroundColor,
    WebkitTextStroke:
      textData.strokeWidth > 0
        ? `${textData.strokeWidth}px ${textData.strokeColor}`
        : undefined,
    textShadow:
      textData.shadowBlur > 0 || textData.shadowOffsetX !== 0 || textData.shadowOffsetY !== 0
        ? `${textData.shadowOffsetX}px ${textData.shadowOffsetY}px ${textData.shadowBlur}px ${textData.shadowColor}`
        : undefined,
    letterSpacing: textData.letterSpacing,
    lineHeight: textData.lineHeight,
    opacity: (textData.opacity ?? 1) * (animStyle.opacity ?? 1),
    transform: [
      textData.rotation ? `rotate(${textData.rotation}deg)` : '',
      animStyle.transform ?? '',
    ]
      .filter(Boolean)
      .join(' ') || undefined,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      textData.textAlign === 'center'
        ? 'center'
        : textData.textAlign === 'right'
          ? 'flex-end'
          : 'flex-start',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  };

  return (
    <Sequence from={msToFrame(overlay.startMs, fps)} durationInFrames={durationFrames}>
      <div style={textStyle}>{visibleText ?? textData.content}</div>
    </Sequence>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/text-overlay.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Integrate into PodcastComposition**

In `src/remotion/PodcastComposition.tsx`, add the import and rendering. The file currently filters overlays into `mediaOverlays` and `aiCardOverlays`. Add a third group for text:

Add import at top:
```typescript
import { TextOverlay } from './TextOverlay';
```

Inside the component, after the existing `mediaOverlays` and `aiCardOverlays` filter lines:
```typescript
const textOverlays = renderableOverlays.filter((overlay) => overlay.type === 'text');
```

Update `mediaOverlays` filter to exclude text:
```typescript
const mediaOverlays = renderableOverlays.filter(
  (overlay) => overlay.overlayType !== 'ai-card' && overlay.type !== 'text',
);
```

In JSX, add text overlay rendering between AI cards and SubtitleTrack:
```typescript
{textOverlays.map((overlay) => (
  <TextOverlay key={overlay.id} overlay={overlay} fps={timeline.fps} />
))}
```

- [ ] **Step 6: Run existing tests**

Run: `npx vitest run tests/text-overlay.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/remotion/TextOverlay.tsx src/remotion/PodcastComposition.tsx tests/text-overlay.test.tsx
git commit -m "feat(text): 添加 Remotion TextOverlay 组件和渲染集成"
```

---

## Task 5: Store Adjustments

**Files:**
- Modify: `src/store/timeline.ts`
- Modify: `tests/timeline-store.test.ts`

- [ ] **Step 1: Write failing test for text overlay store operations**

Add to `tests/timeline-store.test.ts`:

```typescript
it('adds a text overlay to the timeline', () => {
  const store = useTimelineStore.getState();
  const overlayId = store.addOverlay({
    type: 'text',
    assetPath: '',
    trackId: DEFAULT_VISUAL_TRACK_ID,
    startMs: 1000,
    durationMs: 5000,
    position: { x: 100, y: 200, width: 800, height: 200 },
    textData: {
      content: '测试',
      fontFamily: 'PingFang SC',
      fontSize: 64,
      fontColor: '#FFFFFF',
      bold: false,
      italic: false,
      underline: false,
      textAlign: 'center',
      backgroundColor: 'transparent',
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowColor: '#000000',
      shadowOffsetX: 0,
      shadowOffsetY: 2,
      shadowBlur: 0,
      letterSpacing: 0,
      lineHeight: 1.5,
      opacity: 1,
      rotation: 0,
      animation: {
        enter: 'fadeIn',
        enterDurationMs: 500,
        exit: 'fadeOut',
        exitDurationMs: 500,
        loop: 'none',
      },
    },
  });

  expect(overlayId).toBeTruthy();
  const overlay = useTimelineStore.getState().timeline.overlays.find((o) => o.id === overlayId);
  expect(overlay?.type).toBe('text');
  expect(overlay?.textData?.content).toBe('测试');
});

it('does not add text overlays to asset list', () => {
  const store = useTimelineStore.getState();
  store.addOverlay({
    type: 'text',
    assetPath: '',
    trackId: DEFAULT_VISUAL_TRACK_ID,
    startMs: 0,
    durationMs: 5000,
    position: { x: 0, y: 0, width: 800, height: 200 },
    textData: {
      content: '测试',
      fontFamily: 'PingFang SC',
      fontSize: 64,
      fontColor: '#FFFFFF',
      bold: false,
      italic: false,
      underline: false,
      textAlign: 'center',
      backgroundColor: 'transparent',
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowColor: '#000000',
      shadowOffsetX: 0,
      shadowOffsetY: 2,
      shadowBlur: 0,
      letterSpacing: 0,
      lineHeight: 1.5,
      opacity: 1,
      rotation: 0,
      animation: {
        enter: 'none',
        enterDurationMs: 500,
        exit: 'none',
        exitDurationMs: 500,
        loop: 'none',
      },
    },
  });

  const assets = useTimelineStore.getState().assets;
  expect(assets.filter((a) => a.type === 'text')).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeline-store.test.ts`
Expected: May fail due to type errors or the text overlay showing up in assets

- [ ] **Step 3: Update store — widen `addAsset` type and exclude text overlays from asset sync**

In `src/store/timeline.ts`, change the `addAsset` type signature on line 43:

```typescript
addAsset: (path: string, type: 'video' | 'image' | 'text', durationMs?: number) => void;
```

In `deriveAssetsFromTimeline` (around line 162), the `isMediaOverlay` filter already excludes text overlays because `Boolean('')` is false. No change needed here.

In `syncAssetsWithTimeline` (around line 173), text overlays are similarly excluded by `isMediaOverlay`. No change needed.

However, the `buildAsset` function (line 63) defaults `durationMs` based on type. Add text handling:

```typescript
const buildAsset = (
  path: string,
  type: AssetType,
  durationMs = type === 'image' || type === 'text' ? 5000 : 10000,
  locked = false,
): AssetItem => ({
  path,
  type,
  name: getFileNameFromPath(path),
  durationMs,
  ...(locked ? { locked: true } : {}),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/timeline-store.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/timeline.ts tests/timeline-store.test.ts
git commit -m "feat(store): 支持 text overlay 的 store 操作"
```

---

## Task 6: OverlayBlock Text Support

**Files:**
- Modify: `src/components/OverlayBlock.tsx`

- [ ] **Step 1: Add text overlay visual support**

In `src/components/OverlayBlock.tsx`, update the color logic (around line 30) to handle text type:

```typescript
const isTextOverlay = overlay.type === 'text';
```

Update the `color` variable to include text:
```typescript
const color = isDefaultBackground
  ? 'var(--color-brand-accent)'
  : isAICard
  ? overlay.aiCardData?.style.primaryColor ?? 'var(--color-brand-accent)'
  : isTextOverlay
  ? '#10b981'
  : overlay.type === 'video'
    ? 'var(--color-selection-blue-hover)'
    : 'var(--color-brand-warm)';
```

Update `colorGlow`:
```typescript
const colorGlow = isDefaultBackground
  ? 'color-mix(in srgb, var(--color-brand-accent) 22%, transparent)'
  : isAICard
  ? 'color-mix(in srgb, var(--color-brand-accent) 24%, transparent)'
  : isTextOverlay
  ? 'color-mix(in srgb, #10b981 22%, transparent)'
  : overlay.type === 'video'
    ? 'color-mix(in srgb, var(--color-selection-blue-hover) 24%, transparent)'
    : 'color-mix(in srgb, var(--color-brand-warm) 22%, transparent)';
```

Update `label`:
```typescript
const label = isDefaultBackground
  ? `默认背景 · ${getFileNameFromPath(overlay.assetPath)}`
  : isAICard
    ? overlay.aiCardData?.title ?? 'AI 卡片'
    : isTextOverlay
      ? overlay.textData?.content?.slice(0, 20) ?? '文字'
      : getFileNameFromPath(overlay.assetPath);
```

Update `badge`:
```typescript
const badge = isDefaultBackground
  ? 'BG'
  : isAICard
    ? 'AI'
    : isTextOverlay
      ? 'TXT'
      : overlay.type === 'video'
        ? 'VID'
        : 'IMG';
```

Update `showImageThumbnail` to exclude text:
```typescript
const showImageThumbnail =
  !isAICard && !isTextOverlay && overlay.type === 'image' && Boolean(asset) && thumbnailWidth >= 24;
```

Update `maxDurationForAsset` — text has no file-based limit:
```typescript
const maxDurationForAsset =
  overlay.type === 'video' ? asset?.durationMs ?? overlay.durationMs : Number.POSITIVE_INFINITY;
```

- [ ] **Step 2: Run existing OverlayBlock test**

Run: `npx vitest run tests/overlay-block.test.tsx`
Expected: PASS (existing tests should not break)

- [ ] **Step 3: Commit**

```bash
git add src/components/OverlayBlock.tsx
git commit -m "feat(timeline): OverlayBlock 支持 text overlay 显示"
```

---

## Task 7: AssetPanel Text Templates

**Files:**
- Modify: `src/components/AssetPanel.tsx`
- Modify: `src/components/AssetCard.tsx`

- [ ] **Step 1: Add 'text' to AssetCard TYPE_META**

In `src/components/AssetCard.tsx`, add to `TYPE_META` (after `srt` entry) and import `Type` icon:

```typescript
import { Film, ImageIcon, Music, FileText, Type, Play, Plus } from 'lucide-react';
```

Add to `TYPE_META`:
```typescript
text: {
  Icon: Type,
  iconColor: 'color-mix(in srgb, #10b981 75%, transparent)',
  className: styles.typeText,
},
```

Update `isDraggable` on line 61:
```typescript
const isDraggable = !asset.locked && (asset.type === 'image' || asset.type === 'video' || asset.type === 'text');
```

- [ ] **Step 2: Add `.typeText` CSS class**

In `src/components/AssetCard.module.css`, add a `.typeText` class following the same pattern as existing type classes. Find the existing `.typeSrt` rule and add after it:

```css
.typeText {
  --asset-tint: color-mix(in srgb, #10b981 12%, transparent);
}
```

- [ ] **Step 3: Add 'text' filter pill and template rendering to AssetPanel**

In `src/components/AssetPanel.tsx`:

Add import:
```typescript
import { getTextTemplateAssets, getTextTemplateById } from '../lib/text-templates';
```

Add `'text'` to `FILTER_OPTIONS` array:
```typescript
const FILTER_OPTIONS: Array<PillGroupItem<AssetFilterKey>> = [
  { value: 'all', label: '全部' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'text', label: '文字' },
];
```

In the component, compute visible assets to include text templates when filter is 'text' or 'all':

After the existing `visibleAssets` declaration, add text template logic:
```typescript
const textTemplateAssets = getTextTemplateAssets();
const showTextTemplates = activeFilter === 'all' || activeFilter === 'text';
const allVisibleAssets = showTextTemplates
  ? [...visibleAssets, ...textTemplateAssets.filter((t) =>
      matchesAssetFilter(t, activeFilter, compact ? '' : keyword),
    )]
  : visibleAssets;
```

Replace `visibleAssets` with `allVisibleAssets` in the rendering loop.

Update the `onDragStart` handler to support text templates. Change the drag start logic:
```typescript
onDragStart={(event) => {
  if (asset.locked) {
    event.preventDefault();
    return;
  }
  if (asset.type !== 'image' && asset.type !== 'video' && asset.type !== 'text') {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/json', JSON.stringify(asset));
}}
```

- [ ] **Step 4: Run existing AssetPanel test**

Run: `npx vitest run tests/asset-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/AssetPanel.tsx src/components/AssetCard.tsx src/components/AssetCard.module.css
git commit -m "feat(assets): 素材库添加文字模板分类和拖拽支持"
```

---

## Task 8: Timeline Text Drop Handling

**Files:**
- Modify: `src/components/Timeline.tsx`

- [ ] **Step 1: Handle text template drops in Timeline**

In `src/components/Timeline.tsx`, the `placeAssetOnTrack` function (around line 277) needs to handle text assets. Add import:

```typescript
import { getTextTemplateById } from '../lib/text-templates';
```

Update `placeAssetOnTrack` to handle text type:

```typescript
const placeAssetOnTrack = (trackId: string, asset: AssetLike, clientX: number) => {
  if (asset.overlayRole === 'default-background') {
    setGlobalBackground(asset.path);
    return;
  }

  const offsetX = resolveTimelineOffset(clientX);
  if (offsetX === null) {
    return;
  }

  const startMs = Math.max(0, Math.round(offsetX / pxPerMs));

  // 文字模板处理
  if (asset.type === 'text') {
    const template = getTextTemplateById(asset.path);
    if (!template) return;
    addOverlay({
      type: 'text',
      assetPath: '',
      trackId,
      startMs,
      durationMs: asset.durationMs,
      position: {
        x: (timeline.width - 800) / 2,
        y: (timeline.height - 200) / 2,
        width: 800,
        height: 200,
      },
      textData: { ...template.textData },
    });
    return;
  }

  addOverlay({
    type: asset.type,
    assetPath: asset.path,
    trackId,
    startMs,
    durationMs: asset.durationMs,
    position: {
      x: 0,
      y: 0,
      width: timeline.width,
      height: timeline.height,
    },
  });
};
```

- [ ] **Step 2: Wire `onSelect` for text overlays**

In Timeline.tsx, find the `onSelect` callback in OverlayBlock rendering (around line 555). Update to handle text overlays:

```typescript
onSelect={() => {
  if (overlay.type === 'text') {
    onOpenTextInspector?.(overlay.id);
    return;
  }
  const sourceCardId = overlay.aiCardData?.sourceCardId;
  if (overlay.overlayType === 'ai-card' && sourceCardId) {
    onOpenAICardInspector?.(sourceCardId);
  }
}}
```

Add `onOpenTextInspector` to the Timeline component props. Find the props interface and add:
```typescript
onOpenTextInspector?: (overlayId: string) => void;
```

- [ ] **Step 3: Run existing Timeline test**

Run: `npx vitest run tests/timeline.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/Timeline.tsx
git commit -m "feat(timeline): 支持文字模板拖放和文字 overlay 选中"
```

---

## Task 9: EditorInspector Text Routing

**Files:**
- Modify: `src/components/EditorInspector.tsx`
- Create: `src/components/TextInspector.tsx`
- Create: `src/components/TextInspector.module.css`

- [ ] **Step 1: Add 'text-overlay' to InspectorSelection**

In `src/components/EditorInspector.tsx`, update the type:

```typescript
export type InspectorSelection =
  | { type: 'empty' }
  | { type: 'ai-card'; cardId: string }
  | { type: 'subtitle-style' }
  | { type: 'text-overlay'; overlayId: string };
```

- [ ] **Step 2: Create minimal TextInspector placeholder**

Create `src/components/TextInspector.tsx`:

```typescript
import { useCallback } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Trash2,
  Underline,
} from 'lucide-react';
import type { TextOverlayData } from '../types';
import { useTimelineStore } from '../store/timeline';
import { Button } from '../ui';
import styles from './TextInspector.module.css';

interface TextInspectorProps {
  overlayId: string;
  onDelete: () => void;
}

export function TextInspector({ overlayId, onDelete }: TextInspectorProps) {
  const { timeline, updateOverlay } = useTimelineStore();
  const overlay = timeline.overlays.find((o) => o.id === overlayId);
  const textData = overlay?.textData;

  const updateTextData = useCallback(
    (updates: Partial<TextOverlayData>) => {
      if (!textData) return;
      updateOverlay(overlayId, { textData: { ...textData, ...updates } });
    },
    [overlayId, textData, updateOverlay],
  );

  if (!textData) {
    return <div className={styles.empty}>文字不存在</div>;
  }

  return (
    <div className={styles.root}>
      {/* 内容区 */}
      <section className={styles.section}>
        <label className={styles.label}>内容</label>
        <textarea
          className={styles.textarea}
          value={textData.content}
          onChange={(e) => updateTextData({ content: e.target.value })}
          rows={3}
        />
      </section>

      {/* 字体区 */}
      <section className={styles.section}>
        <label className={styles.label}>字体</label>
        <select
          className={styles.select}
          value={textData.fontFamily}
          onChange={(e) => updateTextData({ fontFamily: e.target.value })}
        >
          <option value="PingFang SC">PingFang SC</option>
          <option value="Noto Sans SC">Noto Sans SC</option>
          <option value="Helvetica Neue">Helvetica Neue</option>
          <option value="Arial">Arial</option>
          <option value="STHeiti">STHeiti</option>
          <option value="SimHei">SimHei</option>
        </select>

        <div className={styles.row}>
          <input
            type="number"
            className={styles.numberInput}
            value={textData.fontSize}
            min={12}
            max={200}
            onChange={(e) => updateTextData({ fontSize: Number(e.target.value) })}
          />
          <input
            type="color"
            className={styles.colorInput}
            value={textData.fontColor}
            onChange={(e) => updateTextData({ fontColor: e.target.value })}
            title="字体颜色"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.toggleGroup}>
            <button
              className={[styles.toggleBtn, textData.bold ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => updateTextData({ bold: !textData.bold })}
              title="加粗"
            >
              <Bold size={14} />
            </button>
            <button
              className={[styles.toggleBtn, textData.italic ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => updateTextData({ italic: !textData.italic })}
              title="斜体"
            >
              <Italic size={14} />
            </button>
            <button
              className={[styles.toggleBtn, textData.underline ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => updateTextData({ underline: !textData.underline })}
              title="下划线"
            >
              <Underline size={14} />
            </button>
          </div>

          <div className={styles.toggleGroup}>
            <button
              className={[styles.toggleBtn, textData.textAlign === 'left' ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => updateTextData({ textAlign: 'left' })}
              title="左对齐"
            >
              <AlignLeft size={14} />
            </button>
            <button
              className={[styles.toggleBtn, textData.textAlign === 'center' ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => updateTextData({ textAlign: 'center' })}
              title="居中"
            >
              <AlignCenter size={14} />
            </button>
            <button
              className={[styles.toggleBtn, textData.textAlign === 'right' ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => updateTextData({ textAlign: 'right' })}
              title="右对齐"
            >
              <AlignRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* 背景区 */}
      <section className={styles.section}>
        <label className={styles.label}>背景</label>
        <div className={styles.row}>
          <input
            type="color"
            className={styles.colorInput}
            value={textData.backgroundColor === 'transparent' ? '#000000' : textData.backgroundColor}
            onChange={(e) => updateTextData({ backgroundColor: e.target.value })}
            title="背景颜色"
          />
          <button
            className={[styles.toggleBtn, textData.backgroundColor === 'transparent' ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() =>
              updateTextData({
                backgroundColor: textData.backgroundColor === 'transparent' ? 'rgba(0,0,0,0.5)' : 'transparent',
              })
            }
          >
            {textData.backgroundColor === 'transparent' ? '透明' : '有色'}
          </button>
        </div>
      </section>

      {/* 描边与阴影 */}
      <section className={styles.section}>
        <label className={styles.label}>描边</label>
        <div className={styles.row}>
          <input
            type="color"
            className={styles.colorInput}
            value={textData.strokeColor}
            onChange={(e) => updateTextData({ strokeColor: e.target.value })}
            title="描边颜色"
          />
          <input
            type="number"
            className={styles.numberInput}
            value={textData.strokeWidth}
            min={0}
            max={10}
            onChange={(e) => updateTextData({ strokeWidth: Number(e.target.value) })}
          />
        </div>

        <label className={styles.label}>阴影</label>
        <div className={styles.row}>
          <input
            type="color"
            className={styles.colorInput}
            value={textData.shadowColor}
            onChange={(e) => updateTextData({ shadowColor: e.target.value })}
            title="阴影颜色"
          />
          <input
            type="number"
            className={styles.numberInput}
            value={textData.shadowBlur}
            min={0}
            max={50}
            placeholder="模糊"
            onChange={(e) => updateTextData({ shadowBlur: Number(e.target.value) })}
          />
        </div>
        <div className={styles.row}>
          <input
            type="number"
            className={styles.numberInput}
            value={textData.shadowOffsetX}
            min={-50}
            max={50}
            placeholder="X偏移"
            onChange={(e) => updateTextData({ shadowOffsetX: Number(e.target.value) })}
          />
          <input
            type="number"
            className={styles.numberInput}
            value={textData.shadowOffsetY}
            min={-50}
            max={50}
            placeholder="Y偏移"
            onChange={(e) => updateTextData({ shadowOffsetY: Number(e.target.value) })}
          />
        </div>
      </section>

      {/* 间距 */}
      <section className={styles.section}>
        <label className={styles.label}>间距</label>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>字间距</span>
          <input
            type="range"
            min={-5}
            max={20}
            step={0.5}
            value={textData.letterSpacing}
            onChange={(e) => updateTextData({ letterSpacing: Number(e.target.value) })}
          />
          <span className={styles.sliderValue}>{textData.letterSpacing}px</span>
        </div>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>行间距</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={textData.lineHeight}
            onChange={(e) => updateTextData({ lineHeight: Number(e.target.value) })}
          />
          <span className={styles.sliderValue}>{textData.lineHeight}</span>
        </div>
      </section>

      {/* 变换 */}
      <section className={styles.section}>
        <label className={styles.label}>变换</label>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>透明度</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={textData.opacity}
            onChange={(e) => updateTextData({ opacity: Number(e.target.value) })}
          />
          <span className={styles.sliderValue}>{Math.round(textData.opacity * 100)}%</span>
        </div>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>旋转</span>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={textData.rotation}
            onChange={(e) => updateTextData({ rotation: Number(e.target.value) })}
          />
          <span className={styles.sliderValue}>{textData.rotation}°</span>
        </div>
      </section>

      {/* 动画 */}
      <section className={styles.section}>
        <label className={styles.label}>动画</label>
        <div className={styles.animRow}>
          <span className={styles.sliderLabel}>入场</span>
          <select
            className={styles.select}
            value={textData.animation.enter}
            onChange={(e) =>
              updateTextData({
                animation: { ...textData.animation, enter: e.target.value as TextOverlayData['animation']['enter'] },
              })
            }
          >
            <option value="none">无</option>
            <option value="fadeIn">淡入</option>
            <option value="slideInLeft">左滑入</option>
            <option value="slideInRight">右滑入</option>
            <option value="slideInUp">上滑入</option>
            <option value="slideInDown">下滑入</option>
            <option value="scaleIn">缩放入</option>
            <option value="bounceIn">弹入</option>
          </select>
          <input
            type="number"
            className={styles.numberInput}
            value={textData.animation.enterDurationMs}
            min={100}
            max={3000}
            step={100}
            onChange={(e) =>
              updateTextData({
                animation: { ...textData.animation, enterDurationMs: Number(e.target.value) },
              })
            }
          />
        </div>
        <div className={styles.animRow}>
          <span className={styles.sliderLabel}>循环</span>
          <select
            className={styles.select}
            value={textData.animation.loop}
            onChange={(e) =>
              updateTextData({
                animation: { ...textData.animation, loop: e.target.value as TextOverlayData['animation']['loop'] },
              })
            }
          >
            <option value="none">无</option>
            <option value="pulse">呼吸</option>
            <option value="float">浮动</option>
            <option value="flicker">闪烁</option>
            <option value="typewriter">打字机</option>
          </select>
        </div>
        <div className={styles.animRow}>
          <span className={styles.sliderLabel}>出场</span>
          <select
            className={styles.select}
            value={textData.animation.exit}
            onChange={(e) =>
              updateTextData({
                animation: { ...textData.animation, exit: e.target.value as TextOverlayData['animation']['exit'] },
              })
            }
          >
            <option value="none">无</option>
            <option value="fadeOut">淡出</option>
            <option value="slideOutLeft">左滑出</option>
            <option value="slideOutRight">右滑出</option>
            <option value="slideOutUp">上滑出</option>
            <option value="slideOutDown">下滑出</option>
            <option value="scaleOut">缩放出</option>
            <option value="bounceOut">弹出</option>
          </select>
          <input
            type="number"
            className={styles.numberInput}
            value={textData.animation.exitDurationMs}
            min={100}
            max={3000}
            step={100}
            onChange={(e) =>
              updateTextData({
                animation: { ...textData.animation, exitDurationMs: Number(e.target.value) },
              })
            }
          />
        </div>
      </section>

      {/* 删除 */}
      <section className={styles.section}>
        <Button
          variant="danger"
          className={styles.deleteButton}
          onClick={onDelete}
        >
          <Trash2 size={14} />
          删除文字
        </Button>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Create TextInspector CSS**

Create `src/components/TextInspector.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  overflow-y: auto;
}

.empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-muted);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border-subtle);
}

.section:last-child {
  border-bottom: none;
}

.label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
}

.textarea {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  background: var(--color-surface-secondary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  resize: vertical;
}

.select {
  width: 100%;
  padding: 6px 8px;
  background: var(--color-surface-secondary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.numberInput {
  width: 70px;
  padding: 6px 8px;
  background: var(--color-surface-secondary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
}

.colorInput {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 2px solid var(--color-border-subtle);
  border-radius: 6px;
  cursor: pointer;
  background: none;
}

.toggleGroup {
  display: flex;
  gap: 2px;
}

.toggleBtn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-secondary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.toggleBtn.active {
  background: var(--color-selection-blue);
  color: #fff;
  border-color: var(--color-selection-blue);
}

.sliderRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sliderLabel {
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  min-width: 44px;
}

.sliderValue {
  font-size: 12px;
  color: var(--color-text-primary);
  min-width: 40px;
  text-align: right;
}

.sliderRow input[type='range'] {
  flex: 1;
}

.animRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.animRow .select {
  flex: 1;
}

.deleteButton {
  width: 100%;
}
```

- [ ] **Step 4: Wire TextInspector into EditorInspector**

In `src/components/EditorInspector.tsx`, add import:
```typescript
import { TextInspector } from './TextInspector';
```

Update `eyebrowLabel`:
```typescript
const eyebrowLabel =
  selection.type === 'subtitle-style'
    ? 'SUBTITLE'
    : selection.type === 'ai-card'
    ? 'AI CARD'
    : selection.type === 'text-overlay'
    ? 'TEXT'
    : 'INSPECTOR';
```

In `renderBody()`, add before the empty state:
```typescript
if (selection.type === 'text-overlay') {
  return (
    <TextInspector
      overlayId={selection.overlayId}
      onDelete={() => {
        useTimelineStore.getState().removeOverlay(selection.overlayId);
        onClose();
      }}
    />
  );
}
```

Add `useTimelineStore` import:
```typescript
import { useTimelineStore } from '../store/timeline';
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/editor-inspector.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/TextInspector.tsx src/components/TextInspector.module.css src/components/EditorInspector.tsx
git commit -m "feat(inspector): 添加 TextInspector 文字属性编辑面板"
```

---

## Task 10: Canvas Interaction Layer

**Files:**
- Create: `src/hooks/useCanvasInteraction.ts`
- Create: `src/components/CanvasInteractionLayer.tsx`
- Create: `src/components/CanvasInteractionLayer.module.css`
- Modify: `src/components/PreviewPanel.tsx`

- [ ] **Step 1: Create the `useCanvasInteraction` hook**

Create `src/hooks/useCanvasInteraction.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import type { OverlayItem, OverlayPosition } from '../types';
import { clamp } from '../lib/utils';

type InteractionState = 'idle' | 'dragging' | 'resizing';
type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

interface DragState {
  startMouseX: number;
  startMouseY: number;
  startPosition: OverlayPosition;
  handle?: ResizeHandle;
}

interface UseCanvasInteractionParams {
  canvasWidth: number;
  canvasHeight: number;
  stageRect: DOMRect | null;
  onUpdatePosition: (overlayId: string, position: OverlayPosition) => void;
}

function screenToCanvas(
  mouseX: number,
  mouseY: number,
  stageRect: DOMRect,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: ((mouseX - stageRect.left) / stageRect.width) * canvasWidth,
    y: ((mouseY - stageRect.top) / stageRect.height) * canvasHeight,
  };
}

const MIN_SIZE_RATIO = 0.05;

function constrainPosition(
  pos: OverlayPosition,
  canvasWidth: number,
  canvasHeight: number,
): OverlayPosition {
  const minW = canvasWidth * MIN_SIZE_RATIO;
  const minH = canvasHeight * MIN_SIZE_RATIO;
  const w = Math.max(minW, pos.width);
  const h = Math.max(minH, pos.height);
  const minVisible = 0.1;
  const x = clamp(pos.x, -(w * (1 - minVisible)), canvasWidth - w * minVisible);
  const y = clamp(pos.y, -(h * (1 - minVisible)), canvasHeight - h * minVisible);
  return { x, y, width: w, height: h };
}

export function useCanvasInteraction({
  canvasWidth,
  canvasHeight,
  stageRect,
  onUpdatePosition,
}: UseCanvasInteractionParams) {
  const [state, setState] = useState<InteractionState>('idle');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const activeOverlayRef = useRef<string | null>(null);

  const startDrag = useCallback(
    (overlayId: string, position: OverlayPosition, mouseX: number, mouseY: number) => {
      activeOverlayRef.current = overlayId;
      dragRef.current = { startMouseX: mouseX, startMouseY: mouseY, startPosition: { ...position } };
      setState('dragging');
    },
    [],
  );

  const startResize = useCallback(
    (
      overlayId: string,
      position: OverlayPosition,
      handle: ResizeHandle,
      mouseX: number,
      mouseY: number,
    ) => {
      activeOverlayRef.current = overlayId;
      dragRef.current = {
        startMouseX: mouseX,
        startMouseY: mouseY,
        startPosition: { ...position },
        handle,
      };
      setState('resizing');
    },
    [],
  );

  const onMouseMove = useCallback(
    (mouseX: number, mouseY: number) => {
      if (!stageRect || !dragRef.current || !activeOverlayRef.current) return;

      const drag = dragRef.current;
      const current = screenToCanvas(mouseX, mouseY, stageRect, canvasWidth, canvasHeight);
      const start = screenToCanvas(drag.startMouseX, drag.startMouseY, stageRect, canvasWidth, canvasHeight);
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const sp = drag.startPosition;

      let next: OverlayPosition;

      if (state === 'dragging') {
        next = { x: sp.x + dx, y: sp.y + dy, width: sp.width, height: sp.height };
      } else {
        const handle = drag.handle!;
        let { x, y, width, height } = sp;

        if (handle.includes('w')) { x = sp.x + dx; width = sp.width - dx; }
        if (handle.includes('e')) { width = sp.width + dx; }
        if (handle.includes('n')) { y = sp.y + dy; height = sp.height - dy; }
        if (handle.includes('s')) { height = sp.height + dy; }

        next = { x, y, width, height };
      }

      onUpdatePosition(activeOverlayRef.current, constrainPosition(next, canvasWidth, canvasHeight));
    },
    [canvasWidth, canvasHeight, stageRect, state, onUpdatePosition],
  );

  const endInteraction = useCallback(() => {
    dragRef.current = null;
    setState('idle');
  }, []);

  return {
    state,
    hoveredId,
    setHoveredId,
    startDrag,
    startResize,
    onMouseMove,
    endInteraction,
  };
}
```

- [ ] **Step 2: Create CanvasInteractionLayer component**

Create `src/components/CanvasInteractionLayer.tsx`:

```typescript
import { useCallback, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import type { OverlayItem, OverlayPosition } from '../types';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import styles from './CanvasInteractionLayer.module.css';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

interface CanvasInteractionLayerProps {
  overlays: OverlayItem[];
  selectedOverlayId: string | null;
  canvasWidth: number;
  canvasHeight: number;
  stageRect: DOMRect | null;
  onSelect: (overlayId: string | null) => void;
  onUpdatePosition: (overlayId: string, position: OverlayPosition) => void;
}

function overlayToPercent(pos: OverlayPosition, cw: number, ch: number) {
  return {
    left: `${(pos.x / cw) * 100}%`,
    top: `${(pos.y / ch) * 100}%`,
    width: `${(pos.width / cw) * 100}%`,
    height: `${(pos.height / ch) * 100}%`,
  };
}

export function CanvasInteractionLayer({
  overlays,
  selectedOverlayId,
  canvasWidth,
  canvasHeight,
  stageRect,
  onSelect,
  onUpdatePosition,
}: CanvasInteractionLayerProps) {
  const textOverlays = overlays.filter((o) => o.type === 'text');
  const selectedOverlay = textOverlays.find((o) => o.id === selectedOverlayId);

  const {
    state,
    hoveredId,
    setHoveredId,
    startDrag,
    startResize,
    onMouseMove,
    endInteraction,
  } = useCanvasInteraction({ canvasWidth, canvasHeight, stageRect, onUpdatePosition });

  useEffect(() => {
    if (state === 'idle') return;

    const handleMove = (e: globalThis.MouseEvent) => onMouseMove(e.clientX, e.clientY);
    const handleUp = () => endInteraction();

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [state, onMouseMove, endInteraction]);

  const handleBackgroundClick = useCallback(
    (e: ReactMouseEvent) => {
      if (e.target === e.currentTarget) {
        onSelect(null);
      }
    },
    [onSelect],
  );

  const handleOverlayMouseDown = useCallback(
    (overlay: OverlayItem, e: ReactMouseEvent) => {
      e.stopPropagation();
      onSelect(overlay.id);
      startDrag(overlay.id, overlay.position, e.clientX, e.clientY);
    },
    [onSelect, startDrag],
  );

  const handleHandleMouseDown = useCallback(
    (overlay: OverlayItem, handle: ResizeHandle, e: ReactMouseEvent) => {
      e.stopPropagation();
      startResize(overlay.id, overlay.position, handle, e.clientX, e.clientY);
    },
    [startResize],
  );

  return (
    <div
      className={styles.root}
      onMouseDown={handleBackgroundClick}
    >
      {textOverlays.map((overlay) => {
        const isSelected = overlay.id === selectedOverlayId;
        const isHovered = overlay.id === hoveredId;
        const pct = overlayToPercent(overlay.position, canvasWidth, canvasHeight);

        return (
          <div
            key={overlay.id}
            className={[
              styles.overlayBox,
              isSelected ? styles.selected : '',
              isHovered && !isSelected ? styles.hovered : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={pct}
            onMouseDown={(e) => handleOverlayMouseDown(overlay, e)}
            onMouseEnter={() => setHoveredId(overlay.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {isSelected &&
              HANDLES.map((handle) => (
                <div
                  key={handle}
                  className={[styles.handle, styles[`handle_${handle}`]].join(' ')}
                  onMouseDown={(e) => handleHandleMouseDown(overlay, handle, e)}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Create CanvasInteractionLayer CSS**

Create `src/components/CanvasInteractionLayer.module.css`:

```css
.root {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: auto;
}

.overlayBox {
  position: absolute;
  cursor: move;
  border: 2px solid transparent;
  box-sizing: border-box;
}

.overlayBox.hovered {
  border: 1px dashed rgba(255, 255, 255, 0.3);
}

.overlayBox.selected {
  border: 2px solid var(--color-selection-blue, #3b82f6);
}

.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border: 2px solid var(--color-selection-blue, #3b82f6);
  border-radius: 2px;
  box-sizing: border-box;
}

.handle_nw { top: -5px; left: -5px; cursor: nw-resize; }
.handle_n  { top: -5px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.handle_ne { top: -5px; right: -5px; cursor: ne-resize; }
.handle_w  { top: 50%; left: -5px; transform: translateY(-50%); cursor: w-resize; }
.handle_e  { top: 50%; right: -5px; transform: translateY(-50%); cursor: e-resize; }
.handle_sw { bottom: -5px; left: -5px; cursor: sw-resize; }
.handle_s  { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.handle_se { bottom: -5px; right: -5px; cursor: se-resize; }
```

- [ ] **Step 4: Integrate into PreviewPanel**

In `src/components/PreviewPanel.tsx`:

Add imports:
```typescript
import { CanvasInteractionLayer } from './CanvasInteractionLayer';
import type { OverlayPosition } from '../types';
```

Add props to `PreviewPanelProps`:
```typescript
interface PreviewPanelProps {
  playerRef: RefObject<PlayerRef | null>;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onExport: () => void;
  currentTimeMs: number;
  durationMs: number;
  compact: boolean;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (overlayId: string | null) => void;
  onUpdateOverlayPosition?: (overlayId: string, position: OverlayPosition) => void;
}
```

Add a ref for stageFrame rect and state:
```typescript
const stageFrameRef = useRef<HTMLDivElement>(null);
const [stageFrameRect, setStageFrameRect] = useState<DOMRect | null>(null);
```

Update the ResizeObserver to also capture stageFrame rect:
```typescript
const updateStageSize = () => {
  const nextStageSize = fitPreviewStage(
    container.clientWidth,
    container.clientHeight,
    timeline.width,
    timeline.height,
  );
  setStageSize(nextStageSize);
  if (stageFrameRef.current) {
    setStageFrameRect(stageFrameRef.current.getBoundingClientRect());
  }
};
```

Add `ref={stageFrameRef}` to the `.stageFrame` div, and wrap the interaction layer around/after the Player inside it:

```tsx
<div
  ref={stageFrameRef}
  className={styles.stageFrame}
  style={{
    width: Math.max(0, stageSize.width),
    height: Math.max(0, stageSize.height),
    position: 'relative',
  }}
>
  <Player ... />
  {onSelectOverlay && (
    <CanvasInteractionLayer
      overlays={timeline.overlays}
      selectedOverlayId={selectedOverlayId ?? null}
      canvasWidth={timeline.width}
      canvasHeight={timeline.height}
      stageRect={stageFrameRect}
      onSelect={onSelectOverlay}
      onUpdatePosition={onUpdateOverlayPosition ?? (() => {})}
    />
  )}
</div>
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/preview-panel.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCanvasInteraction.ts src/components/CanvasInteractionLayer.tsx src/components/CanvasInteractionLayer.module.css src/components/PreviewPanel.tsx
git commit -m "feat(canvas): 添加预览区交互层支持拖拽和缩放"
```

---

## Task 11: Editor Wiring

**Files:**
- Modify: `src/pages/Editor.tsx`

- [ ] **Step 1: Wire everything together in Editor**

In `src/pages/Editor.tsx`:

The editor already has `inspectorSelection` and `setInspectorSelection` state. We need to:

1. Pass `onOpenTextInspector` to Timeline
2. Pass canvas interaction props to PreviewPanel
3. Handle overlay selection sync between Timeline, Preview, and Inspector

Add the callback:
```typescript
const handleOpenTextInspector = useCallback(
  (overlayId: string) => {
    setInspectorSelection({ type: 'text-overlay', overlayId });
  },
  [],
);

const handleSelectOverlayOnCanvas = useCallback(
  (overlayId: string | null) => {
    if (overlayId) {
      const overlay = timeline.overlays.find((o) => o.id === overlayId);
      if (overlay?.type === 'text') {
        setInspectorSelection({ type: 'text-overlay', overlayId });
        return;
      }
    }
    setInspectorSelection({ type: 'empty' });
  },
  [timeline.overlays],
);

const handleUpdateOverlayPosition = useCallback(
  (overlayId: string, position: OverlayPosition) => {
    useTimelineStore.getState().updateOverlay(overlayId, { position });
  },
  [],
);
```

Add `OverlayPosition` import:
```typescript
import type { OverlayPosition } from '../types';
```

Pass to PreviewPanel:
```typescript
<PreviewPanel
  ...existingProps
  selectedOverlayId={
    inspectorSelection.type === 'text-overlay' ? inspectorSelection.overlayId : null
  }
  onSelectOverlay={handleSelectOverlayOnCanvas}
  onUpdateOverlayPosition={handleUpdateOverlayPosition}
/>
```

Pass to Timeline:
```typescript
<Timeline
  ...existingProps
  onOpenTextInspector={handleOpenTextInspector}
/>
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/Editor.tsx
git commit -m "feat(editor): 连接文字 overlay 选中、拖拽和 Inspector 面板"
```

---

## Task 12: Type Check & Final Verification

**Files:** All modified files

- [ ] **Step 1: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors. Fix any type errors found.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Run build**

Run: `npx electron-vite build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: 修复文字叠加功能类型检查和构建问题"
```

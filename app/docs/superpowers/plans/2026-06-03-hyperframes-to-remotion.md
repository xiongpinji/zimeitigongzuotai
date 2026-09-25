# HyperFrames → Remotion 渲染引擎迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将预览与导出的渲染引擎从 HyperFrames（HTML+GSAP）整体切换为 Remotion（React/帧驱动），并把 AI 卡片从「自由 HTML+GSAP」改为「LLM 生成自由 Remotion TSX + esbuild 运行时编译」。

**Architecture:** `TimelineData` 仍是唯一数据源。新增 `src/remotion/` 把 timeline 编译为 Remotion 组件树（`<Sequence>` + overlay 组件）；预览用 `@remotion/player`，导出用 `@remotion/bundler` + `@remotion/renderer`（自带 Chrome + ffmpeg）。AI 卡片 TSX 经 esbuild 编译：预览在 sandbox `<iframe>` 内 eval（保持主渲染进程 CSP 严格），导出把卡片编译进 Remotion bundle。完成后硬切换、删除 HyperFrames。

**Tech Stack:** Electron 41 / React 19 / TypeScript 6 / Vitest / Remotion 4.x（`remotion`、`@remotion/player`、`@remotion/bundler`、`@remotion/renderer`）/ esbuild。

**参考规范：** `docs/superpowers/specs/2026-06-03-hyperframes-to-remotion-design.md`

---

## 文件结构总览

**新增（renderer Remotion 工程）**
- `src/remotion/frames.ts` — ms↔frame 工具（依据 fps），纯函数
- `src/remotion/timeline-to-sequences.ts` — TimelineData → 可渲染 overlay 描述（纯函数，可测）
- `src/remotion/MainComposition.tsx` — 组件树根，消费上面的描述
- `src/remotion/overlays/{VideoOverlay,ImageOverlay,TextOverlay,AudioOverlay,SubtitleLayer,AICardOverlay,LegacyCard}.tsx`
- `src/remotion/Root.tsx` — `registerRoot` + `<Composition>`（供 bundle 使用）
- `src/remotion/index.ts` — bundle 入口（`import './Root'`）
- `src/remotion/compile-card.ts` — esbuild TSX→JS（react/remotion external），纯逻辑
- `src/remotion/card-runtime.ts` — 预览侧 sandbox iframe 加载/帧同步协议
- `src/components/RemotionPreviewPlayer.tsx` — 取代 `HyperframesPreviewPlayer.tsx`

**新增（electron 导出）**
- `electron/remotion/bundle.ts` — `@remotion/bundler` 打包 + 缓存
- `electron/remotion/render.ts` — `@remotion/renderer` renderMedia

**改造**
- `src/lib/motion-compiler.ts`（GSAP 校验 → TSX 编译校验）
- `src/types/motion.ts`、`src/types/ai.ts`（`MotionCardPayload.html`→`tsx`）
- `src/lib/ai-analysis.ts`、`src/lib/single-card-generation.ts`
- `src/components/PreviewPanel.tsx`、`src/lib/playback.ts`、`src/pages/Editor.tsx`
- `src/components/AICardInspector.tsx`
- `src/lib/prompts/defaults.ts`（motion.* 提示词）
- `electron/main.ts`（`render-video` IPC、删 `prepareHyperframesProject` / `hyperframes-runtime-preflight`）
- `electron/preload.ts`、`src/lib/electron-api.ts`（IPC 三件套）
- `electron/runtime-binaries.ts`（删 gsap/chrome，保留 ffmpeg/ffprobe）
- `src/vite-env.d.ts`、`CLAUDE.md`、`CHANGELOG.md`

**删除**
- `src/hyperframes/{composition,assets,types}.ts`
- `src/components/HyperframesPreviewPlayer.tsx`
- `electron/hyperframes-cli.ts`、`electron/hyperframes-runtime-preflight.ts`

---

## Phase 0 — 依赖与脚手架

### Task 0.1: 切换依赖

**Files:** Modify `package.json`

- [ ] **Step 1: 移除 HyperFrames，安装 Remotion + esbuild**

```bash
npm remove hyperframes @hyperframes/player
npm install remotion @remotion/player @remotion/bundler @remotion/renderer esbuild
```

- [ ] **Step 2: 验证版本一致（四个 remotion 包主版本必须相同）**

Run: `node -e "const p=require('./package.json').dependencies;console.log(p.remotion,p['@remotion/player'],p['@remotion/bundler'],p['@remotion/renderer'])"`
Expected: 四者主次版本一致（如均为 `^4.x`）。若不一致，手动对齐后 `npm install`。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: 移除 hyperframes，引入 remotion + esbuild"
```

---

## Phase 1 — Remotion 合成核心（纯逻辑优先，TDD）

### Task 1.1: 帧换算工具

**Files:** Create `src/remotion/frames.ts`; Test `tests/remotion-frames.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { msToFrames, framesToMs, durationFrames } from '../src/remotion/frames';

describe('frames util', () => {
  it('rounds ms to nearest frame at 30fps', () => {
    expect(msToFrames(0, 30)).toBe(0);
    expect(msToFrames(1000, 30)).toBe(30);
    expect(msToFrames(33, 30)).toBe(1); // 33ms ≈ 0.99 frame → 1
  });
  it('durationFrames is at least 1 for tiny positive spans', () => {
    expect(durationFrames(1, 30)).toBe(1);
    expect(durationFrames(0, 30)).toBe(1);
  });
  it('framesToMs inverts msToFrames at frame boundaries', () => {
    expect(framesToMs(30, 30)).toBe(1000);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/remotion-frames.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
export function msToFrames(ms: number, fps: number): number {
  return Math.round((Math.max(0, ms) / 1000) * fps);
}

export function framesToMs(frames: number, fps: number): number {
  return Math.round((Math.max(0, frames) / fps) * 1000);
}

/** Sequence durationInFrames 必须 >= 1，避免 Remotion 报错。 */
export function durationFrames(ms: number, fps: number): number {
  return Math.max(1, msToFrames(ms, fps));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/remotion-frames.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/remotion/frames.ts tests/remotion-frames.test.ts
git commit -m "feat(remotion): 帧换算工具"
```

### Task 1.2: TimelineData → 可渲染序列描述（纯函数，取代 composition.ts 的布局/排序逻辑）

**Files:** Create `src/remotion/timeline-to-sequences.ts`; Test `tests/remotion-timeline-to-sequences.test.ts`

该模块**只做数据转换**，不返回 JSX：把 timeline 转成 `RenderableClip[]`，供 `MainComposition.tsx` 映射成组件。复用现有 `getRenderableOverlays`/`getRenderableVisualTracks`（`src/lib/timeline-tracks.ts`）与 z-index 规则（背景 1 / 视觉 10+order / 字幕 1000）。

- [ ] **Step 1: 写失败测试**（断言分层、startFrame/durationFrames、z-index、音频/视觉拆分）

```ts
import { describe, it, expect } from 'vitest';
import { buildRenderPlan } from '../src/remotion/timeline-to-sequences';
import type { TimelineData } from '../src/types';

function baseTimeline(): TimelineData {
  return {
    version: 1, fps: 30, width: 1080, height: 1920,
    podcast: { audioPath: '/p/a.mp3', srtPath: '/p/s.srt', durationMs: 4000 },
    tracks: [{ id: 't1', kind: 'visual', order: 0, name: 'V1', visible: true }],
    overlays: [
      { id: 'v1', type: 'image', assetPath: '/p/i.png', trackId: 't1', startMs: 0, durationMs: 2000,
        position: { x: 0, y: 0, width: 1080, height: 1920 } },
    ],
    subtitle: { fontSize: 48, color: '#fff', position: 'bottom', highlightEnabled: false } as any,
  } as any;
}

describe('buildRenderPlan', () => {
  it('separates audio and visual clips and computes frames', () => {
    const plan = buildRenderPlan(baseTimeline(), [], 30);
    expect(plan.durationFrames).toBeGreaterThan(0);
    const img = plan.visual.find((c) => c.id === 'v1');
    expect(img).toBeTruthy();
    expect(img!.startFrame).toBe(0);
    expect(img!.durationFrames).toBe(60); // 2000ms @30fps
    expect(img!.zIndex).toBe(10); // VISUAL_BASE + order(0)
  });
  it('includes podcast audio as an audio clip', () => {
    const plan = buildRenderPlan(baseTimeline(), [], 30);
    expect(plan.audio.some((a) => a.assetPath === '/p/a.mp3')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/remotion-timeline-to-sequences.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**（移植 composition.ts 的分类/z-index/排序，输出数据而非 HTML）

```ts
import { getRenderableOverlays, getRenderableVisualTracks } from '../lib/timeline-tracks';
import { getEffectiveTimelineDurationMs } from '../lib/utils';
import type { OverlayItem, SrtEntry, TimelineData } from '../types';
import { durationFrames, msToFrames } from './frames';

const VISUAL_BASE_Z_INDEX = 10;
const BACKGROUND_Z_INDEX = 1;
const SUBTITLE_Z_INDEX = 1000;

export interface RenderableClip {
  id: string;
  kind: 'video' | 'image' | 'text' | 'ai-card';
  overlay: OverlayItem;
  startFrame: number;
  durationFrames: number;
  zIndex: number;
}

export interface RenderableAudio {
  id: string;
  assetPath: string;
  startFrame: number;
  durationFrames: number;
  trimStartMs: number;
  volume: number;
}

export interface RenderableSubtitle {
  index: number;
  text: string;
  startFrame: number;
  durationFrames: number;
}

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  visual: RenderableClip[];
  audio: RenderableAudio[];
  subtitles: RenderableSubtitle[];
}

function trackZIndex(timeline: TimelineData, overlay: OverlayItem): number {
  if (overlay.overlayRole === 'default-background') return BACKGROUND_Z_INDEX;
  const map = new Map(getRenderableVisualTracks(timeline.tracks).map((t) => [t.id, t.order]));
  return VISUAL_BASE_Z_INDEX + (map.get(overlay.trackId) ?? 0);
}

export function buildRenderPlan(timeline: TimelineData, srt: SrtEntry[], fpsArg?: number): RenderPlan {
  const fps = fpsArg ?? timeline.fps ?? 30;
  const durationMs = getEffectiveTimelineDurationMs(timeline);
  const renderable = getRenderableOverlays(timeline);
  const visual: RenderableClip[] = [];
  const audio: RenderableAudio[] = [];

  for (const overlay of renderable) {
    if (overlay.type === 'audio') {
      const d = overlay.audioData;
      audio.push({
        id: overlay.id,
        assetPath: overlay.assetPath,
        startFrame: msToFrames(overlay.startMs, fps),
        durationFrames: durationFrames(overlay.durationMs, fps),
        trimStartMs: d?.trimStartMs ?? 0,
        volume: d?.muted ? 0 : Math.max(0, Math.min(1.5, d?.volume ?? 1)),
      });
      continue;
    }
    const kind = overlay.overlayType === 'ai-card' ? 'ai-card' : overlay.type;
    visual.push({
      id: overlay.id,
      kind: kind as RenderableClip['kind'],
      overlay,
      startFrame: msToFrames(overlay.startMs, fps),
      durationFrames: durationFrames(overlay.durationMs, fps),
      zIndex: trackZIndex(timeline, overlay),
    });
  }

  if (timeline.podcast.audioPath) {
    audio.unshift({
      id: 'podcast-audio',
      assetPath: timeline.podcast.audioPath,
      startFrame: 0,
      durationFrames: durationFrames(timeline.podcast.durationMs || durationMs, fps),
      trimStartMs: 0,
      volume: 1,
    });
  }

  const subtitles: RenderableSubtitle[] = srt.map((e, index) => ({
    index,
    text: e.text,
    startFrame: msToFrames(e.startMs, fps),
    durationFrames: durationFrames(Math.max(1, e.endMs - e.startMs), fps),
  }));

  return {
    width: timeline.width,
    height: timeline.height,
    fps,
    durationFrames: durationFrames(durationMs, fps),
    visual,
    audio,
    subtitles,
  };
}

export { SUBTITLE_Z_INDEX };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/remotion-timeline-to-sequences.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/remotion/timeline-to-sequences.ts tests/remotion-timeline-to-sequences.test.ts
git commit -m "feat(remotion): timeline → 渲染计划纯函数"
```

### Task 1.3: Overlay 组件（media/text/audio/subtitle）

**Files:** Create `src/remotion/overlays/{VideoOverlay,ImageOverlay,TextOverlay,AudioOverlay,SubtitleLayer}.tsx`

这些是展示型组件，逻辑直接对应 composition.ts 的样式。验证靠 Phase 2 预览 + Phase 8 build。

- [ ] **Step 1: `VideoOverlay.tsx`**（导出 OffthreadVideo，预览 Video，按 `isRendering` 切换）

```tsx
import { AbsoluteFill, OffthreadVideo, Video } from 'remotion';
import { useIsRendering } from '../use-is-rendering';
import type { OverlayItem } from '../../types';
import { toFileSrc } from '../../lib/utils';

export function VideoOverlay({ overlay, zIndex }: { overlay: OverlayItem; zIndex: number }) {
  const isRendering = useIsRendering();
  const V = isRendering ? OffthreadVideo : Video;
  const src = toFileSrc(overlay.assetPath);
  return (
    <AbsoluteFill style={{ left: overlay.position.x, top: overlay.position.y, width: overlay.position.width, height: overlay.position.height, zIndex, overflow: 'hidden' }}>
      <V src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}
```

- [ ] **Step 2: `ImageOverlay.tsx`**

```tsx
import { AbsoluteFill, Img } from 'remotion';
import type { OverlayItem } from '../../types';
import { toFileSrc } from '../../lib/utils';

export function ImageOverlay({ overlay, zIndex }: { overlay: OverlayItem; zIndex: number }) {
  return (
    <AbsoluteFill style={{ left: overlay.position.x, top: overlay.position.y, width: overlay.position.width, height: overlay.position.height, zIndex, overflow: 'hidden' }}>
      <Img src={toFileSrc(overlay.assetPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}
```

- [ ] **Step 3: `TextOverlay.tsx`**（移植 composition.ts:113-153 样式 + interpolate 淡入淡出）

```tsx
import { interpolate, useCurrentFrame } from 'remotion';
import type { OverlayItem } from '../../types';

export function TextOverlay({ overlay, zIndex, durationFrames }: { overlay: OverlayItem; zIndex: number; durationFrames: number }) {
  const t = overlay.textData;
  const frame = useCurrentFrame();
  if (!t) return null;
  const fadeIn = Math.min(13, Math.max(5, Math.round(durationFrames * 0.18)));
  const opacity = interpolate(frame, [0, fadeIn], [0, t.opacity ?? 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{
      position: 'absolute', left: overlay.position.x, top: overlay.position.y,
      width: overlay.position.width, height: overlay.position.height, zIndex,
      display: 'flex', alignItems: 'center',
      justifyContent: t.textAlign === 'center' ? 'center' : t.textAlign === 'right' ? 'flex-end' : 'flex-start',
      fontFamily: t.fontFamily, fontSize: t.fontSize, color: t.fontColor,
      fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? 'italic' : 'normal',
      textDecoration: t.underline ? 'underline' : 'none', textAlign: t.textAlign,
      backgroundColor: t.backgroundColor,
      WebkitTextStroke: t.strokeWidth > 0 ? `${t.strokeWidth}px ${t.strokeColor}` : undefined,
      textShadow: (t.shadowBlur > 0 || t.shadowOffsetX !== 0 || t.shadowOffsetY !== 0)
        ? `${t.shadowOffsetX}px ${t.shadowOffsetY}px ${t.shadowBlur}px ${t.shadowColor}` : undefined,
      letterSpacing: t.letterSpacing, lineHeight: t.lineHeight, opacity,
      transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
      wordBreak: 'break-word', whiteSpace: 'pre-wrap',
    }}>{t.content}</div>
  );
}
```

- [ ] **Step 4: `AudioOverlay.tsx`**

```tsx
import { Audio } from 'remotion';
import type { RenderableAudio } from '../timeline-to-sequences';
import { framesToMs } from '../frames';
import { toFileSrc } from '../../lib/utils';

export function AudioOverlay({ clip, fps }: { clip: RenderableAudio; fps: number }) {
  return <Audio src={toFileSrc(clip.assetPath)} volume={clip.volume} startFrom={Math.round((clip.trimStartMs / 1000) * fps)} />;
}
```

- [ ] **Step 5: `SubtitleLayer.tsx`**（移植高亮逻辑，复用 `filterValidSubtitleHighlights`）

```tsx
import type { SubtitleHighlight, SubtitleStyle } from '../../types';
import type { RenderableSubtitle } from '../timeline-to-sequences';
import { filterValidSubtitleHighlights } from '../../lib/subtitle-highlights';

export function SubtitleLayer({ cue, style, highlights }: { cue: RenderableSubtitle; style: SubtitleStyle; highlights: SubtitleHighlight[] }) {
  const pos = style.position === 'top' ? { top: 60 } : style.position === 'center' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: 64 };
  const valid = filterValidSubtitleHighlights([{ index: cue.index, startMs: 0, endMs: 1, text: cue.text }], highlights)[0];
  const content = (valid && style.highlightEnabled)
    ? <>{cue.text.slice(0, valid.start)}<span style={{ padding: `${style.highlightPaddingY}px ${style.highlightPaddingX}px`, borderRadius: style.highlightRadius, background: style.highlightBackgroundColor, color: style.highlightTextColor }}>{cue.text.slice(valid.start, valid.end)}</span>{cue.text.slice(valid.end)}</>
    : cue.text;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 1000, textAlign: 'center', padding: '0 80px', pointerEvents: 'none', ...pos }}>
      <span style={{ fontSize: style.fontSize, color: style.color, fontWeight: 700, lineHeight: 1.42, textShadow: '0 2px 10px rgba(0,0,0,.72)', whiteSpace: 'pre-line', display: 'inline-block', maxWidth: '100%' }}>{content}</span>
    </div>
  );
}
```

- [ ] **Step 6: `src/remotion/use-is-rendering.ts`**（区分预览/导出，用于 Video vs OffthreadVideo）

```ts
import { getRemotionEnvironment } from 'remotion';
export function useIsRendering(): boolean {
  return getRemotionEnvironment().isRendering;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/remotion/overlays src/remotion/use-is-rendering.ts
git commit -m "feat(remotion): overlay 展示组件（video/image/text/audio/subtitle）"
```

### Task 1.4: AICardOverlay + LegacyCard 占位

**Files:** Create `src/remotion/overlays/AICardOverlay.tsx`, `src/remotion/overlays/LegacyCard.tsx`

- [ ] **Step 1: `LegacyCard.tsx`**（旧 HTML+GSAP 卡片降级占位，对应 spec §5.1）

```tsx
export function LegacyCard({ title }: { title?: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#101827', color: '#f6f8fb', textAlign: 'center', padding: 40, gap: 12 }}>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{title || '旧版卡片'}</div>
      <div style={{ fontSize: 20, opacity: 0.7 }}>此卡片为旧 HyperFrames 格式，需重新生成为 Remotion 卡片</div>
    </div>
  );
}
```

- [ ] **Step 2: `AICardOverlay.tsx`**（导出：直接渲染编译进 bundle 的组件；预览：sandbox iframe，见 Phase 3。先做导出路径 + 旧卡片降级）

```tsx
import { AbsoluteFill } from 'remotion';
import type { OverlayItem } from '../../types';
import { LegacyCard } from './LegacyCard';
import { CardHost } from '../card-host'; // Phase 3 提供

export function AICardOverlay({ overlay, zIndex }: { overlay: OverlayItem; zIndex: number }) {
  const card = overlay.aiCardData;
  if (!card) return null;
  const fullscreen = card.displayMode === 'fullscreen';
  const wrapper = fullscreen
    ? { position: 'absolute' as const, inset: 0, zIndex, overflow: 'hidden' as const }
    : { position: 'absolute' as const, left: overlay.position.x, top: overlay.position.y, width: overlay.position.width, height: overlay.position.height, zIndex, overflow: 'hidden' as const, borderRadius: 18, boxShadow: '0 10px 30px rgba(0,0,0,.45)' };
  const tsx = card.renderMode === 'motion-card' ? card.motionCard?.tsx : undefined;
  if (card.renderMode === 'motion-card' && !tsx?.trim()) {
    return <AbsoluteFill style={wrapper}><LegacyCard title={card.title} /></AbsoluteFill>;
  }
  return <AbsoluteFill style={wrapper}><CardHost overlayId={overlay.id} tsx={tsx ?? ''} /></AbsoluteFill>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/remotion/overlays/AICardOverlay.tsx src/remotion/overlays/LegacyCard.tsx
git commit -m "feat(remotion): AI 卡片 overlay + 旧卡片降级占位"
```

### Task 1.5: MainComposition + Root + bundle 入口

**Files:** Create `src/remotion/MainComposition.tsx`, `src/remotion/Root.tsx`, `src/remotion/index.ts`

- [ ] **Step 1: `MainComposition.tsx`**

```tsx
import { AbsoluteFill, Sequence } from 'remotion';
import type { SrtEntry, TimelineData } from '../types';
import { buildRenderPlan } from './timeline-to-sequences';
import { VideoOverlay } from './overlays/VideoOverlay';
import { ImageOverlay } from './overlays/ImageOverlay';
import { TextOverlay } from './overlays/TextOverlay';
import { AudioOverlay } from './overlays/AudioOverlay';
import { SubtitleLayer } from './overlays/SubtitleLayer';
import { AICardOverlay } from './overlays/AICardOverlay';

export interface MainCompositionProps {
  timeline: TimelineData;
  srtEntries: SrtEntry[];
}

export function MainComposition({ timeline, srtEntries }: MainCompositionProps) {
  const plan = buildRenderPlan(timeline, srtEntries, timeline.fps ?? 30);
  return (
    <AbsoluteFill style={{ backgroundColor: '#04060a' }}>
      {plan.audio.map((a) => (
        <Sequence key={a.id} from={a.startFrame} durationInFrames={a.durationFrames}>
          <AudioOverlay clip={a} fps={plan.fps} />
        </Sequence>
      ))}
      {plan.visual.map((c) => (
        <Sequence key={c.id} from={c.startFrame} durationInFrames={c.durationFrames}>
          {c.kind === 'ai-card' ? <AICardOverlay overlay={c.overlay} zIndex={c.zIndex} />
            : c.kind === 'text' ? <TextOverlay overlay={c.overlay} zIndex={c.zIndex} durationFrames={c.durationFrames} />
            : c.kind === 'video' ? <VideoOverlay overlay={c.overlay} zIndex={c.zIndex} />
            : <ImageOverlay overlay={c.overlay} zIndex={c.zIndex} />}
        </Sequence>
      ))}
      {plan.subtitles.map((s) => (
        <Sequence key={`sub-${s.index}`} from={s.startFrame} durationInFrames={s.durationFrames}>
          <SubtitleLayer cue={s} style={timeline.subtitle} highlights={timeline.subtitleHighlights ?? []} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
```

- [ ] **Step 2: `Root.tsx`**（`calculateMetadata` 从 inputProps 推导宽高/fps/时长）

```tsx
import { Composition } from 'remotion';
import { MainComposition, type MainCompositionProps } from './MainComposition';
import { buildRenderPlan } from './timeline-to-sequences';

export function RemotionRoot() {
  return (
    <Composition
      id="lingji-composition"
      component={MainComposition as React.FC<Record<string, unknown>>}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{} as unknown as MainCompositionProps}
      calculateMetadata={({ props }) => {
        const p = props as MainCompositionProps;
        const plan = buildRenderPlan(p.timeline, p.srtEntries, p.timeline.fps ?? 30);
        return { durationInFrames: plan.durationFrames, fps: plan.fps, width: plan.width, height: plan.height };
      }}
    />
  );
}
```

- [ ] **Step 3: `index.ts`**

```ts
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';
registerRoot(RemotionRoot);
```

- [ ] **Step 4: 类型检查（无独立测试，靠 build）**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 与本阶段相关文件无类型错误（`card-host` 尚未实现会报错 → 在 Phase 3 补；此步可暂时用占位 `CardHost` stub）。

- [ ] **Step 5: 临时 `src/remotion/card-host.tsx` stub（Phase 3 替换）**

```tsx
export function CardHost(_: { overlayId: string; tsx: string }) {
  return <div style={{ width: '100%', height: '100%' }} />;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/remotion/MainComposition.tsx src/remotion/Root.tsx src/remotion/index.ts src/remotion/card-host.tsx
git commit -m "feat(remotion): MainComposition + Root + bundle 入口"
```

---

## Phase 2 — 预览（@remotion/player）

### Task 2.1: RemotionPreviewPlayer

**Files:** Create `src/components/RemotionPreviewPlayer.tsx`

保持与 `HyperframesPreviewHandle` 相同的命令式接口（`play/pause/seekToMs/isPlaying/setVolume/mute/unmute`），让 `PreviewPanel`/`Editor` 改动最小。

- [ ] **Step 1: 实现**（`@remotion/player` `PlayerRef` 映射）

```tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { MainComposition } from '../remotion/MainComposition';
import { buildRenderPlan } from '../remotion/timeline-to-sequences';
import type { SrtEntry, TimelineData } from '../types';

export interface RemotionPreviewHandle {
  play: () => void; pause: () => void; seekToMs: (ms: number) => void;
  isPlaying: () => boolean; setVolume: (v: number) => void; mute: () => void; unmute: () => void;
}

interface Props {
  timeline: TimelineData; srtEntries: SrtEntry[]; currentTimeMs: number;
  onTimeUpdate: (ms: number) => void; onPlay: () => void; onPause: () => void; onEnded: () => void;
}

export const RemotionPreviewPlayer = forwardRef<RemotionPreviewHandle, Props>(function RemotionPreviewPlayer(
  { timeline, srtEntries, currentTimeMs, onTimeUpdate, onPlay, onPause, onEnded }, ref,
) {
  const player = useRef<PlayerRef>(null);
  const plan = useMemo(() => buildRenderPlan(timeline, srtEntries, timeline.fps ?? 30), [timeline, srtEntries]);
  const fps = plan.fps;

  useImperativeHandle(ref, () => ({
    play: () => player.current?.play(),
    pause: () => player.current?.pause(),
    seekToMs: (ms) => player.current?.seekTo(Math.round((ms / 1000) * fps)),
    isPlaying: () => !!player.current?.isPlaying(),
    setVolume: (v) => player.current?.setVolume(Math.max(0, Math.min(1, v))),
    mute: () => player.current?.mute(),
    unmute: () => player.current?.unmute(),
  }));

  useEffect(() => {
    const p = player.current; if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => onTimeUpdate(Math.round((e.detail.frame / fps) * 1000));
    p.addEventListener('frameupdate', onFrame as EventListener);
    p.addEventListener('play', onPlay); p.addEventListener('pause', onPause); p.addEventListener('ended', onEnded);
    return () => {
      p.removeEventListener('frameupdate', onFrame as EventListener);
      p.removeEventListener('play', onPlay); p.removeEventListener('pause', onPause); p.removeEventListener('ended', onEnded);
    };
  }, [fps, onTimeUpdate, onPlay, onPause, onEnded]);

  useEffect(() => {
    const p = player.current; if (!p) return;
    const target = Math.round((currentTimeMs / 1000) * fps);
    if (Math.abs(p.getCurrentFrame() - target) > Math.ceil(fps * 0.25)) p.seekTo(target);
  }, [currentTimeMs, fps]);

  return (
    <Player ref={player} component={MainComposition as React.FC<Record<string, unknown>>}
      inputProps={{ timeline, srtEntries }}
      durationInFrames={plan.durationFrames} compositionWidth={plan.width} compositionHeight={plan.height} fps={fps}
      style={{ width: '100%', height: '100%', background: 'var(--color-preview-bg)' }} controls={false} />
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RemotionPreviewPlayer.tsx
git commit -m "feat(preview): RemotionPreviewPlayer 接 @remotion/player"
```

### Task 2.2: 切换 PreviewPanel / Editor 引用

**Files:** Modify `src/components/PreviewPanel.tsx`, `src/pages/Editor.tsx`

- [ ] **Step 1: 全量定位旧引用**

Run: `grep -rn "HyperframesPreviewPlayer\|HyperframesPreviewHandle" src`
Expected: 列出所有引用点（PreviewPanel/Editor 等）。

- [ ] **Step 2: 替换 import 与组件名**：把 `HyperframesPreviewPlayer`→`RemotionPreviewPlayer`、`HyperframesPreviewHandle`→`RemotionPreviewHandle`；删除 `projectDir` prop（预览用 `toFileSrc` 直接处理绝对路径，无需 projectDir 改写）。逐处确认 ref 调用面与新接口一致。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无与预览相关的类型错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/PreviewPanel.tsx src/pages/Editor.tsx
git commit -m "refactor(preview): 预览切换到 RemotionPreviewPlayer"
```

---

## Phase 3 — AI 卡片 TSX 编译 + 预览 sandbox

### Task 3.1: compile-card（esbuild TSX→JS）

**Files:** Create `src/remotion/compile-card.ts`; Test `tests/compile-card.test.ts`

esbuild 在 renderer 不可用（需 Node）；编译实际发生在 **Electron 主进程**或预览前经 IPC。为可测，`compile-card.ts` 暴露纯逻辑 `wrapCardSource`（拼装 + 校验），真正的 esbuild 调用放在 `electron/remotion/compile-card-node.ts`（Phase 4）。本任务做校验/包装纯逻辑，替代旧 `motion-compiler` 的角色。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { validateCardTsx, stripCodeFences } from '../src/remotion/compile-card';

describe('validateCardTsx', () => {
  it('rejects empty', () => { expect(validateCardTsx('').ok).toBe(false); });
  it('requires a default export', () => {
    expect(validateCardTsx('const X = () => null;').ok).toBe(false);
    expect(validateCardTsx('export default function X(){ return null; }').ok).toBe(true);
  });
  it('strips ```tsx fences', () => {
    expect(stripCodeFences('```tsx\nexport default 1\n```')).toBe('export default 1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/compile-card.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
const FENCE = /^```(?:tsx|jsx|ts|js)?\s*|\s*```$/g;
const DEFAULT_EXPORT = /export\s+default\b/;

export function stripCodeFences(src: string): string {
  return src.trim().replace(/^```(?:tsx|jsx|ts|js)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export interface CardValidation { ok: boolean; error?: string }

export function validateCardTsx(src: string): CardValidation {
  const code = stripCodeFences(src);
  if (!code) return { ok: false, error: 'Motion Card TSX 不能为空' };
  if (!DEFAULT_EXPORT.test(code)) return { ok: false, error: 'Motion Card 必须有 default export 的 Remotion 组件' };
  return { ok: true };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/compile-card.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/remotion/compile-card.ts tests/compile-card.test.ts
git commit -m "feat(remotion): 卡片 TSX 校验/去围栏纯逻辑"
```

### Task 3.2: 重写 motion-compiler 为 TSX 校验

**Files:** Modify `src/lib/motion-compiler.ts`; Modify `tests/`（若有 motion-compiler 相关测试）

- [ ] **Step 1: 改写 `compileMotionSource`** 复用 `validateCardTsx`，保持 `MotionCompileResult` 形态（`html` 字段改为承载 tsx 文本，或新增 `tsx`，见 Task 6.1 类型调整后对齐）：

```ts
import type { MotionCompileResult } from '../types/motion';
import { stripCodeFences, validateCardTsx } from '../remotion/compile-card';

export function compileMotionSource(source: string): MotionCompileResult {
  const tsx = stripCodeFences(source);
  const v = validateCardTsx(tsx);
  if (!v.ok) return { success: false, error: v.error! };
  return { success: true, tsx };
}
```

- [ ] **Step 2: 跑相关测试**

Run: `npx vitest run tests/ai-analysis.test.ts`
Expected: 依赖该函数的断言通过（必要时同步更新断言到 tsx 字段）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/motion-compiler.ts tests/ai-analysis.test.ts
git commit -m "refactor(motion): 编译校验从 GSAP HTML 改为 Remotion TSX"
```

### Task 3.3: 预览 sandbox CardHost（iframe + 帧同步）

**Files:** Replace `src/remotion/card-host.tsx`; Create `src/remotion/card-runtime.ts`

预览侧把编译后的卡片 JS 放进 `sandbox="allow-scripts"` 的 `<iframe srcdoc>`（独立 origin、不放宽主渲染进程 CSP）。父用 `useCurrentFrame()` 经 `postMessage` 把当前帧推给 iframe；iframe 内 React 用该帧渲染（卡片用 props.frame 而非 `useCurrentFrame`，或注入一个垫片 `useCurrentFrame` 返回收到的帧）。编译后的 JS 由主进程 IPC 提供（`compile-card-node`，Phase 4）。

- [ ] **Step 1: `card-runtime.ts`**（iframe srcdoc 模板 + 注入 react/remotion UMD + 垫片）。模板要点：
  - 引入 React/ReactDOM UMD（随包打包，走本地 file/asset）。
  - 注入 `window.__frame`，并提供 `useCurrentFrame = () => window.__frame`、`useVideoConfig` 垫片。
  - 监听 `message` 更新 `window.__frame` 并 `ReactDOM` 重渲染编译后的 default export。

- [ ] **Step 2: `card-host.tsx`**（用 `useCurrentFrame` + `delayRender/continueRender` 处理首帧，postMessage 推帧）：

```tsx
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCardSrcDoc } from './card-runtime';
import { useCardCompiledJs } from './use-card-compiled-js'; // 经 IPC 取编译产物（带缓存）

export function CardHost({ overlayId, tsx }: { overlayId: string; tsx: string }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ref = useRef<HTMLIFrameElement>(null);
  const compiled = useCardCompiledJs(overlayId, tsx);
  const srcDoc = useMemo(() => (compiled ? buildCardSrcDoc(compiled, { fps, width, height }) : ''), [compiled, fps, width, height]);
  useEffect(() => { ref.current?.contentWindow?.postMessage({ type: 'frame', frame }, '*'); }, [frame]);
  if (!compiled) return null;
  return <iframe ref={ref} sandbox="allow-scripts" srcDoc={srcDoc} style={{ width: '100%', height: '100%', border: 0 }} />;
}
```

> 注：导出路径（`getRemotionEnvironment().isRendering`）下 iframe 帧同步不可靠，导出改为把卡片 TSX 编译进 bundle 直接渲染（Phase 4 Task 4.2）。`CardHost` 内用 `useIsRendering()` 分支：渲染时走 bundle 内动态组件，预览时走 iframe。

- [ ] **Step 3: 手动验收（dev）**：`npm run dev`，在编辑器插入一张 motion 卡片，确认预览 iframe 内动画随播放头推进。
- [ ] **Step 4: Commit**

```bash
git add src/remotion/card-host.tsx src/remotion/card-runtime.ts src/remotion/use-card-compiled-js.ts
git commit -m "feat(remotion): 预览卡片 sandbox iframe + 帧同步"
```

---

## Phase 4 — 导出（@remotion/bundler + renderer）

### Task 4.1: 主进程卡片编译（esbuild）

**Files:** Create `electron/remotion/compile-card-node.ts`

- [ ] **Step 1: 实现** esbuild `transform`（loader `tsx`，jsx `automatic`，format `iife`/`esm`，external react/remotion），输出 `{ js, error }`。供预览 IPC 与导出 bundle 注入复用。
- [ ] **Step 2: Commit**

```bash
git add electron/remotion/compile-card-node.ts
git commit -m "feat(export): 主进程 esbuild 卡片编译"
```

### Task 4.2: bundle.ts（卡片注入 + 打包）

**Files:** Create `electron/remotion/bundle.ts`

- [ ] **Step 1: 实现**：
  - 把 timeline 内所有 motion 卡片的 TSX 写入 Remotion 源树临时目录的 `cards/<overlayId>.tsx`，生成 `cards/registry.ts` 映射 `overlayId → 组件`；MainComposition 在 `isRendering` 时通过 registry（经 inputProps 传 overlayId）渲染真实组件。
  - 调 `@remotion/bundler` `bundle({ entryPoint, publicDir, webpackOverride })`，返回 `serveUrl`，带 hash 缓存避免重复打包。
- [ ] **Step 2: Commit**

```bash
git add electron/remotion/bundle.ts
git commit -m "feat(export): Remotion bundle + 卡片注入"
```

### Task 4.3: render.ts（renderMedia）

**Files:** Create `electron/remotion/render.ts`

- [ ] **Step 1: 实现**：`selectComposition` + `renderMedia`（codec `h264`，`inputProps={timeline,srtEntries}`，`onProgress` → 回传 `render-progress`，`concurrency` 用 `floor(cpu/2)`，`publicDir` 指向 materialize 后的资源目录）。
- [ ] **Step 2: Commit**

```bash
git add electron/remotion/render.ts
git commit -m "feat(export): renderMedia 导出 H.264 MP4"
```

### Task 4.4: 重写 render-video IPC

**Files:** Modify `electron/main.ts`（删 `prepareHyperframesProject` 530-545、删 CLI execFile 块 2455-2495、删 `hyperframes-runtime-preflight` 597-604）

- [ ] **Step 1: 替换** `render-video` 内部：materialize 资源到 publicDir（复用现有 `createRenderPublicDir`/`materializeRenderAssets`，路径改写产出 `staticFile` 可达的相对路径）→ `bundle()` → `render()`。入参/返回值与 `render-progress` 事件保持不变。
- [ ] **Step 2: 删除** `createHyperframesComposition`、`resolveHyperframesCliPath`、`runCurrentHyperframesRuntimePreflight`、gsap copy 等相关 import 与调用。
- [ ] **Step 3: 验证编译**

Run: `npm run build`
Expected: Electron main 编译通过（renderer 也通过）。

- [ ] **Step 4: 手动验收**：编辑器导出一段含 video/text/字幕/AI 卡片的时间线，得到可播放 MP4，画面与预览一致。
- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "refactor(export): render-video 切换为 Remotion bundle+renderMedia"
```

---

## Phase 5 — 提示词改写（motion.* 产出 Remotion TSX）

### Task 5.1: defaults.ts motion 提示词

**Files:** Modify `src/lib/prompts/defaults.ts`（`motion.system`/`motion.generate`/`motion.modify`/`motion.autofix`）

- [ ] **Step 1: 改写** 四个 motion 提示词：要求输出 **单文件 Remotion 函数组件，default export**，可用 `import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill, Sequence } from 'remotion'` 与 React；通过 `props` 接收数据/资源；禁止外部网络资源；`motion.autofix` 接收编译错误文本并产出修正后的完整 TSX。给 1 个最小可编译示例。
- [ ] **Step 2: 跑提示词相关测试**

Run: `npx vitest run tests/ai-analysis.test.ts`
Expected: PASS（更新任何引用旧 HTML 提示词文案的断言）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/defaults.ts
git commit -m "feat(prompts): motion.* 改为生成 Remotion TSX"
```

---

## Phase 6 — 类型迁移与卡片生成链路

### Task 6.1: MotionCardPayload html→tsx + 旧数据兼容

**Files:** Modify `src/types/motion.ts`, `src/types/ai.ts`

- [ ] **Step 1:** `MotionCardPayload`：`html: string` → `tsx: string`；新增可选 `legacyHtml?: string`（保留旧值以便提示）、`needsRegeneration?: boolean`。`MotionCompileSuccess.html` → `tsx`。
- [ ] **Step 2:** `src/types/ai.ts` 内 motion 卡片引用同步。
- [ ] **Step 3:** 类型检查 `npx tsc --noEmit`，修复所有 `motionCard.html` 引用点（grep 定位）。
- [ ] **Step 4: Commit**

```bash
git add src/types/motion.ts src/types/ai.ts
git commit -m "refactor(types): MotionCardPayload html→tsx"
```

### Task 6.2: 持久化迁移（旧 project.json 降级）

**Files:** Modify 卡片读取处（`src/lib/ai-persistence.ts` 或 `ai-analysis.ts`）

- [ ] **Step 1:** 加载时若 `motionCard.html` 存在且无 `tsx` → 设 `{ tsx: '', legacyHtml: html, needsRegeneration: true }`，不崩溃（对应 spec §5.1）。
- [ ] **Step 2:** 新增测试 `tests/motion-legacy-migration.test.ts` 断言旧→新映射。

```ts
// 旧卡片对象 → 迁移后 needsRegeneration=true 且 legacyHtml 保留
```

- [ ] **Step 3:** Run: `npx vitest run tests/motion-legacy-migration.test.ts` → PASS。
- [ ] **Step 4: Commit**

```bash
git add src/lib/ai-persistence.ts tests/motion-legacy-migration.test.ts
git commit -m "feat(persistence): 旧 HTML 卡片加载降级为 needsRegeneration"
```

### Task 6.3: single-card-generation + AICardInspector 对齐

**Files:** Modify `src/lib/single-card-generation.ts`, `src/components/AICardInspector.tsx`

- [ ] **Step 1:** 生成链路校验从 `card.motionCard?.html` 改为 `tsx`；Inspector 表单显示/编辑 tsx，对 `needsRegeneration` 卡片显示「重新生成为 Remotion 卡片」按钮。
- [ ] **Step 2:** 类型检查 + 相关测试通过。
- [ ] **Step 3: Commit**

```bash
git add src/lib/single-card-generation.ts src/components/AICardInspector.tsx
git commit -m "refactor(cards): 生成与 Inspector 对齐 tsx 卡片"
```

---

## Phase 7 — 硬切换：删除 HyperFrames

### Task 7.1: 删除 HyperFrames 代码与 IPC

**Files:** Delete `src/hyperframes/{composition,assets,types}.ts`, `src/components/HyperframesPreviewPlayer.tsx`, `electron/hyperframes-cli.ts`, `electron/hyperframes-runtime-preflight.ts`

- [ ] **Step 1:** 删除上述文件；删 `electron/preload.ts` 与 `src/lib/electron-api.ts` 中 `hyperframes-runtime-preflight` 桥接（grep 定位调用方一并处理）。
- [ ] **Step 2:** 裁剪 `electron/runtime-binaries.ts`：删 `resolveGsapPath`/`resolveChromePath`/`buildPathWithRuntimeBinaries` 中 hyperframes 专用部分，**保留 `resolveFfmpegPath`/`resolveFfprobePath`**（`card-media-handlers.ts` 仍用）。
- [ ] **Step 3:** 清理 `src/vite-env.d.ts` 中 hyperframes-player 自定义元素声明。
- [ ] **Step 4:** 全量确认无残留引用

Run: `grep -rinE "hyperframe" src electron`
Expected: 无输出（或仅注释/CHANGELOG 历史）。

- [ ] **Step 5:** Run: `npm run build` → 通过。
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: 移除 HyperFrames 渲染引擎全部代码与 IPC"
```

### Task 7.2: 更新 CLAUDE.md / CHANGELOG

**Files:** Modify `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1:** 改写 `CLAUDE.md`「HyperFrames 导出约束」整章为「Remotion 导出约束」：删除「不允许重新引入 Remotion 作为 fallback」；新增 Remotion 链路文件（`src/remotion/`、`electron/remotion/`）、AI 卡片 = Remotion TSX、预览 = @remotion/player、导出 = bundler+renderer 等约束。同步更新「常用命令/技术栈/高风险清单」中 HyperFrames 提及。
- [ ] **Step 2:** `CHANGELOG.md` 增加条目（遵循 `release_changelog_rule` 记忆：发版同步 CHANGELOG + Release notes）。
- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: CLAUDE.md/CHANGELOG 记录 HyperFrames→Remotion 切换"
```

---

## Phase 8 — 全量验证

### Task 8.1: 测试与构建

- [ ] **Step 1:** 删除/重写过时测试：`tests/hyperframes-composition.test.ts`（删）、`tests/motion-card-scope.test.ts`（重定向到新 sandbox 或删）。

Run: `git rm tests/hyperframes-composition.test.ts`

- [ ] **Step 2:** 全量测试

Run: `npm test`
Expected: 全绿。

- [ ] **Step 3:** 全量构建

Run: `npm run build`
Expected: 通过（main + preload + renderer + 混淆）。

- [ ] **Step 4:** 手动端到端验收：dev 下预览（含 AI 卡片）→ 导出 MP4 → 用播放器确认画面与预览一致、字幕高亮正确、音频对齐。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: 迁移测试至 Remotion，移除 HyperFrames 用例"
```

---

## Self-Review 备注（计划作者自查）

- **Spec 覆盖：** §3 架构→Phase1-4；§5 卡片编译/加载→Phase3-4；§5.1 旧卡片降级→Task1.4/6.2；§6 导出→Phase4；§7 删除/改造→Phase6-7；§8 测试→Phase8。✅
- **类型一致性：** `MotionCardPayload.tsx`（Task6.1）贯穿 motion-compiler（3.2）、AICardOverlay（1.4）、single-card-generation（6.3）。⚠️ 执行顺序提示：Task 1.4/3.2 先以 `card.motionCard?.tsx` 编码，须在 Task 6.1 完成类型改名后整体 `tsc` 校验对齐；建议执行时把 6.1 提前到 Phase 1 之后、或接受中间态类型红线直至 6.1。
- **已知风险：** 自由 TSX 预览（iframe 帧同步）与导出（bundle 内组件）两条路径；Remotion bundle 冷启动；Remotion 源码需随包（packaging extraResources）—— 打包阶段在 Task 4.x 真机验证时确认。
```

# Editor UI Component Library Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 继续把 Timeline 区域中风险较低、样式密集的子组件收敛到 CSS Modules 与基础模式，降低后续时间线功能迭代成本。

**Architecture:** 本轮只处理 `OverlayBlock`、`TimelineAudioWaveform`、`TimelineSubtitleBlocks` 三个 Timeline 子块，保持现有拖拽、缩放、轨道命中和定位算法不变。主 `Timeline.tsx` 仅做最小接线调整，不做结构性重写。

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS Modules

---

## Chunk 1: 迁移 Timeline 子组件样式边界

### Task 1: 迁移 OverlayBlock

**Files:**
- Create: `src/components/OverlayBlock.module.css`
- Modify: `src/components/OverlayBlock.tsx`
- Test: `tests/overlay-block.test.tsx`

- [ ] Step 1: 把覆盖块壳层、缩略图容器、标签和 resize handle 样式迁到 CSS Modules
- [ ] Step 2: 保留拖拽移动、缩放、右键删除逻辑不变
- [ ] Step 3: 更新测试，继续验证图片覆盖块可正常渲染缩略图和文本

### Task 2: 迁移 TimelineAudioWaveform

**Files:**
- Create: `src/components/TimelineAudioWaveform.module.css`
- Modify: `src/components/TimelineAudioWaveform.tsx`
- Create: `tests/timeline-audio-waveform.test.tsx`

- [ ] Step 1: 把加载态和峰值条的视觉样式迁到 CSS Modules
- [ ] Step 2: 保留波形缓存、抽样和异步加载逻辑不变
- [ ] Step 3: 补充 SSR 渲染测试，覆盖 shell 状态

### Task 3: 迁移 TimelineSubtitleBlocks

**Files:**
- Create: `src/components/TimelineSubtitleBlocks.module.css`
- Modify: `src/components/TimelineSubtitleBlocks.tsx`
- Create: `tests/timeline-subtitle-blocks.test.tsx`

- [ ] Step 1: 把字幕块和内部文本样式迁到 CSS Modules
- [ ] Step 2: 保留布局计算和条目过滤逻辑不变
- [ ] Step 3: 补充渲染测试，验证字幕条目输出

## Chunk 2: 最终验证

### Task 4: 回归验证与剩余风险记录

**Files:**
- Modify: `src/components/*`
- Test: `tests/*.test.tsx`

- [ ] Step 1: 执行 `npm test -- tests/overlay-block.test.tsx tests/timeline-audio-waveform.test.tsx tests/timeline-subtitle-blocks.test.tsx`
- [ ] Step 2: 执行 `npm test`
- [ ] Step 3: 执行 `npm run build`
- [ ] Step 4: 记录下一轮最值得继续处理的 Timeline 主文件结构点

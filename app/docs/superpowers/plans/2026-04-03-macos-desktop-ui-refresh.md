# macOS Desktop UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把编辑器基础组件与页面壳层从网页式 dark dashboard 收敛为融合 macOS 系统设置语法的深色专业创作工具界面。

**Architecture:** 先重构 token、全局排版和基础 primitives，再统一 patterns，最后调整 Toolbar、Editor shell、Preview 和各类 modal / inspector 的组合方式。整个过程保持现有业务逻辑、数据结构与 Remotion 渲染逻辑不变，优先保留现有组件 API，必要时再做最小接口补充。

**Tech Stack:** React 19, TypeScript, CSS Modules, Electron Vite, Vitest

---

## Chunk 1: 建立 macOS 深色视觉 token

### Task 1: 重写全局颜色、排版与交互 token

**Files:**
- Modify: `src/ui/styles/tokens.css`
- Modify: `src/ui/styles/base.css`

- [ ] Step 1: 把现有背景体系从偏蓝黑 dashboard 调整为 graphite / charcoal 分层，重新定义 canvas、sidebar、panel、modal、selection 的颜色变量
- [ ] Step 2: 收敛强调色，仅保留 selection / focus / primary action 所需的系统蓝语义，降低渐变与高饱和装饰色权重
- [ ] Step 3: 重新定义 shadow、radius、spacing 和 motion，让交互更接近桌面工具而不是网页卡片
- [ ] Step 4: 调整全局字体优先级为 `SF Pro Text / SF Pro Display / PingFang SC / Inter / sans-serif`
- [ ] Step 5: 调整全局 `:focus-visible`、`::selection` 和默认输入 / 按钮字体继承，避免强网页感

### Task 2: 做基础 smoke 验证，确保 token 不破坏现有样式注入

**Files:**
- Modify: `src/main.tsx`（仅当需要补充样式导入顺序时）

- [ ] Step 1: 检查 `src/main.tsx` 中 `tokens.css` 和 `base.css` 的导入顺序
- [ ] Step 2: 若不需要调整导入顺序，则保持 `src/main.tsx` 不变
- [ ] Step 3: 运行一次 `npm run build`
- [ ] Step 4: 记录是否存在 CSS 变量命名冲突或页面初始渲染异常

## Chunk 2: 桌面化 primitives

### Task 3: 重构 Button 与 IconButton 的桌面控件语法

**Files:**
- Modify: `src/ui/primitives/Button.module.css`
- Modify: `src/ui/primitives/Button.tsx`
- Modify: `src/ui/primitives/IconButton.module.css`
- Modify: `src/ui/primitives/IconButton.tsx`

- [ ] Step 1: 调整 `Button.module.css`，去掉重渐变、重阴影和明显上浮 hover
- [ ] Step 2: 重新定义 `primary / secondary / tint / ghost / danger` 的桌面语义
- [ ] Step 3: 收紧 `sm / md / lg` 的高度、padding 和字重，提升桌面工具密度
- [ ] Step 4: 调整 `IconButton.module.css`，让默认状态更像 toolbar item / utility button
- [ ] Step 5: 仅在必要时修改 `Button.tsx` / `IconButton.tsx` 的数据属性或 class 拼接逻辑，尽量不改 public API

### Task 4: 重构输入、字段和状态胶囊的 grouped settings 语法

**Files:**
- Modify: `src/ui/primitives/Input.module.css`
- Modify: `src/ui/primitives/Input.tsx`
- Modify: `src/ui/primitives/Textarea.module.css`
- Modify: `src/ui/primitives/Textarea.tsx`
- Modify: `src/ui/primitives/Field.module.css`
- Modify: `src/ui/primitives/Field.tsx`
- Modify: `src/ui/primitives/Badge.module.css`
- Modify: `src/ui/primitives/Badge.tsx`

- [ ] Step 1: 把 `Input` 和 `Textarea` 调整为 recessed field 语法，降低边框存在感并统一 focus 行为
- [ ] Step 2: 让 `Field` 更像 grouped settings row 的容器，优化 label、hint、error 的层级
- [ ] Step 3: 让 `Badge` 更接近桌面客户端中的 meta pill / status capsule，而非 dashboard 标签
- [ ] Step 4: 保持 `Input.tsx`、`Textarea.tsx`、`Field.tsx`、`Badge.tsx` 接口稳定，除非必须补充辅助 data 属性

### Task 5: 重构 SurfaceCard 与 ModalShell 的桌面 surface 语法

**Files:**
- Modify: `src/ui/primitives/SurfaceCard.module.css`
- Modify: `src/ui/primitives/SurfaceCard.tsx`
- Modify: `src/ui/primitives/ModalShell.module.css`
- Modify: `src/ui/primitives/ModalShell.tsx`

- [ ] Step 1: 把 `SurfaceCard` 从网页卡片语义重定义为 panel shell / grouped section / workspace surface
- [ ] Step 2: 降低 `elevated` 的重阴影，改用弱边界与材质层级表达浮起
- [ ] Step 3: 把 `ModalShell` 改成更像 sheet / inspector dialog 的布局和 spacing
- [ ] Step 4: 如现有 `SurfaceCardVariant` 不足以表达 grouped section，可做最小范围变体补充；若现有 variants 足够，则保持 `SurfaceCard.tsx` 不变或只做最小接线
- [ ] Step 5: 若 `ModalShell` 需要补充 close affordance、header/body/footer class 结构或 size 语义，控制在最小 API 变化范围内

## Chunk 3: 桌面化 patterns

### Task 6: 重构 TabBar 与 SearchField

**Files:**
- Modify: `src/ui/patterns/TabBar.module.css`
- Modify: `src/ui/patterns/TabBar.tsx`
- Modify: `src/ui/patterns/SearchField.module.css`
- Modify: `src/ui/patterns/SearchField.tsx`

- [ ] Step 1: 把 `TabBar` 从 web underline tabs 改为 segmented / source-list hybrid 语法
- [ ] Step 2: 确保 `TabBar.tsx` 仍兼容现有 `items / value / onChange` 接口
- [ ] Step 3: 把 `SearchField` 改成接近 macOS 系统设置截图中的 recessed search field
- [ ] Step 4: 如需要更好地支持 placeholder、icon 或 sidebar 内使用场景，优先通过 class 和 data 属性完成，不破坏现有 props

### Task 7: 重构 PanelHeader、ActionBar 与 SelectionCard

**Files:**
- Modify: `src/ui/patterns/PanelHeader.module.css`
- Modify: `src/ui/patterns/PanelHeader.tsx`
- Modify: `src/ui/patterns/ActionBar.module.css`
- Modify: `src/ui/patterns/ActionBar.tsx`
- Modify: `src/ui/patterns/SelectionCard.module.css`
- Modify: `src/ui/patterns/SelectionCard.tsx`

- [ ] Step 1: 让 `PanelHeader` 更像 macOS panel title / section header，而不是 dashboard 区块标题
- [ ] Step 2: 让 `ActionBar` 更接近 utility strip / toolbar row
- [ ] Step 3: 让 `SelectionCard` 的选中态更接近系统设置选项卡片，而不是发光卡片
- [ ] Step 4: 保持这些 pattern 的现有 props 尽量稳定，优先内部调整布局与数据属性

## Chunk 4: 页面壳层与关键业务组合

### Task 8: 重构 Toolbar、Editor shell 与 Preview workspace

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/components/Toolbar.module.css`
- Modify: `src/pages/Editor.tsx`
- Modify: `src/pages/Editor.module.css`
- Modify: `src/components/PreviewPanel.tsx`
- Modify: `src/components/PreviewPanel.module.css`

- [ ] Step 1: 把 Toolbar 收敛为 window chrome 风格，重组工程名、保存状态和导出动作的层级
- [ ] Step 2: 调整 Editor 外层布局，让 sidebar、workspace、timeline 更像一个统一窗口中的不同分区
- [ ] Step 3: 把 PreviewPanel 从网页卡片改成 main workspace stage
- [ ] Step 4: 控制 `Editor.tsx` 和 `PreviewPanel.tsx` 的逻辑改动范围，仅为结构 class 和布局组合服务

### Task 9: 重构 Setup 的 onboarding 壳层

**Files:**
- Modify: `src/pages/Setup.tsx`
- Modify: `src/pages/Setup.module.css`
- Modify: `src/ui/patterns/FileDropCard.module.css`
- Modify: `src/ui/patterns/FileDropCard.tsx`

- [ ] Step 1: 降低 Setup 页的 landing page 感，转向桌面 app onboarding 气质
- [ ] Step 2: 让 FileDropCard 更像 grouped import section，而非展示型营销卡片
- [ ] Step 3: 保持导入流程、拖拽逻辑和按钮行为不变，仅调整视觉和布局表达

### Task 10: 收尾已消费 primitives 的 modal / inspector 组件

**Files:**
- Modify: `src/components/ExportSettingsModal.tsx`
- Modify: `src/components/ExportSettingsModal.module.css`
- Modify: `src/components/AISettingsModal.tsx`
- Modify: `src/components/AICardEditModal.tsx`
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/AssetPanel.tsx`
- Modify: `src/components/AICoverPanel.tsx`
- Modify: `src/components/ExportProgress.tsx`

- [ ] Step 1: 把 `ExportSettingsModal` 收敛为 grouped settings sheet，检查 `SelectionCard` 新语法下的视觉一致性
- [ ] Step 2: 回收 `AISettingsModal` 中仍存在的 inline style，转向 `Field + Input + grouped section` 组合
- [ ] Step 3: 审查 `AICardEditModal`、`AIPanel`、`AssetPanel`、`AICoverPanel`、`ExportProgress`，只做与新 primitives 冲突或明显 web 感过强的局部调整
- [ ] Step 4: 避开当前工作区中用户未提交的 timeline 相关文件，不碰 `OverlayBlock`、`TimelineAudioWaveform`、`TimelineSubtitleBlocks` 及相关测试

## Chunk 5: 验证与回归

### Task 11: 运行自动化验证

**Files:**
- Test: `tests/**/*.test.ts?(x)`

- [ ] Step 1: 运行 `npm test`
- [ ] Step 2: 运行 `npm run build`
- [ ] Step 3: 若测试或构建失败，仅修复与本轮桌面化改造直接相关的问题

### Task 12: 做手动视觉 smoke test

**Files:**
- Inspect: `src/pages/Setup.tsx`
- Inspect: `src/pages/Editor.tsx`
- Inspect: `src/components/ExportSettingsModal.tsx`
- Inspect: `src/components/AISettingsModal.tsx`

- [ ] Step 1: 启动应用并人工检查 Setup、Editor、Preview、Toolbar、Sidebar 的整体桌面化程度
- [ ] Step 2: 打开导出设置和 AI 设置弹窗，确认 grouped settings、按钮层级、搜索框和 selection 语法一致
- [ ] Step 3: 记录仍明显带有“网页感”的残留点，作为下一轮收尾项

### Task 13: 完成度收口

**Files:**
- Modify: `docs/superpowers/specs/2026-04-03-macos-desktop-ui-refresh-design.md`（仅当实施后需要补充偏差记录）

- [ ] Step 1: 对照设计文档逐项核验 token、primitive、pattern、page shell 是否达成目标
- [ ] Step 2: 如实施中对设计作出有意识偏离，补充记录到 spec
- [ ] Step 3: 准备实施总结，等待用户验收

# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据 design.pen 重构 AI 面板、字幕检查器、导出弹窗等 7 个组件的视觉展示层，业务逻辑保持不变。

**Architecture:** 并行 3 组独立执行。每组只修改各自的 `.tsx` + `.module.css`，不跨组读写共享文件。Group 1 处理弹窗类，Group 2 处理检查器面板类，Group 3 处理卡片列表与 AI 主面板。

**Tech Stack:** React 18, TypeScript, CSS Modules, lucide-react, Electron (渲染进程)

---

## Group 1 — 弹窗类（可与 Group 2、3 并行）

### Task 1: AISettingsModal — 移除 description

**Files:**
- Modify: `src/components/AISettingsModal.tsx`

- [ ] **Step 1: 移除 DialogDescription**

打开 `src/components/AISettingsModal.tsx`，找到 `DialogHeader` 块（第 55-60 行），删除整个 `<DialogDescription>` 元素：

```tsx
// 删除这段：
<DialogDescription>
  配置内容分析与封面生成的服务入口。当前版本默认按桌面暗黑工作流整理。
</DialogDescription>
```

删除后 `DialogHeader` 应为：
```tsx
<DialogHeader>
  <div className={styles.eyebrow}>SETTINGS</div>
  <DialogTitle>AI 配置</DialogTitle>
</DialogHeader>
```

- [ ] **Step 2: 清理 DialogDescription import**

在文件顶部 import 列表中，从 `../ui` 的导入中删除 `DialogDescription`。

- [ ] **Step 3: 验证 TypeScript**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1 | head -30
```

期望：无报错（或报错不在 AISettingsModal.tsx 中）

- [ ] **Step 4: Commit**

```bash
git add src/components/AISettingsModal.tsx
git commit -m "refactor(ui): 移除 AISettingsModal 描述文本"
```

---

### Task 2: ExportSettingsModal — 精简布局

**Files:**
- Modify: `src/components/ExportSettingsModal.tsx`
- Modify: `src/components/ExportSettingsModal.module.css`

- [ ] **Step 1: 更新 DialogDescription 文本**

找到 `<DialogDescription>` 元素，将文本改为：
```tsx
<DialogDescription>配置视频导出参数</DialogDescription>
```

- [ ] **Step 2: 重写路径区域为单行**

在 `ExportSettingsModal.tsx` 顶部 import 中追加 `FolderOpen`：
```tsx
import { FolderOpen } from 'lucide-react';
```

找到路径 Card（`<Card className={`${styles.pathCard} p-4`}>`），替换整个路径 Card 块：

```tsx
// 替换为：
<Card className={styles.pathCard}>
  <FolderOpen size={14} className={styles.pathIcon} />
  <div
    className={[styles.pathValue, outputPath ? styles.pathValueFilled : '']
      .filter(Boolean)
      .join(' ')}
  >
    {outputPath || '还未选择导出位置'}
  </div>
  <Button
    onClick={() => void handleSelectOutputPath()}
    variant="secondary"
    size="sm"
  >
    选择位置
  </Button>
</Card>
```

- [ ] **Step 3: 移除 grid 内的描述卡片**

找到 `<div className={styles.grid}>` 块，删除两列各自的 `<Card className={...summaryCard...}>` 子元素（保留 `<Field>` + `<Select>`）。

左列改为：
```tsx
<div className={styles.column}>
  <Field label="分辨率">
    <Select
      value={resolution}
      options={EXPORT_RESOLUTION_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
      onChange={(event) => setResolution(event.target.value as ExportResolution)}
    />
  </Field>
</div>
```

右列改为：
```tsx
<div className={styles.column}>
  <Field label="导出速度">
    <Select
      value={quality}
      options={EXPORT_QUALITY_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
      onChange={(event) => setQuality(event.target.value as ExportQuality)}
    />
  </Field>
</div>
```

- [ ] **Step 4: 将摘要卡片改为裸 badge 行**

找到最后一个 `<Card className={...summaryCard...}>` 块（"本次导出摘要"），替换为：
```tsx
<div className={styles.summary}>
  <Badge variant="secondary">
    {renderConfig.renderWidth} × {renderConfig.renderHeight}
  </Badge>
  <Badge variant="secondary">{renderConfig.videoBitrate}</Badge>
  <Badge variant="secondary">{renderConfig.audioBitrate}</Badge>
  <Badge variant="secondary">{renderConfig.x264Preset}</Badge>
</div>
```

- [ ] **Step 5: 清理 import**

从 `../ui` 的导入中删除 `Card`（如果路径 Card 需要保留则保留）。
检查 Card 是否还在使用——路径行仍用 Card，所以**保留** Card import。
删除未使用的 `Eyebrow`（如果已无使用）——检查文件中是否还有 `<Eyebrow>`，没有则删除。

- [ ] **Step 6: 更新 CSS**

在 `src/components/ExportSettingsModal.module.css` 中：

将 `.pathCard` 改为单行 flex 布局：
```css
.pathCard {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}
```

新增 `.pathIcon`：
```css
.pathIcon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}
```

`.pathValue` 改为单行（去掉 `min-height`）：
```css
.pathValue {
  flex: 1;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

删除 `.pathRow` 和 `.summaryCard` 规则（已无使用）。

`.summary` 去掉 `margin-top`（现在直接跟在 grid 后，spacing 由 DialogBody gap 控制）：
```css
.summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
```

- [ ] **Step 7: 验证 TypeScript**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1 | head -30
```

期望：无 ExportSettingsModal 报错

- [ ] **Step 8: Commit**

```bash
git add src/components/ExportSettingsModal.tsx src/components/ExportSettingsModal.module.css
git commit -m "refactor(ui): 精简导出设置弹窗布局"
```

---

### Task 3: ExportProgress — 简化进度弹窗

**Files:**
- Modify: `src/components/ExportProgress.tsx`
- Modify: `src/components/ExportProgress.module.css`

- [ ] **Step 1: 更新进度状态文本**

在 `ExportProgress.tsx` 中找到 status div 的内容：
```tsx
{errorMessage || (isDone ? outputPath : `${Math.round(progress * 100)}%`)}
```

改为：
```tsx
{errorMessage || (isDone ? outputPath : `${Math.round(progress * 100)}% — 导出中`)}
```

- [ ] **Step 2: 重写 DialogFooter**

找到 `<DialogFooter>` 块，将整个 `<ModalFooter .../>` 替换为：

```tsx
<DialogFooter>
  <div className={styles.footerActions}>
    {isDone && outputPath ? (
      <Button
        onClick={() => window.electronAPI.showItemInFolder(outputPath)}
        variant="accent"
      >
        在 Finder 中显示
      </Button>
    ) : null}
    <Button
      onClick={onClose}
      variant={canDismiss ? 'secondary' : 'destructive'}
    >
      {canDismiss ? '关闭' : '取消导出'}
    </Button>
  </div>
</DialogFooter>
```

- [ ] **Step 3: 清理 import**

从 `../ui` 的导入中删除 `ModalFooter`（已不再使用）。
确认保留：`Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Progress`

- [ ] **Step 4: 更新 CSS**

打开 `src/components/ExportProgress.module.css`，追加：

```css
.footerActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
```

- [ ] **Step 5: 验证 TypeScript**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1 | head -30
```

期望：无 ExportProgress 报错

- [ ] **Step 6: Commit**

```bash
git add src/components/ExportProgress.tsx src/components/ExportProgress.module.css
git commit -m "refactor(ui): 简化导出进度弹窗布局"
```

---

## Group 2 — 面板类（可与 Group 1、3 并行）

### Task 4: EditorInspector — eyebrow 标签更新

**Files:**
- Modify: `src/components/EditorInspector.tsx`
- Modify: `src/components/EditorInspector.module.css`

- [ ] **Step 1: 更新 eyebrowLabel**

在 `EditorInspector.tsx` 中找到 `eyebrowLabel` 赋值：
```tsx
const eyebrowLabel =
  selection.type === 'subtitle-style'
    ? '字幕块'
    : selection.type === 'ai-card'
    ? 'AI 卡片'
    : '检查器';
```

改为：
```tsx
const eyebrowLabel =
  selection.type === 'subtitle-style'
    ? 'SUBTITLE'
    : selection.type === 'ai-card'
    ? 'AI 卡片'
    : '检查器';
```

- [ ] **Step 2: 在 header 左侧追加 "字幕样式" 标签**

找到 `<div className={styles.headerLeft}>` 块：
```tsx
<div className={styles.headerLeft}>
  <span className={styles.eyebrowPill}>{eyebrowLabel}</span>
</div>
```

改为：
```tsx
<div className={styles.headerLeft}>
  <span className={styles.eyebrowPill}>{eyebrowLabel}</span>
  {selection.type === 'subtitle-style' && (
    <span className={styles.headerLabel}>字幕样式</span>
  )}
</div>
```

- [ ] **Step 3: 追加 headerLabel CSS**

打开 `src/components/EditorInspector.module.css`，在文件末尾追加：
```css
.headerLabel {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-left: 4px;
}
```

- [ ] **Step 4: 验证 TypeScript**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1 | head -30
```

期望：无 EditorInspector 报错

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorInspector.tsx src/components/EditorInspector.module.css
git commit -m "refactor(ui): 更新检查器 header eyebrow 标签"
```

---

### Task 5: SubtitleInspector — 状态 chip 重设计

**Files:**
- Modify: `src/components/SubtitleInspector.tsx`
- Modify: `src/components/SubtitleInspector.module.css`

- [ ] **Step 1: 更新 import**

在 `SubtitleInspector.tsx` 顶部，将 lucide-react 的导入改为：
```tsx
import { FileText, Sparkles, Palette, SlidersHorizontal } from "lucide-react";
```

在 `../ui` 的导入中追加 `Alert, Badge`：
```tsx
import { Button, Switch, NumberField, Select, ColorField, Alert, Badge } from "../ui";
```

- [ ] **Step 2: 删除 summaryText useMemo**

删除整个 `summaryText` 的 `useMemo` 块（约第 33-64 行）。这段逻辑在新设计中不再需要。

- [ ] **Step 3: 重写「关键词高亮」section 内容**

找到 Section 1 内的 `{/* 状态卡片 */}` 块及其后的 `errorText` span 和 `actionRow` div，用以下内容替换：

```tsx
{/* 状态 chip */}
<div className={styles.statusChip}>
  <FileText size={12} className={styles.statusChipIcon} />
  <span className={styles.statusChipName}>{srtFileName}</span>
  {validSubtitleHighlights.length > 0 && (
    <Badge variant="default" className={styles.statusChipBadge}>
      {validSubtitleHighlights.length} 处高亮
    </Badge>
  )}
</div>

{subtitleHighlightError ? (
  <Alert variant="destructive">{subtitleHighlightError}</Alert>
) : null}

<Button
  onClick={() => void handleGenerateSubtitleHighlights()}
  loading={isGeneratingHighlights}
  disabled={!timeline.podcast.srtPath}
  variant="primary"
  fullWidth
>
  <Sparkles size={13} />
  {storedSubtitleHighlightCount > 0 ? '重新生成高亮' : '生成高亮'}
</Button>
```

`switchRow`（启用高亮 toggle）保持不变，仍在其后。

- [ ] **Step 4: 更新 CSS**

打开 `src/components/SubtitleInspector.module.css`。

删除（或注释）以下不再使用的规则：
- `.statusCard`
- `.statusCardMeta`
- `.statusCardText`
- `.actionRow`
- `.errorText`

追加新规则：
```css
/* ── 状态 chip ── */
.statusChip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--color-panel-elevated);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
}

.statusChipIcon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.statusChipName {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statusChipBadge {
  flex-shrink: 0;
}
```

- [ ] **Step 5: 验证 TypeScript**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1 | head -30
```

期望：无 SubtitleInspector 报错

- [ ] **Step 6: Commit**

```bash
git add src/components/SubtitleInspector.tsx src/components/SubtitleInspector.module.css
git commit -m "refactor(ui): 重设计字幕检查器状态 chip 与按钮布局"
```

---

## Group 3 — 列表类（可与 Group 1、2 并行）

### Task 6: AICardList — 卡片重设计

**Files:**
- Modify: `src/components/AICardList.tsx`
- Modify: `src/components/AICardList.module.css`

- [ ] **Step 1: 移除 Badge import，添加 getPreviewText 辅助函数**

在 `AICardList.tsx` 中，从 `../ui` 导入移除 `Badge`：
```tsx
import { Button, Card } from '../ui';
```

在 `CARD_TYPE_META` 定义之前，添加辅助函数：
```tsx
function getPreviewText(content: AICard['content']): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}
```

- [ ] **Step 2: 重写卡片 JSX 结构**

找到 `return (` 内的 Card 渲染（大约第 44-99 行），将整个 Card 内的 JSX 替换为：

```tsx
<Card
  key={card.id}
  onClick={() => onEditCard(card.id)}
  className={styles.card}
  data-enabled={card.enabled}
  style={createCardAccentStyle(meta.color)}
>
  <div className={styles.cardRow}>
    {/* Checkbox 圆圈 */}
    <Button
      aria-label={card.enabled ? `取消选择卡片 ${card.title}` : `选择卡片 ${card.title}`}
      title={card.enabled ? '已选' : '未选'}
      onClick={(event) => {
        event.stopPropagation();
        onToggleEnabled(card.id);
      }}
      variant={card.enabled ? 'accent' : 'ghost'}
      iconOnly
      className={styles.toggleButton}
      data-enabled={card.enabled}
    >
      <AppIcon name={card.enabled ? 'circle-check-big' : 'circle'} size={15} />
    </Button>

    {/* 内容区 */}
    <div className={styles.content}>
      <span
        className={styles.typeBadge}
        style={{ '--badge-color': meta.color } as React.CSSProperties}
      >
        {meta.label}
      </span>
      <div className={styles.title}>{card.title}</div>
      <div className={styles.preview}>{getPreviewText(card.content)}</div>
    </div>

    {/* 删除按钮（hover 显示）*/}
    <Button
      aria-label={`删除卡片 ${card.title}`}
      title="删除卡片"
      onClick={(event) => {
        event.stopPropagation();
        onDeleteCard(card.id);
      }}
      variant="ghost"
      iconOnly
      className={styles.deleteButton}
    >
      <Trash2 size={13} />
    </Button>
  </div>
</Card>
```

- [ ] **Step 3: 更新 CSS**

打开 `src/components/AICardList.module.css`，进行以下改动：

**删除**（不再使用）：
- `.iconChip` 规则块
- `.header` 规则块
- `.meta` 规则块
- `.placement` 规则块

**修改 `.toggleButton`**：
```css
.toggleButton {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  padding: 0;
}

.toggleButton[data-enabled='true'] {
  color: var(--color-success);
}
```

**修改 `.title`** — 允许换行（卡片内空间更充裕）：
```css
.title {
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  /* 移除 white-space: nowrap 和 overflow/text-overflow */
}
```

**追加新规则**：
```css
/* 类型 badge pill */
.typeBadge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  margin-bottom: 3px;
  background: color-mix(in srgb, var(--badge-color) 18%, transparent);
  color: var(--badge-color);
}

/* 预览文本 — 两行截断 */
.preview {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 删除按钮 — hover 时显示 */
.deleteButton {
  flex-shrink: 0;
  color: var(--color-text-muted);
  opacity: 0;
  transition:
    color var(--motion-fast),
    opacity var(--motion-fast);
}

.deleteButton:hover {
  color: var(--color-danger);
}

.card:hover .deleteButton {
  opacity: 1;
}
```

- [ ] **Step 4: 验证 TypeScript**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1 | head -30
```

期望：无 AICardList 报错

- [ ] **Step 5: Commit**

```bash
git add src/components/AICardList.tsx src/components/AICardList.module.css
git commit -m "refactor(ui): 重设计 AICardList 卡片样式"
```

---

### Task 7: AIPanel — 标题更新

**Files:**
- Modify: `src/components/AIPanel.tsx`

- [ ] **Step 1: 更新 PanelHeader title**

在 `AIPanel.tsx` 中找到：
```tsx
<PanelHeader
  title="AI 助手"
```

改为：
```tsx
<PanelHeader
  title="AI 分析"
```

- [ ] **Step 2: 验证 TypeScript**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1 | head -30
```

期望：无 AIPanel 报错

- [ ] **Step 3: Commit**

```bash
git add src/components/AIPanel.tsx
git commit -m "refactor(ui): 更新 AI 面板标题为「AI 分析」"
```

---

## 整合验证

### Task 8: 最终整合检查

- [ ] **Step 1: 全量 TypeScript 检查**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npx tsc --noEmit 2>&1
```

期望：无任何报错

- [ ] **Step 2: 构建验证**

```bash
cd /Users/yoqu/Documents/code/self/self-boke/video-web-master
npm run build 2>&1 | tail -20
```

期望：构建成功，无 error（warning 可接受）

- [ ] **Step 3: 最终 commit（若有未提交改动）**

```bash
git status
# 若有未提交文件：
git add -p
git commit -m "refactor(ui): 整合 UI 重构收尾"
```

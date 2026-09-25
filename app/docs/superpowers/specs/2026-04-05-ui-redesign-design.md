# UI Redesign — AI 面板、字幕检查器、弹窗、导出组件

**日期**: 2026-04-05  
**范围**: 根据 design.pen 重构 6 个前端组件的视觉展示层，逻辑行为基本保留。

---

## 目标

将以下组件的 JSX 结构与 CSS 更新为 design.pen 设计稿风格（macOS 暗色，简洁紧凑）：

- `AISettingsModal`
- `ExportSettingsModal`
- `ExportProgress`
- `EditorInspector` (eyebrow/header 局部)
- `SubtitleInspector`
- `AICardList`
- `AIPanel` (header title、footer 按钮文案)

---

## 架构

并行 3 组独立执行，每组只修改各自的 `.tsx` + `.module.css`，不跨组修改共享文件。

```
Group 1 — 弹窗类       Group 2 — 面板类         Group 3 — 列表类
────────────────       ─────────────────         ─────────────────
AISettingsModal        SubtitleInspector         AICardList
ExportSettingsModal    EditorInspector            AIPanel (header+footer)
ExportProgress
```

---

## 各组件变更规格

### Group 1 — 弹窗类

#### AISettingsModal
- 移除 `<DialogDescription>` 及其文本内容
- 其余表单字段、逻辑、props 不变

#### ExportSettingsModal
- `DialogDescription` 文本改为：`"配置视频导出参数"`
- 输出路径区域：将 Card + 两层 div 改为单行 Card，内含 folder icon (lucide `FolderOpen`, size 14) + 路径文本 + "选择位置"按钮，路径文本用 CSS 截断（`text-overflow: ellipsis`）
- 移除分辨率描述卡片和速度描述卡片（两个 `Card className={summaryCard}`，含 description 文本）
- 保留两列 Select（分辨率 + 导出速度），仅保留 `<Field>` + `<Select>`
- 本次导出摘要：将现有 `Badge` 组合保留，移除外层 Card 容器（改为裸 div + flex-wrap）

#### ExportProgress
- 进度中状态文本：由 `` `${Math.round(progress * 100)}%` `` 改为 `` `${Math.round(progress * 100)}% — 导出中` ``
- 移除 `<ModalFooter>`，底部改为单个 `<Button variant="destructive">取消导出</Button>`（in-progress 时）
- 完成状态：显示 "导出完成"，底部显示"在 Finder 中显示"（accent）+ "关闭"（secondary）
- 失败状态：显示 "导出失败"，底部显示"关闭"（secondary）
- `DialogContent` 保持 `size="sm"`

### Group 2 — 面板类

#### EditorInspector
- `eyebrowLabel`：subtitle-style 分支由 `'字幕块'` → `'SUBTITLE'`
- header 左侧：eyebrow pill 右侧增加 `<span className={styles.headerLabel}>字幕样式</span>`（仅在 subtitle-style 时显示）
- 新增 `.headerLabel` CSS：`font-size: 11px; color: var(--color-text-secondary); margin-left: 4px;`

#### SubtitleInspector
- 状态行（"关键词高亮"section 第一个元素）改为 chip 行：
  - 左：`<FileText size={12} />` + 文件名文本
  - 右：高亮数量 badge（`<Badge variant="default">{validSubtitleHighlights.length} 处高亮</Badge>`），无高亮时不显示 badge
  - 整体为 `div.statusChip`（flex, align-center, gap-6, 圆角背景色）
- "重新生成高亮" / "生成高亮" 按钮：`fullWidth`，左 icon `<Sparkles size={13} />`，已有 loading/disabled 逻辑保留
- error text：改用 `<Alert variant="destructive">` 替代裸 span
- 其余 section（颜色/圆角/动画/预览）保持结构，CSS 优化间距

### Group 3 — 列表类

#### AICardList
每张卡片结构变更：

**移除**：
- 左侧 `div.iconChip`（icon + 圆形背景）

**新增**：
- 左侧 toggle button 样式改为 24px 圆圈 checkbox（`border-radius: 50%; width: 24px; height: 24px`）
- 圆圈内显示 check icon（enabled）或空（未 enabled，仅边框）

**调整**：
- 卡片右侧：`type badge pill`（保留颜色语义 `CARD_TYPE_META[card.type].color`）显示在 title 上方
- title 下方追加：`<div className={styles.preview}>{previewText}</div>`
  - `previewText` = `typeof card.content === 'string' ? card.content : JSON.stringify(card.content)` 截断至 ~80 字符
  - CSS：`2` 行截断（`-webkit-line-clamp: 2`），`font-size: 11px; color: var(--color-text-tertiary)`
- 删除按钮：改为 hover 时才显示（`opacity: 0` → hover `opacity: 1`）
- 移除 `placement Badge`（已在轨/未上轨），信息已通过 footer 按钮体现

#### AIPanel
- `PanelHeader` title 由 `"AI 助手"` → `"AI 分析"`
- footer 按钮文案：`上轨 ${enabledCount}`（目前文案为空，现在显式加上）
- 其余 header icon / badge / action 逻辑不变

---

## 边界与不涉及范围

- **不改**：所有业务逻辑（API 调用、store、状态机）
- **不改**：AICardInspector、AICoverPanel、AssetPanel、Timeline、Toolbar
- **不改**：ui/ 组件库（Button、Dialog 等）
- **不改**：CSS 变量定义文件
- 每个组件各自的 `.module.css` 独立修改，不共享新 class

---

## 验证方式

- 视觉对比：截图与 design.pen 截图对齐
- 功能回归：各弹窗开关、表单提交、进度更新、高亮生成、卡片选择/删除/上轨流程
- 无 TypeScript 报错（`tsc --noEmit`）

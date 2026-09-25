# Darwin UI 源码直入 src/ui Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Darwin UI 全量源码直接并入 `src/ui`，删除重复包装组件，改造业务引用侧，并移除对 `@pikoloo/darwin-ui` 的外部包依赖。

**Architecture:** `src/ui` 直接承接 Darwin 的 `components / contexts / hooks / lib / styles`，项目自有的 `patterns` 与少量非重复 `primitives` 继续保留。重复包装层不再作为中间 facade 使用，业务侧直接改用 Darwin 原生组件导出或按需组合。

**Tech Stack:** React 19, Electron, electron-vite, TypeScript, CSS Modules, Tailwind CSS v4, Darwin UI source, framer-motion, Vitest

---

## File Structure

### 新建目录 / 文件

```text
src/ui/components/*
src/ui/contexts/*
src/ui/hooks/*
src/ui/lib/animation-config.ts
src/ui/lib/fonts.ts
src/ui/lib/image-utils.ts
src/ui/lib/utils.ts
src/ui/styles/darwin-ui.css
```

### 重点修改文件

```text
package.json
package-lock.json
src/main.tsx
src/ui/index.ts
src/ui/styles/tailwind.css
src/ui/styles/tokens.css
src/ui/primitives/index.ts
src/ui/patterns/index.ts
src/ui/patterns/ModalFooter.tsx
src/ui/patterns/PillGroup.tsx
src/ui/patterns/SummaryCard.tsx
src/components/*.tsx
src/pages/*.tsx
tests/ui-primitives.test.tsx
```

### 重点删除文件

```text
src/ui/lib/cn.ts
src/ui/primitives/Button.tsx
src/ui/primitives/Badge.tsx
src/ui/primitives/ErrorAlert.tsx
src/ui/primitives/IconButton.tsx
src/ui/primitives/Input.tsx
src/ui/primitives/Textarea.tsx
src/ui/primitives/ProgressBar.tsx
src/ui/primitives/SelectField.tsx
src/ui/primitives/SwitchField.tsx
src/ui/primitives/SurfaceCard.tsx
src/ui/primitives/ModalShell.tsx
src/ui/patterns/SearchField.tsx
src/ui/patterns/TabBar.tsx
```

---

## Chunk 1: 文档与源码接入

### Task 1: 写入设计/计划文档并确认执行边界

**Files:**
- Modify: `docs/superpowers/specs/2026-04-05-darwin-ui-macos-overhaul-design.md`
- Modify: `docs/superpowers/plans/2026-04-05-darwin-ui-macos-overhaul.md`

- [ ] **Step 1: 写入最终设计文档**

要求：

- 明确 `src/ui` 直接承接 Darwin 源码
- 明确删除重复包装层
- 明确业务侧直接改引用

- [ ] **Step 2: 写入实现计划**

要求：

- 覆盖源码复制、依赖切换、导出重建、业务改造、验证
- 计划内容与当前用户确认的方案一致

### Task 2: 将 Darwin 源码复制到 `src/ui`

**Files:**
- Create: `src/ui/components/*`
- Create: `src/ui/contexts/*`
- Create: `src/ui/hooks/*`
- Create: `src/ui/lib/*`
- Create: `src/ui/styles/darwin-ui.css`

- [ ] **Step 1: 从上游源码复制组件、上下文、hooks、lib、styles**

Run:

```bash
mkdir -p src/ui/components src/ui/contexts src/ui/hooks src/ui/lib
cp -R /tmp/darwin-ui/src/components/. src/ui/components/
cp -R /tmp/darwin-ui/src/contexts/. src/ui/contexts/
cp -R /tmp/darwin-ui/src/hooks/. src/ui/hooks/
cp -R /tmp/darwin-ui/src/lib/. src/ui/lib/
cp /tmp/darwin-ui/src/styles/darwin-ui.css src/ui/styles/darwin-ui.css
```

Expected: Darwin 源码文件出现在 `src/ui` 下对应目录。

- [ ] **Step 2: 复制完成后抽查关键文件**

Run:

```bash
find src/ui/components -maxdepth 1 -type f | sort | sed -n '1,20p'
find src/ui/contexts -maxdepth 1 -type f | sort
find src/ui/hooks -maxdepth 1 -type f | sort
find src/ui/lib -maxdepth 1 -type f | sort
```

Expected: 列表包含 button、dialog、tabs、alert、select、overlay-context、use-escape-key、utils 等 Darwin 文件。

---

## Chunk 2: 依赖与导出重建

### Task 3: 将 npm 依赖切换为“本地源码 + 显式运行时依赖”

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 删除外部 Darwin 包依赖，补齐运行时依赖**

要求：

- 删除 `@pikoloo/darwin-ui`
- 新增 Darwin 所需运行时依赖：
  - `@base-ui/react`
  - `@radix-ui/react-dialog`
  - `@radix-ui/react-popover`
  - `@uiw/react-md-editor`
  - `class-variance-authority`
  - `clsx`
  - `date-fns`
  - `lucide-react`
  - `react-day-picker`
  - `react-focus-lock`
  - `recharts`
  - `remark-gfm`
  - `tailwind-merge`

- [ ] **Step 2: 安装依赖并更新 lockfile**

Run:

```bash
npm install
```

Expected: 安装成功，`package-lock.json` 与 `package.json` 对齐。

- [ ] **Step 3: 确认 Darwin 外部包已移除**

Run:

```bash
npm ls @pikoloo/darwin-ui
```

Expected: 输出表明未安装该包或为空树，不再存在直接依赖。

### Task 4: 重建 `src/ui` 的统一导出入口

**Files:**
- Modify: `src/ui/index.ts`
- Modify: `src/ui/primitives/index.ts`
- Modify: `src/ui/patterns/index.ts`
- Modify: `src/main.tsx`
- Modify: `src/ui/styles/tailwind.css`

- [ ] **Step 1: 重写 `src/ui/index.ts`**

要求：

- 统一导出 Darwin `components / contexts / hooks / lib`
- 统一导出保留的本地 `primitives / patterns`
- 让业务层可以从 `../ui` 直接获取所需组件

- [ ] **Step 2: 让 `primitives/index.ts` 只保留非重复本地组件**

保留：

- `Divider`
- `EmptyState`
- `Field`
- `LoadingOverlay`
- `MediaPlaceholder`
- `NumberField`

- [ ] **Step 3: 让 `patterns/index.ts` 只导出保留的组合组件**

保留：

- `ActionBar`
- `FieldGrid`
- `FileDropCard`
- `ModalFooter`
- `PanelHeader`
- `PillGroup`
- `StepIndicator`
- `SummaryCard`

- [ ] **Step 4: 改应用入口与样式入口**

要求：

- `src/main.tsx` 改为从本地 `src/ui` 引用 `OverlayProvider`
- `src/ui/styles/tailwind.css` 改为引本地 `./darwin-ui.css`

- [ ] **Step 5: 运行一次构建检查导出链路**

Run:

```bash
npm run build
```

Expected: 若失败，错误应集中在业务侧尚未迁移的 import/props，而不是 Darwin 源码缺失。

---

## Chunk 3: 删除重复包装层并改造本地组合组件

### Task 5: 删除重复包装组件文件

**Files:**
- Delete: `src/ui/lib/cn.ts`
- Delete: `src/ui/primitives/Button.tsx`
- Delete: `src/ui/primitives/Badge.tsx`
- Delete: `src/ui/primitives/ErrorAlert.tsx`
- Delete: `src/ui/primitives/IconButton.tsx`
- Delete: `src/ui/primitives/Input.tsx`
- Delete: `src/ui/primitives/Textarea.tsx`
- Delete: `src/ui/primitives/ProgressBar.tsx`
- Delete: `src/ui/primitives/SelectField.tsx`
- Delete: `src/ui/primitives/SwitchField.tsx`
- Delete: `src/ui/primitives/SurfaceCard.tsx`
- Delete: `src/ui/primitives/ModalShell.tsx`
- Delete: `src/ui/patterns/SearchField.tsx`
- Delete: `src/ui/patterns/TabBar.tsx`

- [ ] **Step 1: 删除重复包装 TSX 文件**

要求：

- 删除 TSX 文件本身
- 仅在对应 CSS module 已无引用时再删除样式文件

- [ ] **Step 2: 全局扫描确认旧文件不再被 import**

Run:

```bash
rg -n "ui/primitives/Button|ui/primitives/Badge|ui/primitives/Input|ui/primitives/ModalShell|ui/patterns/SearchField|ui/patterns/TabBar|ui/lib/cn" src
```

Expected: 不再有结果，或只剩待迁移业务引用。

### Task 6: 保留组件直连 Darwin 组件

**Files:**
- Modify: `src/ui/patterns/ModalFooter.tsx`
- Modify: `src/ui/patterns/PillGroup.tsx`
- Modify: `src/ui/patterns/SummaryCard.tsx`

- [ ] **Step 1: `ModalFooter` 直连 Darwin Button**

要求：

- 不再依赖本地 `Button` 包装
- 直接用 Darwin `Button`
- `confirmVariant` 映射为 Darwin `primary / destructive`

- [ ] **Step 2: `PillGroup` 直连 Darwin Button**

要求：

- 直接用 Darwin `Button`
- 选中态用 Darwin variant 区分

- [ ] **Step 3: `SummaryCard` 直连 Darwin Card**

要求：

- 不再依赖 `SurfaceCard`
- 直接使用 Darwin `Card`

- [ ] **Step 4: 运行类型检查/构建**

Run:

```bash
npm run build
```

Expected: 若失败，错误主要来自业务侧仍在使用旧 API。

---

## Chunk 4: 业务侧迁移

### Task 7: 将业务 import 从旧分层入口迁移到 `../ui`

**Files:**
- Modify: `src/components/*.tsx`
- Modify: `src/pages/*.tsx`

- [ ] **Step 1: 统一改 import 来源**

要求：

- 业务文件不再从 `../ui/primitives`、`../ui/patterns` 获取重复能力
- 优先统一从 `../ui` 导入
- 对保留的本地组件也改为从 `../ui` 导入，减少多入口使用

- [ ] **Step 2: 全局扫描旧入口引用**

Run:

```bash
rg -n "from '../ui/primitives'|from \"../ui/primitives\"|from '../ui/patterns'|from \"../ui/patterns\"|from '../ui/primitives/" src/components src/pages
```

Expected: 不再依赖旧入口，或只剩允许保留的极少数内部文件。

### Task 8: 将旧包装 props 使用点改为 Darwin 原生 API

**Files:**
- Modify: `src/components/*.tsx`
- Modify: `src/pages/*.tsx`

- [ ] **Step 1: Modal 相关场景改为 Darwin Dialog 组合**

覆盖：

- `AICardEditModal`
- `AISettingsModal`
- `AssetPanel`
- `ExportSettingsModal`
- `ExportProgress`

- [ ] **Step 2: Card / Search / Tabs / Select / Switch 使用点改为 Darwin 原生组件**

覆盖：

- `SurfaceCard -> Card`
- `SearchField -> SearchInput`
- `TabBar -> Tabs/TabsList/TabsTrigger`
- `SelectField -> Field + Select`
- `SwitchField -> Switch`

- [ ] **Step 3: Button/Badge/IconButton variant 语义对齐 Darwin**

要求：

- `danger -> destructive`
- `tint / brand -> accent`
- `neutral -> secondary`
- `subtle -> secondary/ghost`

- [ ] **Step 4: 运行全量搜索，确认旧包装 API 不再使用**

Run:

```bash
rg -n "<ModalShell|<SurfaceCard|<SearchField|<TabBar|<SelectField|<SwitchField|variant=\"danger\"|variant=\"tint\"|variant=\"brand\"|variant=\"neutral\"|variant=\"subtle\"" src/components src/pages
```

Expected: 只剩允许保留的非 Darwin 组件，重复包装 API 使用点被清理。

---

## Chunk 5: 验证与收尾

### Task 9: 更新测试并执行验证

**Files:**
- Modify: `tests/ui-primitives.test.tsx`
- Modify: 其他受影响测试文件（按实际失败项）

- [ ] **Step 1: 调整测试到新的 `src/ui` 导出方式**

要求：

- 测试不再依赖被删除的包装组件
- 覆盖关键 Darwin 组件与保留的本地组合组件

- [ ] **Step 2: 运行测试**

Run:

```bash
npm test
```

Expected: 全部测试通过，或明确定位剩余失败项并修复。

- [ ] **Step 3: 运行生产构建**

Run:

```bash
npm run build
```

Expected: 构建通过。

- [ ] **Step 4: 做最终人工核对清单**

核对：

- `src/ui` 已包含 Darwin 全量源码
- `@pikoloo/darwin-ui` 已移除
- 重复包装组件已删除或彻底停用
- 业务层引用已收敛到 `../ui`
- 核心界面仍能正常工作

## Execution Notes

- 当前分支存在已修改文件，执行时必须在现有 dirty worktree 基础上合并，不得回滚无关改动。
- 若某些文件已包含部分 Darwin 化尝试，应优先吸收当前改动，再向最终结构收敛。
- 任何验证失败都必须就地修复后再继续，不得跳过。

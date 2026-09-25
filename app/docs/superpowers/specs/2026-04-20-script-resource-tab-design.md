# 写稿工作台 · 稿件资源 Tab 设计

- **日期**：2026-04-20
- **作者**：yoqu / Claude
- **范围**：写稿工作台 (`ScriptWorkbench`) 左侧文件树
- **状态**：Draft（待用户复核）

## 1. 背景与目标

写稿工作台左侧的 `FileTreePanel` 当前以完整文件树形态展示工作目录的全部文件。当工程内积累了较多素材（多个抖音 `preview.json`、辅助文档等）时，用户难以快速定位三类核心稿件资源：

1. 原始文稿（`original.md`）
2. 生成的口播脚本（`script.md`）
3. 抖音导入预览（`<douyin>/<videoId>/preview.json`）

**目标**：在文件树面板顶部新增一个类 VSCode 的 tab 切换，提供一个「稿件资源」视图，按类型分组、用中文命名、支持搜索过滤，便于用户快速筛选与查找。

## 2. 非目标

- 不重写「全部文件」视图，沿用现有 `FileTree` 组件与展开状态。
- 不引入第二条 Activity Bar 或外部图标列。
- 不做虚拟滚动（资源数量预期 < 100）。
- 不修改 `onOpenFile` 行为或后续编辑器逻辑（preview.json 仍走现有的抖音预览页）。
- 不持久化 preview.json title 缓存到磁盘（仅进程内内存缓存）。

## 3. 用户故事

- 作为编辑用户，我希望切换到「稿件资源」tab 时，能在一屏内看到工程的原稿、口播稿和所有抖音导入的稿件，每个抖音稿都用我熟悉的中文标题展示，而不是 `videoId`。
- 作为编辑用户，当抖音导入超过 5 个时，我希望在搜索框输入关键词，仅展示匹配的资源。
- 作为重度用户，我希望关闭并重开应用后，我上次停留的 tab（全部文件 / 稿件资源）能被恢复。

## 4. 架构

```
FileTreePanel (容器)
├─ <PanelHeader />                        ← 已有
├─ <Tabs value={fileTreeView} ...>        ← 新增（复用 ui/components/tabs）
│   <TabsList>
│     <TabsTrigger value="all">全部文件</TabsTrigger>
│     <TabsTrigger value="resources">稿件资源</TabsTrigger>
│   </TabsList>
│   <TabsContent value="all">
│     <FileTree ... />                    ← 已有，保持不变
│   </TabsContent>
│   <TabsContent value="resources">
│     <ScriptResourceView ... />          ← 新增
│   </TabsContent>
└─ EmptyState（未选目录时）                ← 已有
```

```
ScriptResourceView
├─ <Input variant="search" leftIcon=<Search/> ... />    ← 复用 ui/components/input
├─ 三段分组列表
│   ├─ 「原始文稿」 + Badge 计数
│   ├─ 「口播脚本」 + Badge 计数
│   └─ 「抖音导入」 + Badge 计数
└─ <EmptyState />（无资源 / 搜索无命中时）              ← 复用 ui/primitives/EmptyState
```

## 5. 文件分布

### 新增

- `src/lib/workspace-resources.ts` — 资源收集、preview.json 解析、缓存
- `src/components/script/FileTreeTabs.tsx` — 顶部 Tabs 包装（薄层，便于测试）
- `src/components/script/ScriptResourceView.tsx` — 稿件资源视图组件
- `src/components/script/ScriptResourceView.module.css` — 样式（仅分组标题/行间距，色值与圆角全部用 CSS 变量）
- `tests/script-workspace-resources.test.ts` — 收集 / 解析 / 缓存逻辑单测
- `tests/script-resource-view.test.tsx` — 视图渲染、搜索、空态测试

### 修改

- `src/components/script/FileTreePanel.tsx` — 接入 Tabs + 新视图
- `src/components/script/FileTreePanel.module.css` — 仅微调（如必要）
- `src/store/script.ts` — 新增 `fileTreeView` 状态字段与 setter
- `src/pages/ScriptWorkbench.tsx` — 透传 store 中的 `fileTreeView` 到 `FileTreePanel`（如组件内直接消费 store 则免）

### 不修改

- `src/lib/video-import-preview.ts` — 已提供 `isVideoImportPreviewFile` 与 `parseVideoImportPreviewDocument`
- `src/lib/electron-api.ts` — 复用现有 `loadScriptFile` 读取 preview.json 内容

## 6. 数据模型

```ts
// src/lib/workspace-resources.ts

export type ResourceGroup = 'original' | 'script' | 'douyin';

export interface ResourceItem {
  /** 相对路径，与 onOpenFile 一致 */
  path: string;
  /** 中文展示名 */
  displayName: string;
  /** 分组归属 */
  group: ResourceGroup;
  /** 副标题（如 videoId、来源链接） */
  subtitle?: string;
  /** 文件 mtime，用于缓存失效（可选） */
  mtime?: number;
}

export interface PreviewMeta {
  title: string;
  videoId: string;
  mtime: number;
}

/** 第一阶段：扫描 fileEntries，给出基础列表（preview 用 videoId 占位） */
export function collectScriptResources(
  fileEntries: FileEntry[],
  previewMetaCache: Map<string, PreviewMeta>,
): ResourceItem[];

/** 第二阶段：异步读取并解析未命中缓存的 preview.json */
export async function hydratePreviewMeta(
  projectDir: string,
  paths: string[],
  cache: Map<string, PreviewMeta>,
  loadScriptFile: (dir: string, rel: string) => Promise<string | null>,
): Promise<void>;

/** 搜索过滤 */
export function filterResources(items: ResourceItem[], query: string): ResourceItem[];
```

### 命名规则

| 文件路径 | displayName | subtitle |
|---------|-------------|----------|
| `original.md` | `原始文稿` | `original.md` |
| `script.md` | `口播脚本` | `script.md` |
| `<...>/<videoId>/preview.json`（解析成功） | preview.json 内 `title` 字段 | `抖音 · <videoId>` |
| `<...>/<videoId>/preview.json`（解析失败 / 加载中） | `videoId` | `抖音 · 解析中` 或 `抖音 · 解析失败` |

> 备注：解析中显示 `videoId` 而非空白，避免列表抖动；解析完成后平滑替换。

## 7. 数据流

```
fileEntries 变更
   │
   ▼
collectScriptResources(entries, cache)  ← 同步，立即出列表（preview 显示占位）
   │
   ▼
ScriptResourceView 渲染
   │
   ▼
useEffect: 找出未在 cache 中的 preview 路径
   │
   ▼
hydratePreviewMeta(...) 串行读取 + parse
   │
   ▼
更新 cache（useState + ref）→ 重新计算 items
   │
   ▼
ScriptResourceView 重渲染（title 替换）
```

### 缓存与失效

- 缓存形态：`Map<string /* relativePath */, PreviewMeta>`，存放在 `ScriptResourceView` 的 ref + state 双结构中（state 触发重渲染，ref 用于 effect 内读取最新值）。
- 失效条件：`fileEntries` 中同路径的 mtime 变化（若 `FileEntry` 暴露 mtime；若不暴露，则按路径首次解析后保留，外层文件树刷新时不强制重解析）。
- 进程退出后缓存丢失，下次进入 tab 时重新解析。

> 实现注意：先在 `FileEntry` 类型上确认是否带 `mtime`/`modifiedAt`。若不带，则缓存按路径粒度即可，不做 mtime 比较；解析失败的项加入 negative cache（带 `failedAt`），10s 内不重试。

## 8. 状态管理

```ts
// src/store/script.ts 新增
interface ScriptStoreState {
  // ...已有字段
  fileTreeView: 'all' | 'resources';
}

interface ScriptStoreActions {
  // ...已有 actions
  setFileTreeView: (view: 'all' | 'resources') => void;
}
```

- 默认值 `'all'`
- 写入 `script-state.json`（与现有 `expandedDirectories` 同套持久化机制）
- `expandedDirectories` 仅作用于「全部文件」tab，互不影响

## 9. UI 规范（严格遵循 DESIGN.md）

### 复用的 UI 库组件

| 用途 | 组件 | 来源 |
|------|------|------|
| Tab 切换 | `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` | `src/ui/components/tabs.tsx` |
| 搜索输入 | `Input` (`variant="search"`，内置 Search icon + clearable) | `src/ui/components/input.tsx` |
| 计数徽章 | `Badge` (`size="xs"`, `variant="secondary"`) | `src/ui/components/badge.tsx` |
| 空状态 | `EmptyState` | `src/ui/primitives/EmptyState.tsx` |
| 面板标题 | `PanelHeader` | `src/ui/patterns/PanelHeader.tsx` |
| 操作按钮 | `Button.Ghost` (Tab 旁的「更换目录」复用现有) | `src/ui/components/button.tsx` |

> **铁律**：禁止自行实现 Tab、Input、Badge、Spinner 等任何已存在于 UI 库的原子组件。仅当 UI 库不存在对应能力时才允许新建样式（本设计中仅「分组标题行 + 资源列表行」需要新写 CSS）。

### 视觉细节

| 元素 | 规范 |
|------|------|
| Tabs 高度 | 与 `PanelHeader` 同一行视觉节奏，整体 ≤ 32px |
| Tabs 颜色 | 未激活：`--color-text-secondary`；激活：`--color-text-primary` + 底部 2px `--color-system-blue` |
| 搜索框尺寸 | `size="sm"`，圆角 `--radius-md`，内边距 8/10px |
| 分组标题 | 字号 `--font-size-xs`，颜色 `--color-text-secondary`，左 padding 与列表行对齐 |
| 计数徽章 | 紧贴分组标题右侧，`Badge size="xs"`，自动隐藏（计数为 0 时不渲染整段分组） |
| 资源行 | 复用 `treeRow` 视觉（icon + 主文字 + 副标题 + 状态点） |
| 行高 | 复用现有 `treeRow` 高度（约 24px） |
| icon | 原稿：`FileText`；口播稿：`FileText`（深色 / 不同色）；抖音：`Film` |
| 已打开高亮 | 与 `FileTree` 一致（`treeRowActive`） |
| 脏标 / 冲突 | 复用 `dirtyDot` / `conflictMark`，行为与全部文件 tab 一致 |
| 空态 | `EmptyState`，文案见 §10 |

## 10. 文案

| 场景 | 文案 |
|------|------|
| Tab A | `全部文件` |
| Tab B | `稿件资源` |
| 搜索框 placeholder | `搜索稿件...` |
| 分组标题 | `原始文稿` / `口播脚本` / `抖音导入` |
| 空态（未选目录） | 复用现有 `EmptyState`（标题：`尚未选择工作目录`） |
| 空态（无任何资源） | 标题：`暂无稿件资源`；描述：`导入文稿或抖音视频后，会在此快速访问。` |
| 空态（搜索无命中） | 标题：`未找到匹配资源`；描述：`换个关键词试试，或清空搜索。` |
| 解析失败副标题 | `抖音 · 解析失败` |
| 解析中副标题 | `抖音 · 解析中` |

## 11. 交互行为

- **点击资源**：调用 `onOpenFile(item.path)`，等同于全部文件 tab 中的点击。
- **拖拽**：复用现有 `handleDragStart`，dataTransfer 传 `application/x-workbench-file` + `path`。
- **搜索**：
  - 输入实时过滤（无 debounce）
  - 匹配字段：`displayName` + `subtitle`，不区分大小写
  - 命中分组保留，未命中分组整段隐藏
  - 搜索时整体无命中则展示「未找到匹配资源」EmptyState
  - `Esc` 清空（依赖 `Input` 自带的 clearable 行为）
- **Tab 切换**：写入 `setFileTreeView` → 持久化到 `script-state.json`
- **资源高亮**：`activeFile` 命中时与全部文件 tab 同样高亮
- **键盘导航**（P1，本次不做）：未来可加 ↑↓ + Enter

## 12. 错误处理与降级

| 场景 | 行为 |
|------|------|
| `loadScriptFile` 抛错 | 缓存为「失败」，副标题显示 `抖音 · 解析失败`，不影响其他资源 |
| preview.json 内容损坏 / schema 不匹配 | 同上 |
| `fileEntries` 为空但 projectDir 存在 | 显示空态「暂无稿件资源」 |
| 一份 preview.json 解析后 `title` 为空字符串 | fallback 到 `videoId` |
| 同名 preview.json 出现在非抖音目录 | 当前正则只判文件名，因此会被纳入「抖音导入」；如需更严格限制，未来可扩展 `parseVideoImportPreviewDocument` 校验 |

## 13. 测试计划

### 单元（`tests/script-workspace-resources.test.ts`）

- 给定 `fileEntries`，`collectScriptResources` 返回正确分组与基础命名
- 缓存命中时直接用缓存的 title
- 缓存未命中时使用 videoId 占位
- `filterResources` 中文匹配 / 大小写不敏感 / 副标题命中

### 组件（`tests/script-resource-view.test.tsx`）

- 渲染三段分组与计数
- 输入搜索后正确过滤、空命中显示 EmptyState
- 点击行触发 `onOpenFile`
- 解析中显示占位、解析完后替换为 title（mock `loadScriptFile`）
- `activeFile` 高亮

### 集成（手动）

- Tab 切换 + 状态持久化跨会话
- 抖音导入完成后切到稿件资源 tab，新 preview.json 自动出现并加载 title
- 拖拽行到右侧编辑区行为正确

## 14. 验证清单（交付前必跑）

- [ ] `npm test` 全部通过
- [ ] 新建空工程 → 稿件资源 tab 显示「暂无稿件资源」
- [ ] 仅有 `original.md` → 仅显示「原始文稿」分组
- [ ] 全量场景（原稿 + 口播稿 + 多份 preview.json）展示正确
- [ ] 搜索关键词命中、清空恢复全部
- [ ] Tab 状态持久化（关闭重开应用后恢复）
- [ ] preview.json title 异步加载平滑替换
- [ ] preview.json 损坏不影响其他资源
- [ ] UI 库组件全部复用（搜索框、Tab、Badge、EmptyState 均来自 `src/ui/`）
- [ ] 通过 `/ui-review` 审查

## 15. 风险与权衡

| 风险 | 影响 | 缓解 |
|------|------|------|
| `Tabs` 组件视觉密度可能略大于面板 | 占用顶部空间增加 | 必要时通过 className 收紧 padding；不修改 `Tabs` 本体 |
| preview.json 数量极多（>100）时一次性解析慢 | 进入 tab 卡顿 | 当前 YAGNI；超出阈值时改为按需 / 可见区域优先解析 |
| `FileEntry` 不带 mtime | 文件被外部修改后标题不刷新 | 切换 tab / 刷新文件树时强制清缓存（按需补丁） |
| `script-state.json` schema 变更 | 老用户 state 缺字段 | 默认值 `'all'`，向前兼容 |

## 16. 与现有规范的关系

- **DESIGN.md**：色值、字号、圆角全部走 CSS 变量；不引入第二种彩色 accent。
- **AI 操作界面铁律**：本功能不涉及 AI 操作，不引入虚拟光标 / 流式编辑器。
- **统一进度条规范**：本功能不涉及耗时任务（preview.json 解析为毫秒级，不上 AppStatusBar）。
- **前端 UI 交付审查**：完成实现后必须执行 `/ui-review`。

## 17. 里程碑

1. **M1**：`workspace-resources.ts` + 单测
2. **M2**：`ScriptResourceView` 组件 + 单测
3. **M3**：`FileTreePanel` 接入 Tabs + script store 字段与持久化
4. **M4**：手动验证 + `/ui-review`
5. **M5**：提交 commit

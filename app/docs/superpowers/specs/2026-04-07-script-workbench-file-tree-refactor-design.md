# AI 写稿工作台文件树重构设计

## 概述

重构 ScriptWorkbench 的操作逻辑：将工作目录选择从步骤 1 移至左侧文件树面板，采用类 VS Code 的布局（左文件树 + 右上操作面板 + 右下编辑器），支持文件修改标记、⌘S 全量保存、chokidar 文件监听与编辑冲突处理。

## 设计决策记录

| 决策点 | 选项 | 选择 | 理由 |
|--------|------|------|------|
| 整体布局 | 三栏 / 双栏 / 活动栏 | 用户自定义方案 | 左文件树 + 右上操作面板 + 右下编辑器 |
| 初始化流程 | 去掉步骤1 / 简化导入 / 自动检测 | 自动检测（C） | 选目录后智能判断状态，无需显式步骤 1 |
| 复杂步骤操作 | 面板展开 / 弹窗抽屉 / 高度自适应 | 抽屉（B） | 操作面板保持紧凑，编辑器不被压缩 |
| 保存范围 | 单文件 / 全部保存 | 全部保存（B） | 写稿场景文件少，Save All 更省心 |
| 冲突判定 | 脏文件即冲突 / diff合并 / 时间戳 | 脏文件即冲突（A） | 最简单可预测，写稿场景不需要自动合并 |
| 文件监听 | fs.watch / chokidar / 轮询 | chokidar（B） | 跨平台稳定可靠，社区成熟 |

## 布局结构

```
┌──────────────────────────────────────────────────────────┐
│                    ScriptWorkbench                       │
├────────────┬─────────────────────────────────────────────┤
│            │  操作面板（紧凑，1-2行）                       │
│            │  [步骤指示器] [统计/摘要] [保存⌘S] [下一步→]   │
│  文件树     ├─────────────────────────────────────────────┤
│  (~220px)  │  文件标签栏  [original.md ●] [script.md]     │
│            ├─────────────────────────────────────────────┤
│  📂 项目    │                                             │
│  ├ 📄 orig │          编辑器 (CodeMirror 6)               │
│  ├ 📄 scri │              占据主要面积                     │
│  ├ ⚙ state │                                             │
│  └ 📁 asse │                                             │
└────────────┴─────────────────────────────────────────────┘
```

## 组件层级

```
ScriptWorkbench (页面容器)
├── FileTreePanel (左侧文件树)
│   ├── 空状态 → 点击唤起目录选择器
│   └── 文件树 → 项目文件列表，修改/冲突标记，点击打开文件
├── WorkArea (右侧工作区)
│   ├── OperationBar (顶部操作面板，紧凑)
│   │   ├── StepIndicator (步骤指示器)
│   │   ├── 当前步骤摘要信息
│   │   └── 操作按钮组 (保存/上一步/下一步/步骤特有按钮)
│   ├── FileTabs (文件标签栏)
│   │   └── 标签页 + 修改状态圆点 + 冲突警告图标
│   └── EditorArea (编辑器区域)
│       └── ScriptEditor (CodeMirror 6)
├── StepDrawer (右侧抽屉，按需弹出)
│   └── 模板选择 / 批注列表
└── ConflictDialog (冲突确认弹窗)
```

## 文件树面板

### 空状态

用户首次打开或未选择目录时，文件树显示引导：点击唤起 `electronAPI.selectProjectDirectory()`。

### 初始化流程（自动检测）

```
用户点击"选择工作目录"
  → electronAPI.selectProjectDirectory() → dir
  → setProjectDir(dir)
  → chokidar 开始监听
  → loadFullScriptState(dir)

  ├── 有 script-state.json
  │   → 恢复 currentStep / 模板 / 批注
  │   → 加载 original.md / script.md
  │   → 跳转到恢复的步骤
  │
  └── 无 script-state.json
      ├── 有 original.md → 加载内容，从步骤 1（原稿审查）开始
      └── 无 original.md → 编辑器区显示引导：
          [导入文本文件] 或 [新建空白文稿]
          → 创建 original.md → 进入步骤 1
```

### 文件树功能

- 显示工作目录下文件，最多 2 层深度
- 高亮当前打开文件（accent 左边框 + 背景色）
- 修改标记：文件名右侧橙色圆点（dirty）
- 冲突标记：文件名右侧红色 ⚠（conflict）
- 点击 `.md` 文件切换编辑器标签页
- `script-state.json` 显示但不可编辑（灰色）

## 步骤改造

原 5 步 → 新 4 步（步骤 1 融入文件树）：

| 新步骤 | 名称 | 操作面板内容 | 自动打开文件 |
|--------|------|------------|------------|
| 0 | 未初始化 | （文件树空状态） | — |
| 1 | 原稿审查 | 字数/段落/阅读时间 + [下一步] | original.md |
| 2 | 生成口播稿 | [选择模板▼] + [生成] + [下一步] | original.md → 生成后切 script.md |
| 3 | AI 审查 | 批注统计 + [查看批注▼] + [开始审查] + [下一步] | script.md |
| 4 | 确认保存 | 最终稿信息 + [保存最终稿] | script.md |

`currentStep` 值 `0` 表示未初始化，`1-4` 对应工作步骤。

## 操作面板（OperationBar）

始终保持紧凑（1-2 行），各步骤内容：

- **步骤 1**：`[← 返回] | 字数/段落/阅读时间 | [💾 保存 ⌘S] [下一步 →]`
- **步骤 2**：`[← 上一步] | 模板: xxx [更换模板▼] | [💾 保存 ⌘S] [✨ 生成口播稿] [下一步 →]`
- **步骤 3**：`[← 上一步] | 批注: N待处理/N已采纳/N已忽略 [查看批注▼] | [💾 保存 ⌘S] [🔍 开始审查] [下一步 →]`
- **步骤 4**：`[← 上一步] | 最终稿信息 | [💾 保存最终稿]`

点击 [更换模板▼] 或 [查看批注▼] 打开右侧抽屉。

## 抽屉（StepDrawer）

- 从右侧滑出，宽度 ~320px
- 不使用遮罩层，编辑器仍可见可操作
- 关闭方式：关闭按钮 / ESC
- 内容类型：`template`（模板选择列表 + 预览）或 `annotations`（批注列表，可逐条采纳/忽略）

## 文件监听与冲突处理

### 监听架构

- **主进程**：chokidar 监听工作目录，`depth: 1`，`ignoreInitial: true`，过滤只关注 `.md` 文件
- **IPC 通道**：`file-changed` 事件，携带 `{ file: string, content: string }`
- **渲染进程**：收到事件后根据 dirty 状态决定更新或标记冲突

### dirty 状态流转

```
用户编辑 → fileDirtyMap[file] = true → 文件树/标签页显示橙色 ●
用户保存 ⌘S → 所有 dirty 文件写入磁盘 → fileDirtyMap 全部清 false → ● 消失
```

### 冲突处理流程

```
dirty 文件收到外部变更
  → fileConflictMap[file] = true
  → 文件树/标签页显示红色 ⚠
  → 编辑器顶部提示条："此文件已被外部修改。[查看差异] [使用外部版本] [保留当前版本]"
  → 暂存外部版本到 stashedContent[file]

用户按 ⌘S 且存在冲突
  → 弹出 ConflictDialog
  → 列出冲突文件，用户逐个选择"使用我的版本"或"使用外部版本"
  → 确认后执行对应操作，清除 dirty/conflict 标记
```

### 忽略自身写入

保存文件时通过 `savingFiles: Set<string>` 标记，`onFileChanged` 中过滤掉自身写入触发的事件，延迟 500ms 移除标记。

## Store 变更

```typescript
interface ScriptState {
  // 现有字段保留
  projectDir: string | null;
  currentStep: number;           // 0=未初始化, 1-4=工作步骤
  originalText: string;
  scriptText: string;
  selectedTemplate: string;
  annotations: Annotation[];
  generating: boolean;
  reviewing: boolean;

  // 新增字段
  openedFile: 'original.md' | 'script.md' | null;
  fileDirtyMap: Record<string, boolean>;
  fileConflictMap: Record<string, boolean>;
  stashedContent: Record<string, string>;   // 外部版本暂存
  drawerVisible: boolean;
  drawerContent: 'template' | 'annotations' | null;

  // 新增 actions
  setOpenedFile(file: string | null): void;
  setFileDirty(file: string, dirty: boolean): void;
  setFileConflict(file: string, conflict: boolean): void;
  stashExternalContent(file: string, content: string): void;
  clearAllDirty(): void;
  clearConflict(file: string): void;
  openDrawer(content: 'template' | 'annotations'): void;
  closeDrawer(): void;
  saveAll(): Promise<void>;     // 遍历 dirty 文件写入磁盘
}
```

## Electron API 变更

```typescript
interface ElectronAPI {
  // 现有 API 保留
  selectProjectDirectory(): Promise<string | null>;
  selectTextFile(): Promise<{ path: string; content: string } | null>;
  saveScriptFile(projectDir: string, filename: string, content: string): Promise<void>;
  loadScriptFile(projectDir: string, filename: string): Promise<string | null>;
  saveScriptState(projectDir: string, state: string): Promise<void>;
  loadScriptState(projectDir: string): Promise<string | null>;

  // 新增：文件监听
  startWatching(dir: string): Promise<void>;
  stopWatching(): Promise<void>;
  onFileChanged(callback: (data: { file: string; content: string }) => void): void;
  removeFileChangedListener(): void;

  // 新增：读取目录结构
  readDirectory(dir: string): Promise<FileEntry[]>;
}

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  children?: FileEntry[];   // 仅 directory 类型
}
```

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `src/components/script/FileTreePanel.tsx` | 文件树面板组件 |
| 新增 | `src/components/script/FileTreePanel.module.css` | 文件树样式 |
| 新增 | `src/components/script/OperationBar.tsx` | 顶部操作面板 |
| 新增 | `src/components/script/FileTabs.tsx` | 文件标签栏 |
| 新增 | `src/components/script/StepDrawer.tsx` | 右侧抽屉 |
| 新增 | `src/components/script/ConflictDialog.tsx` | 冲突确认弹窗 |
| 新增 | `src/components/script/EmptyGuide.tsx` | 编辑器区空状态引导 |
| 重构 | `src/pages/ScriptWorkbench.tsx` | 主布局重组 |
| 重构 | `src/pages/ScriptWorkbench.module.css` | 布局样式重写 |
| 重构 | `src/store/script.ts` | 新增 dirty/conflict/drawer/openedFile 状态 |
| 重构 | `src/lib/script-persistence.ts` | 文本保存改为手动触发 |
| 重构 | `src/lib/electron-api.ts` | 新增文件监听 + 目录读取 API |
| 重构 | `electron/main.ts` | 新增 chokidar IPC handlers |
| 重构 | `electron/preload.ts` | 暴露新 API |
| 删除 | `src/components/script/StepInitialize.tsx` | 功能拆分到文件树和引导 |
| 重构 | `src/components/script/StepReviewOriginal.tsx` | 精简，统计信息移到操作面板 |
| 重构 | `src/components/script/StepGenerate.tsx` | 模板选择移入抽屉 |
| 重构 | `src/components/script/StepAIReview.tsx` | 批注列表移入抽屉 |
| 重构 | `src/components/script/StepConfirm.tsx` | 适配新布局 |
| 重构 | `src/components/script/StepIndicator.tsx` | 适配新 4 步流程 |

## 依赖变更

- 新增 `chokidar`（主进程 devDependency，Electron 打包时 bundled）

## 风险与边界

- chokidar 在 Electron 打包时需确认兼容性（已有广泛使用先例）
- 文件树仅展示 2 层深度，不支持深层嵌套目录
- 冲突处理采用保守策略（dirty=冲突），可能在 AI 频繁修改时产生较多冲突提示
- 保存时忽略自身写入的 500ms 延迟窗口，极端情况下可能漏过快速连续的外部写入

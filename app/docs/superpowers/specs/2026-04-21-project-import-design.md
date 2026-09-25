# 跨机器项目导入设计

- 创建时间：2026-04-21
- 状态：Design（待 review）
- 主负责：yoqu

## 背景

当前欢迎页有「新建工程」「打开项目」「导入文稿」「导入音频」「抖音导入」五个入口，但缺少一个场景：

> 用户把项目目录从 A 电脑复制到 B 电脑（U 盘、网盘同步、跨团队传递等）。B 电脑第一次打开这个目录时：
> - 若目录已有 `project.json`，`打开项目` 能打开，但 **时间线中所有 `assetPath` / `podcast.audioPath` 都是 A 电脑的绝对路径，素材全部缺失**。
> - 若目录只有散落的 `original.md` / `script.md` / `podcast-audio.mp3` / `podcast-subtitles.srt`（用户在 A 电脑用旧版本或手工整理），B 电脑虽然可以「打开项目」但会生成一个空壳 `project.json`，用户看不到任何已存在素材，体验断裂。
> - 旧格式（`timeline.json` / `script-state.json`）目前已支持自动迁移，但同样会命中绝对路径问题。

「导入项目」功能的价值是把 **跨机器项目接入** 显式化：识别目录内容、生成或迁移 `project.json`、修复素材绝对路径、给出清晰的"哪些修好了 / 哪些缺失"反馈，并加入最近项目列表。

## 目标与非目标

### 目标

- 在欢迎页提供显式的「导入项目」入口，与「打开项目」并列。
- 支持四类目录内容：
  - **S1**：含 `project.json`，素材齐全
  - **S2**：含旧格式（`timeline.json` / `script-state.json` / `ai-analysis.json`）
  - **S3**：无 `project.json` 但含核心媒资（至少有 `podcast-audio.mp3` 或 `script.md` 或 `original.md`）
  - **S4**：仅有零散 md/srt/mp3，无法识别为项目
- 自动路径修复：扫描 `timeline` 中所有 `OverlayItem.assetPath`、`timeline.podcast.audioPath`，对绝对路径且不存在的引用，在新 `projectDir` 下按 basename 搜索并重写到新机器的绝对路径。
- 识别面板：导入前让用户看到 `{scenario, timelineItemCount, fixedAssets, missingAssets, coverCandidateCount}` 等信息，可以选择"接受缺失继续导入"或"取消"。
- 导入后调用既有 `addRecentProject` 并导航到合适页面（与「打开项目」一致）。

### 非目标（YAGNI）

- 不做"自动根据 md/srt 重建时间线"（裸素材场景引导用户走「新建工程」）。
- 不把 `assetPath` 整体改为相对路径（牵扯 Remotion / Timeline / Asset Panel 多处路径解析，另立 RFC）。
- 不做批量导入 / 文件夹扫描递归（一次只导一个项目目录）。
- 不做云盘 / 远程项目同步。
- 不做项目内容预览（封面、文本摘要等）——识别面板只给结构信息。

## 场景分级与处理策略

| 场景 | 判定信号 | 处理 | UI 提示 |
|---|---|---|---|
| **S1** 完整项目 | 存在 `project.json` 且 JSON 合法 | 复用 `loadProjectFile`，之后跑 `normalizeAssetPaths` | `"识别为完整项目"` + 路径修复报告 |
| **S2** 旧格式 | 无 `project.json`，但存在 `timeline.json` / `script-state.json` / `ai-analysis.json` 任一 | `loadProjectFile` 自动迁移（现有逻辑），之后跑 `normalizeAssetPaths` | `"识别为旧版本项目，已迁移"` |
| **S3** 无状态但有媒资 | 以上全无，但含 `podcast-audio.mp3` / `original.md` / `script.md` / `podcast-subtitles.srt` 任一 | `loadProjectFile` 创建空骨架（现有逻辑），不做素材注入 | `"未找到项目状态文件，将创建新项目骨架"` + 列出检测到的媒资 |
| **S4** 无法识别 | 以上全无 | **阻断**：导入按钮置灰 + 提示 `"未识别为项目目录，请使用『新建工程』"` | 识别面板禁用继续 |

> 备注：S3 不做"自动填充时间线"，因为时间线结构需要用户意图（分段、字幕切分参数等）。仅展示"你的项目已接入，时间线为空，请在编辑器中继续编辑"。

## 架构设计

### 模块关系

```
Setup (欢迎页)
  └─ 快捷栏新增「导入项目」入口
       │
       └─ 打开 ImportProjectDialog
             │
             ├─ Step 1：选择目录 (IPC select-project-directory，复用)
             │
             ├─ Step 2：扫描目录 (IPC scan-project-directory，新增)
             │        ↓
             │   返回 ImportProjectScanResult
             │        ↓
             ├─ Step 3：展示识别面板
             │        - 场景标签（S1 / S2 / S3）
             │        - 检测到的文件清单
             │        - 时间线素材数、将被修复的数、缺失的数
             │        - 缺失素材详情（可展开）
             │        - S4 阻断 + 引导
             │
             └─ Step 4：用户确认 → IPC import-project（新增）
                    │
                    ├─ loadProjectFile(projectDir) — 复用现有迁移
                    ├─ normalizeAssetPaths(projectData, projectDir)
                    ├─ saveProjectSection(..., 'timeline', fixed) — 持久化修复
                    ├─ addRecentProject(...)  — 复用
                    └─ 返回 ImportProjectResult
```

### 新增文件与职责

| 文件 | 职责 |
|---|---|
| `electron/project-import.ts` | 主进程：`scanProjectDirectory()` / `normalizeAssetPaths()` / `importProject()` 核心逻辑 |
| `src/components/ImportProjectDialog.tsx` | 欢迎页导入向导 Modal：选目录 → 识别面板 → 确认导入 |
| `src/lib/project-import-types.ts` | Renderer / Main 共享类型：`ImportProjectScanResult`、`ImportProjectResult`、`AssetFixReport` |
| `tests/project-import.test.ts` | 四类场景（S1–S4）+ 路径修复正负例 + 缺失汇总 |

### 修改的既有文件

- `electron/main.ts`：注册 `scan-project-directory`、`import-project` 两个 IPC handler
- `electron/preload.ts`：暴露 `scanProjectDirectory`、`importProject` 桥
- `src/lib/electron-api.ts`：追加两个方法与类型
- `src/pages/Setup.tsx`：在 `quickBar` 末尾新增「导入项目」按钮，接线 Dialog
- `src/App.tsx`：新增 `handleImportProject` 回调（与 `handleOpenProject` 类似：导入成功后导航到 `resolveProjectLandingPage()`，失败 toast 提示）

### 与现有链路的关系

- **复用**：`loadProjectFile` 的场景识别与旧格式迁移 / `saveProjectSection` 的持久化 / `addRecentProject` 的最近项目登记 / `select-project-directory` 的目录选择对话框。
- **不触碰**：`project.json` 结构、Remotion 导出链路、Web Card materialize、`ProjectData` 迁移版本号。

## 数据模型

### `ImportProjectScanResult`

```typescript
export type ImportProjectScenario = 'complete' | 'legacy' | 'mediaOnly' | 'unrecognized';

export interface DetectedFile {
  relativePath: string;       // 相对 projectDir
  bytes: number;
  kind:
    | 'projectJson'
    | 'legacyTimeline'
    | 'legacyAIAnalysis'
    | 'legacyScriptState'
    | 'scriptMd'
    | 'originalMd'
    | 'audioMp3'
    | 'subtitleSrt'
    | 'coverImage'
    | 'aiCard'
    | 'douyinImport'
    | 'promptOverride'
    | 'other';
}

export interface AssetReferenceSummary {
  /** overlay.assetPath + podcast.audioPath 总数 */
  totalReferences: number;
  /** 引用在当前文件系统存在（未变动）的数量 */
  intactCount: number;
  /** 将被自动修复的数量（通过 basename 匹配能找到新路径） */
  fixableCount: number;
  /** 仍缺失的数量 */
  missingCount: number;
  /** 缺失清单（用于 UI 展示，最多返回 50 条） */
  missingItems: Array<{
    overlayId?: string;        // 如果是 overlay，填 id
    kind: 'overlayAsset' | 'podcastAudio';
    originalPath: string;      // A 电脑的原始绝对路径
    basename: string;
  }>;
}

export interface ImportProjectScanResult {
  projectDir: string;
  projectName: string;          // path.basename(projectDir)
  scenario: ImportProjectScenario;
  detectedFiles: DetectedFile[];
  timelineItemCount: number;
  coverCandidateCount: number;
  assetReferences: AssetReferenceSummary;
  /** scenario === 'unrecognized' 时填，前端展示引导文案 */
  blockReason?: string;
}
```

### `ImportProjectResult`

```typescript
export interface AssetFixReport {
  fixed: Array<{
    kind: 'overlayAsset' | 'podcastAudio';
    overlayId?: string;
    originalPath: string;
    newPath: string;
  }>;
  missing: AssetReferenceSummary['missingItems'];
}

export interface ImportProjectResult {
  projectDir: string;
  projectName: string;
  scenario: ImportProjectScenario;     // 非 'unrecognized'
  fixReport: AssetFixReport;
  migratedFromLegacy: boolean;         // S2 场景标记
}
```

## IPC 设计（三件套）

### `scan-project-directory`

- **输入**：`{ projectDir: string }`
- **输出**：`ImportProjectScanResult`
- **主进程实现**（`electron/project-import.ts`）：
  1. 校验 `projectDir` 存在且为目录
  2. 扫描顶层 + 一层子目录（`covers/`、`ai-cards/`、`imports/douyin/<id>/`、`configs/prompts/`），分类到 `DetectedFile[]`
  3. 判定场景：`project.json` 存在 → `complete`；有任一旧文件 → `legacy`；有核心媒资 → `mediaOnly`；否则 `unrecognized`
  4. 对 `complete` / `legacy` 场景：只读解析 `project.json` 或 `timeline.json`，统计 `timelineItemCount` / `coverCandidateCount`，跑 `planAssetNormalization`（只计算不写入），产出 `AssetReferenceSummary`
  5. 对 `mediaOnly`：`timelineItemCount = 0`，`assetReferences` 全零
  6. 对 `unrecognized`：`blockReason = '目录中未找到 project.json 或核心媒资文件（podcast-audio.mp3 / script.md 等）'`
- **只读**：本 IPC 不修改任何文件

### `import-project`

- **输入**：
  ```typescript
  {
    projectDir: string;
    acceptMissingAssets: boolean;  // 用户勾选"允许缺失继续"
  }
  ```
- **输出**：`ImportProjectResult`
- **主进程实现**：
  1. 再次 `scanProjectDirectory`（避免 scan 与 import 之间目录被外部修改）；若场景降级为 `unrecognized` → 报错
  2. 若 `scenario === 'unrecognized'` → 抛 `ImportProjectError('unrecognized')`
  3. 若 `missingCount > 0 && !acceptMissingAssets` → 抛 `ImportProjectError('missing_assets')`
  4. 调 `loadProjectFile(projectDir)`（完成 S1 读取 / S2 迁移 / S3 骨架创建）
  5. 调 `normalizeAssetPaths(data, projectDir)` → 得到 `{ fixedData, fixReport }`
  6. 若 `fixedData.timeline !== data.timeline` → `saveProjectSection(projectDir, 'timeline', fixedData.timeline)` 持久化修复
  7. 返回 `ImportProjectResult`（`migratedFromLegacy` 根据 scan 结果填）

## 路径修复算法（`normalizeAssetPaths`）

**输入**：`ProjectData` + `projectDir`

**步骤**：

```
candidates = 收集以下路径引用 {
  timeline.podcast.audioPath (if 非空)
  timeline.tracks[*].overlays[*].assetPath (type in ['video','image','audio'])
}

// 建立 basename → candidate 文件表（惰性，只在第一次 fix 时构建）
basenameIndex = null

for each ref in candidates:
  if isAbsolute(ref) && existsSync(ref):
    继续  // 原地可用，不动
  else if !isAbsolute(ref):
    // 已经是相对路径，resolve 到 projectDir 下检查
    resolved = path.resolve(projectDir, ref)
    if existsSync(resolved) → 继续
    else → 按 basename 走修复流程
  
  // basename 搜索
  if basenameIndex === null:
    basenameIndex = buildBasenameIndex(projectDir)  // 递归扫描，跳过 node_modules / release / dist*
  matches = basenameIndex.get(path.basename(ref))
  
  if matches.length === 0:
    fixReport.missing.push({ kind, overlayId?, originalPath: ref, basename })
  else if matches.length === 1:
    newPath = matches[0]
    更新 ref 为 newPath
    fixReport.fixed.push({ kind, overlayId?, originalPath: ref, newPath })
  else:
    // 多个同名文件：优先选"路径深度最浅 + 体积差异最小"的候选（若 originalPath 记录过尺寸则对比）
    newPath = pickBestMatch(matches, ref)
    更新 ref 为 newPath
    fixReport.fixed.push(...)
```

**basenameIndex 构建**：
- 从 `projectDir` 开始递归，深度限制 3 层（足以覆盖 `imports/douyin/<id>/` / `covers/` / `ai-cards/` 等）
- 忽略目录：`node_modules`、`.git`、`release`、`dist`、`dist-electron`、`work`
- 忽略文件：以 `.` 开头、大小为 0 的空文件
- `basename → string[]` 映射；冲突时通过 `pickBestMatch` 决策

**向后兼容**：
- 算法不改 `project.json` 结构；只改 `timeline.tracks[*].overlays[*].assetPath` 和 `timeline.podcast.audioPath` 字符串值
- 封面 `CoverCandidate.imageUrl` 本身已由 `project.json` + `covers/` 相对结构维护（由 `materializeTimelineWebCards` / `addRecentProject` 等已有逻辑处理），本期不涉及

## UI 交互

### 入口位置

`Setup.tsx` 的快捷栏在现有三个按钮（导入文稿 / 导入音频 / 抖音导入）**末尾**追加第 4 个：

```
[导入文稿]  [导入音频]  [抖音导入]  [导入项目]
                                  ↑ 新增
```

图标用 `FolderInput`（lucide-react），Label 为「导入项目」。点击打开 `ImportProjectDialog`。

### Dialog 布局（两个阶段）

**阶段 A — 选择目录**（初始态）：
```
┌───────────────────────────────────────────────┐
│ 导入项目                                  [×] │
├───────────────────────────────────────────────┤
│                                               │
│  从其他电脑复制过来的项目？选择项目目录，     │
│  灵机剪影会自动识别并修复素材路径。            │
│                                               │
│  [选择项目目录…]                              │
│                                               │
├───────────────────────────────────────────────┤
│                          [取消]               │
└───────────────────────────────────────────────┘
```

**阶段 B — 识别结果**（扫描完成后）：
```
┌───────────────────────────────────────────────┐
│ 导入项目  —  /Users/.../my-project        [×] │
├───────────────────────────────────────────────┤
│  ● 识别为：完整项目                            │
│    检测到 project.json / 时间线 23 片段 /      │
│    封面候选 4 张                               │
│                                               │
│  ● 素材路径（23 个引用）                       │
│    ✓ 8 个原位可用                              │
│    ↻ 12 个可自动修复（新机器路径）             │
│    ✗ 3 个找不到文件  [查看详情 ▾]              │
│                                               │
│  ● 其他检测到的文件                            │
│    script.md / podcast-audio.mp3 /             │
│    podcast-subtitles.srt / covers (4)          │
│                                               │
│  ☐ 允许缺失素材继续导入                        │
├───────────────────────────────────────────────┤
│              [取消]        [开始导入]         │
└───────────────────────────────────────────────┘
```

**阶段 B — S4 阻断态**：
```
● 目录中未找到 project.json 或核心媒资文件
  建议：若这是一个新项目目录，请使用「新建工程」

              [取消]        [开始导入] (置灰)
```

### 状态与反馈

- **扫描中**：按钮 "正在识别..." + 旋转图标；扫描通常 <500ms（基于 basenameIndex 构建开销）
- **导入中**：接入统一进度系统 `src/store/task-progress.ts` (`startTask('importProject', ...)`)；完成 / 失败触发 toast
- **导入成功**：关闭 Dialog → 按 `resolveProjectLandingPage` 规则跳转（复用现有逻辑）
- **导入失败**：Dialog 内 inline error（不关闭），允许用户修改勾选后重试

### 可访问性

- 阻断 / 警告文案颜色用 `tokens.colorStatusWarning` / `colorStatusDanger`，不单独依赖颜色
- ESC / 点击遮罩 = 取消
- 按钮 Tab 顺序：取消 → 开始导入

## 决策记录（2026-04-21）

本次规划中默认决定（可在实现前推翻）：

1. **S3/S4 处理**：S3 走"骨架创建"接入；S4 阻断并引导「新建工程」
2. **路径策略**：保留绝对路径，修复时重写为新机器的绝对路径（未来再单独做相对路径 RFC）
3. **UX 位置**：欢迎页快捷栏第 4 个入口，与「导入文稿/音频/抖音」并列
4. **缺失素材策略**：默认要求用户显式勾选"允许缺失继续导入"，否则阻断
5. **扫描深度**：递归深度 3 层，足以覆盖 `imports/douyin/<id>/video.mp4` 等典型布局；深度不足时通过 `missing` 汇报

## 测试策略

Vitest（单元 + 集成）：

1. `scanProjectDirectory`：
   - S1：构造含 `project.json` 的临时目录，断言 `scenario === 'complete'`、`detectedFiles` 包含 `projectJson`、`assetReferences` 统计正确
   - S2：构造含 `timeline.json` 的临时目录
   - S3：只含 `podcast-audio.mp3` + `script.md`
   - S4：空目录或只有无关文件
2. `normalizeAssetPaths`：
   - 绝对路径存在 → 不动
   - 绝对路径不存在 + basename 能命中 → 修复
   - basename 匹配多个 → `pickBestMatch` 选路径最浅者
   - basename 找不到 → 进 `missing`
   - 相对路径 resolve 成功 / 失败两种情况
3. `importProject`：
   - 完整流程：scan + import，断言 `project.json` 被写入且 `timeline.tracks[*].overlays[*].assetPath` 已更新
   - `scenario === 'unrecognized'` → 抛错
   - `missingCount > 0 && !acceptMissingAssets` → 抛错
   - 竞态：scan 与 import 之间文件被删，重新 scan 后报错
4. `ImportProjectDialog`：
   - 初始态 → 点击选目录 → 扫描 → 渲染识别面板
   - S4 阻断态下「开始导入」按钮禁用
   - 勾选"允许缺失"后按钮启用
   - 导入成功触发 `onComplete`
5. `Setup.tsx` 快捷栏：新按钮渲染 + 点击打开 Dialog

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `basenameIndex` 对大目录（>5000 文件）扫描慢 | UI 卡顿 | 深度限制 3 层 + 忽略目录白名单；单次扫描 log 耗时，>2s 接入 progress UI |
| `pickBestMatch` 对同名文件选错 | 素材错配 | 仅在同名文件多于 1 时应用；优先最浅路径；UI 可展开看详情（后续增强） |
| 持久化路径修复后，原目录再复制回 A 电脑又失效 | 循环跨机失效 | 文档注明：跨机复制时建议用新目录名 + 重新导入；不做双向同步 |
| `project.json` 合法但结构已损坏（版本不兼容） | 导入失败 | `readProjectJson` 已 try/catch；scan 阶段降级为 S2 或 S4，并在 `blockReason` 中给出 JSON 解析错误 |
| `saveProjectSection` 的 `materializeTimelineWebCards` 在路径修复后重复 materialize | 产生冗余文件 | 现有 materialize 以 srcDoc 存在为条件，修复过程不接触 Web Card，不触发冗余 |
| 用户在 scan 完成到 import 之间外接网盘断开 | import 时文件消失 | import 内部 re-scan；失败抛 `scenario === 'unrecognized'` |

## 里程碑

| 阶段 | 内容 | 时长 |
|---|---|---|
| M1 | 共享类型 + 主进程 `scanProjectDirectory` + `normalizeAssetPaths` 纯函数 + 单测 | 0.5d |
| M2 | 主进程 `importProject` + IPC 注册 + preload / electron-api 桥 | 0.5d |
| M3 | `ImportProjectDialog` UI + 快捷栏入口 + `App.tsx` 接线 | 0.5d |
| M4 | 接入统一进度系统 + UI 打磨 + 端到端手动走查（S1–S4）+ 回归测试 | 0.5d |

**合计预估 2 天**。

## 依赖变更

无新增 npm 依赖。

## 后续可扩展

- 相对路径改造（单独 RFC）
- "修复详情"抽屉展示 basename 匹配候选，允许手动选
- 缺失素材批量"重新定位"：用户选一个目录，系统再次在其中做 basename 搜索
- 导入时从 `original.md` / `podcast-subtitles.srt` 回填 AI 分析初始状态（需解析规则，后续版本）
- 导出"项目迁移包"（打包素材 + 可移植相对路径的 project.json），配合导入实现无缝跨机

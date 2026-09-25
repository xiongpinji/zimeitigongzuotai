# MCP 全流水线接入设计

- 日期：2026-04-28
- 状态：Draft（已通过 brainstorming 五项关键决策）
- 关联：`electron/mcp/`、`electron/acp/`、`src/store/task-progress.ts`、`docs/superpowers/specs/2026-04-08-mcp-server-migration-design.md`

## 目标

把灵机剪影从素材到导出 MP4 的全部能力暴露为 MCP 原子工具，使外部 AI（Claude Code / Codex / Gemini）可以编排执行「一键创作」：

```
create_project → import_video_source → write_script → generate_tts
→ analyze_subtitles → 并行 (covers / cards / storyboard) → generate_motion
→ assemble_timeline → export_video
```

## 设计前提（已与用户对齐的关键决策）

1. **工具粒度 = A**：全原子工具，外部 AI 自己编排顺序、自行处理失败/重试/分支；不暴露高层「一键创作」编排工具。
2. **异步模型 = B**：耗时工具立刻返回 `{ taskId }`，外部 AI 通过 `lingji_get_task_status(taskId)` 轮询。复用现有 `task-progress` store。
3. **项目上下文 = B + create_project**：每个工具显式接受 `projectPath` 入参；新增 `lingji_create_project` 入口。同一时间允许操作非主窗口活动项目（headless）。
4. **执行许可 = A**：完全无许可、无配额、无人工确认；外部 AI 全自主。
5. **配置来源 = C**：默认从 App Settings 继承（Provider / 提示词绑定 / TTS / 导出默认）；入参可选覆盖任意字段；新增 `lingji_get_settings` 让外部 AI 查默认值。

## 架构

### Renderer / Main 切分

| 类别 | 能力 | 处理 |
|---|---|---|
| 天然主进程 | TTS、Remotion 导出、文件 I/O、抖音导入、Provider HTTP 直调 | 现有 IPC 直接接 MCP，不重写 |
| Renderer-resident，需下沉 | LLM 生成（write/review/analyze/covers/cards/motion）、卡片 materialize、时间线编排算法 | 把核心逻辑从 `src/lib/llm/`、`src/lib/ai-analysis.ts`、`src/lib/timeline-*` 抽出共享模块，主进程能直接 import；Renderer 调同一份避免漂移 |
| 必须经 Renderer | 编辑器虚拟光标、AI 写稿/审稿可视化（CodeMirror 流式打字、breathing） | 工具入口检测 `projectPath` 是否为主窗口活动项目：是→走 Renderer 通道（保留视觉反馈）；否→走主进程 headless 通道（无动画，结果直写文件） |

### 新增模块：`electron/pipeline/`

```
electron/pipeline/
  index.ts                 # PipelineService 单例对外
  task-registry.ts         # 任务注册表（进程内 Map）
  context.ts               # resolveProject() / HeadlessProjectContext
  tasks/
    tts.ts
    write-script.ts
    review-script.ts
    analyze-subtitles.ts
    generate-covers.ts
    generate-storyboard.ts
    generate-cards.ts
    generate-motion.ts
    export-video.ts
    import-video-source.ts
  algorithms/
    assemble-timeline.ts   # 同步算法：字幕分析 + 卡片 → 时间线
    project-state.ts       # has_* 推导
```

`electron/mcp/tools.ts` 改为 PipelineService 的薄包装；不再直接调 BrowserWindow IPC，统一走 service。

### `resolveProject(projectPath)`

每个工具入口先解析项目上下文：

- 若 `projectPath` 与主窗口当前活动项目一致 → 复用现有 store/IPC 通道，视觉反馈在线；
- 否则 → 主进程内构造 `HeadlessProjectContext`：
  - 加载 `project.json`（必要时触发已有迁移逻辑）
  - 在内存里持有 timeline / aiAnalysis / script 子状态
  - 写回时走 `electron/project-file.ts` 的写锁，按节合并
  - **不开新窗口**

### 兼容旧项目

调用任意 MCP 工具时若 `project.json` 不存在但有 `timeline.json` / `ai-analysis.json` / `script-state.json`，自动触发 `electron/project-file.ts` 现有迁移；不为 MCP 单写迁移路径。

## MCP 工具清单（22 个）

> 命名保留 `lingji_` 前缀。下表中「Async」列标识返回 `{ taskId }` 的工具。

### 项目层（3）

| 工具 | 同步性 | 入参 | 返回 |
|---|---|---|---|
| `lingji_create_project` | 同步 | `path: string`, `options?: { name?, template?, meta? }` | `{ projectPath }` |
| `lingji_open_project` | 同步 | `path: string` | `{ ok: true }`（可选；headless 流不必调） |
| `lingji_get_project_state` | 同步 | `projectPath` | `{ has_original, has_script, has_audio, has_subtitles, has_analysis, has_covers, has_cards, has_timeline, last_export }` |

`create_project` 落盘骨架：

```
<projectPath>/
  project.json              # version、createdAt、空 timeline/aiAnalysis/script
  original.md               # 空文件
  covers/                   # 空目录
  ai-cards/                 # 空目录
  configs/prompts/          # 空目录
```

不预生成 `script.md`、不写音频/SRT。

`get_project_state` 全部走文件检测，不读 `project.json` 业务字段，避免与过时持久化打架。具体规则：

- `has_original` = `original.md` 存在且非空
- `has_script` = `script.md` 存在且非空
- `has_audio` = `podcast-audio.mp3` 存在
- `has_subtitles` = `podcast-subtitles.srt` 存在
- `has_analysis` = `project.json.aiAnalysis.subtitleAnalysis` 非空
- `has_covers` = `covers/` 下有图片
- `has_cards` = `project.json.aiAnalysis.cards` 非空
- `has_timeline` = `project.json.timeline.tracks` 至少一条非空 overlay
- `last_export` = `<projectPath>/*.mp4` 按 mtime 取最新；无则 `null`

### 素材导入层（2）

| 工具 | 同步性 | 入参 | 备注 |
|---|---|---|---|
| `lingji_import_video_source` | Async | `projectPath`, `url`, `overrides?` | 抖音/YouTube → `original.md` |
| `lingji_import_local_media` | 同步 | `projectPath`, `files: string[]` | 本地音视频/SRT 注册到工程 |

### 脚本层（4）

| 工具 | 同步性 | 入参 | 备注 |
|---|---|---|---|
| `lingji_read_script` | 同步 | `projectPath`, `file: 'original' \| 'script'` | 直接读文件 |
| `lingji_update_script` | 同步 | `projectPath`, `content: string`, `file?` | 直写；活动项目自动同步到 CodeMirror |
| `lingji_write_script` | Async | `projectPath`, `overrides?` | LLM 写稿 |
| `lingji_review_script` | Async | `projectPath`, `overrides?` | 审稿，结果含批注列表 |

### TTS 层（1）

| 工具 | 同步性 | 入参 | 备注 |
|---|---|---|---|
| `lingji_generate_tts` | Async | `projectPath`, `overrides?` | MiniMax 合成 → `podcast-audio.mp3` + `podcast-subtitles.srt` |

### AI 分析与卡片层（5）

| 工具 | 同步性 | 入参 | 备注 |
|---|---|---|---|
| `lingji_analyze_subtitles` | Async | `projectPath`, `overrides?` | 字幕重切、关键词、分段 |
| `lingji_generate_covers` | Async | `projectPath`, `count?`, `overrides?` | 封面候选批量 |
| `lingji_generate_storyboard` | Async | `projectPath`, `overrides?` | 分镜 |
| `lingji_generate_cards` | Async | `projectPath`, `kind: 'image'\|'video'\|'info'`, `overrides?` | 信息卡 / image / video / Motion 占位 |
| `lingji_generate_motion` | Async | `projectPath`, `cardId`, `overrides?` | Motion 代码生成 + autofix |

### 时间线层（2）

| 工具 | 同步性 | 入参 | 备注 |
|---|---|---|---|
| `lingji_assemble_timeline` | 同步 | `projectPath`, `options` | 算法编排：字幕分析 + 卡片 → 轨道（吸附、避撞） |
| `lingji_get_timeline` | 同步 | `projectPath` | 读 `project.json.timeline` |

### 导出层（1）

| 工具 | 同步性 | 入参 | 备注 |
|---|---|---|---|
| `lingji_export_video` | Async | `projectPath`, `exportSettings?` | Remotion 渲染 MP4 |

### 任务与设置层（4）

| 工具 | 同步性 | 入参 | 备注 |
|---|---|---|---|
| `lingji_get_task_status` | 同步 | `taskId` | 完整 PipelineTask 对象 |
| `lingji_cancel_task` | 同步 | `taskId` | 不可取消时返回 `error.code='not_cancelable'` |
| `lingji_list_tasks` | 同步 | `projectPath?` | 在跑 + 24h 内终态 |
| `lingji_get_settings` | 同步 | — | App Settings 默认值（Provider、prompts binding、TTS、export 默认） |

## 任务模型（fire-and-poll 协议）

### 任务对象

```ts
type PipelineTaskKind =
  | 'tts' | 'write_script' | 'review_script' | 'analyze_subtitles'
  | 'generate_covers' | 'generate_storyboard' | 'generate_cards'
  | 'generate_motion' | 'export_video' | 'import_video_source';

type PipelineTask = {
  taskId: string;            // uuid v4
  kind: PipelineTaskKind;
  projectPath: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress: { phase: string; percent: number; message?: string };
  startedAt: number;
  finishedAt?: number;
  result?: unknown;          // 完成后填入；结构按 kind 定义
  error?: { code: string; message: string; retryable: boolean };
  logs?: string[];           // 最近 200 条，环形 buffer
};
```

### 结果结构（按 kind）

- `tts.result = { audioPath, srtPath, durationSec }`
- `write_script.result = { scriptPath, charCount }`
- `review_script.result = { annotations: Annotation[] }`
- `analyze_subtitles.result = { segmentCount, keywordCount }`
- `generate_covers.result = { covers: Array<{ id, path, prompt, score? }> }`
- `generate_storyboard.result = { shots: Storyboard[] }`
- `generate_cards.result = { cards: Array<{ id, kind, payload }> }`
- `generate_motion.result = { cardId, motionCode, durationMs }`
- `export_video.result = { outputPath, sizeBytes, durationMs }`
- `import_video_source.result = { sourceUrl, originalPath }`

### 存储与生命周期

- **进程内 `TaskRegistry`**（`electron/pipeline/task-registry.ts`）：单例 `Map<taskId, PipelineTask>`。
- **持久化**：仅成功/失败/取消的终态任务在 24h 内可查；进程重启后失踪。外部 AI 自行存档。
- **与 Renderer `task-progress` store 的关系**：每个 PipelineTask 同时调 `taskProgressStore.startTask/updateTask/completeTask`，UI 显示统一不变。Renderer 自己发起的任务**不**进 PipelineRegistry，避免双源覆盖。

### 错误与重试

- `error.retryable=true` 时，外部 AI 可用相同入参直接发起新工具调用；**不复用 taskId**，避免状态机复杂度。
- `cancel_task` 仅对运行中且支持取消的 kind 生效：
  - 可取消：TTS、export、LLM 流式生成
  - 不可取消：本地同步算法（`assemble_timeline`、`get_project_state` 等本就同步）
  - 不可取消时返回 `{ error: { code: 'not_cancelable', ... } }`

## 并发与写锁

- 同一项目并发跑 `generate_covers + generate_cards + generate_storyboard` 时，三者只写各自小节字段；`project.json` 保存仍走 `electron/project-file.ts` 的写锁，按节合并。
- 不允许同一项目并发跑同一 kind（例如不允许两个 `tts` 任务同时跑同一项目）；后发任务直接返回 `error.code='task_conflict'`。
- 不同项目并发不受限。

## 典型调用序列

外部 AI 一键创作的最小提示框架：

```
1. lingji_create_project(path, options)
2. lingji_get_settings()                              # 拿默认值
3. lingji_import_video_source(path, url) → poll
4. lingji_write_script(path) → poll
5. (可选) lingji_review_script(path) → poll
6. lingji_generate_tts(path) → poll
7. lingji_analyze_subtitles(path) → poll
8. 并行：
     lingji_generate_covers(path) → poll
     lingji_generate_cards(path, 'info') → poll
     lingji_generate_storyboard(path) → poll
9. 按需：lingji_generate_motion(path, cardId) → poll
10. lingji_assemble_timeline(path, options)            # 同步
11. lingji_export_video(path) → poll
```

每步调完 `lingji_get_project_state` 也可作为容错断点续做的依据。

## 实施工作量分解

> 写实施计划阶段会细拆为 task。这里只列粗块，便于评估总量。

1. **PipelineService 骨架 + TaskRegistry**（M）
2. **`resolveProject` 与 HeadlessProjectContext**（L）
3. **共享模块下沉**：把 `src/lib/llm/`、`src/lib/ai-analysis.ts`、卡片 materialize、时间线编排从 Renderer 抽出（XL，工作量最大）
4. **22 个工具的 PipelineService 实现 + MCP 包装**（L，重复劳动多）
5. **`task-progress` store 与 PipelineRegistry 双向桥**（S）
6. **`lingji_create_project` 落盘骨架 + 兼容旧项目迁移**（S）
7. **`assemble_timeline` 算法**（M，需要规则：按字幕分段 + 卡片类型 → 默认轨道安排）
8. **测试**：每个工具至少 happy path + 一种失败路径；headless 模式与活动项目模式各覆盖一次（M）
9. **更新 ACP 注册时写入用户项目 `CLAUDE.md` 的 MCP 用法说明**（S）

整体规模：相当大。建议在写实施计划时把（3）单独成阶段，先完成共享模块下沉再开工（4）。

## 测试策略

- **单测**：PipelineService 每个 task 模块独立测试（mock Provider HTTP / 文件系统）。
- **集成测**：`tests/mcp-pipeline.test.ts`，覆盖：
  - `create_project` → `get_project_state` 正确反映各阶段
  - 一条最短路径（create → update_script → generate_tts mock → analyze_subtitles mock → assemble_timeline → export mock）
  - 同项目并发同 kind 的冲突行为
  - 取消行为
- **手动验证**：在 Claude Code 中实际跑一遍完整一键创作。

## 风险

- **共享模块下沉**最大风险：Renderer 现有调用路径在迁移过程中可能出现一份新旧混用导致行为漂移；解决方式是迁移完成前 Renderer 暂停切换，迁移完成后一次性切换。
- **headless 模式下的 LLM 流式动画缺失**：约定行为差异，文档里写明；不视为 bug。
- **MCP 调用方等待长任务**：fire-and-poll 已是工业惯例，但外部 AI prompt 必须正确写循环；在工具描述里给出明确示例。
- **并发写 `project.json` 段落合并**：现有写锁基础上还需保证「按节合并」语义，写实施计划时单独验证。

## 不在本次范围

- 高层「一键创作」编排工具（用户已选 A 拒绝）。
- 人工确认 / 配额 / 计费保护（用户已选 A 拒绝）。
- 多窗口并发同一项目（架构允许 headless + 活动并存，但不主动测）。
- MCP 工具的 `patch_timeline`（局部时间线编辑）：先不做，后续按需补。
- 任务持久化到磁盘：仅进程内保留 24h 终态。

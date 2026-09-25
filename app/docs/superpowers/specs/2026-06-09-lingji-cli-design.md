# 灵机 CLI 设计

- 日期：2026-06-09
- 状态：已评审待实施
- 相关前置：`2026-04-08-mcp-server-migration-design.md`、`2026-04-28-mcp-full-pipeline-design.md`、`2026-04-11-unified-task-progress-design.md`

## 1. 背景与目标

`灵机剪影` 当前的生成能力（音频、AI 卡片、封面、导出）主要通过桌面应用 UI 触发。本项目提供一个命令行工具 `lingji`，让用户（以及外部 AI Agent）**无需打开应用界面点按**，即可远程驱动**已启动的应用实例**完成主链路操作。

非目标（本期不做）：

- 不做无界面（headless）运行；CLI 依赖应用已经启动并运行。
- 不替代 UI 的精细编辑（时间线拖拽、批注等）。
- 不新增第二套任务/进度体系。

## 2. 关键决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 通信架构 | **复用现有 MCP HTTP 服务**（`lingji-editor`，默认端口 19820），CLI 作为 MCP 客户端 | 任务生命周期（start→progress→poll→cancel）已由 `PipelineService` 实现并经 MCP 暴露；外部 AI（Claude Code/Codex/Gemini）可同步获得新能力；与 CLAUDE.md 的 Agent/MCP 架构一致 |
| 生成执行位置 | **主进程 headless 执行**（`PipelineService.createTask` 的 run 函数 + `HeadlessProjectContext` 读写 `project.json`），完成后向渲染进程发「重载 project 节」信号 | `PipelineService`/`HeadlessProjectContext` 本就为 headless 设计；生成编排（`useAIVideoWorkflow.ts` 等）耦合在 1300 行 React Hook 与 UI 组件里，属高风险文件，不在 CLI 链路里重构；headless 复用 `ai-analysis.ts`/`llm/`/图片 Provider 客户端/TTS runner/Remotion 渲染等可在 Node 侧导入的底层；CLI 不依赖应用是否已在 UI 打开该项目 |
| 项目定位 | 默认作用于应用**当前活动项目**，`--project <path>` 可覆盖 | 贴合「快速操作界面」初衷，同时保留显式可控性 |
| 耗时任务体验 | **fire-and-poll**：start 类命令返回 `taskId`；`--wait` 时 CLI 轮询并显示进度直到终态 | 脚本友好；底层统一走任务轮询 |
| CLI 打包 | **仓库内 TS 子包**（`cli/`），构建为 `lingji` 可执行 bin | 单仓库、单发布、与 `src/types` 不漂移 |
| 封面命令 | 拆分 `cover prompt` / `cover image`，并保留合并 `cover gen` | 用户需要分步与一步两种用法 |
| 实施范围 | 本期一次性做齐全部模块（不分期） | 用户明确要求 |

## 3. 架构与数据流

```
lingji CLI ──HTTP(JSON-RPC over MCP)──> 127.0.0.1:<port>/mcp ──> main 进程 MCP 工具
  ├─ start 类工具（全部 headless，在 main 执行）:
  │    1) PipelineService.createTask(kind, projectPath, run) → 立即得 { taskId } 并返回
  │    2) run 在 main 后台执行: HeadlessProjectContext.loadProjectData() 读 project.json
  │       → 复用底层库生成（ai-analysis / llm / 图片 Provider / TTS runner / Remotion）
  │       → handle.update(progress) 回写进度；saveSection 写回 project.json
  │    3) 终态后经 task-progress-bridge 通知；并向渲染进程发「project 节已更新」信号
  ├─ 即时类工具（卡片读取/字段修改/删除）: main 直接读写 project.json，不建 task
  └─ 查询类工具: get_task_status / list_tasks / cancel_task / get_project_state（已存在）

CLI 默认 fire 后返回 taskId；带 --wait 时轮询 get_task_status 至终态并渲染进度条。
```

- 进度桥接：复用 `electron/pipeline/task-progress-bridge.ts` 与统一任务进度体系（`src/store/task-progress.ts`）。headless run 通过 `handle.update`/`handle.log` 回写，无需渲染进程进度回报通道。
- **UI 刷新信号**：headless 任务写回 `project.json` 后，main 向渲染进程发送 `pipeline:project-updated`（含 projectPath 与变更的节）；若该项目正是应用当前打开的项目，渲染进程重载对应节（aiAnalysis/timeline）使界面同步。
- 因 headless 工具在 main 执行，**新增 start/即时类工具不需要 preload/renderer/electron-api 三件套**，只在 `electron/` 与 MCP 注册层落地；仅「UI 刷新信号」与「project open/switch 驱动 UI」需要触达渲染进程。

## 4. 需要新增/改动的服务端能力

### 4.1 新增 MCP 工具（main 侧，返回 `taskId`）

- `lingji_generate_audio`（kind `tts`）
- `lingji_analyze_subtitles`（kind `analyze_subtitles`，卡片前置）
- `lingji_generate_cards`（kind `generate_cards`）
- `lingji_generate_cover_prompts`（kind `generate_covers` 的提示词阶段）
- `lingji_generate_cover_images`（kind `generate_covers` 的出图阶段）
- `lingji_generate_covers`（合并：先提示词后出图）
- `lingji_export_video`（kind `export_video`）

复用既有工具：`lingji_open_project`、`lingji_get_project_state`、`lingji_get_settings`、`lingji_get_task_status`、`lingji_list_tasks`、`lingji_cancel_task`、`lingji_list_project_files`。

「切换活动项目」：复用/扩展 `lingji_open_project` 语义，使其将目标项目设为应用当前活动项目（若已支持则仅文档化；若仅校验则补设为活动项目的能力）。

### 4.2 参数策略（YAGNI）

- start 类工具默认使用**项目已配置的设置与默认值**（TTS 音色、封面/卡片 Provider、导出格式等）。
- 仅暴露少量高频可选覆盖：`export_video` 的输出路径 `out`。其余覆盖项后续按需扩展。

### 4.3 任务约束

- 各 kind 的并发冲突沿用 `PipelineService` 的 `TASK_CONFLICT` 语义。
- 可取消性沿用 `CANCELABLE_KINDS`。

### 4.4 AI 卡片操作工具

复用现有渲染进程 store 动作（`src/store/ai.ts`）与 main 侧 IPC，经 MCP 暴露。卡片操作分**即时**与**任务型**两类：

| 能力 | 复用动作 | 新增 MCP 工具 | 类型 | 返回 |
| --- | --- | --- | --- | --- |
| 列出卡片 | `analysisResult.cards`（或复用 `lingji_get_project_state`） | `lingji_list_cards` | 即时 | 卡片摘要数组 |
| 查看单卡 | 同上按 id 过滤 | `lingji_get_card` | 即时 | 单卡完整对象 |
| 修改字段 | `updateCard(cardId, updates)` | `lingji_update_card` | 即时 | 更新后卡片 |
| 删除卡片 | `deleteCard(cardId)`（含 `deleteCardMediaAssets`） | `lingji_delete_card` | 即时 | `{ ok: true }` |
| 重生整卡 | `regenerateAICard` | `lingji_regenerate_card` | 任务 | `taskId` |
| 重生媒体 | `regenerateCardMedia(cardId, overrides)` | `lingji_regenerate_card_media` | 任务 | `taskId` |
| 类型转换 | `convertCardToMedia('image'\|'video')` / `convertCardToMotion()` | `lingji_convert_card`（参数 `to: image\|video\|motion`） | 任务 | `taskId` |
| Motion 卡自然语言修改 | `motion.modify` 流程（实施期核实是否已有 store 动作；无则在本期补一个最小 modify 动作或降级为不支持并文档化） | `lingji_modify_motion_card` | 任务 | `taskId` |

`update_card` 可改字段（白名单，避免越权改结构）：`title`、`enabled`、`displayMode`、`startMs`/`endMs`/`displayDurationMs`、`template`、`stylePresetId`、`cardPrompt`、`style`（部分）。

**约束（重要）**：卡片操作同样走 **headless 主进程**，读写 `project.json` 的 `aiAnalysis.analysisResult.cards`，不依赖渲染进程实时 store。因此：

- 即时类（list/show/update/delete）直接读写 `project.json`；任务类（regenerate/regen-media/convert/modify）走 `PipelineService` 并复用 `ai-analysis.ts` / 图片 Provider / Motion 源生成等底层库。
- 完成后发送 `pipeline:project-updated` 信号；若该项目正在应用中打开，UI 重载 aiAnalysis 节同步显示。
- 卡片重生成/转换依赖卡片合并逻辑（如 `mergeMotionConversionResult` 等共享库），实施时复用其纯函数部分，避免依赖渲染进程 store 动作。

## 5. CLI 命令面

```
lingji project open <path>        # 打开/设为活动项目
lingji project switch <path>      # 切换活动项目（语义同 open）
lingji project current            # 显示当前活动项目
lingji project list               # 最近项目列表

lingji audio gen                  # 生成 podcast 音频 + SRT
lingji subtitle analyze           # 字幕分析（卡片前置）

# ── AI 卡片 ──
lingji cards gen                  # 批量生成 AI 卡片（任务）
lingji cards list                 # 列出当前卡片摘要（即时；支持 --json）
lingji cards show <cardId>        # 查看单卡完整信息（即时）
lingji cards update <cardId> [字段开关]   # 修改卡片字段（即时）
lingji cards regenerate <cardId>  # 重新生成整卡（任务）
lingji cards regen-media <cardId> # 仅重新生成图/视频媒体（任务）
lingji cards convert <cardId> --to <image|video|motion>   # 类型转换（任务）
lingji cards modify <cardId> --instruction "<自然语言>"    # Motion 卡自然语言修改（任务，若支持）
lingji cards delete <cardId>      # 删除卡片（即时）

# ── 封面 ──
lingji cover prompt               # 仅生成封面提示词
lingji cover image                # 仅由提示词出封面图
lingji cover gen                  # 提示词 + 出图一次完成
lingji export [--out <file>]      # 导出 H.264 MP4

lingji task status <id>           # 查询任务状态
lingji task wait <id>             # 阻塞等待任务到终态（带进度）
lingji task list                  # 列出任务（可 --project 过滤）
lingji task cancel <id>           # 取消任务
```

`cards update` 字段开关（对应白名单）：`--title`、`--enabled <true|false>`、`--display-mode <fullscreen|pip>`、`--start <ms>`、`--end <ms>`、`--duration <ms>`、`--template <id>`、`--style-preset <id>`、`--card-prompt <text>`。

全局开关：

- `--project <path>`：覆盖活动项目（默认当前活动项目）。卡片类命令若与活动项目不一致会先切换并等待加载。
- `--wait`：start 类命令阻塞等待并显示进度（否则 fire-and-poll 返回 taskId）。
- `--detach`：显式仅返回 taskId（与默认一致，提供给脚本语义清晰）。
- `--json`：机器可读 JSON 输出。
- `--server <url>`：覆盖 MCP 服务地址。

## 6. 端口发现

- 应用启动 MCP 服务时写入 `~/.lingji/mcp-endpoint.json`：`{ port, pid, startedAt, url }`；服务停止时清理或标记。
- CLI 解析顺序：`--server` > `LINGJI_MCP_URL` 环境变量 > `~/.lingji/mcp-endpoint.json` > 默认 `http://localhost:19820/mcp`。
- 需在 `electron/mcp/server.ts` 启停处增加写/清理逻辑。

## 7. 错误处理

- 应用未运行 / 端口不可达：明确提示「未发现运行中的灵机剪影，请先启动应用」，退出码非 0。
- 无活动项目且未传 `--project`：报错并提示用 `lingji project open`。
- 任务失败：透传 `PipelineService` 的 `code` / `message`（`task_conflict`、`not_cancelable`、`invalid_project` 等），`--json` 下结构化输出。
- 超时：start 调用本身快速返回；`--wait` 轮询设上限并提示可改用 `lingji task status` 继续观察。

## 8. 测试

Vitest 覆盖（与现有测试风格一致）：

- 新 MCP/pipeline 工具注册：仿 `tests/pipeline-mcp-registration.test.ts`、`tests/mcp-tools.test.ts`，校验每个新工具被注册且入参 schema 正确。
- 端口发现解析优先级：单测 `--server` / 环境变量 / endpoint 文件 / 默认 的回退链。
- CLI 参数解析：子命令、全局开关、`--project` 覆盖、`--json` 输出形状。
- MCP 客户端交互：mock MCP server，验证 start→返回 taskId、`task wait` 轮询至终态、错误透传。
- 进度桥接：渲染进程进度按 taskId 回写到 pipeline task 的单测（若改动 `task-progress-bridge`）。

构建/类型：完成后跑 `npm test` 与（涉及 main/preload/electron-api 三件套改动时）`npm run build`。

## 9. 影响面与同步点

因生成与卡片工具走 headless 主进程，大部分新增不涉及「IPC 三件套」（preload/electron-api/renderer）。涉及点：

- `electron/pipeline/tools/*` 与/或 `electron/mcp/tools.ts`：注册新 headless MCP 工具（生成 + 卡片）。
- `electron/pipeline/`：新增各 kind 的 headless run 函数；复用 `ai-analysis.ts`/`llm/`/图片 Provider 客户端/TTS runner/Remotion 渲染等底层库。
- main 侧 settings/密钥装配：headless 生成需读取完整 `AISettings`（含密钥，经 `safeStorage`）与 `projectBindings`。
- `electron/pipeline/types.ts`：task kinds 已含所需 kind，预计无需改动（复核）。
- `electron/mcp/server.ts`：endpoint 文件写/清理。
- **UI 刷新信号**：main → 渲染进程 `pipeline:project-updated`（preload + renderer 监听 + 重载逻辑）——这是唯一需要触达渲染进程的常规链路；`project open/switch` 若要驱动 UI 打开项目，也需复用 `src/App.tsx` 既有 `openProject` 流程。
- 新增 `cli/`：CLI 子包、bin、MCP 客户端、参数解析。
- `package.json`：`bin` 字段与构建脚本接入。

高风险项（评审中已确认）：修改 MCP 工具、导出入口、Remotion 输入结构属高风险改动清单内，实施时逐项做影响面分析。**不在 CLI 链路中重构 `useAIVideoWorkflow.ts` 等 AI Hook。**

## 9.1 实施分解（多个独立可交付子计划，线性依赖）

按 writing-plans 约定，本 spec 拆为多个各自可独立交付/测试的子计划（范围仍涵盖全部模块）：

- **Plan 1 — CLI 基座 + 项目/任务命令**：端口发现文件、CLI 包骨架（MCP 客户端 + 参数解析 + 输出）、`project current/list/open`、`task status/wait/list/cancel`（复用**现有** MCP 工具）。
- **Plan 2 — Headless 生成框架 + 音频(TTS)**：main 侧 settings/密钥装配、`registerGenerationTool` 框架、`lingji_generate_audio`、UI 刷新信号、CLI `audio gen`。
- **Plan 3 — 其余生成模块**：字幕分析、卡片批量、封面（prompt/image/gen）、导出。
- **Plan 4 — 卡片操作**：headless `cards list/show/update/delete/regenerate/convert/modify` + CLI `cards *`。

## 10. 验收标准

应用运行且打开某项目时，在终端依次执行可完成：

1. `lingji project current` 显示当前项目。
2. `lingji audio gen --wait` 生成音频与 SRT。
3. `lingji subtitle analyze --wait` → `lingji cards gen --wait` 产出卡片。
4. `lingji cover gen --wait`（或 `cover prompt` 后 `cover image`）产出封面。
5. `lingji export --out out.mp4 --wait` 导出 MP4。
6. 任一 start 命令不带 `--wait` 时返回 taskId，`lingji task wait <id>` 可续接观察至终态。
7. 应用未启动时执行任意命令给出明确「请先启动应用」提示。
8. 卡片闭环：`lingji cards list` 查看 → `cards show <id>` 看详情 → `cards update <id> --enabled false` 即时改 → `cards regenerate <id> --wait` 重生 → `cards convert <id> --to motion --wait` 转 Motion → `cards delete <id>` 删除，状态在应用 UI 同步可见。

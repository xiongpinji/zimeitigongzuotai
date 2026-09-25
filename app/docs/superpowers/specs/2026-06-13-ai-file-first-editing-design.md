# AI File-First 编辑 + 实时热重载 设计方案

- 日期：2026-06-13
- 分支：feat/lingji-cli
- 状态：已评审，待实现

## 1. 背景与目标

灵机剪影目前让外部 AI 操作编辑器的唯一通道是 `lingji-editor` MCP server（20 个 `lingji_*` 工具），项目级 `CLAUDE.md` 明确**禁止外部 AI 直接 Read/Write 文件**，以保证 Zustand store 是唯一数据源。

本功能改变这一约束：让外部 AI（Claude Code / Codex / Gemini 等任意能读写文件的 CLI agent）**直接编辑项目文件**来修改视频与文稿，编辑器侧提供一个**带会话锁的实时热重载钩子**，把外部改动安全地灌回 store 并刷新预览。

最终形成闭环：**AI 改文件 → 编辑器实时反映**。

### 核心决策（已与用户确认）

1. 视频与文稿两个 skill **都走 file-first**（直接改文件，不强制走 MCP 工具）。
2. 协调机制 = **文件信号会话锁**（agent 无关，带 TTL/心跳防止忘记解锁）。
3. 目标 = **所有外部 CLI agent**；核心交付物是一份通用**文件契约文档**，同步进 `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`。
4. 视频 skill = **纯编辑**，不触发重生成 / 重导出 / TTS / AI 画图。
5. **Motion Card 源码外置**为独立 `.tsx` 文件，`project.json` 改存引用，软件适配读取，老项目自动迁移。
6. 校验结果通过 `.lingji/edit-result.json` 回传，**默认不要求 AI 调用 MCP 工具**。

## 2. 架构总览

```
外部 AI（Claude / Codex / Gemini）
  │ 1. 读契约（CLAUDE.md/AGENTS.md/GEMINI.md + docs/ai-contract/ + skill）
  │ 2. 写 .lingji/edit-lock.json（声明开始编辑 + scope）
  │ 3. 直接编辑 project.json / script.md / ai-cards/<id>/motionCard.tsx
  │ 4. 删除 edit-lock.json
  │ 5. 读 .lingji/edit-result.json 确认成功/拿报错
  ▼
编辑器（Electron）
  - chokidar 监听 .json/.md/motionCard.tsx/.lingji/edit-lock.json
  - 锁态：暂停自动保存、目标区只读、状态栏显示"AI 正在编辑"
  - 校验外部改动（JSON schema + validateCardTsx + esbuild）
  - 校验通过 → 合并进 store → @remotion/player 自动刷新预览
  - 校验失败 → 保留上一份内存态 → 写 edit-result.json 报错
  - 锁释放（删除或 TTL 超时）→ 恢复可编辑
```

### 两个 Skill 的边界（落在文件域上）

| Skill | 管的文件 | 能改 | 不能干 |
|---|---|---|---|
| `lingji-video-edit` | `project.json` 的 `timeline` 段、`ai-cards/<id>/motionCard.tsx` | overlay 时间/位置/进出场动画、文字&字幕样式、Motion Card 源码、enable/displayMode/卡片样式 | 重生成卡片图/封面、重跑 TTS、重导出 MP4、改脚本 |
| `lingji-script-edit` | `original.md`、`script.md` | 文稿内容、改写、扩写、结构调整 | 碰 timeline/overlay/卡片、触发 AI 写稿管线 |

## 3. 三层交付物

1. **文件契约文档（核心）** `docs/ai-contract/`：项目目录结构、`project.json` 各字段语义与合法取值（动画枚举、时间单位 ms、坐标范围）、`motionCard.tsx` 硬约束、会话锁协议、校验反馈协议。Agent 无关。
2. **两个 skill（Claude 格式 `.claude/skills/`）**：薄入口，描述边界 + 指向契约对应章节 + 典型操作示例。
3. **契约同步**：把契约要点写进项目根 `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`，复用并扩展 `electron/acp/ipc.ts` 的 `ensureProjectClaudeMd`。

## 4. Motion Card 外置改造

**现状**：`project.json → timeline.overlays[].aiCardData.motionCard.tsx` 内嵌 TSX 源码字符串。

**改造后**：
- 源码落地 `ai-cards/<cardId>/motionCard.tsx`，AI 直接编辑该文件。
- `project.json` 的 `motionCard` 改存引用 + 元数据：`{ tsxPath, compiledAt, compileError, prompt, retryCount }`，不再存 `tsx` 全文。
- 软件适配：加载项目按 `tsxPath` 读源码；编译（`electron/remotion/compile-card-node.ts`）、导出 materialize、预览 `CardHost` 均从外置文件取源码（预览与导出仍是同一编译产物）。
- 迁移：老项目内嵌 `tsx` 首次加载时写出到 `ai-cards/<id>/motionCard.tsx`，project.json 改为引用。旧 `motionCard.html`（HyperFrames）维持现有降级逻辑不变。
- watch 钩子监听 `ai-cards/**/motionCard.tsx`，单卡改动只重编译那一张并刷新预览。

> 高风险：本项属于"改 project.json 结构 + 迁移逻辑 + Remotion 输入结构"，迁移需覆盖新建/老工程/并发保存测试。

## 5. 文件信号会话锁（agent 无关）

- AI 开始改前创建 `.lingji/edit-lock.json`：`{ owner, scope: "video"|"script", startedAt, heartbeat, ttlMs }`。
- 编辑器 watch 到锁文件 → "AI 编辑中"态：暂停 300ms 自动保存、目标区只读、状态栏/统一任务进度显示"AI 正在编辑（已锁定）"。
- AI 改完删除锁文件；若忘删，编辑器按 `ttl + heartbeat` 超时自动释放（默认 30s 无心跳即释放）。
- 锁释放后把外部改动整段 reload 进 store、恢复可编辑。

> 统一进度：锁态接入 `src/store/task-progress.ts`，不新增独立弹窗（遵守 PROGRESS-SPEC）。

## 6. 热重载钩子

复用现有 chokidar（`electron/main.ts`）+ `file-changed` IPC，补全 Renderer 侧处理：
- `project.json` 变更 → 重新 `loadProjectFile()` → diff 合并进 timeline / ai store → 预览自动刷新。**这条路当前未接通，是核心补全项。**
- `ai-cards/<id>/motionCard.tsx` 变更 → 只重编译该卡 → 更新 `compiledCards` → 刷新预览。
- `script.md` / `original.md` 变更 → 灌回脚本工作台；`script.md` 外部写入后**补建版本历史**。
- 外部 file-first 走真实 reload，不补播流式光标动画（那套留给 App 内置 agent）。

## 7. 校验与错误回传（agent 无关）

- 应用前校验：`project.json` 必须合法 JSON + schema 基本约束（时间为正、动画枚举合法、坐标范围）；`motionCard.tsx` 走现有 `validateCardTsx` + esbuild。
- 校验失败不崩：卡片已有错误边界；`project.json` 失败则保留上一份内存态，不应用脏数据。
- 结果写 `.lingji/edit-result.json`（`{ ok, errors: [...] }`）。契约告诉 AI 改完读此文件确认；对 Codex/Gemini 通用。

## 8. 改动清单（按层）

**数据/持久化**
- `src/types/motion.ts`：`MotionCardPayload` 去 `tsx` 全文，加 `tsxPath`。
- `src/lib/project-persistence.ts` + `electron/project-file.ts`：按 `tsxPath` 读源码；内嵌→外置迁移；保存回写。
- `electron/ai-card-assets.ts`：管理 `ai-cards/<id>/motionCard.tsx` 读写。

**编译/渲染**
- `electron/remotion/compile-card-node.ts`、导出 materialize（`electron/main.ts` render-video）、`src/remotion/card-host`：源码取自外置文件。

**锁 + 热重载 + 校验（新模块）**
- 新 `electron/ai-edit/`：锁文件监听、TTL 释放、校验、`edit-result.json` 回写。
- `electron/main.ts`：chokidar 扩展监听 `ai-cards/**/motionCard.tsx` 与 `.lingji/edit-lock.json`。
- Renderer 新 `src/lib/external-edit-sync.ts` + store 接入：`file-changed` → reload/merge → 刷新；锁态驱动只读 + 任务进度。
- `src/store/timeline.ts` / `src/store/ai.ts` / `src/store/script.ts`：暴露"外部合并"入口，锁期间停自动保存。

**契约 + skill + 同步**
- `docs/ai-contract/`：契约文档。
- `.claude/skills/lingji-video-edit/`、`.claude/skills/lingji-script-edit/`：两个薄入口 skill。
- `electron/acp/ipc.ts`：`ensureProjectClaudeMd` 扩展为同步 `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`。

> IPC 改动遵守三件套（`electron/main.ts` + `electron/preload.ts` + `src/lib/electron-api.ts` + 测试）同步。

## 9. 验证策略

- 纯函数/迁移：`npx vitest run` 覆盖"内嵌→外置"迁移、新老 project.json 加载、锁 TTL、校验拒绝脏数据。
- 热重载链路：外部改 project.json/tsx → store 合并 → 不丢用户态。
- 导出链路：相关测试 + 必要时 `npm run build`，确认外置 tsx 编译/导出与预览一致。
- 持久化：新工程、老工程迁移、并发保存 + 锁期间不互相覆盖。

## 10. 明确不做（out of scope）

- 不触发重生成/重导出/TTS/AI 画图（划到 skill 之外，文档指向现有 MCP/pipeline 工具或 App 内操作）。
- 不新接 Codex/Gemini 的 ACP 二进制连接（靠文件契约通用，不绑 agent）。
- 不改 script.md 的流式光标动画体系（外部 file-first 走真实 reload，不补播动画）。

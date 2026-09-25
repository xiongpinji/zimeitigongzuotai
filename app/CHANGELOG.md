# Changelog

本项目所有显著变更将记录在此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.3.1] - 2026-06-27

本版本完善火山引擎方舟（Volcengine Ark）LLM Provider，并围绕「发布」与「声呐采风」两条链路做了大量增强与修复：发布侧把 Chromium / biliup 改为运行时按需下载（安装包瘦身），新增发布历史、失败账号就地重登、多比例封面与 B 站分区推荐；声呐侧把采风工作流重做为「爆款拆解」创作流水线，并修复音视频分离提音、主页采集去重等问题；打包侧修复 macOS Intel 架构不兼容警告。

### Added
- **火山引擎方舟（Volcengine Ark）独立 LLM Provider**：AI 设置新增 `volcengine_ark` Provider 类型，内置默认端点 `https://ark.cn-beijing.volces.com/api/v3`，支持深度思考模式（`thinkingMode`）、思考力度（`reasoningEffort`）、在线推理模式（`serviceTier`）三个火山特有参数，并沿用「流水线步骤强制关思考」的调用约定（`src/lib/llm/model.ts`、`src/types/ai.ts`）。同时新增 `openai_responses` Provider 类型（走 OpenAI `/v1/responses` 协议）。
- **Provider 默认模型**：每个 LLM Provider 可单独设置默认模型（`defaultModel`），切换默认 Provider 时自动回填全局默认模型。
- **出卡前生成逐拍动画指导**：Motion 卡片在生成前可由 AI 先产出一份「逐拍动画脚本」（`cards.animation` 提示词）指导出卡节奏与形变；卡片 Inspector 新增手动生成 / 编辑动画指导入口，可在 AI 设置中开关自动生成（`autoAnimationDirection`）。
- **发布：Chromium 运行时按需下载**：抖音 / 视频号 / 小红书 / 快手所需的自动化浏览器组件不再随安装包内置，改为在「发布账号」首次选中相关平台时按需下载到用户目录（`<userData>/publish/chromium`），下载进度接入底部统一任务进度；组件缺失时禁用登录并引导先下载（`electron/publish/chromium-install.ts`）。
- **发布：B 站投稿分区选择 + AI 智能推荐**：发布工作台内置 B 站全量投稿分区清单，可手动选择分区，并支持根据标题 / 描述由 AI 推荐最贴合的分区 tid（`publish.partition` 提示词，返回值经服务端二次校验）。
- **发布：多比例封面与发布元数据**：发布共享数据支持按 16:9 / 4:3 / 3:4 提供多张封面，各平台按需取用；新增按平台生成发布标题 / 简介 / 标签的元数据能力（`src/lib/publish-metadata.ts`）。
- **发布：发布历史 + 失败账号就地重登**：发布工作台记录每次发布任务的历史（含各账号最终结果与重发字段，最多保留 20 条）；发布过程中检测到某账号登录态失效会弹窗确认并就地重新登录后继续（`src/components/publish/PublishWorkbench.tsx`）。
- **发布：无头登录开关**：发布登录默认使用应用内二维码的无头模式；可在发布设置中关闭改用弹出浏览器窗口扫码（兜底被反爬拦截场景），设置持久化于 `userData/publish/settings.json`。
- **声呐采风：创作流水线工作流**：「工作流」重做为创作流水线工作台——每条拉入的视频自动「准备素材（抓无水印源 + 转录）→ 爆款拆解」并停在「待确认」，拆解报告含选题角度、开头钩子、内容结构、亮点、数据点与二创建议，确认后一键送进灵机剪影待创作箱（`extensions/sonar/src/background/workflow-runner.ts`、`extensions/sonar/src/processing/insight-provider.ts`）。
- **耗时任务完成系统通知**：导出 / TTS / 导入 / AI 分析 / 封面 / 卡片等顶层耗时任务（≥1.5 秒）完成或失败时弹出系统通知，点击聚焦主窗口（`src/lib/task-notification-bridge.ts`）。

### Changed
- **打包不再随包内置 Chromium 与 biliup 二进制**：macOS / Windows 打包流程移除随包安装 Playwright Chromium 与下载 biliup 的步骤，二者改为运行时按需下载到用户目录，签名安装包体积减小（`scripts/package-mac.cjs`、`scripts/package-windows.cjs`）。
- **B 站登录改造**：适配 biliup 1.x 交互式 TUI 登录，通过伪终端（node-pty）驱动菜单选「扫码登录」并轮询二维码回传 UI（`electron/publish/platforms/bilibili.ts`）。
- **Remotion 导出产物改为构建期预打包**：新增 `npm run bundle:remotion`，构建期把 Remotion 合成工程预打包到 `dist-remotion/`，打包态运行时复用静态产物并注入素材，规避 asar 内无法 bundle 的问题（`scripts/bundle-remotion.cjs`）。
- **声呐采风：抖音主页采集与去重**：同一 secUid 的 Creator 在 DOM 采集与 API 两条捕获路径间收敛为单一记录，作品统一重挂，避免重复 Creator 导致主页采不到视频（`extensions/sonar/src/background/ingest.ts`）；视频库列表改用虚拟化渲染并配套批量查询接口，提升大量数据下的性能（`extensions/sonar/src/workbench/Library.tsx`）。

### Fixed
- **声呐采风：音视频分离作品提音失败**：抖音对部分作品采用音视频分离（DASH）下发，纯视频流提音得到空音轨；现优先以 `video_id` 现取「音视频合一」的 snssdk 播放流作为提音源（`extensions/sonar/src/adapter/source-extractor.ts`）。
- **声呐采风：ffmpeg.wasm 崩溃毒化整批转码**：wasm 运行时崩溃会永久毒化 ffmpeg 实例致后续候选源连环失败；现检测到崩溃即丢弃并重建干净实例（`extensions/sonar/src/offscreen/ffmpeg-runner.ts`）。
- **视频号「未找到上传框」**：视频号 session 被服务端吊销（即使本地 cookie 未到期）后会被重定向到扫码登录页；现据 DOM 特征识别登录态失效并给出提示，同时逐 frame 查找上传框以覆盖主框架与子 iframe 两种渲染形态（`electron/publish/platforms/tencent.ts`）。
- **macOS「Intel 组件不兼容」警告**：ffprobe 二进制由仅含 x86_64 的 `ffprobe-static` 换为按平台架构发布原生二进制的 `@ffprobe-installer/ffprobe`，并在打包时剔除非目标架构原生产物，单架构 .app 不再混入 Intel 二进制（`scripts/package-mac-helpers.cjs`）。

### Removed
- **随包内置的发布运行时二进制**：移除打包阶段随包内置的 Playwright Chromium 与 biliup 二进制（含 `scripts/fetch-biliup.cjs`），改由运行时按需下载（见 Changed）。

## [1.3.0] - 2026-06-22

本版本把 AI 对话 agent 收敛为内置、开箱即用的 **Pi**，底层重构为多协议 runtime，并打通「AI 改文件 → 编辑器实时热重载」的 file-first 闭环；同时新增发布视频选项卡的多画幅封面工作台与待创作箱清空等创作链路改进，并修复工作区标签页互切偶发空白。

### Changed
- **对话面板收敛为唯一「内置 Pi」agent（移除 Codex / Claude 面板路径）**：在本轮多协议 runtime（Claude / Codex / Pi）基础上进一步收敛——AI 对话面板现在只保留 **Pi** 一个 agent，并将其**内置打包**，用户无需自行安装。本条目取代下面「多协议 Runtime」「内置 Pi agent（ACP 接入）」等中间态描述。
  - **内置打包、开箱即用**：固定版本 `@earendil-works/pi-coding-agent` 经 `scripts/vendor-pi.cjs` 安装到 `resources/pi/`（打包时 asar unpack），用 Electron 自带 Node（`ELECTRON_RUN_AS_NODE`）运行其 `dist/cli.js --mode rpc`；不再要求用户本机安装 `pi`，也不再走 `npx -y pi-acp` 适配器。
  - **复用 App LLM Provider 配置**：连接时把 `AISettings.llmProviders` 投影成 pi 的 `models.json`（`provider/api/baseUrl/apiKey/models` + 每模型能力默认值），写入 App 托管的 pi 配置目录（`~/.lingji/pi-agent`，经 `PI_CODING_AGENT_DIR`）。用户在 App AI 设置里配好 provider 即可用 agent，无需另填凭证。
  - **Pi 走 file-first（无 MCP）**：pi 没有 MCP 能力，直接编辑项目 `script.md` / `original.md` / `project.json` / `ai-cards/<id>/motionCard.tsx`，编辑器热重载反映改动（沿用已有 file-first 契约 `CLAUDE.md`/`AGENTS.md`）。移除了原仅服务 in-app Claude 的 MCP 工具引导逻辑；`lingji-editor` MCP server 仍保留给外部 agent。
  - **移除**：Codex 与 Claude 的面板 agent、其 stream parser、旧 ACP 面板 `connection-registry` 与 `agent-profiles`；设置页 Agent/MCP 配置同步收敛为 Pi。默认 agent 改为 `pi`（旧 `claude`/`codex`/`*-acp` 配置归一化到 pi，不丢用户数据）。`HeadlessAcpProvider`（Claude Code 作为编辑器 AI 的 LLM Provider，即 `claude_code_acp`）保持不变。
- **AI 对话界面重做（对齐 open-design）**：
  - 移除左侧会话列表，改为顶部 icon 弹 **ConversationDropdown**（搜索 / 切换 / 新建 / 重命名 / 删除会话）。
  - Agent 切换收敛到设置中心，**全局只激活一个 agent**（`activeAgentId`）；对话顶部仅只读标记当前 agent，点击直达设置的 Agent 配置页。
  - 新增 **ModelPicker** 模型选择芯片：手动切换当前 agent 使用的模型（或用默认），所选模型经发送链路透传到 runtime（`sendPrompt` → `buildArgs(ctx.model)`）；设置中心模型配置由文本输入改为下拉。
  - 工具调用渲染重做为 op-card 风格（状态徽章 + 折叠 input/output），连续同名工具调用聚合为可折叠 **tool-group**（"Edit ×3"）。
  - 移除对话工具栏顶部多余的 "Claude Code" 标题与 MCP 服务运行状态展示。
  - 对话侧边栏纳入独立错误边界：渲染异常只关闭面板而非整窗黑屏。
- **Agent 底层重构为多协议 Runtime（Claude / Codex / Pi）**：参考 open-design 的声明式 agent 架构，把原 ACP-only 的 agent 连接层重写为多协议 runtime（`electron/agent-runtime/`）。新增/切换 agent 只需一个声明式 `RuntimeAgentDef` 文件 + 注册一行。
  - **声明式注册表 + 协议多态**：`RuntimeAgentDef` 注册表（claude/codex/pi）+ 按 `streamFormat` 分发的解析器（`claude-stream-json` / `codex-json-event` / `pi-rpc`）+ 公用 JSON 行/部分聚合切分器，三种协议归一化成统一 `AgentStreamEvent` 事件流，映射到现有会话事件管线与 SQLite 持久化（保留 Zustand + SQLite，不换状态底座）。
  - **可替换底层**：`AgentSession`（spawn + 接 parser + 生命周期/resume）+ `RuntimeRegistry`（多会话 + 归一化转发）取代旧 ACP `connection-registry`/`session`/`client`；IPC 通道契约不变。agent id 从 `claude-acp`/`pi-acp` 迁移为 `claude`/`codex`/`pi`（带旧配置兼容迁移，不丢用户数据）。preflight 改为按 def 探测 CLI 是否在 PATH。
- **AI 对话界面全面重构（对齐 open-design）**：`ConversationDetailPane` 重构为 `ChatPane`（ChatHeader + `MessageList` + `ChatComposer`）；新增 `AssistantMessage`（按 block 分发渲染 + agent 身份头 + 权限卡）、`AgentPicker`（新建会话时显式选 Claude/Codex/Pi，未装的 agent 置灰并给指引）、`AgentIcon`；会话列表支持搜索/重命名/agent 图标。会话 turn 记录 `agentId`/`agentName`，支持同一会话混合 agent 历史展示。修复了此前"按启用顺序隐式选 agent"的限制。

### Added
- **内置 Pi agent（ACP 接入）**：在原有 Claude Code ACP 之外，新增内置 [Pi coding agent](https://pi.dev) 接入，通过 `npx -y pi-acp` 适配器零安装启动（内部 `pi --mode rpc`）。Agent 设置页可在 Claude Code / Pi 间切换并分别配置/预检；新建会话按"已启用 agent"选择连接目标。引入 `AgentProfile` 注册表把原硬编码 `claude-acp` 的连接/预检参数化（`electron/acp/agent-profiles.ts`）；Pi 走"预检提示、不代管"模式——应用只管 pi-acp 适配器，`pi` 本体与模型 provider 凭证由用户在 pi 侧配置（预检检测 `pi` 是否在 PATH）。
- **AI File-First 编辑 + 实时热重载**：外部 CLI agent（Claude Code / Codex / Gemini 等）现在可直接编辑项目文件来改视频与文稿，编辑器实时把改动热重载到预览，形成「AI 改文件 → 编辑器实时反映」闭环。
  - **Motion Card 源码外置**：卡片 TSX 源码从 `project.json` 内嵌字符串外置为独立文件 `ai-cards/<overlayId>/motionCard.tsx`，`project.json` 只存 `tsxPath` 引用；内存态始终带源码、仅落盘时剥离（编译/渲染管线零改动），老项目首次加载自动迁移（`src/lib/motion-card-externalize.ts`）。
  - **文件信号会话锁**：AI 编辑前写 `.lingji/edit-lock.json`（带 `heartbeat`/`ttlMs`），编辑器据此暂停自动保存、状态栏显示「AI 正在编辑」，避免内存态覆盖外部改动；忘记解锁时按 TTL 自动释放（`electron/ai-edit/`）。
  - **实时热重载钩子**：`project.json`、`ai-cards/**/motionCard.tsx`、`script.md`/`original.md` 的外部变更经 chokidar 灌回对应 store 并刷新预览；`script.md` 外部保存补建版本历史（`source: external`）（`src/lib/external-edit-sync.ts`）。
  - **校验守门 + 结果回传**：外部改 `project.json` 经基础约束校验（时间为正、动画枚举合法），结果写 `.lingji/edit-result.json` 供 agent 自查，校验失败的脏数据不灌回预览，无需调用 MCP 工具（`src/lib/external-edit-validate.ts`）。
  - **文件契约文档 + 两个 Skill**：`docs/ai-contract/`（视频/文稿/锁/结果协议）+ `lingji-video-edit` / `lingji-script-edit` 两个边界清晰的 file-first skill；ACP 连接时把契约要点同步进项目目录的 `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`（`electron/acp/contract-sync.ts`）。
- **发布视频选项卡：多画幅封面工作台 + 元数据**：新增 `PublishCoverPanel` / `useCoverStudio`，按 16:9 / 4:3 / 3:4 分组生成与管理封面（`CoverCandidate` 新增 `aspectRatio`，旧数据缺省按 16:9）；编辑器封面面板只展示 16:9 整期封面，竖屏/方屏画幅交由发布选项卡管理。新增 `publish-metadata` 生成发布标题 / 简介 / 标签。导出成功后记录 `lastExportPath`，供发布选项卡预填视频文件。
- **待创作箱一键清空 + 欢迎页双栏工作区布局**：待创作箱支持一键清空（`inbox-store.clear()` 经 `sonar-inbox-clear` IPC 三件套贯通）；欢迎页改为左侧待创作箱 / 右侧本地草稿双栏布局，各自独立滚动。
- **pi agent 新增「火山方舟 Coding Plan」provider 预设**：内置火山引擎方舟 Coding Plan（OpenAI 兼容端点 `/api/coding/v3`，Doubao-Seed-Code 等编程模型）。
- **声呐扩展：抖音主页滚动采集 + DOM 提取 + ffmpeg 本地转码**：内容脚本改为滚动 DOM 采集主页（`secUid` 作 id），后台编排采集任务与进度，offscreen 集成 `ffmpeg.wasm` 本地转码（资源由 `scripts/copy-ffmpeg-assets.mjs` 在 predev/prebuild 生成，不入库）。

### Fixed
- **工作区 tab 切换偶发空白**：写稿工作台 / 视频编辑器 / 发布三个 tab 互切时，`resolvePageTransition` 仍返回随切换变化的 `contentKey`（如 `crossfade:editor->script-workbench`），导致 `AnimatePresence mode="wait"` 触发「旧页 exit(opacity→0) → 新页 remount」的完整周期；framer-motion v12 在 exit 动画帧与新 render 的时序竞态下会卡在「旧节点已退至透明、`onExitComplete` 未触发、新节点永不挂载」的状态，表现为整片空白（概率性出现）。修复为：工作区三页共用稳定 `contentKey: 'workspace'` + 静态 opacity:1，让 `AnimatePresence` 不介入，真正走 `display:contents/none` 切换显隐（兑现 `App.tsx` / `page-transition.ts` 原有注释的设计意图）。跨类别切换（welcome ↔ workspace、workspace → settings）仍保留正常 crossfade 动画。

## [1.2.0] - 2026-06-13

本版本带来全新的命令行工具 `lingji` 与配套的 headless（无头）主进程执行框架：音频、字幕分析、卡片、封面、导出等流水线步骤现在都能在终端里驱动，无需点开界面逐步操作。全部能力向后兼容，桌面端原有交互不受影响。

### Added
- **全新命令行工具 `lingji`**：无头 CLI，通过 MCP 服务地址与运行中的灵机剪影桌面端通信，在终端里驱动完整创作流水线（`cli/src/`）。覆盖子命令：
  - `project current | list | open` — 查看活动项目 / 列最近项目 / 切换项目
  - `audio gen` — 生成口播音频（MiniMax TTS，写盘 + SRT）
  - `subtitle analyze` — 字幕分析 + 卡片生成
  - `cards list | show | update | regenerate | regen-media | convert | delete` — AI 卡片的查看与重生成 / 重生成媒体 / 图片卡转 Motion 卡 / 删除
  - `cover prompt | image | gen` — 封面提示词 / 出图 / 一次性生成
  - `export` — 导出 MP4
  - `task status | list | cancel | wait <id>` — 任务查询与控制（支持 `--wait` 轮询至完成）
  - 全局开关 `--json`（机器可读输出）、`--server <url>`（覆盖 MCP 服务地址）
  - `npm run install:cli` / `uninstall:cli` 一键全局安装 / 卸载 `lingji` 命令
- **Headless 主进程执行框架**：TTS / 字幕分析 / 卡片 / 封面 / 导出全部可在无 UI 交互下由主进程直接执行，并通过刷新信号让已打开的项目同步最新结果（`registerGenerationTool`、`renderVideoHeadless`、完整 `AISettings` 装配与迁移链）。
- **新增 pipeline MCP 工具**：`lingji_generate_audio`、`lingji_analyze_subtitles`、`lingji_export_video`、卡片操作系列（list / get / update / delete / regenerate / regen-media / convert）、`lingji_get_active_project`、`lingji_list_recent_projects`，供外部 AI（Claude Code / Codex / Gemini）远程编排。
- **MCP 端点发现文件**：服务启停时写入 / 删除端点文件，CLI 据此自动定位运行中的服务地址，无需手动传 `--server`。
- **应用级错误边界 `AppErrorBoundary`**：页面渲染期抛错时转为可见错误信息 + 恢复入口，避免整窗黑屏（典型触发：项目切换时的中间不一致渲染），并暴露真正抛错的组件便于定位（`src/components/AppErrorBoundary.tsx`）。

### Changed
- **`lingji_open_project` 切换运行中窗口**：校验通过后经 `menu-action` 通道复用「打开最近项目」流程，让运行中的窗口直接切到目标项目（此前仅校验目录合法性）。
- **渲染进程订阅 `pipeline:project-updated`**：headless 写盘后，已打开的项目在 Renderer 侧自动刷新（新增 IPC 通道，向后兼容）。
- **`App.setPage` 对相同目标页短路**：避免 `AnimatePresence mode="wait"` 退化为「同页退出再进入」而卡成空白。

### Fixed
- **图片卡转 Motion 卡字幕分支**：`convert→motion` 补齐 `cardTemplate` / `imageTemplate` / `stylePresetId`，转换后样式不再丢失。
- **`audio gen` UI 刷新失效**：音频生成结果写回 `timeline.podcast`，使已打开项目的 UI 刷新生效。

## [1.1.0] - 2026-06-06

本版本是 v1.0.1 以来的一次大版本更新：渲染引擎整体从 HyperFrames 迁移到 Remotion，并带来卡片风格模板库、多 Provider TTS 音色体系、AI 卡片增量流式呈现等多项新能力。

### Added
- **AI 卡片增量流式呈现与自动落轨**：一键分析从「批处理结尾一次性出现」改为增量呈现——规划完成即铺出每个分段的骨架占位卡，每张卡片生成完即就地填充为真实卡片并自动落轨（进入时间线），无需手动「上轨」；取消 / 报错时保留已生成并落轨的卡片，仅清理剩余 pending 骨架。配套 `analyze-progress-bridge` 把卡片生命周期经 IPC 增量回传渲染端（`src/store/ai.ts`、`src/store/timeline.ts`、`src/lib/analyze-progress-bridge.ts`、`src/remotion/ai-card-render-plan.ts`）。
- **卡片生成父子任务嵌套进度**：`task-progress` 支持父子任务模型，`TaskProgressPanel` / 一键流水线嵌套渲染单卡子任务，长流程中可逐张看到实时进度。
- **段落卡 / 图片卡「风格模板库」**：内置 10 个系统预设风格（swiss-grid、nyt-data、xhs-pastel、mono-bold、soft-apple、dark-graph、hand-sketch、film-leak、cyber-glitch 等），支持全局 / 项目 / 单卡三级选择，每个风格附带零 LLM、秒开的静态预览 demo（`src/lib/card-style-presets/`、`StyleLibraryPanel`、`StylePresetPreview`）。
- **多 Provider TTS 与克隆音色体系**：TTS 设置从单一 MiniMax 升级为可扩展的多 Provider + 音色库，支持 MiniMax T2A v2 与 Xiaomi MiMo（含 `mimo-v2.5-tts-voiceclone` 克隆音色：参考音频 Base64 上传），旧配置自动迁移为默认 Provider / 默认音色（`TTSProviderDialog`、`TTSVoiceDialog`、`tts-settings.ts`、`tts-provider-runner.ts`）。
- **MiMo TTS 表现力增强 + 长文本分块合成**：口播模板新增 TTS 字段，AI 句级打标驱动情绪/语气变化，长文本分块合成并按块生成字幕，缓解「声音太平」（`xiaomi-mimo-tts.ts`、`tts/mimo-annotate.ts`、`tts/mimo-style.ts`、`tts-chunking.ts`、`media-concat.ts`）。
- **预览音频预载**：`src/remotion/preview-audio-preload.ts` 在预览前预载音频，减少播放抖动。
- **MiniMax 关思考走 Anthropic 端点**：新增 `@langchain/anthropic`，MiniMax 关闭 thinking 时改走 Anthropic 端点（OpenAI 端点会忽略 `enable_thinking`）。

### Changed
- **渲染引擎从 HyperFrames 切换为 Remotion**：预览改用 `@remotion/player`，导出改用 `@remotion/bundler` + `@remotion/renderer`（自带 Chrome Headless Shell + ffmpeg）。`TimelineData` 仍是唯一数据源，经 `buildRenderPlan` 编译为 Remotion 组件树（`src/remotion/`、`electron/remotion/`）。
- **AI Motion Card 改为自由 Remotion TSX**：LLM 产出 `motionCard.tsx`（default export 函数组件），主进程用 esbuild 编译为 CJS，经 `inputProps.compiledCards` 注入，由 `CardHost` 在 Remotion 上下文内求值；预览与导出共用同一份编译产物。`motion.*` 提示词同步改版为帧驱动（useCurrentFrame/interpolate/spring）。
- **风格库并入「项目统一风格」**：移除自由文本 `project.style`，项目统一风格完全由所选风格预设承载，消除「自由文本 + 风格预设」两套重叠概念，配置入口收敛为「只选模板」。
- **时间线播放体验**：拖动播放头时暂停 / 松手续播，缩放与定位时把播放头居中，修复预览中字幕与卡片的显隐时机。

### Removed
- 移除 `hyperframes` / `@hyperframes/player` 依赖与相关代码（`src/hyperframes/composition.ts`、`HyperframesPreviewPlayer`、`electron/hyperframes-cli.ts`、`electron/hyperframes-runtime-preflight.ts`、`hyperframes-runtime-preflight` IPC）。
- 移除自由文本 `project.style` 及其 `{{projectStylePrompt}}` / `{{projectStylePromptBlock}}` 提示词注入路径。

### Fixed
- **分段时间漂移 / 溢出**：规划分段重锚定到字幕真实时间轴（单调匹配 + 丢弃越界段），杜绝卡片时间漂移与溢出。
- **时间线大量空白**：新卡片时长默认铺满所在 segment（此前固定 5s）。
- **重复触发内容卡片分析**：头部按钮禁用 + 重入锁，消除多条并发进度。
- **pipeline 适配**：`register.ts` 适配 Zod4 `z.record` 二参，`ToolResult` 结构兼容 `CallToolResult`。

### Migration
- 旧工程的 `motionCard.html`（HTML+GSAP）加载时降级为占位并标记 `needsRegeneration`，不崩溃；Inspector 提示重新生成为 Remotion 卡片。

## [1.0.1] - 2026-05-27

### Added
- **Motion Card 字幕注入**：Motion Card 运行时新增 `MotionSubtitleCue` / `props.subtitles`，LLM 生成的动画按讲述节奏分步触发；`AICardOverlay` / `MotionCardOverlay` / `PodcastComposition` 物化 Motion Card 字幕窗。
- **一键流水线 telemetry**：新增 `src/lib/telemetry/auto-run.ts` 与 `electron/telemetry/auto-run-logger.ts`，把阶段耗时与单卡耗时写入 jsonl，用户报"慢"时可直接查日志定位瓶颈。
- **COVER_REGENERATION 接入一键流水线**：单条封面可在一键工作流内重生，无需手动重跑整个流程。
- **AGENTS.md**：新增本地协作指南。
- **Promo assets**：补充推广素材。

### Changed
- **封面 / 卡片提示词全面改版**：引入新视觉系统，`cards.segment` 提示词升级到 v7（motion-only，image 段直接走 `card.image` 链路），与新一代图像 Provider 配合更稳。
- **AIStore / AISegmentAnalysis 字段扩展**：配合 Motion Card 字幕窗与 telemetry 落地。
- **subtitle-highlight-runner / llm/index**：围绕 telemetry 做配套增强。

### Removed
- 移除 `electron-installer-dmg` 依赖，DMG 改用 `hdiutil` 生成，减少打包链路上的脆弱点。

### Build / Packaging
- macOS 多架构（arm64 + x64）DMG，Windows x64 zip 通过 GitHub Actions 自动构建并发布。

[1.3.1]: https://github.com/yoqu/lingji-cut/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/yoqu/lingji-cut/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/yoqu/lingji-cut/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/yoqu/lingji-cut/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/yoqu/lingji-cut/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/yoqu/lingji-cut/releases/tag/v1.0.0

# Agent 使用指南

灵机剪影提供两条 AI Agent 路径：

1. **应用内 Pi**：内置、开箱即用的对话 agent，直接在应用里和你协作改稿、改视频。
2. **外部 Agent + MCP / File-First**：让 Claude Code / Codex / Gemini 等外部 CLI 通过 `lingji-editor` MCP 工具或直接编辑项目文件来驱动编辑器。

两条路径共用同一套「AI 改文件 → 编辑器实时热重载」的 file-first 闭环。

---

## 一、应用内 Pi Agent

### 是什么

自 v1.3.0 起，应用内对话面板收敛为唯一的内置 agent **Pi**：

- **内置打包、零安装**：固定版本的 [`@earendil-works/pi-coding-agent`](https://pi.dev) 已随应用一起打包（打包时 asar unpack），用 Electron 自带的 Node 进程内运行，**用户无需自行安装 `pi` 或任何 CLI**。
- **复用应用的 LLM Provider 配置**：连接时把「设置 → AI」里配置的 `llmProviders` 投影成 Pi 的模型清单（写入应用托管的 `~/.lingji/pi-agent` 目录）。**你在 AI 设置里配好 Provider 即可用 agent，不用再单独填一遍凭证。**
- **走 File-First（不依赖 MCP）**：Pi 直接编辑项目里的 `script.md` / `original.md` / `project.json` / `ai-cards/<id>/motionCard.tsx`，编辑器热重载把改动实时反映到预览。

### 准备工作：配置 LLM Provider

进入「设置 → AI」添加一个 LLM Provider（OpenAI 兼容、Gemini、LM Studio、火山方舟等），填入 Base URL / 模型 / API Key。API Key 通过 Electron `safeStorage` 加密保存。

内置了 **「火山方舟 Coding Plan」** Provider 预设（火山引擎方舟，OpenAI 兼容端点 `/api/coding/v3`，含 Doubao-Seed-Code 等编程模型），可一键添加。

### 开始对话

1. 在编辑器里打开 AI 对话面板。
2. 顶部图标可弹出会话下拉（搜索 / 切换 / 新建 / 重命名 / 删除会话）。
3. 顶部只读标记当前 agent 为 Pi，点击直达「设置 → Agent」。
4. 底部的 **模型选择芯片** 用来切换 Pi 当前使用的模型（或用默认）；所选模型会经发送链路透传到 runtime。
5. 输入需求并发送即可。

### Pi 能做什么

- **改文稿**：编辑 `script.md`（口播成稿）/ `original.md`（原始素材），编辑器热重载回写脚本工作台，并自动补建版本历史。
- **改视频**：编辑 `project.json`（overlay 时间 / 动画 / 坐标 / 字幕样式）与 `motionCard.tsx`（Motion Card 动画源码），预览实时热重载。
- **跑命令**：内置 read / edit / write / bash 工具。

> Pi 本身没有 MCP 能力，靠「直接改文件 + 编辑器热重载」生效，因此它不会调用 `lingji_*` MCP 工具；那套工具是给下文的外部 agent 用的。

### 工具审批门控

Pi 的每次工具调用（读写文件、执行命令）都会经过权限策略：

- **请求批准**：每次工具调用都弹卡片确认。
- **替我审批（默认 tiered）**：仅对有风险的操作（执行命令、改动项目外文件）弹卡片。
- **完全访问**：不弹确认，完全放行（请谨慎）。

策略在「设置 → Agent」配置。工具调用在对话里以 op-card 形式渲染（状态徽章 + 可折叠的 input / output），连续同名调用会聚合成可折叠分组（如 `Edit ×3`）。

---

## 二、外部 Agent（Claude Code / Codex / Gemini）

如果你想用自己惯用的 CLI agent 来驱动灵机剪影，有两种接入方式，可以混用。

### 方式 A：MCP 工具（lingji-editor）

应用内可启动一个本地 MCP Server（server id：`lingji-editor`），把编辑器与流水线能力开放给外部 agent。

1. 进入「设置 → MCP」，启动本地 MCP Server。
2. 一键注册到 Claude Code / Codex / Gemini（应用会写入各客户端的配置）。应用同时会写一个端点发现文件（`~/.lingji/mcp-endpoint.json`），CLI 据此自动定位运行中的服务地址。

`lingji_*` 工具覆盖：

- **读取编辑器 / 项目状态**：当前活动项目、最近项目、项目上下文、列项目文件、读脚本。
- **脚本协作**：读 / 写 / 更新 `script.md` / `original.md`，提交审稿批注。
- **媒体导入**：导入视频源、查询导入状态。
- **流水线（headless）**：生成音频（TTS）、字幕分析、卡片操作系列（list / get / update / delete / regenerate / regen-media / convert）、封面、导出 MP4，以及任务查询。

### 方式 B：File-First 直接改文件

外部 agent 也可以像 Pi 一样直接改项目文件，由编辑器热重载反映。ACP 连接时，应用会把 file-first 契约要点同步进项目目录的 `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`（用标记块幂等更新），让外部 agent 知道规则。

契约要点：

- **编辑前加锁**：写 `<项目>/.lingji/edit-lock.json`（带 `owner` / `scope` / `heartbeat` / `ttlMs`）。编辑器据此暂停自动保存、状态栏显示「AI 正在编辑」，避免内存态覆盖外部改动；忘记解锁会按 TTL 自动释放。
- **编辑后解锁**：删除 `edit-lock.json`。
- **校验回传**：改 `project.json` 后，应用把校验结果写入 `<项目>/.lingji/edit-result.json`（时间为正、动画枚举合法等），失败的脏数据不灌回预览，agent 可据此自查重写。
- **文件边界**：视频走 `project.json` + `ai-cards/<id>/motionCard.tsx`，文稿走 `script.md` / `original.md`。

配套提供两个边界清晰的 file-first skill：

- `lingji-video-edit`：改视频（overlay 时间 / 动画 / 坐标 / 字幕样式、Motion Card 源码）。
- `lingji-script-edit`：改文稿（`script.md` / `original.md`）。

完整协议见 [`docs/ai-contract/`](ai-contract/)。

### 方式 C：lingji 命令行

`lingji` CLI 是另一条无头驱动路径，通过 MCP 端点与运行中的桌面端通信，在终端里跑完整流水线：

```bash
npm run install:cli                       # 全局安装 lingji 命令
lingji project current | list             # 活动 / 最近项目
lingji audio gen --wait                   # 生成口播音频 (TTS)
lingji subtitle analyze --wait            # 字幕分析 + 卡片生成
lingji cards list|show|update|regenerate  # 卡片操作
lingji cover gen --wait                   # 封面
lingji export --out out.mp4 --wait        # 导出 MP4
lingji task status|list|cancel|wait <id>  # 任务查询与控制
```

全局开关：`--json`（机器可读输出）、`--server <url>`（覆盖 MCP 服务地址）。

---

## 三、配置与数据位置

| 路径 | 用途 |
| --- | --- |
| `设置 → AI` | LLM Provider、图片 / 视频 Provider、TTS、提示词配置（Pi 与外部 agent 共用 Provider 凭证） |
| `设置 → Agent` | Pi 的审批策略、模型与推理档位、技能开关 |
| `设置 → MCP` | 启动 `lingji-editor` MCP Server，注册到 Claude Code / Codex / Gemini |
| `~/.lingji/agent-config.json` | Agent 全局配置 |
| `~/.lingji/pi-agent/` | 应用托管的 Pi 配置目录（模型清单、会话等） |
| `~/.lingji/mcp-endpoint.json` | MCP 端点发现文件（CLI / 扩展据此定位服务） |
| `<项目>/.lingji/edit-lock.json` · `edit-result.json` | File-first 会话锁与校验回传 |

API Key 通过 `safeStorage` 加密保存，降级时才明文写入 key 文件。**请不要把真实 API Key / Session / Cookie 提交到源码、测试、文档或截图中。**

---

## 四、Pi 与外部 Agent 对比

| 维度 | 内置 Pi | 外部 Agent（Claude Code / Codex / Gemini） |
| --- | --- | --- |
| 安装 | 随应用打包，零安装 | 需自行安装对应 CLI |
| LLM 配置 | 复用应用 AI 设置 | 各自的配置文件 |
| 改动方式 | File-first（直接改文件） | File-first + `lingji_*` MCP 工具 |
| 运行方式 | 进程内 SDK | 外部进程，经 MCP / 文件交互 |
| 会话历史 | 应用内 SQLite 持久化 | 由外部 agent 自行管理 |

简单说：**想开箱即用、在应用里直接聊就用 Pi；想用自己惯用的 CLI、或要批量 / 自动化编排就走外部 Agent + MCP / CLI。**

# 声呐 ⇄ 灵机剪影：监听→二创 联动设计

日期：2026-06-21　分支：`feat/lingji-cli`

## 1. 目标

声呐（Chrome 扩展）定时监听每个博主的更新，发现新视频后抓取**转录稿 + 元数据**，
推送到灵机剪影（Electron 桌面端）的「待创作箱」。用户在桌面端审一眼，点「生成初稿」，
桌面端把转录稿当素材，AI **二创/转述**成用户风格的口播稿，再走现有 pipeline
（配音 → 字幕分析 → 封面/卡片 → 时间线），用户只做审稿与导出。

**联动深度**：到「初稿创作完成」。**触发**：审批队列（重 AI 链路由用户点击启动）。
**创作意图**：二创/转述成口播稿。**桥**：本地 HTTP（方案 A），队列只带转录稿+元数据，原片按需。

## 2. 关键决策（已与用户确认）

| 维度 | 决策 |
| --- | --- |
| 联动深度 | 发现 → 下载转录 → 入队 → 用户点击 → AI 二创 → 配音/字幕/封面/卡片/排线 → 用户审稿导出 |
| 触发 | 审批队列：声呐只做轻量活（转录+元数据入队），重 AI 链路由桌面端「生成初稿」按钮启动 |
| 创作意图 | 二创/转述：别人转录稿 → 用户风格口播 `script.md` |
| 桥 | 方案 A：扩展 POST 到桌面端本地 HTTP 端点；loopback + 共享 token |
| 原片 | 不自动下大 mp4；队列只带转录稿+元数据，原片按需 |

## 3. 数据流

```
chrome.alarms 定时
  → 声呐批量轮询每个博主（inactive tab 抓作品列表 → diff 新增）
  → 对新增视频抓转录稿（bcut/openai ASR）+ 元数据
  → 转录完成后 BridgeClient POST /sonar/enqueue → 灵机剪影「待创作箱」
       （桌面端关着 → 扩展 IndexedDB pending 暂存，可达时补推；awemeId 幂等）
  → 用户在欢迎页「待创作箱」点「生成初稿」
  → 桌面端 pipeline：create_project → original.md=转录稿 → AI 二创 script.md
     → TTS → 字幕分析/封面/卡片 → 时间线
  → 用户审稿 + 导出
```

## 4. 现有代码锚点（已核实）

### 桌面端（Electron）
- `electron/mcp/server.ts`：`http.createServer`，`listen(port,'127.0.0.1')`，路由 `/health`、`/mcp`、else 404。
  `parseRequestBody(req)`、`setCorsHeaders(res)` 工具已有。`writeEndpointFile(port)` 写 `~/.lingji/mcp-endpoint.json`。
- pipeline MCP 工具（`electron/mcp/tools.ts`、`electron/pipeline/`）：`lingji_create_project`、`lingji_update_script`
  （直接写任意文件）、`lingji_write_script`（模板 `{{rawText}}` + original.md → AI 写稿）、`lingji_generate_audio`、
  `lingji_analyze_subtitles`、`lingji_generate_cover_*`、`lingji_export_video`。fire-and-poll。
- 写稿无独立 prompt kind；走 `script-template` 体系（`src/lib/script-utils.ts::generateScriptDraft`，
  `buildScriptDraftPrompt` 用 `{{rawText}}` 占位）。**二创无需新 prompt kind**，phase 1 复用现有模板。

### 扩展（Sonar）
- `src/background/service-worker.ts:107-121`：`chrome.alarms` 全局 30min → `monitor.runOnce()`。
- `src/monitor/monitor-service.ts`：每 tick 选「最久未检查」一个博主；`onNewVideo` 钩子。
- `src/background/build-services.ts:129`：`onNewVideo → autoQueue.enqueue(video.id)`（发现即入处理队列做转录）。
- `src/domain/models.ts`：`Creator`、`Video`、`CreatorSubscription{intervalMinutes:15|30|60,paused,...}`、
  `TranscriptDocument{videoId,provider,language,fullText,srtText,segments,createdAt}`。
- `src/processing/`：bcut/openai ASR，`transcript.ts` 标准化。`processing-queue.ts` 单线程，转录存 `repo.putTranscript`。
- `src/background/settings-store.ts`：`AiSettingsInternal`，存 `chrome.storage.local` 键 `sonar:ai-settings`。
- `src/protocol/`：可判别联合协议，方法白名单 `methods.ts`，路由 `handlers.ts`。

## 5. 桥协议（loopback + token）

- `GET /sonar/health` → `{ ok:true, name:'lingji-editor', version }`（探活，无需 token）。
- `POST /sonar/enqueue`（需 `x-sonar-token` 头）→ body：
  ```jsonc
  {
    "source": "douyin",
    "awemeId": "string",          // 幂等键
    "creatorId": "string",
    "creatorName": "string",
    "title": "string",
    "url": "string",
    "coverUrl": "string?",
    "publishedAt": 1719000000000,
    "durationMs": 123000,
    "transcript": { "fullText": "...", "srtText": "...", "segments": [{ "text","startMs","endMs" }] }
  }
  ```
  返回 `{ queued:true, itemId, duplicate?:true }`。
- 鉴权：仅 loopback；`x-sonar-token` 与桌面端 token 比对，不符 → 401。token 桌面端生成，写入端点文件
  与设置页，用户复制进扩展设置。
- 幂等：桌面端 inbox 按 `awemeId` 去重，重复返回 `duplicate:true`，不重复建项目。

## 6. 桌面端改动（Electron）

- **inbox 持久化**：`~/.lingji/sonar-inbox.json`（或 userData）。纯模块 `electron/sonar/inbox-store.ts`：
  `enqueue(item)`（幂等）、`list()`、`get(id)`、`markStatus(id,status)`、`remove(id)`。可单测。
- **token**：`electron/sonar/token.ts`：首次生成持久化到 `~/.lingji/sonar-token`，随端点文件暴露。
- **路由**：`electron/sonar/routes.ts`：`handleSonarRequest(req,res,deps)`，在 `server.ts` 404 前接入。校验 token、解析 body、入 inbox。
- **UI**：欢迎页「待创作箱」入口，列 inbox 项（封面/博主/标题/转录预览/状态），每项「生成初稿」（可批量）。
- **「生成初稿」编排**：create_project（按博主+标题派生目录名）→ update_script 写 original.md=转录稿 →
  write_script（用户选模板，默认可配）→ generate_audio → analyze_subtitles → generate_covers。
  复用现有 headless 编排；inbox 项状态：`pending → creating → drafted → failed`。
- IPC 三件套（main/preload/electron-api）暴露 inbox 读取、生成初稿、删除。

## 7. 扩展改动（Sonar）

- **BridgeClient**（`src/bridge/bridge-client.ts`，纯逻辑+注入 fetch）：`probe()`（health）、`enqueue(payload)`、
  pending 队列（IndexedDB）补推、awemeId 幂等。
- **接线**：转录完成后（处理队列产出 `TranscriptDocument`）对**自动发现**的视频组装 payload 推桥；
  失败入 pending，下次 alarm/启动补推。
- **设置**：`AiSettingsInternal` 加 `bridge:{ enabled, endpoint, token }`；设置页 UI + 协议方法
  `getBridgeSettings`/`updateBridgeSettings`/`testBridge`。
- **调度增强**（phase 2）：alarm tick 批量轮询，按 `CreatorSubscription.intervalMinutes` 到期才查，
  一 tick 处理一批（可配 batch），轮转覆盖所有博主；保留熔断。

## 8. 失败 / 边界

- 桌面端关闭 → 扩展 pending 暂存，可达时补推。
- 抖音登录失效/验证码 → 现有熔断停轮询 + 通知。
- 转录失败 → 不入队，标错。
- token 不符 → 401，扩展提示重配。
- awemeId 全程幂等：扩展 pending 去重 + 桌面端 inbox 去重。
- 「生成初稿」中途失败 → inbox 项 `failed` + 错误信息，可重试。

## 9. 安全边界

- 桌面端新增 inbound 端点：严格 loopback（`127.0.0.1`）+ 共享 token。
- 不接收/转发抖音 Cookie/Token；转录文本是用户已同意 Provider 产出的派生数据。
- token 存 `~/.lingji/sonar-token`（0600）与扩展 `chrome.storage.local`，不进日志/导出。

## 10. 分期实施计划

### Phase 1 — 桥地基 + 待创作箱（端到端打通，复用现有写稿）
1. 桌面端 `inbox-store.ts`（纯模块 + 单测）。
2. 桌面端 `token.ts`（生成/读取 + 单测）。
3. 桌面端 `routes.ts`（`handleSonarRequest` + 单测：health/enqueue/token/幂等/404）。
4. 接入 `server.ts`；端点文件暴露 token。
5. 扩展 `bridge-client.ts`（纯逻辑 + 单测：probe/enqueue/pending 补推/幂等）。
6. 扩展接线：转录完成推桥；设置 + 协议方法 + 单测。
7. 桌面端「待创作箱」UI + 「生成初稿」编排 + IPC 三件套。
8. 真实联调（需用户）：扩展加载 + 桌面端运行 + 抖音登录态。

### Phase 2 — 调度增强 + 二创 prompt + 状态回写
1. 扩展批量/按周期轮询调度 + 单测。
2. 桌面端「二创/转述」专用 script-template。
3. 状态回写：桌面端记录已处理 awemeId；扩展轮询 health/status 显示「已创作」。

## 11. 测试策略

- **纯逻辑单测**（可自动循环跑）：inbox-store、token、routes、bridge-client、调度选择器。两侧各自 vitest。
- **契约**：enqueue payload 形状两侧共享 fixture。
- **需用户的真实联调**：抖音抓取、桌面端 pipeline 实跑、打包。每到此类检查点显式标注，不伪造通过。

## 12. 自动化边界（诚实声明）

可自动完成并循环测试：两侧全部纯逻辑/服务模块 + vitest 回归 + typecheck/build。
**无法纯自动完成**：真实抖音登录抓取、真实桌面 App 跑 AI/TTS/导出、Electron 打包上线——
这些需用户在检查点参与；loop 在每个检查点暂停并明确说明已验证什么、待用户验证什么。

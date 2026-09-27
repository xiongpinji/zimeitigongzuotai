# Objective

在独立剪辑台把暂停、拖动和逐帧画面接到与导出同一 Remotion composition 的 `renderStill()`，让当前版本的目标时间线帧精确覆盖原生 Player 画面；播放时继续用 Player，现有 `render-video` 导出结果与行为不变。本任务只交源码及测试，不打包。

# Why

主库 `8289ac54a5048ee1b303a85d37670a0910b3e1cf` 的严格 UI 测试在 15 fps 源第 42/43 帧、30 fps 源第 43 帧 SSIM <0.92。`requestVideoFrameCallback().mediaTime` 证实原生 `<video>` 实际呈现的帧不同于导出 `OffthreadVideo` 的帧。`app/scripts/probe-r2-renderstill-win.cjs` 已在同一合成工程验证 `renderStill()` 与导出帧 SSIM 0.984–1.0、复用浏览器单帧约 0.55–0.72 秒。随后补充的 VFR、字幕和[9:16 隔离工程](../validation/r2-portrait-canvas-probe-2026-09-28.md)也呈现“产品原生预览未过、独立静帧探针通过”；选定设计见 `docs/superpowers/specs/2026-09-28-r2-exact-paused-preview-design.md`。

# Scope

允许修改：`app/electron/remotion/preview-still.ts`（新）、`app/electron/remotion/render-video-headless.ts`（仅提取/导出共享素材及包态辅助函数、保持导出行为）、必要时 `app/electron/remotion/preview-still-assets.ts`（新共享辅助）、`app/electron/main.ts`（仅预览 IPC）、`app/electron/preload.ts`（仅预览桥）、`app/src/lib/electron-api.ts`（仅预览类型）、`app/src/components/PreviewPanel.tsx`、`app/src/components/PreviewPanel.module.css`、`app/scripts/check-editor-preview-export-parity-win.cjs`、`app/tests/preview-still.test.ts`、`app/tests/preview-panel.test.tsx`、必要时新增 `app/tests/preview-still-ui.test.tsx`。若确需改动其他路径，先通过任务 question channel 问 Codex，不得自行扩范围。不要修改 `VideoOverlay.tsx` 的导出/预览分流，不换视频依赖，不改商品、账号、发布、高光或 Agent 模块。最大变更文件数 13。

# Files to inspect

- `AGENTS.md`：协作、数据隔离和源码/真实平台证据分层。
- `app/src/remotion/overlays/VideoOverlay.tsx`、`use-is-rendering.ts`、`MainComposition.tsx`、`Root.tsx`：确认预览/导出视频路径及同一个 composition ID。
- `app/electron/remotion/render-video-headless.ts` 的 `createRenderPublicDir`、卡片 hydrate/外置、`prepareServeUrlFromPrebuilt`、`resolveRemotionBinariesDirectory`、`prepareRemotionCwd`：预览应复用或抽取这些准备步骤；保留现有导出。
- `app/electron/remotion/render.ts` 与 `bundle.ts`：输入 props 和导出 bundle 缓存边界；预览不能覆盖导出共用的可变缓存。
- `app/src/components/PreviewPanel.tsx`、`RemotionPreviewPlayer.tsx` 与 CSS：进度条、Player、交互层位置和播放/暂停事件。
- `app/electron/main.ts` 的 `render-video` handler、`app/electron/preload.ts` 的 `renderVideo`、`app/src/lib/electron-api.ts` 的 `ElectronAPI`：新增类型化 IPC 的现有模式。
- `app/scripts/check-editor-preview-export-parity-win.cjs` 与 `app/scripts/probe-r2-renderstill-win.cjs`：严格 UI 门槛、逐帧和可行性证据。
- `app/tests/remotion-render.test.ts`、`app/tests/preview-panel.test.tsx`、`app/tests/render-video-headless.test.ts`：现有相关测试边界，避免只做字符串存在性断言。

# Implementation guidance

1. 先添加有意义的失败测试：最新帧/版本覆盖旧异步返回，播放或项目切换立即清除静帧，重复帧可复用，渲染/素材失败显示明确状态且不能把旧图当当前帧；主进程会话属主和释放也要测。测试应验证行为而非仅匹配源码字符串。
2. 在主进程提供独立的预览静帧服务。采用三段类型化 IPC：`prepareExactPreview({timeline,srtEntries,projectDir}) -> {sessionId,durationInFrames,fps}`；`renderExactPreviewFrame({sessionId,frame}) -> {sessionId,frame,png:Uint8Array}`；`releaseExactPreview(sessionId) -> void`。会话属于创建它的 `webContents.id`，其他窗口不可使用；无输出路径参数，PNG 仅经本机 IPC 返回。项目会话至多保留当前有效版本与正在安全释放的旧版本，关闭窗口要清理浏览器和临时目录。验证帧在 `[0,durationInFrames)`；无效输入直接拒绝。
3. 预览素材和卡片输入必须与导出一致。允许给 `createRenderPublicDir` 增加可选 `projectDir` 参数并提取共享准备函数；不要复制一个行为逐渐漂移的简化导出器。`renderStill({output:null,imageFormat:'png',inputProps,composition,serveUrl,frame,puppeteerInstance})` 返回的 Buffer 转为 `Uint8Array`。一份 serve URL/浏览器按当前工程版本复用；用户连续拖动时旧请求取消或合并，只把最新帧结果返回为可展示帧。开发态运行时 bundle，包态使用既有预打包站点与真实二进制/可写缓存约定；本任务不得制作安装包。避免与导出任务竞争可变 `process.cwd()` 或 `getRemotionBundle` 单槽缓存。
4. 渲染进程在 `PreviewPanel` 管理版本 token 和 `Blob` URL。暂停后短暂 debounce，再准备会话/请求目标帧；版本、帧、播放状态改变时，旧 promise 的返回不得覆盖当前目标，旧 URL 及时 revoke。播放恢复立即移除静帧。准备/失败时显示明确状态，不把原生视频当前帧或上一张 PNG 标为精确帧。图片覆盖 Player，但交互层仍在上方。提供稳定 `data-exact-preview-status` 与 `data-exact-preview-frame` 供端到端验收；不要在产品文案承诺平台原创判定。
5. 更新严格 UI 脚本：等待与当前进度一致的 `ready` 精确帧，记录等待耗时、状态和实际帧号，再截图比对；超时或错误即失败，不用固定 sleep 冒充完成。15/30 fps 及返回拖动均应运行。测试仅在隔离合成工程中，勿使用真实录屏。
6. 对话框/日志不得输出原始视频、会话 Cookie、商品 ID 或长路径。任何会改变导出行为、包态路径、资源权限或交互语义的未决问题先使用 question channel 向 Codex 提问。

# Constraints

用户当前说“先不打包，我们先测试”。只做源码实现与离线测试；不得打包、发布、登录真实账号、读取真实录屏、调用收费模型或平台接口。不得新增/升级依赖、修改凭证、提交、推送、部署、删用户文件或递归清理仓库。测试媒体和临时输出留在被忽略的 `data/runtime/validation/`。不要派生任何子 Agent；Agent Orchestrator 负责路由、重试和升级。若隔离工作树没有 `app/node_modules`，不得随意安装或更改锁文件；报告无法运行的命令，由 Codex 在主工作区独立复测。固定模型和文件范围，拒绝越界实现。

# Acceptance criteria

- 暂停的当前帧只有在 `sessionId`、工程版本、目标帧均匹配时显示 exact PNG；快速 42→43→90→42 不出现迟到帧覆盖，播放立刻取消覆盖。
- 对同一工程重复请求帧不重新 bundle/启动浏览器；工程编辑/切换/素材变化使旧结果失效，关闭会话清理资源。
- 主进程拒绝其他 `webContents` 使用会话、非法帧和已释放会话；缺失素材/卡片编译失败不静默当作成功。
- 15/30 fps 合成工程的真实桌面 UI 第 42、43、90、返回 42 帧 SSIM 均 ≥0.92；连续拖动与保存重开无页面异常。若当前 worktree 无测试运行依赖，保留可由 Codex 运行的严格测试脚本，不虚报此项通过。
- 对已存在的 9:16 工程、VFR 素材和 SRT 叠层分别复测同一严格 UI 门槛；9:16 工程可通过隔离文件准备，但不算剪辑台画幅切换功能验收。
- 现有 `renderVideoHeadless`、播放器播放和导出参数保持原行为；相关 Vitest、类型检查与源码构建通过或明确记录缺依赖。

# Validation

在有现成依赖的环境：`cd app; npx vitest run tests/preview-still.test.ts tests/preview-panel.test.tsx tests/remotion-render.test.ts tests/render-video-headless.test.ts --reporter=dot`，然后 `npx tsc --noEmit`、`npx electron-vite build`。Windows UI：先运行 `node app/scripts/smoke-editor-multitrack-win.cjs` 生成隔离工程，再运行 `node app/scripts/check-editor-preview-export-parity-win.cjs <runDir>`；用 `LINGJI_R2_SOURCE_FPS=15` 和 `30` 各做一次，并以 `LINGJI_R2_CANVAS_KIND=portrait` 复测竖屏。VFR 用 `LINGJI_R2_SOURCE_KIND=vfr` 且源帧率 30；字幕用既有隔离 SRT 工程。无依赖时跑 `node --check app/scripts/check-editor-preview-export-parity-win.cjs` 与 `git diff --check` 并记录跳过。不要运行 `electron-builder`、真实平台连接或在线模型调用。Codex 会独立运行全量/聚焦检查并审阅输出。

# Final report

列出每个修改文件、具体行为、先失败后通过的测试证据、所有实际执行命令与退出码、跳过项和原因、UI 逐帧 SSIM 或未运行状态、假设/偏离/残留风险。说明是否满足每条验收标准；不能把工作树代码、mock 或 `renderStill` 独立探针算成真实编辑器 UI 通过。不提交、不推送，等待 Codex 复核。

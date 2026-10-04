# R2 暂停精确预览：源码与离线桌面验证（2026-10-05）

基线为 `b779a7fad7d1084e68e4c7cc19350237df38ad69`。用户要求先测试、不打包；本轮仅修改源码，用隔离的合成媒体和 Electron 桌面实例验证。旧版严格 UI 门槛在 15 fps 素材的 42/43 帧分别为 SSIM `0.884854`/`0.882321`，低于 `0.92`；独立 `renderStill` 探针虽通过，但当时没有接入产品（见 `prepackage-source-validation-2026-09-28.md`）。

## 实现与边界

- `app/electron/remotion/preview-still.ts` 新增主进程静帧会话：按 `webContents.id` 隔离、验证帧边界、淘汰过期请求、缓存 4 帧、释放浏览器和临时目录。使用导出同一 `lingji-composition`、素材准备与卡片编译，并用 `renderStill()` 生成 PNG；不接收任意输出路径。
- `app/electron/remotion/render-video-headless.ts` 提取导出与预览共用的素材/卡片准备，允许传入已打开工程目录；打包态的可写 cwd 使用进程级串行门槛，导出也经过该门槛。没有生成或测试安装包，因此包态路径仍待独立验证。
- `app/electron/main.ts`、`preload.ts`、`app/src/lib/electron-api.ts` 新增三段类型化预览 IPC。窗口销毁时释放所属会话。
- `app/src/components/PreviewPanel.tsx` 和 CSS 在暂停时按目标帧延迟准备并覆盖 Player；播放、工程版本变化或新目标帧立即取消旧图，图片解码成功后才标记 `ready`。准备和失败有显式状态，交互层仍在图片上方。
- `app/scripts/check-editor-preview-export-parity-win.cjs` 改为等待目标 `ready` 帧并记录帧号、耗时和 SSIM；不再用固定睡眠代表渲染成功。两项新测试文件验证主进程属主/失效/缓存/释放，以及界面迟到帧与错误状态。

## 本轮实际验证

所有命令退出码为 0，除另有说明：

| 检查 | 结果 |
| --- | --- |
| `npx vitest run tests/preview-still.test.ts tests/preview-still-ui.test.tsx tests/preview-panel.test.tsx tests/remotion-render.test.ts tests/render-video-headless.test.ts --reporter=dot` | 5 文件、10 项通过 |
| `npx tsc --noEmit`、`npx electron-vite build`、`node --check app/scripts/check-editor-preview-export-parity-win.cjs`、`git diff --check` | 通过；构建有现存依赖 externalize/dynamic-import 告警，无失败 |
| `npx vitest run --maxWorkers=2 --minWorkers=2 --reporter=dot` | 396 文件通过；2983 项通过、4 项跳过、0 失败 |
| `node app/scripts/smoke-editor-multitrack-win.cjs`（15 fps 合成源） | 新工程分割、撤销/重做、双画轨、保存重开、H.264/AAC 导出解码通过；页面异常 0 |

以下均运行 `node app/scripts/check-editor-preview-export-parity-win.cjs <隔离目录>`，顺序为 42→43→90→42 帧（字幕为 6→36→78→36）；阈值 `0.92`。证据位于 Git 忽略的 `data/runtime/validation/`，每个目录有 `parity-result.json`、截图、导出逐帧图；媒体、工程与本机路径未提交。

| 合成场景 / 证据目录 | UI 对导出逐帧 SSIM | 结果 |
| --- | --- | --- |
| 15 fps 横屏，新建并保存重开的 `r2-multitrack-1791139454376` | `.963061 / .962084 / .995767 / .963061` | 通过；等待 1664/662/669/120 ms |
| 30 fps 横屏 `r2-multitrack-1791137989285`（默认 GPU 路径，未加 `--disable-gpu`） | `.965043 / .964321 / .995767 / .965034` | 通过 |
| 15 fps 竖屏 `r2-multitrack-1791138091652` | `.927684 / .928387 / .979114 / .927684` | 通过，距阈值最近 |
| 30 fps VFR `r2-multitrack-1791138167632` | `.962902 / .962277 / .995767 / .962902` | 通过 |
| SRT 字幕 `r2-subtitle-1791138267394` | `.998104 / .993074 / .993971 / .993074` | 通过 |

前四类源素材的配置由各目录 `result.json` 证实。每个多轨工程有 2 条画轨、3 个片段和 0 个页面异常。严格脚本实际读取状态/帧号和已解码图片后截图，重复拖动 42 帧并未显示迟到帧。新工程的导出为 H.264 1280×720 + AAC，5.461 秒，完整探针通过。竖屏样本是隔离工程，不代表产品有画幅切换 UI。

## 验收界限

R2 暂停帧的源码、类型、构建、离线产品 UI 与合成导出回归通过。包态安装、长时间编辑稳定性、真实录屏、大规模性能、外部 GLM 只读审查仍未验证。该证据不解除 R1/R3/R4/R5/R6 的各自缺口，也不代表平台对视频的原创判定。未登录账号、调用平台接口、发布视频、付费模型或制作安装包。

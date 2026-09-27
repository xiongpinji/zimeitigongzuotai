# R2 暂停预览实际呈现帧诊断（2026-09-28）

**业务源码基准：** `66b52fc94083355580e92de2630da987fb454ae8`。本轮只增强 Windows 源码验收脚本并运行隔离合成工程；产品预览/导出实现未改，没有打包、读取真实录屏、登录账号或发布。

上一轮以 `HTMLVideoElement.currentTime` 和截图推断预览帧。现在[严格比对脚本](../../app/scripts/check-editor-preview-export-parity-win.cjs)额外记录 `requestVideoFrameCallback()` 的 `mediaTime`、`presentedFrames` 和 `seeked` 事件。`currentTime` 是请求的媒体位置，`mediaTime` 是浏览器报告的**已呈现画面**时间码，二者不可混用。比对仍在测试进程以 `--disable-gpu --force-color-profile=srgb` 运行，画面门槛 SSIM ≥ 0.92。

[多轨源码脚本](../../app/scripts/smoke-editor-multitrack-win.cjs)现在可用 `LINGJI_R2_SOURCE_FPS` 生成 1–120 fps 的隔离素材，默认保持原先 15 fps。本轮用相同 30 fps 时间线各生成 15 fps、30 fps 的 3 秒 `testsrc2` 和蓝底视频；30 fps 素材的实际桌面多轨工作流、保存重开、H.264/AAC 导出和完整解码通过，页面异常 0。修改脚本后默认 15 fps 冒烟亦重新通过，隔离工程为 `r2-multitrack-1790541545494/`。

| 源素材 fps | 时间线帧 | `<video>.currentTime` | 已呈现 `mediaTime` | 对应导出帧 SSIM | 结果 |
| ---: | ---: | ---: | ---: | ---: | --- |
| 15 | 42 | 0.733333 s | 0.666667 s | 0.884818 | 失败 |
| 15 | 43 | 0.766666 s | 0.733333 s | 0.884885 | 失败 |
| 30 | 42 | 0.733333 s | 0.733333 s | 0.949064 | 通过 |
| 30 | 43 | 0.766666 s | 0.733333 s | 0.895879 | 失败 |

两次第 90 帧的纯蓝第二轨 SSIM 均为 `0.996497`，因此全局裁图/缩放并未让所有帧失败。30 fps 素材在第 42 帧通过、第 43 帧失败，说明问题不只发生在混合帧率。第 43 帧的 `seeked` 已触发，随后 `presentedFrames` 增加且回调报告 `mediaTime=0.733333`；等候 600 ms 后截图仍是该画面，因此“尚未等到解码完成”也不足以解释该样本。

**断裂边界：** 本地固定版本的 `remotion` 中，预览 `VideoForPreview` 使用原生 `<video>` 并按时间线帧设置媒体时间；导出 `OffthreadVideoForRendering` 按时间请求 compositor `ExtractFrame`。两条路径已经在同一时间线位置选出不同的实际画面。此证据定位了偏差发生在解码/取帧边界，但尚未证明 compositor 对所有 CFR/VFR 媒体的具体舍入规则。仅给播放条增加等待、比较 `currentTime`、或对 15 fps 单一素材加固定帧偏移，都不足以关闭 R2；把导出退回原生 `<video>` 还需独立证明不损害源入点和帧准确性，不能为迎合截图门槛直接替换。

后续修复应保持精确导出路径，给暂停/逐帧预览提供与导出一致的取帧结果，并在连续拖动时以工程版本和目标帧作失效键，避免旧异步结果覆盖新帧。播放中的流畅预览可单独处理。验收至少复跑 15/30 fps、逐帧往返拖动、源入点、VFR 素材、字幕/画面叠层及默认 GPU 截图；只对当前两帧通过不能声明 R2 完成。

复现命令（在仓库根目录，先完成 `cd app; npx electron-vite build`，无需打包）：

```powershell
$env:LINGJI_R2_SOURCE_FPS = '30'
node app/scripts/smoke-editor-multitrack-win.cjs
node app/scripts/check-editor-preview-export-parity-win.cjs '<上一步输出的 runDir>'
```

30 fps 隔离工程：`data/runtime/validation/r2-multitrack-1790541037056/`；15 fps 工程：`data/runtime/validation/r2-multitrack-1790538031552/`。实际输出文件只保留在 Git 忽略目录。`r2-parity-source30-presented.log` SHA-256 `E4D54A269DE732E1D474CE1362A88BA293A1E4DF552850FA7E179144992FD65B`；`r2-parity-source15-presented.log` SHA-256 `5EB1846F7D11BE0FF2B260AEC571827B5F5B6F91004D88B1FA76FFFF50BBDCE1`。两个脚本 `node --check` 与 `git diff --check` 均通过。严格比对对两种源帧率均退出 1，这是预期的失败门槛，不能计入通过项。

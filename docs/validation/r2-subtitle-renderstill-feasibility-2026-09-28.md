# R2 字幕叠层静帧路径离线复测（2026-09-28）

在用户“先测试、不打包”的范围内，[精确静帧探针](../../app/scripts/probe-r2-renderstill-win.cjs)扩展为可读取项目内的隔离 SRT，并调用产品 `parseSrt` 将字幕条目传入同一个 Remotion composition。此变更只扩展测试脚本；编辑器预览和导出业务代码未修改，输出留在 Git 忽略的 `data/runtime/validation/`。

先在当前 Windows 源码环境重跑 `node app/scripts/smoke-editor-subtitle-win.cjs`：SRT 导入、保存重开、三个预览时点、H.264/AAC 导出和字幕像素检查均通过，页面异常 0。隔离工程为 `r2-subtitle-1790543983040/`，蓝底视频为 15 fps；SRT 有 0.5–2.2 秒和 2.3–2.9 秒两条自写字幕。然后执行：

```powershell
node app/scripts/probe-r2-renderstill-win.cjs data/runtime/validation/r2-subtitle-1790543983040
node app/scripts/probe-r2-renderstill-win.cjs data/runtime/validation/r2-multitrack-1790538031552
```

| 时间线帧 | 画面状态 | `renderStill` 对导出 MP4 对应帧的整幅 SSIM |
| ---: | --- | ---: |
| 6 | 字幕前 | 0.999604 |
| 36 | 第一条字幕显示 | 0.998786 |
| 78 | 第二条字幕显示 | 0.999139 |
| 96 | 字幕结束后 | 1.000000 |
| 36，返回 | 第一条字幕显示 | 0.998786 |

五帧均 ≥0.92，脚本退出 0；原双轨 15 fps 工程的四帧回归也退出 0，SSIM 仍为 `0.984303`、`0.984149`、`0.999999`、`0.984303`。这证明候选静帧路径能在该短 SRT 样本上复现导出字幕叠层，不能证明当前编辑器 UI 已采用该路径，也未覆盖 AI Motion Card、长节目字体、真实录屏或默认 GPU 的严格逐帧截图。产品 UI 的既有视频选帧失败仍需单独修复。

本机日志 SHA-256：`r2-subtitle-current-baseline-2026-09-28.log` 为 `C56F5429A14CAD22EF251C9091952B6E4A85E8F71C90875E4A567CEE14D4C6EF`；`r2-subtitle-renderstill-probe-2026-09-28.log` 为 `8CEFF5C9F2654DAFBB18CAB190EEE7638521AA1F7AA0E53BB753F5CC599FEB15`；`r2-multitrack-probe-after-subtitle-extension.log` 为 `A7809F43AF4BCBDA07378397F0E542595597FC824C3B55EF8D51106B0A7FC16D`。

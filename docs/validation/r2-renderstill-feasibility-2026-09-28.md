# R2 精确暂停帧路径离线探针（2026-09-28）

本探针以产品源码 `77efc458f8f11d0ea0483a6dc61a0d359a4f7329` 为基准。用户要求先测试、暂不打包；本轮没有修改编辑器预览或导出实现，没有连接真实账号、读取真实直播录屏或发布。输入是已有的隔离合成工程，输出留在 Git 忽略的 `data/runtime/validation/`。

[呈现帧诊断](r2-presented-frame-diagnosis-2026-09-28.md)已证明：当前 UI 使用原生 `<video>` 预览，导出使用 `OffthreadVideo`；`seeked` 完成后，浏览器实际呈现的 `mediaTime` 仍可能与导出选帧不同。为验证能否共用导出取帧路径，[探针脚本](../../app/scripts/probe-r2-renderstill-win.cjs)把隔离工程的素材通过 Remotion `publicDir` 提供，复用一个无头浏览器，调用同一 `lingji-composition` 的 `renderStill()`，再与已导出的 H.264 MP4 对应帧计算整幅 1280×720 图像 SSIM。测试帧为 42、43、90、42；最后重复 42 检查返回拖动的稳定性。合成工程时间线为 30 fps、1920×1080，导出为 1280×720；第 42、43 帧位于裁切后的主视频，第 90 帧为第二轨纯蓝画面。SSIM 门槛沿用 R2 严格脚本的 `0.92`。

| 源素材 | 帧 | 当前 UI 预览对导出 SSIM | `renderStill` 对导出 SSIM | 复用浏览器的单帧耗时 |
| --- | ---: | ---: | ---: | ---: |
| 15 fps | 42 | 0.884818，失败 | 0.984303，通过 | 609 ms |
| 15 fps | 43 | 0.884885，失败 | 0.984149，通过 | 600 ms |
| 15 fps | 90 | 0.996497，通过 | 0.999999，通过 | 704 ms |
| 15 fps | 42，返回 | 未测 | 0.984303，通过 | 555 ms |
| 30 fps | 42 | 0.949064，通过 | 0.984136，通过 | 703 ms |
| 30 fps | 43 | 0.895879，失败 | 0.984034，通过 | 694 ms |
| 30 fps | 90 | 0.996497，通过 | 0.999999，通过 | 722 ms |
| 30 fps | 42，返回 | 未测 | 0.984136，通过 | 603 ms |

15 fps 工程的 bundle、启动浏览器、选择 composition 分别约为 2.12 s、0.59 s、0.34 s；30 fps 工程分别约为 2.35 s、0.55 s、0.37 s。未复用浏览器的初始探针中，每帧约 1.16–1.24 s。耗时来自本机两次隔离运行，不是普适性能保证，也不等于 Electron UI 的首帧或拖动延迟。`renderStill` 和 MP4 存在编码差异，因此这里比较相似度而非要求像素完全相等。

**结论边界：** 同一 Remotion composition 的离线静帧输出，在已测 15/30 fps、裁切入点、两轨遮盖和返回拖动场景，显著接近导出帧，足以支持“暂停/逐帧时走导出取帧路径”这个候选修复方向。当前产品 UI 仍沿用原生 `<video>`，严格预览门槛仍是红色；探针通过不能表述为编辑器预览已修复。将来接入 UI 时，需要缓存 bundle / 浏览器、按工程版本和目标帧使过时请求失效，并继续保留播放中的流畅预览。约 0.6 s 的单帧耗时需要以连续拖动产品测试评估。可变帧率、字幕/卡片叠层、默认 GPU 路径、打包态和真实素材尚未通过该探针，不能外推。

复跑命令（Windows；先用 `smoke-editor-multitrack-win.cjs` 生成对应隔离工程并完成源码构建）：

```powershell
node app/scripts/probe-r2-renderstill-win.cjs data/runtime/validation/r2-multitrack-1790538031552
node app/scripts/probe-r2-renderstill-win.cjs data/runtime/validation/r2-multitrack-1790541037056
```

两个命令均退出 0，所有探针帧 ≥0.92。15 fps 的 `probe-renderstill-result.json` SHA-256 为 `72202E7B03ECD815DB85BA09D788E65E83EA8522F18FADD3F5CC37E432AE9BE2`；30 fps 的为 `6FF0D25C266585BBCC219A494C56816087C5FE139F6952EDECBB296B615C58F6`。原始 UI SSIM 来自[呈现帧诊断](r2-presented-frame-diagnosis-2026-09-28.md)，两组证据没有混作同一个产品验收结果。

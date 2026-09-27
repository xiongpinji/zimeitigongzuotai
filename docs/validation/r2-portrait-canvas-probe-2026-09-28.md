# R2 竖屏画布隔离探针（2026-09-28）

本轮只测试 Windows 源码构建，不打包、不读取真实录屏、不登录或发布。给[双轨桌面冒烟脚本](../../app/scripts/smoke-editor-multitrack-win.cjs)增加可选 `LINGJI_R2_CANVAS_KIND=portrait`：先按原 UI 新建工程、导入两段合成 MP4、分割、撤销/重做并保存；**关闭应用后仅在隔离工程的 `project.json` 中**把时间线尺寸改为 1080×1920，再由桌面应用重开、预览和导出。默认分支仍是 1920×1080。该方法只检验现有竖屏数据和渲染链，不替代剪辑台画幅切换操作。

```powershell
$env:LINGJI_R2_CANVAS_KIND = 'portrait'
node app/scripts/smoke-editor-multitrack-win.cjs
node app/scripts/check-editor-preview-export-parity-win.cjs data/runtime/validation/r2-multitrack-1790545888454
node app/scripts/probe-r2-renderstill-win.cjs data/runtime/validation/r2-multitrack-1790545888454
```

| 检查 | 隔离竖屏结果 |
| --- | --- |
| 桌面双轨冒烟 | 退出 0；3 个片段、2 条画轨；重开后预览区域 113×200 CSS 像素，页面异常 0。 |
| 视频导出 | 完整解码通过；FFprobe 为 H.264 720×1280 加 AAC。 |
| 产品原生预览对导出 | 第 42、43、90 帧 SSIM 为 `0.884854`、`0.882321`、`0.978787`；前两帧低于 0.92，严格门槛退出 1。 |
| 独立 `renderStill` 对导出 | 第 42、43、90、返回 42 帧 SSIM 为 `0.992599`、`0.992466`、`0.999828`、`0.992599`；探针退出 0。 |

原严格脚本只按横屏视频元素裁剪，视频元素超出竖屏画布时会产生越界裁剪参数；本轮调整为竖屏比较完整画布截图，横屏仍沿用原视频元素裁剪。默认横屏冒烟重跑退出 0，导出 1280×720；严格比对第 42、43、90 帧仍为 `0.884818`、`0.884885`、`0.996497`，按设计退出 1。这是测试工具适配，不是产品预览修复。

竖屏证据在 Git 忽略的 `data/runtime/validation/r2-multitrack-1790545888454/`，横屏回归在 `r2-multitrack-1790546038548/`。本测试证明渲染底层能处理已存在的 9:16 工程，**没有证明**编辑器可以让用户切换画幅、旧图层能自动重排成合适的竖屏构图、真实录屏表现或 R2 整体验收。画幅 UI 缺口见[封面与画幅记录](r2-cover-aspect-source-test-2026-09-28.md)，原生预览逐帧一致性仍未通过。

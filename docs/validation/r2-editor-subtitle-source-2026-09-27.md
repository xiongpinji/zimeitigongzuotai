# R2 字幕预览与导出源码验收（2026-09-27）

用户要求先测试、暂不打包。本轮在主库 28822bc 的基础上，使用 Windows、Node v22.23.3 直接执行 electron-vite 源码构建，再运行 `app/scripts/smoke-editor-subtitle-win.cjs`。脚本仅在 Git 忽略的 `data/runtime/validation/` 下生成 3 秒蓝色视频、两条自写 SRT、独立工程和 Electron profile。测试进程将原生目录及 SRT 文件选择器固定指向该隔离工程；素材扫描、拖入轨道、字幕解析、工程保存重开、预览和导出走产品界面与实际 IPC。没有使用真实录屏、账号或平台接口。

| 检查 | 本机结果 | 边界 |
| --- | --- | --- |
| 字幕导入与持久化 | 界面扫描到视频和 SRT 两项；视频拖入轨道后，经“口播资源”导入 SRT。工程保存 `srtPath` 和末条结束时间 2900 ms，关闭重开后预览仍显示首条字幕。 | 原生文件弹窗由测试进程返回隔离路径；未覆盖弹窗手工选择、坏文件或路径迁移。 |
| 预览时点 | 0.2 秒首条未出现，1.2 秒首条出现，3.2 秒末条已消失。 | 两条短合成字幕；不代表长节目同步精度。 |
| 导出字幕 | UI 导出 MP4，FFmpeg 完整解码退出 0；H.264 1280×720 + AAC、3.712 秒、93,823 字节。导出画面下部的高亮像素数在 0.2/1.2/2.6/3.2 秒分别为 0/2517/1733/0；抽帧人工确认字幕文字出现。 | 像素计数是蓝色纯底上的字幕存在性检查，不是 OCR 或逐帧预览/导出一致性证明。 |
| 字体一致性 | 首轮人工对照发现预览为无衬线、导出为衬线。字幕组件原先未指定字体，导出页面不继承 App 的字体栈。给字幕文本显式设置与 App 相同的字体栈后，重新导出的抽帧与预览均为无衬线字形。 | 字形已对齐，但截图与视频仍有已观察到的颜色偏移；尚不能宣称逐像素一致。 |

先写的 `remotion-subtitle-layer.test.tsx` 在修复前 **1/1 失败**，指出独立导出页缺少字幕字体声明；修复后该测试通过。最终定向测试 7 个文件 **48/48 通过**，`tsc --noEmit --project tsconfig.json`、`electron-vite build`、`node --check app/scripts/smoke-editor-subtitle-win.cjs` 均退出 0。重新编译后的 UI 字幕烟测退出 0，页面错误为空；隔离 profile 对应的 Electron 残留进程为 0。没有运行默认全量 Vitest 或制作安装包。

最终日志位于 `data/runtime/validation/r2-subtitle-after-fix.log`（SHA-256 `1973470DA218C835CFB9B54521972A30617437BB5E6FBD2AAB70FB1DCD0AAC76`）；隔离工程位于 `data/runtime/validation/r2-subtitle-1790508698279/`。其中 `project/project.json` SHA-256 为 `889DB23ADA4CD225013FA23D7F48034BADEF7E99C5383EFD7E408E1A9F16104F`，`project/project.mp4` SHA-256 为 `D577682F9E8DABA940D9605AB6701DEEEF3A7D1EB67F8A4AF3C250A7E929E82E`；预览截图和导出抽帧分别为 `preview-after-reopen.png`、`export-1.2s.png`。

本轮补上 R2 的短合成素材 SRT 导入、预览、重开与导出证据。封面、画幅切换、长素材、异常恢复及严格预览/导出颜色一致性仍需单独验收；用户要求的真实授权直播切片质量和平台发布也不由本项推定。

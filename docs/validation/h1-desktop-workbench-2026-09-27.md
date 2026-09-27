# 直播高光桌面接线源码验证（2026-09-27）

用户要求先测试、暂不打包。本次基于 `297769b` 将高光控制器接到 Electron 主进程、preload 和“直播高光”工作区。录屏目录、文件、Node.js 与另行安装的 HotClip 均由系统对话框选择；Renderer 只能收到文件名、任务摘要和候选，无法通过此桥传入任意本地路径。运行须显式提供模型配置并确认可能下载本地模型。候选始终标记为待人工审核，不自动生成视频或发布。

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| IPC + UI + 页面过渡聚焦测试 | 3 文件、10/10 通过；包含预期 RED 后的目录错配、失效选择清除与授权门槛 | 合成文件、假侧车；校验 IPC 白名单、路径不回传、队列状态和候选展示。 |
| 默认 `vitest run --reporter=dot` | 382/382 文件通过，2878 项通过、4 项按平台条件跳过 | 最终源码自动化回归；完整日志在忽略目录 `data/runtime/validation/highlight-ui-full-vitest-final.log`，SHA-256 为 `9D1F7E2051494B2E83646908FB12B368A12061D38F55E8999A16020AC8BF395F`。 |
| `tsc --noEmit` 与 `electron-vite build` | 均退出码 0 | 主进程、preload、Renderer 的类型与源码构建；没有执行打包脚本。构建日志在忽略目录 `data/runtime/validation/highlight-ui-source-build.log`。 |
| 隔离 `userData` 的 Electron 源码冒烟 | 通过；真实 main/preload/renderer IPC 导入 1 个合成录屏，假侧车完成 1 个候选并回读 `reviewRequired: true`；页面异常 0 | 仅证明桌面接线和持久任务路径。假侧车不调用真实 HotClip、ASR、LLM、网络或平台。结果在忽略目录 `data/runtime/validation/electron-highlight-ui-smoke.json`。 |

测试没有制作安装包，没有连接真实平台账号、发布视频或挂载商品。没有用户授权的真实直播录屏，也没有进行高光质量、切片成片和叙事独立性的盲审；因此 R3 / H1-S3 仍未验收。HotClip 的 AGPL 分发边界仍须在未来打包前审查。现有工作区可查看候选时间码，但人工调边、切片渲染和候选接入独立剪辑台仍属后续产品任务。

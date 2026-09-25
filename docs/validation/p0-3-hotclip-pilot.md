# HotClip 隔离试验（P0-3 进行中）

2026-09-25 在仓库外的参考副本测试 [HotClip](https://github.com/xixihhhh/hotclip) 固定提交 `62aef3919fdd7d8a974f80a9b721e0177eb408c2`，版本 `0.32.0`。主库和当前 Windows 安装包**没有**包含 HotClip 源码、模型或运行包。测试素材是本机用 FFmpeg 生成的 6 秒视频及两句自写 SRT，不涉及用户录屏、真实账号或云端 LLM。

| 检查 | 本机结果 | 证据边界 |
| --- | --- | --- |
| 来源与许可 | `package.json` 声明 `AGPL-3.0-only`，根 `LICENSE` 为 AGPLv3；CLI、stdio MCP、Agent Skill 均存在。 | 固定 SHA 的源码证据；不等于允许直接并入 Apache-2.0 桌面包。 |
| 依赖 | Windows `pnpm 12.4.2` 的首次 `pnpm install --frozen-lockfile` 因忽略构建脚本报 `ERR_PNPM_IGNORED_BUILDS`；仅在仓库外参考副本显式批准 `ffmpeg-static`、`esbuild`、`onnxruntime-node`、`electron-winstaller` 后安装退出码 0。 | 参考副本环境，不改变主库锁文件。 |
| CLI 输入输出 | `transcribe <video> --subtitles <srt> --json` 退出码 0，返回 `engine=subtitle-srt`、`durationSec=6`、2 段及估算的逐词时间；未下载 ASR 模型。 | 验证字幕导入、时间码和 JSON 通路；**没有**验证自动语音识别或高光质量。 |
| MCP 输入输出 | 真实 stdio 进程对 `initialize` 返回 `hotclip 0.32.0`；`tools/list` 返回 `clip_video`、`detect_highlights`、`transcribe_video`；`transcribe_video` 对同一素材返回两句，`isError=false`。 | 验证协议启动和一个工具调用；没有验证长任务取消/恢复。 |
| 超时、取消、资源占用 | CLI 对 `transcribe/highlights/clip` 的入口源码注册 `SIGINT/SIGTERM → AbortController`；MCP 协议层仅忽略 `notifications/*`，没有单次工具调用取消句柄。 | 尚未用长录屏做故障注入和资源测量；不能宣称 P0-3 完成。长任务优先用独立 CLI 子进程，由本项目管理超时、进程树取消和任务恢复。 |

HotClip 的 `--max-clips` 在当前 CLI 源码被限制在 1–12；它处理一个输入视频，不是本项目要求的多录屏批量调度器。高光检测和自动出片仍需 LLM 配置、代表样本与负样本、首轮模型/磁盘/内存消耗及时间码质量验收。MCP 工具描述里的“素材不出电脑”只适用于视频本体；若配置云端 LLM，转写文本和相关请求仍可能出机，接入 UI 必须明示。

分发边界尚未获得法律验收。GNU 的 [GPL FAQ 关于插件与独立进程](https://www.gnu.org/licenses/gpl-faq.en.html#GPLPlugins) 指出，独立进程及 IPC **本身不足以**决定是否构成一个组合作品，还取决于交换数据的语义；因此当前只研究可选、用户另行安装的 HotClip 进程协议，不把 AGPL 源码复制进主库或打包进 Apache-2.0 安装包。正式分发前需对拟采用的协议和安装方式单独审查；若不适合分发，沿相同高光任务接口使用许可证可接受的替代实现。

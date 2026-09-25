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

## Sidecar 进程边界适配器（2026-09-25）

新增 `app/electron/highlights/hotclip-sidecar.ts`：一个**可选、可替换**的子进程边界，导出 `runHotClipHighlights`。它按上表 CLI 通路调用用户**另行安装并显式配置**的 HotClip `highlights <video> --json [--subtitles SRT] [--max-clips 1..12]`，只走 stdin/stdout/exit-code 协议，不 import、不复制、不打包、不依赖 HotClip 源码。主库与安装包仍不含 HotClip 代码、模型或运行包。

设计要点（源码可见级证据）：

- **无静默执行**：`executable` 必填、无默认值；缺失时以 `executable_missing` 拒绝，绝不下载或执行任何内置副本。
- **显式子进程环境**：`spawn(..., { shell: false })`，env 由「固定 OS 最小 allowlist（PATH/HOME/SystemRoot 等）」+「调用方逐项批准的键值」构成；`process.env` 中其余键（可能含本应用凭证）一律不转发，并拒绝 `NODE_OPTIONS`/`LD_PRELOAD`/`ELECTRON_RUN_AS_NODE`/`DYLD_INSERT_LIBRARIES` 等注入向量。Windows 特例：本机 Windows Node 22 实测，子进程 env 缺少 `PATH` 时 libuv 会自动补全**父进程 PATH**；因此 `inheritBaseEnv: false` 时 win32 分支显式写入 `PATH: ''`，使子进程 PATH 为空、无法检索父进程目录。系统仍会注入少量非敏感 OS 变量（实测有 `SystemRoot`），该选项的准确语义是「不转发本应用基础 allowlist 与敏感变量」，不是「Windows 上完全零继承」。
- **有界资源**：`timeoutMs` 必填正数；stdout/stderr 各自有字节上限（默认 4 MiB），超限即终止子进程树。
- **进程树终止**：超时 / 取消 / 超限都会终止整棵子进程树——Windows 用固定 argv 的 `taskkill /PID <pid> /T /F`（无 shell），POSIX 用 detached 进程组 + 负 PID 组信号，并在宽限期（默认 2 s）后升级 SIGKILL；Promise 恰好 settle 一次，避免 `error`/`close` 竞态。
- **输出校验**：只接受 JSON 数组；对每条候选校验字段类型与时间（拒绝 NaN、负值、`endSec <= startSec`）；退出码 0 + 空 stdout 视为合法的**零候选**并返回 `[]`，保留低高光负样本；非零退出为失败。秒→毫秒用 `Math.round(sec*1000)`，同时保留原始 `startSec/endSec`。
- **脱敏错误**：机器可读 `code`（`invalid_options`/`executable_missing`/`spawn_failed`/`timeout`/`cancelled`/`nonzero_exit`/`output_too_large`/`invalid_output`）；错误消息只含静态描述与数值度量，**绝不**含 API key、转写文本、原始 stderr 或完整文件路径（连 Node 的 ENOENT 消息都被替换，因其携带路径）。
- **不做语义越权**：返回的是高光**候选**投影，上游 `recommended` 仅为启发式建议，不是本项目发布批准，也不构成任何平台「原创」判定；未自动映射到 `HighlightV1`——写入契约需另补录屏 `sourceSha256` 来源追溯并经人工独立评审。

证据边界与限制：配套 `app/tests/highlights/hotclip-sidecar.test.ts`（47 项）用本机无害的 Node 假子进程覆盖合法输出、空/纯空白输出、非数组、畸形 JSON、非法时间、非零退出、stdout/stderr 超限、超时、取消、**`spawn` 返回句柄前同步取消（abort 监听器竞态）**、SIGTERM 被忽略时的 SIGKILL 升级、孙进程无孤儿，以及 argv/cwd/env 白名单与错误脱敏；这属于**合成进程证据**，只证明本适配器的进程边界协议，**不等于**真实 HotClip 长录屏任务下的超时、取消与资源占用行为，后者仍未测（见上表最后一行）。

- 2026-09-25 复审修复后，在本工作树用 Windows Node 22.23.3 + 项目原版 Vitest 2.1.9 实跑：`node.exe ./node_modules/vitest/vitest.mjs run tests/highlights/hotclip-sidecar.test.ts` 退出码 0，**47/47 通过**（全量复跑两次一致）；`node.exe ./node_modules/typescript/bin/tsc --noEmit` 退出码 0。测试进程实际运行在 Windows，因此新增的「`spawn` 返回前同步取消」集成用例真实走过 Windows `taskkill /PID <pid> /T /F` 终止路径，并断言子进程 PID 消失；POSIX 负 PID 组信号杀树路径本轮未在 Linux 复跑，仍是未验证边界。
- 环境变量实测（Windows Node 22.23.3）：子进程 env 不含 `PATH` 时，子进程实际看到父进程完整 PATH；显式 `PATH: ''` 时子进程 PATH 为空；`SystemRoot` 由系统注入；`LINGJI_TEST_SECRET_MARKER` 不转发。故 `inheritBaseEnv: false` 的文档语义限定为「不转发本应用基础 allowlist 与敏感变量」。
- 仍未验证：真实 HotClip 长录屏任务下的超时/取消/资源占用、`--max-clips` 之外的上游协议变化、自动语音识别与高光质量、正式分发前的 AGPL 法务审查。本适配器属合成进程级证据，不等于 P0-3 整体验收；上表「超时、取消、资源占用」一行仍未验收。

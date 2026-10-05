# HotClip 本地模型与真实进程试验（2026-10-05）

本轮只测试 P0-3 高光候选的本机进程链路。输入是 `data/media/synthetic/` 中被 Git 忽略的 120 秒 FFmpeg 测试画面、合成音和 12 句自写 SRT；画面/声音**不对应**字幕，预标注的高低光窗口只用于检查时间码和负样本，不构成高光质量标尺。没有真实直播录屏、账号登录、平台调用或发布。

HotClip 是 `data/tools/hotclip/` 中被 Git 忽略的用户本地参考副本，固定上游 `62aef3919fdd7d8a974f80a9b721e0177eb408c2`（0.32.0，AGPL-3.0-only）。主库只新增 `app/scripts/probe-hotclip-local-win.cjs`，调用现有 `hotclip-sidecar.ts` 的真实子进程边界；源码、模型、测试媒体、转写和原始诊断均不进入 Git 或安装包。分发许可闸门仍按 [P0-3 试验记录](p0-3-hotclip-pilot.md)保留。

## 本机结果

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| 上游字幕导入 | 真实 CLI `transcribe --subtitles --json` 退出 0，`engine=subtitle-srt`、120 秒、12 段。 | 证明字幕读取和时间投影；未跑自动 ASR。 |
| `qwen3:4b` 高光完整调用 | 本地 Ollama 0.35.1、独立端口 `127.0.0.1:11435`。默认 262144 上下文导致加载规模约 42 GB、runner 工作集约 39 GB，主动停止。重启并设 `OLLAMA_CONTEXT_LENGTH=8192` 后模型加载规模约 3.9 GB；真实 sidecar 以 `nonzero_exit` 返回。直接运行上游 CLI 的忽略目录诊断显示 **模型响应超时**（HotClip 本地 LLM 边界为 300 秒）。 | 高光候选**未生成**；不能算真实模型通过。当前模型/配置不适合该条链路的有界任务。 |
| `qwen3:4b-instruct` 高光完整调用 | 固定模型 ID `0edcdef34593`；直接 CLI 退出 0、给出 3 条候选，但 sidecar 首轮报 `invalid_output`。查明 HotClip 0.32.0 的 `HighlightCandidate.id` 与 CLI JSON 均为数字，本项目原解析器仅接受字符串。先补 RED 测试后，把非负安全整数规范化为十进制字符串；真实 sidecar 重跑退出 0，耗时 **53.881 秒**，返回 3 条候选：`30–60 s`（97 分、建议）、`80–90 s`（70 分、不建议）、`100–120 s`（50 分、不建议）。 | 真实模型 + 真实进程 + 本项目适配器链路通过；只证明合成样本的候选产生和时间码解析。首条跨入预标注的 `50–60 s` 低光区间，不能算质量通过。 |
| 真实 HotClip 子进程取消 | 探针 2 秒后取消，2.711 秒返回 `cancelled`。 | 使用真实 CLI 进程，证明取消边界；没有模型推理完成。 |
| 真实 HotClip 子进程超时 | 探针 1 秒限时，1.672 秒返回 `timeout`。随后检查无残留 `src/cli/index.ts highlights` 进程。 | 证明超时和子进程清理；不代表长录屏稳定性。 |
| sidecar 与相关回归 | 数字 ID 新测试先红后绿；Windows 高光模块 11 文件、163 通过、2 跳过；全量 412 文件、3040 通过、4 跳过、0 失败；类型检查与源码构建退出 0。 | 自动化契约和构建证据，与真实模型/人工复核分开。 |
| 合成素材复现 | `generate-hotclip-trial.cjs repro-20261005` 在新的忽略子目录实际生成视频、SRT 与预标注；`ffprobe` 为 120 秒，SRT 为 12 段。 | 只验证测试夹具可复现，不构成真实素材。 |

`qwen3:4b` 和后续非思考模型来自 [Ollama 的 Qwen3 模型列表](https://ollama.com/library/qwen3/tags)。模型权重下载到 `data/tools/ollama-models/`；LLM 请求只到本机回环地址。HotClip 可尝试下载可选的 YuNet/FER+ 辅助视觉模型到本机忽略目录，本轮已在隔离 `APPDATA` 观察到这两份文件，因此不能笼统宣称整个试验完全无网络访问。SRT 未发送到云端 LLM。

同一输入的直接 CLI 与 sidecar 重跑给出了不同候选时间码和建议标记；这属于模型输出波动，不能把单次合成结果当作稳定的高光质量或最终发布批准。需要已授权真实录屏、匹配的字幕、预先冻结的人工标签和独立盲审，才能验收召回率、误判率与切点质量。

## 复现边界

在项目根目录用 PowerShell 启动独立服务，并保证 11435 端口未被其他进程占用：

```powershell
$env:OLLAMA_HOST='127.0.0.1:11435'
$env:OLLAMA_MODELS=(Join-Path (Get-Location) 'data\tools\ollama-models')
$env:OLLAMA_CONTEXT_LENGTH='8192'
$env:OLLAMA_NUM_PARALLEL='1'
Start-Process -FilePath (Get-Command ollama).Source -ArgumentList 'serve' -WindowStyle Hidden
ollama pull qwen3:4b-instruct
node app/scripts/generate-hotclip-trial.cjs
node app/scripts/probe-hotclip-local-win.cjs
node app/scripts/probe-hotclip-local-win.cjs cancel
node app/scripts/probe-hotclip-local-win.cjs timeout
```

探针要求 HotClip 源码和依赖已在忽略的 `data/tools/hotclip/`。`generate-hotclip-trial.cjs` 在缺少测试素材时生成 120 秒视频、SRT 和预标注，不覆盖已有文件；可传一个短小写名称，在 `data/media/synthetic/` 下新建隔离子目录。探针本身不会自动安装 HotClip、下载 LLM 权重或生成素材。探针只将候选 ID、时间码、评分等安全摘要写入 `data/runtime/validation/`，失败仅记错误码和耗时；直接 CLI 的原始诊断只在忽略目录。本次复现不应被引用为用户素材的双人盲审、平台原创判定或 P0-3 整体验收。

本试验当时的产品批量高光控制器仍拒绝 `transcriptRef` 非空的任务；这里的 SRT 结果来自 sidecar 直连。随后已补用户选择、私有字幕快照、持久身份与运行前哈希复核，并实跑产品队列，见 [R3 产品 SRT 收据验证](r3-product-srt-receipt-2026-10-05.md)。两次试验的证据层级仍分别保留。

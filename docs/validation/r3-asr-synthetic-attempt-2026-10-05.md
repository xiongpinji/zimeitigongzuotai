# R3 无字幕自动转写：合成中文语音试验

2026-10-05，Codex 在 Git 忽略的 `data/media/synthetic/asr-speech-2026-10-05/` 用 Windows 本机 Huihui 中文语音和 FFmpeg 生成 30 秒 MP4，未使用用户录屏。HotClip 0.32.0 CLI 在隔离 `APPDATA` 下执行 `transcribe <video> --json`，没有传入 SRT、云端 LLM 凭证或真实账号。

CLI 默认使用 SenseVoice。首次运行从固定源码指定的归档下载到项目内忽略目录，最终归档大小为 **1,047,870,769 字节**，并解压出 `model.int8.onnx` 与 `tokens.txt`。下载期间的文件大小瞬时读数曾有明显波动，不能据此推断镜像重置；两次人为停止后，第三次在同一目录通过断点续传完成下载。

模型文件完整后，原始中文项目路径仍导致 sherpa-onnx 原生层报告 `tokens.txt does not exist`，尽管文件确实存在。HotClip 的 `toAnsiSafeDir` 试图转换 8.3 短路径，但本机的父目录 `AI编程库/项目库/进行中的项目` 仍保留中文。为验证识别引擎，Codex 临时将同一**项目内**的模型目录映射为纯英文 `W:\models` 并在隔离设置中指向它；模型物理文件没有搬到仓库外。试验结束后已删除临时设置并撤销 `W:` 映射。

在该临时路径条件下，CLI 产出 `data/runtime/validation/r3-asr-synthetic-2026-10-05/transcript-ascii.json`：`engine=sensevoice-local`、`language=zh`、30 秒、7 句、119 个词元，带时间码。合成原文中的“复核字幕时间”被识别成“复合字幕时间”，重复音频末尾也被截断；因此这里只证明**本地 ASR 可执行并产生时间化转写**，不证明识别准确率或真实直播高光质量。

随后用同一物理模型、临时 ASCII 路径、本机 `qwen3:4b-instruct` 和无 SRT 的 30 秒合成录屏，运行真实产品高光队列：先导入任务并关闭、重开队列，再由产品调度器启动真实 HotClip。`data/runtime/validation/highlight-product-asr-1791177500969/result.json` 记录 `completed`、**67.602 秒**、1 条候选（7.38–21.36 秒、97 分）；隔离的 sidecar 转写缓存保存 `engine=sensevoice-local`、7 句。该试验使用假单实例宿主与真实产品队列/真实 CLI，不等于真实 Electron 页面加模型的全链路。没有自动批准或发布候选。

产品在中文项目目录内直接使用该模型的路径限制仍待解决；不能把临时盘符当成面向用户的长期安装方案。后续还需授权真实录屏、事先标注和双人盲审。临时 `W:` 映射和本机模型服务均已停止，模型与结果留在项目的 Git 忽略目录。没有打包、登录或发布。

本轮只扩展本地联测脚本的无 SRT 分支，没有修改产品运行时；高光导入、控制器和 sidecar 三个相关测试文件 **70/70** 通过，TypeScript 类型检查退出 0。此前的源码构建结果按 [产品 SRT 验证](r3-product-srt-receipt-2026-10-05.md)保留，本轮没有重复全量回归或制作安装包。

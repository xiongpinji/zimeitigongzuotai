# R3 Windows 中文路径下的本地 ASR 接线验证

2026-10-05，项目目录含中文且磁盘未为全部父目录生成 8.3 短名称。HotClip 0.32.0 默认的 SenseVoice 原生识别库因此无法直接打开已存在的 `tokens.txt`。产品现在在 Windows 上为隔离的 HotClip 数据目录建立稳定的纯 ASCII junction，并把该入口作为子进程的 `APPDATA`。模型、缓存、录屏和候选产物的物理文件仍在原来的本地数据目录；不会复制约 1 GB 的模型。已有入口只有指向同一物理目录时才复用，冲突时在任务领取前返回 `model_path_unavailable`，不会覆盖其他目录。

验证分为三层：

1. 对项目内已下载模型和 30 秒合成中文语音 MP4，使用英文 junction 和 `--restart-transcription` 强制重做识别，CLI 退出 0。结果存于忽略目录 `data/runtime/validation/r3-junction-probe/`；这排除了仅命中旧转写缓存的情况。
2. 产品队列试验 `data/runtime/validation/highlight-product-asr-1791198850966/result.json`：无 SRT 导入、关闭并重开队列、由产品控制器自动建立英文入口、真实 HotClip CLI 自动转写、本机 `qwen3:4b-instruct` 生成候选。任务 `completed`，耗时 47.086 秒，得到 2 条待审核候选；新队列的转写缓存记录 `engine=sensevoice-local`、中文、30 秒、7 句、119 个词元。试验没有为 HotClip 写入外部模型目录设置，只有被忽略的本地模型目录链接用于复用同一份下载文件。
3. 高光模块 11 个测试文件：185 通过、2 跳过；控制器与 IPC 的路径复用、冲突、子进程实际环境均覆盖。Node TypeScript 类型检查退出 0。

这是合成素材与本机模型的源码/产品队列验证，不是已授权真实直播录屏的高光质量验收，也不是完整 Electron 页面交互、平台账号或最终发布结果验收。HotClip 是另行安装的 AGPL 组件，仍不纳入本仓库源码或安装包。当前没有打包、登录真实账号或发布。

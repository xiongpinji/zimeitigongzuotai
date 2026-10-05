# R5 定向高光执行：本地真实模型合成试验（2026-10-05）

在原有产品高光探针增加 `--selected` 模式：把两个项目内合成录屏排入同一可恢复队列，关闭并重开队列，然后只把第一个任务 ID 交给控制器的 `runSelected`。使用 Git 忽略的 `data/tools/hotclip/`（固定上游 0.32.0）和 `data/tools/ollama-models/` 中已有的 `qwen3:4b-instruct`；LLM 入口为本机回环地址。试验结束后停止本次启动的 Ollama 服务。脚本不连接真实账号，也不执行平台发布。

命令 `node ../data/tools/hotclip/node_modules/tsx/dist/cli.mjs scripts/probe-highlight-product-local-win.ts --selected` 退出 0。证据在 Git 忽略的 `data/runtime/validation/highlight-product-selected-1791182167017/result.json`：120 秒合成录屏在 71.927 秒后完成，产生 3 条候选（30–50、50–60、60–80 秒）；第二条任务仍为 `queued`。产品队列经重启恢复后运行，模型和真实 HotClip CLI 由现有来源复核、侧车与产物收据链路调用。这验证了“定向领取不误运行另一条任务”，不验证高光内容质量。输入字幕是自写 SRT，与测试画面和声音不对应；没有运行自动 ASR。

`npx tsc --noEmit` 通过。探针结果明确记录 `realRecordingTested=false`、`humanReviewTested=false`、`platformActionAttempted=false`。本轮只扩展忽略目录的本地验证脚本，没有打包或开放 Agent 的 `detect_highlights`。智能体模型运行仍需要当前工程任务绑定核对、单独授权和用户配置的模型参数；真实两小时录屏、低高光对照与双人盲审继续待验收。

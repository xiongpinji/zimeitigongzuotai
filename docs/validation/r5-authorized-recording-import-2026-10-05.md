# R5 已授权录屏导入：离线验证（2026-10-05）

本轮将录屏导入接到独立的生产 MCP。`lingji_production_import_recordings` 只接受 `maxClips`（1–12），仅消费桌面文件选择器为当前工程选中的本地录屏，计算源哈希并写入可恢复高光队列。工具不接收文件路径，不运行高光模型，不生成或发布视频；返回任务 ID、源哈希和队列状态，不返回媒体路径。导入任务与源哈希的工程绑定写在 Git 忽略的 Electron `userData/production-v1/activities.json` 中。

设置页新增单独的 30 分钟录屏导入授权，须由当前窗口发起并通过原生确认；授权也包含质检和已授权素材检索，但没有账号、平台或自动发布额度。无授权、仅质检、仅分析、跨工程、过期、撤销、重复消费都拒绝。导入在文件哈希完成后、队列写入前再次检查授权、工程及选择版本；授权读取失败时关闭。导入后再检查当前工程，才写入工程绑定。进程重启后可从私有活动存储恢复绑定。

按高风险改动流程，先写失败测试再接线。最终聚焦测试为 6 文件、29 项通过；`npx tsc --noEmit`、`npm run build`、`git diff --check` 均退出 0。低并发全量回归 `npx vitest run --maxWorkers=2 --minWorkers=2` 为 413 文件通过、3058 项通过、4 项跳过、0 失败。最后的路径规范化与注释调整后，再跑的聚焦测试和类型检查同样通过；全量回归完成于这些微调之前。

隔离桌面进程探针 `node scripts/smoke-production-mcp-win.cjs --prepare-token-fixture` 在最终源码构建后退出 0，证据保存在 Git 忽略的 `data/runtime/validation/r5-mcp-1791180853442/`。它以合成 `.mp4` 文件模拟系统文件选择，验证原生确认、四个生产工具、无授权和较低权限的拒绝、导入成功、再次导入和撤销后拒绝，以及私有绑定不泄漏路径。探针报告 `syntheticRecordingImport=true`，`modelInvoked=false`，`publicationAttempted=false`，`productionAcceptanceTested=false`。

这关闭的是 R5 的“当前工程已选录屏 → 授权队列导入”接线，并非 R5 整体验收。下一段高光执行不能直接对全局队列运行：必须先提供按工程已绑定任务限定的执行入口，再接候选审核、授权素材匹配、时间线、渲染、质检和普通发布。真实版权材料、高光模型结果、两小时录屏盲审、真实账号和平台最终状态均未验证。本轮未打包。

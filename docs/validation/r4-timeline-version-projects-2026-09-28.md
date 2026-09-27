# R4 任务 4：可编辑时间线与独立版本工程离线验证

**源码基准：** `8bd9199`（包含 `8da84c9` 的时间线、版本工程及合成渲染脚本，另补充损坏时间线拒绝）。**范围：** 源码和合成媒体；未打包、未连接真实账号、未调用平台发布、未以平台“原创”认定为测试结论。

## 已验证

| 项目 | 结果 | 证据边界 |
| --- | --- | --- |
| 测试先行 | 两个聚焦测试先因缺少模块失败，新增实现后转绿 | 失败是模块不存在，不代表曾有可运行行为回归。 |
| R4 聚焦测试 | `npx vitest run tests/composition-timeline-builder.test.ts tests/composition-version-projects.test.ts`：13/13 通过 | 对齐源入点、视觉轨顺序、原声长度、文字图层、比例、三版独立工程、主工程字节不变、重开哈希、改动冲突、损坏与符号链接路径。 |
| 全量 Vitest | 最新源码低并发运行：2972 通过、4 跳过、0 失败；JSON 结果在被 Git 忽略的 `app/data/runtime/validation/r4-vitest-full-final.json` | 首次默认并发全量运行有 1 条无关 UI 用例 60 秒超时（2970 通过、4 跳过）；该文件单独复跑 10/10 通过，低并发全量连续两次通过。不能称默认并发运行完全稳定。 |
| 类型检查 | `npx tsc --noEmit` 通过 | 针对补充损坏时间线校验后的源码。 |
| 源码构建 | `npx electron-vite build` 通过 | 只构建 Electron/前端源码；没有执行安装包或发行物打包。 |
| Remotion 实际渲染 | `node scripts/smoke-r4-composition.cjs` 通过；输出 SHA-256 `5d7ad3675bf1a744718ba2f88bec4dd49b80a54b183d9d7265d72fca5fb56d9e` | 合成 MP4 经时间线 builder 和 Remotion 渲染。主画面/B-roll/返回主画面的采样 RGB 依次为 `[253,1,0]`、`[1,127,1]`、`[253,1,0]`；覆盖期间原声音频平均电平 `-24.1 dB`。原始媒体与输出留在项目内被忽略目录 `app/data/runtime/validation/r4-composition-ZySPx2/`。 |

生成的时间线把已审切片画面放在 `visual-1`，同源原声放在 `audio-overlay-1`，两者使用相同起点、长度和 `trimStartMs`；B-roll 放在更高的 `visual-2`，可编辑开场/结尾文字放在 `visual-3`。缺少经过核验的配音媒体时，`narration` 和 `mixed` 计划会明确拒绝，不会被静默当作原声版。五种画幅比均有确定像素尺寸。

每个版本写入当前项目的 `compositions/<batch-id>/<plan-id>/`，含普通 Lingji `project.json` 和 `composition-manifest.json`。先在同批次临时目录写完整文件，再提交版本目录；同名内容一致可重试，内容不同拒绝覆盖。来源收据、录屏/切片和素材哈希保存在清单中。合法的手工时间线改动在重开时以 `timelineModified` 暴露，后续渲染必须要求重新审片和重新调用来源解析；本任务不把存储的旧授权快照当成永久授权。

## 尚未通过的验收

`claude-bailian=qwen3.8-max` 在读取任务前返回百炼月额度 429，没有候选差异。`opencode-bailian=.../deepseek-v4.1-flash` 约 10 分钟无输出、无差异后取消。`qwen-code-review=glm-5.3` 在读取固定 SHA 前同样返回 429，**外部只读审查未完成**。三个 job 的执行状态保存在 Agent Orchestrator；不能把 Codex 自检写成 GLM 审查通过。

本轮没有已授权的真实直播录屏或商品/平台账号样本，真实高光质量、真实素材授权再次核验、实际多账号发布、平台最终状态和“原创”判定均未验证。R4 任务 5 仍须在每版渲染前再次运行 `resolveCompositionSources`，并实现批量渲染与质检；任务 6 仍须接通产品界面与人工审核。阶段一 R1–R6 不因本报告而完成。

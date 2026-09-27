# 阶段一当前主库源码复测（2026-09-28）

用户要求先测试、暂不打包。本记录绑定业务源码 `c0e38c7a07333318bae06a11b78e6ba45572c0ce`，在 Windows / Node v24.17.0 的本地源码环境运行。没有制作安装包、接入真实平台账号、读取真实直播录屏、发布作品或挂载商品。测试媒体及负载账号均为合成数据；日志与输出保存在 Git 忽略的 `data/runtime/validation/`、`app/data/runtime/validation/`。

| 检查 | 当前结果 | 边界 |
| --- | --- | --- |
| 默认全量 Vitest | `cd app; npx vitest run --reporter=dot --maxWorkers=4 --minWorkers=2`：394/394 文件通过，2974 项通过、4 项跳过，退出码 0。 | 跳过项分别在高光队列、旧账号迁移预览、本地来源观察器和 Sonar token 测试文件内；不能算通过。 |
| 独立负载 Vitest | `cd app; npx vitest run --config vitest.load.config.ts --reporter=dot --maxWorkers=2 --minWorkers=1`：4/4 通过，退出码 0。 | 100 个模拟账号按四平台各 25 个保存并重开，99 有效、1 过期；不代表真实平台账号容量。 |
| 发布队列容量/恢复 | 100 模拟账号 × 10 版本共 1000 任务：8 worker，250 轮，任务均进入模拟最终态且同账号无重叠；1000 个未知提交逐账号核对后推进；1000 任务领取后子进程退出，重开先核对 8 条租约，均通过。 | 本机文件队列和假执行器/核对器，不是四平台真实投稿、吞吐或最终作品状态。 |
| R4 实际合成渲染 | `cd app; node scripts/smoke-r4-composition.cjs` 退出码 0；输出主画面 `[253,1,0]`、覆盖素材 `[1,127,1]`、回到主画面 `[253,1,0]`，覆盖期间原声平均电平 `-24.1 dB`。MP4 SHA-256 `5d7ad3675bf1a744718ba2f88bec4dd49b80a54b183d9d7265d72fca5fb56d9e`。 | 64×64、10 fps 合成素材；未覆盖三版产品界面、真实录屏或人工审片。 |
| 静态检查与源码构建 | `cd app; npx tsc --noEmit` 退出码 0；撤回实验改动后 `npx electron-vite build` 退出码 0。 | 构建 Electron 源码，并非打包或安装验收。 |

## R2 严格预览门槛仍未通过

在上述业务源码的原有 `<Video>` 预览 / `<OffthreadVideo>` 导出实现上，复用[逐帧验收脚本](../../app/scripts/check-editor-preview-export-parity-win.cjs)及隔离合成工程 `r2-multitrack-1790538031552` 再测：30 fps 时间线上的 15 fps 素材，第 42、43 帧 SSIM 分别为 `0.884818`、`0.884885`，低于 `0.92` 门槛；纯蓝的第 90 帧为 `0.996497`。严格脚本退出码 1，与[原始逐帧记录](r2-preview-export-frame-parity-2026-09-28.md)一致。默认全量测试通过不能覆盖这个画面一致性失败。

为验证解码路径，曾临时用与既有 Remotion 版本对齐的 `@remotion/media@4.0.469` 画布视频组件替换预览、保留原导出路径。两种入点写法 `trimBefore` 和 `from` 都通过类型检查、源码构建及基本桌面 UI 冒烟，但连续从 1400 ms 拖到 1433 ms 并逐点截图时，严格比对第 43 帧分别只有 `0.877736` 或 `0.899006`；单独跳到该时间点与连续跳转后的画面也不同。这个实验只说明当前替换方式未达到可重复验收，不能断言组件在所有项目上有缺陷。所有**被 Git 跟踪的实验源码均已撤回**，`package.json` / 锁文件没有增加依赖，R2 门槛保持红色；实验差异和日志仅留在忽略的本地验证目录。临时包仍留在被忽略的共享 `node_modules`，不属于源码提交。

下一步需要确定预览和导出共同遵守的源帧选择规则，并对连续拖动、15/30 fps、可变帧率、字幕叠层及默认 GPU 路径各自验收。此处不能用“全量单测通过”或“某一个暂停帧吻合”关闭 R2。

## 日志校验与阶段边界

| 本地日志 | SHA-256 |
| --- | --- |
| `data/runtime/validation/full-vitest-2026-09-28-c0e38c7.log` | `1A9064E4DD8CCFE7E867A9F77F0A74CBD7E3BE113E18B57F82BCFBF1B04532E3` |
| `data/runtime/validation/load-vitest-2026-09-28-c0e38c7.log` | `22151B1FC2021FE78EF8F968D00674DADE7BBE10D2015BDC6107ACD9E86F79DF` |
| `data/runtime/validation/r4-smoke-2026-09-28-c0e38c7.log` | `D5839290319DF74B5CAE04F109C559DD47B5DDCB30E095810E89C56299FDD4B6` |
| `data/runtime/validation/tsc-2026-09-28-c0e38c7.log` | `A362855A07D0875949BA2C5FEEB01D0F323BAC81B54E01B73DF7253FB496908B` |
| `data/runtime/validation/r2-original-restore-parity.log` | `66B56B073BB87557A3586A209B45F74E1646F63D822F3A93B49FCFC051F27908` |

R1 的真实 Electron 加密会话与四平台续登、R3 的授权长录屏质量/盲审、R4 三版可编辑产品链与真人盲审、R5 全链自动化、R6-P 四平台远端最终状态均未因此通过。商品挂载仍仅保留扩展端口。原有本地包绑定旧提交，本轮没有重新打包，也没有把旧包视为当前源码验收。

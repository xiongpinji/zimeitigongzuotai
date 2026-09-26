# P1-2 / Q2-R3b2b：产品发布队列启动接线（2026-09-26）

主库 `2d423f7`（父提交 `d7ee103`）把新的持久发布队列接到 Electron 主运行时。薄入口先取得单实例锁并延迟加载 `main.ts`；`app.whenReady()` 后、首个窗口前，主进程通过 `bootstrapProductQueue(app.getPath('userData'))` 构造唯一的产品队列引用。存储固定为 `<userData>/publish-v2/queue.json`，要求绝对 `userData` 路径。构造失败会记录错误类别并以 `app.exit(1)` 停止启动，不能无队列保护地继续打开窗口。

这一步只建立持锁者构造入口。队列没有注册新 IPC、计时器或自动 `tick`；注入的发布 executor 对合成任务只返回 `needs_user_action` 且确认未提交，远端 reconciler 只返回 `unknown`，不会上传、重试未知提交或宣称已发布。现有旧 `publish:*` 路径仍独立存在，未改为使用本队列。商品请求保持原有阻止边界。

构建脚本在混淆前执行 `assert-single-instance-build.cjs`：只解析当前 `dist-electron/main.js` 与 `app-main.js` 真正引用的 chunk，检查薄入口把 `app-main.js` 放在 `loadMainRuntime` 延迟回调内、两个入口共享同一个 gate chunk、该 chunk 保留 owner 断言。这样旧的未引用 chunk 不能使检查假阳性通过。构建检查通过后才进行原有混淆。

## 可复核证据

- TDD：产品接线测试先为 **10 passed、1 failed**（`main.ts` 没有启动调用），补调用后转绿；相对 `userDataPath` 用例先失败，再加入绝对路径断言后通过。构建守卫曾以顶层动态导入负例先失败，再收紧 `loadMainRuntime` 检查。
- Windows Node 22.23.3 聚焦合跑 9 个测试文件：**95/95 passed、0 skipped**。其中有真实双 Electron 进程单实例 fixture 2 项、队列双进程崩溃恢复 1 项、原持久队列 41 项、新产品引导 12 项和构建守卫 14 项。
- `tsc --noEmit --project app/tsconfig.json` 退出码 0；`npm run build` 退出码 0。最终源码的预混淆守卫输出 `OK: shared gate chunk single-instance-gate-B6E0rn1Y.js retains the owner assertion`，随后 JS 混淆完成。`git diff --check` 通过。
- 代码提交只含 `main.ts`、产品队列引导、`package.json`、构建守卫及两个新测试文件，共六文件。Qwen `claude-bailian-20260926-061254-e4e12a` 超时无候选；DeepSeek `opencode-bailian-20260926-062856-cfa110` 超时只留下未调用的候选，不能计为成功。Codex 根据用户明确选择直接补全并独立运行上述验证；另一个 DeepSeek 构建守卫候选也超时，Codex 修复测试清理边界和顶层动态导入漏检后合入。

## 只读审查

GLM-5.3 作业 `qwen-code-review-20260926-070534-5fcc96` 已成功结束，无开放 P0/P1，Codex 复核其有界报告并以 `review-1790407296504981145-a104df` 记录接受。审查会话没有 shell 工具，不能自行运行 `git diff` 或测试；精确六文件 diff 和测试由 Codex 独立核对。GLM 指出损坏/不兼容队列文件会按当前 fail-closed 决策使整个应用退出，仍缺用户可见的恢复引导；在队列开始真实写入前必须处理这一可用性问题。它还指出日志只记错误类别、不记具体队列错误码，及通用队列加载时可能进行 commerce 任务隔离写盘；后者的模块注释已更正。现有 `whenReady` 链没有整体 `.catch`，构建守卫只跟踪入口一级 chunk 引用，均未因本子项宣称解决。

## 尚未验收

- 目前的 Windows 双进程测试运行的是合成 fixture；还未从 `app.asar` 内的正式打包应用实测 owner/loser 与异常退出。**Q2-R3b2 总门槛仍待打包启动验收**。
- 本次 `npm run package:win`（系统 Node 24）在 Electron packager 输出 `Packaging app for platform win32 x64 using electron v41.1.0` 后以 `Windows packaging stopped before completion` 退出码 1 结束，未生成新便携包。改用 Node 22.23.3 直接运行同一打包脚本，约 15 分钟仍停在同一阶段，进程只读了部分打包目录、未产生新发行目录；Codex 停止了该次尝试。原有 `release/灵机剪影-win32-x64` 已原位恢复，旧安装器未改动。打包失败原因尚未定位，不能把构建成功写成发行成功。
- 本次生成的 `app/.tmp/package-stage/win32-x64` 和系统临时目录中的 `electron-packager/tmp-Oeday7` 仍在本机；自动审批审查以 `blocked by policy` 拒绝了针对它们的递归删除，未改用其他命令绕过。它们是被 Git 忽略的临时产物，不在代码提交中。
- 队列未开放给 Renderer/Agent 调度，也未绑定四个平台的真实上传、会话、远端核对或账号授权；这些能力不能从本次构建或合成测试推断。通用 `openDurableQueue` 仍不是跨 OS 进程的原子 CAS；非 Electron 写者需要另外的存储级锁。

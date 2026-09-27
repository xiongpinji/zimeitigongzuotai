# P1-2 产品源码入口双进程烟测（2026-09-27）

用户要求先测试，暂不打包。本轮在 Windows、Node v22.23.3、主库 `0cbc2f2` 上直接执行 `electron-vite build`（退出码 0），并运行 `scripts/assert-single-instance-build.cjs`（退出码 0）。随后以仓内 Electron 二进制启动构建后的真实产品入口 `dist-electron/main.js`。没有执行 `npm run build` 的清理/混淆步骤，也没有生成或安装包。

可复测脚本为 `app/scripts/smoke-product-single-instance-win.cjs`。它使用 Git 忽略的 `data/runtime/validation/product-single-instance-profile/` 作为专用 `userData`，以 Playwright 观察真实窗口，并依次启动 owner、同身份 loser、owner 关闭后的第三个产品进程。

| 检查 | 本机观察 | 证据边界 |
| --- | --- | --- |
| owner 产品启动 | 首窗标题“灵机剪影”，界面有“开始创作”；Electron `app.getPath('userData')` 与隔离目录完全匹配。 | 只验证该源码编译产物在本机启动，不涉及安装包。 |
| 第二进程竞争 | loser 退出码 0，约 863 ms 退出；owner 收到恰好一次 `second-instance`，窗口数仍为 1。 | 脚本没有直接探测 loser 的内部模块或队列构造次数；“不加载写者”的代码路径另由 gate fixture 和构建断言验证。 |
| 释放与重开 | owner 正常关闭后，第三进程使用同一隔离目录再次显示“灵机剪影”和“开始创作”。 | 证明本轮正常关闭后的重开；不等于异常断电、应用更新或打包启动验收。 |
| 进程清理 | 测试结束后，命令行含该隔离 profile 的 Electron 进程数为 0。 | 只针对该 profile，未触碰其他 Electron 进程。 |

独立回归 `single-instance-gate.test.ts`、`single-instance.windows.test.ts`、`assert-single-instance-build.test.ts` 共 **29/29 通过，0 跳过**，包括无窗口 fixture 的真实 Windows 双进程写者标记测试。烟测脚本 `node --check` 退出码 0，`git diff --check` 退出码 0。

复测顺序：在 `app/` 下用 Node 22 运行 `node ./node_modules/electron-vite/bin/electron-vite.js build` 和 `node ./scripts/assert-single-instance-build.cjs`；回到仓库根目录运行 `node ./app/scripts/smoke-product-single-instance-win.cjs`。脚本的 JSON 结果、运行日志及构建日志在 Git 忽略的 `data/runtime/validation/` 下。运行日志 SHA-256 为 `1ED94CD43899F4A9FCA15F7D4E76DCE52971732164431F93960D43D744DA76EB`，JSON SHA-256 为 `631EBB9614282CAA17878C1E33DD48BD4265CA53510843444E36E862B467E1F5`，构建日志 SHA-256 为 `D38A1D26555FD1B3EA8A846179CBE4A8F24DA47595A61EF99C7ECDBBD423C0EC`。

这项检查补上了“fixture 通过，但真实产品入口未起双进程”的源码验证缺口。产品队列当前仍是构造后惰性、没有平台提交调度；四平台授权登录、真实发布、挂车接口及完整安装包行为均未由本测试证明。遵照用户要求，保持不打包。

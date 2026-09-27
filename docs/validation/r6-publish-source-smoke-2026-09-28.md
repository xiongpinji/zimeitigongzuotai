# R6-P 发布入口离线复测（2026-09-28）

在源码构建 `66e128d` 上复跑 `node app/scripts/smoke-product-single-instance-win.cjs`，退出码 0：隔离用户目录的首个 Electron 进程正常开窗，第二个进程 0.76 秒后退出（退出码 0），首进程收到一次 `second-instance` 事件且仍只有一个窗口；关闭后第三个进程可重新开窗。这验证了本机源码应用的单实例启动门禁，未启动平台发布。结果在 Git 忽略的 `data/runtime/validation/product-single-instance-smoke.json`。

发布 runner 整批预检、旧仓读取保护、产品队列启动组合根和四平台队列适配层聚焦回归共 **4/4 文件、77/77 测试通过**。测试使用模拟账号、会话和平台结果，没有真实上传。另在 [R1 桌面测试](r1-secure-accounts-desktop-smoke-2026-09-28.md)的隔离用户目录中保留 7 条新安全账号并打开空工程“发布”工作台；“发布到”仍显示暂无账号，截图见 `data/runtime/validation/r1-accounts-1790547730421/publish-workspace-isolated.png`。这说明账号新仓与旧发布界面的接线尚未完成。

本轮不关闭 R6-P 产品验收：未验证新账号任务矩阵、真实四平台上传、远端作品 ID 与最终状态，也未测真实并发吞吐或平台限流。没有打包、登录、调用付费服务或发表作品。

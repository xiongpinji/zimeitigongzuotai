# P1-2 / Q2-R3b2a：持锁者队列工厂

主库 `8aa79d8` 新增进程内 `assertSingleInstanceOwner()` 与 `openOwnedDurableQueue()`。薄入口调用 `runSingleInstanceGate` 时先清掉旧断言状态；Electron 单实例锁失败的进程只退出；取得锁并成功注册 `second-instance` 监听后，才在延迟加载主运行时之前标记 owner。加载抛错时清除该标记并原样抛错。队列工厂先检查 owner，再读取 `DurableQueueOptions` 或调用通用 `openDurableQueue`。

这是产品接线所需的**构造门槛**，不是新的跨进程存储锁。`DurablePublishQueue` 通用入口仍可被其他 Node 进程直接调用；主运行时 `main.ts`、发布 IPC 和旧 `publish:run` 尚未引用新工厂，也未启用自动队列提交。构建优化目前会从产品产物移除尚未被使用的断言，因此本提交不能证明安装包中的队列写者已受保护。

## 本机证据

- TDD：新门禁断言先出现 **3 failed、10 passed**，因断言尚不存在而失败；实现后门禁套件 **13/13**。队列工厂测试先因文件缺失无法加载，补最小桩后出现 **3/3 断言失败**，再实现工厂后通过。未将模块加载错误计作有效 RED。
- Windows Node 22.23.3 聚焦回归：`single-instance-gate` 13、真实双 Electron 进程 fixture 2、Vite 入口配置 5、新队列工厂 3、既有持久队列 41，共 **64/64 通过、无跳过**。
- `tsc --noEmit --project app/tsconfig.json` 与 `electron-vite build` 退出码均为 0。构建后 `dist-electron/main.js` 保持对 `app-main.js` 的延迟加载，两个入口引用同一个 `single-instance-gate-*.js` chunk；目前该 chunk 中的新增断言被树摇优化掉，因为产品入口尚未调用工厂。
- 截至本记录，GLM-5.3 只读审查作业 `qwen-code-review-20260926-055157-5be921` 正在运行，不能写成已通过审查。

## 仍需完成

Q2-R3b2b 必须在真实产品 `main.ts`/IPC 的每个队列写入口使用这个工厂，并在构建产物和打包启动路径验证同一 owner 状态；如果仍能直接调通用 `openDurableQueue`，本门槛无效。队列租约与未停止的上传 Promise、旧账号迁移、远端作品 ID/最终状态均未解决，不能据本次 64 项合成测试启用四平台真实自动发布。商品挂载仍保持阻止。

# P1-2 持久发布队列核心验收记录

输入基线：`841763d`。本轮为 GLM 只读复审后的故障修复。本记录仅涵盖 `app/electron/publish/durable-queue.ts` 的离线状态机与单元测试；尚未接入现有 IPC、账号仓、平台发布适配器或真实账号。

## 验证命令与结果（离线模拟）

- 本工作树没有 `node_modules`，也未打包依赖：按任务约束未安装依赖、未复制其他工作树依赖，改用本机既有 npx 缓存的运行器（vitest 5.0.1；项目 devDependency 声明为 `^2.1.9`）。命令与结果：
  - `~/.npm/_npx/69c381f8ad94b576/node_modules/.bin/vitest run --config /tmp/opencode/p1-2-vitest.config.mjs tests/publish/durable-queue.test.ts`
  - 修复前：24 项基线通过，新增 10 项中 7 项按预期失败（随后补充的“人工判定可重试 + 迟到 published”竞态测试又暴露一次非法迁移）。
  - 修复后：**34/34 通过，退出码 0**（2026-09-25）。
- 未运行 `tsc --noEmit`：本工作树与 npx 缓存均无 TypeScript 编译器，且约束不允许安装依赖，静态类型结论未经编译器验证。
- 以下“通过”仅为离线注入 executor / reconciler 的单元证据，不是真实平台证据。

## 本轮修复的复审缺口

1. `leaseUntil` 从“只写不读”改为 tick 步骤 0 读取：同进程中 `uploading` 超过租约且不在 `running`（例如执行器已结束但结果落盘失败）时，转 `unknown_submission` 并只核对，绝不直接重发；命中 `running` 的在途执行器即使租约超时也不回收。
2. `submitted` 状态白名单补上 `published`：持久化 `submitted` 任务经核对 published 可正常落终态，不再每轮 tick 抛 `invalid_transition`；其他远端结果仍受 `confirmedNotPublished` 门槛约束（未证实失败进 `unknown_submission`，不盲重发）。
3. 挂车任务隔离：持久化 `commerceRequest` 非空却处于 `queued` / `retryable_failure` / `uploading` 时，加载即转 `needs_user_action`（错误码 `commerce_blocked_recovered`）并落盘；tick 领取前再次跳过任何 `commerceRequest` 非空任务；核对确认“未发布且可重试”时也不降级，转 `needs_user_action`（`commerce_blocked`）。入队商品请求原有 `needs_user_action` 阻断与 `resumeTask` 拒绝保持不变。
4. 人工决议与在途核对竞态：`applyReconcileResult` / `recordReconcileInconclusive` 仅在任务仍处于可核对状态时应用结果；人工决议（终态或可重试）落盘后，迟到的核对结果被丢弃，不覆盖人工决定、不触发非法迁移，该轮 tick 平稳结束。
5. `applyManualResolution` 改为返回 `structuredClone` 副本；调用方改写返回值不再污染队列内存与磁盘。

对照失败测试（修复前）：挂车加载未隔离、挂车核对后降级、`submitted→published` 非法迁移、租约回收缺失、人工终态被迟到核对覆盖两次、返回值被改写。

## 尚未验证／不得宣称

- 没有真实四平台账号登录、发布、远端状态核对、并发吞吐或限流测试；不能把单元测试预算当成平台可用并发量。
- 当前发布 UI / `runner.ts` 仍走上游旧路径，本队列尚未被运行时引用。接线前不得宣称持久化和去重保护已经覆盖实际发布。
- 当前实现只适用于单 Electron main 进程持有一个队列实例；没有跨进程文件锁或多设备分布式协调。
- 挂起的 executor 无法被中止：在途执行器会一直占用该账号，租约到期也不会被回收或补发（tick 合并等待其 settle）。本模块只保证不并发重发，不保证能恢复挂起的适配器。
- 人工决议被当作权威：人工判定后迟到的自动核对结果会被丢弃。若人工错误地确认“远端未发布”而实际已发布，核心不会自动纠正，需在接线 / UI 层做防呆与二次确认。
- 实际适配器必须提供可靠的“未提交／未发布”证据，否则队列停在未知态等待核对或人工处理。
- 安装包、真实账号、商品挂载和平台最终状态未在此任务验证。

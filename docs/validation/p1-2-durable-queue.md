# P1-2 持久发布队列核心验收记录

输入基线：`b8514a8`。本记录仅涵盖 `app/electron/publish/durable-queue.ts` 的离线状态机与单元测试；尚未接入现有 IPC、账号仓、平台发布适配器或真实账号。

## 已验证

- Codex 在 Windows 工作树复跑 `npm exec vitest run tests/publish/durable-queue.test.ts`：24/24，通过。新增 2 项先失败后修复的测试覆盖“网络失败不等于未提交”和“远端没有 ID 不等于未发布”。
- `npm exec tsc -- --noEmit`：队列本身的类型错误已修复；当前唯一报错为基线 `electron/remotion/render-video-headless.ts` 的 `width` 参数，P0-1 分支已修复，合并后需统一复测。
- 任务矩阵以视频版本和账号生成稳定幂等键；重复入队返回旧任务，同键不同载荷拒绝。JSON 存储损坏、未来 schema 和非法任务显式拒绝，不清空旧任务。
- 单账号互斥、全局／设备／平台预算、计划时间、退避和取消通过离线测试；上传中取消进入 `unknown_submission`，不会直接记成已取消。重启时残留 `uploading` 也只进入核对。
- 执行器的失败、限流、登录／人工处理结果只有显式 `confirmedNotSubmitted: true` 才可进入相应状态或自动重试；否则进入 `unknown_submission`。远端失败只有显式 `confirmedNotPublished: true` 才可终止、取消或重试。商品请求非空时落库为 `needs_user_action`，普通发布执行器不会收到挂车请求。

## 尚未验证／不得宣称

- 没有真实四平台账号登录、发布、远端状态核对、并发吞吐或限流测试；不能把单元测试预算当成平台可用并发量。
- 当前发布 UI / `runner.ts` 仍走上游旧路径，本队列尚未被运行时引用。接线前不得宣称持久化和去重保护已经覆盖实际发布。
- 当前实现只适用于单 Electron main 进程持有一个队列实例；没有跨进程文件锁或多设备分布式协调。实际适配器必须提供可靠的“未提交／未发布”证据，否则队列停在未知态等待核对或人工处理。
- 安装包、真实账号、商品挂载和平台最终状态未在此任务验证。

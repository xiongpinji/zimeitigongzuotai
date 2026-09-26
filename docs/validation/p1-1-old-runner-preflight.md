# P1-1 / A2-S4a：旧发布链路整单账号预检

本项修复旧 `publish:run` 对未知账号静默 `continue` 的行为。现在 runner 在解析第一个平台模块、上传或发送进度之前，只读一次旧账号列表并预检**整批**目标。任一目标为空、畸形、重复、不在快照中，或账号记录的 ID、平台、名称不一致时，整单以固定错误码和中文文案拒绝，不产生部分上传。新 `account-v2` UUID 不会进入旧上传链。有效旧账号仍按目标顺序上传，并保留原有覆盖字段、B 站 `tid`、进度及取消行为。

Renderer 收到 `publishAPI.run` 的同步抛错或异步拒绝时，将本单仍为 `pending`/`running` 的行标记为 `failed`，写入固定安全文案和结束时间；已经为 `success`、`failed` 或 `login-expired` 的行保留原状态。任务进度标记失败，事件订阅退订。预检错误和这条 UI 兜底文案均不拼接目标 ID、账号昵称、会话路径或底层异常。单目标平台级错误仍按旧链发送其原始进度消息；它不属于整单预检错误。

## 离线验证

所有账号、路径、平台模块和 Electron sender 均为合成假件；没有使用真实账号、Cookie、媒体或网络。改动限定为 `app/electron/publish/preflight.ts`、`app/electron/publish/runner.ts`、`app/src/store/publish.ts`、两份聚焦测试和本文。

| 检查 | 实际结果 |
| --- | --- |
| 首次 RED | 两份测试先复制到主库，runner 测试因 `preflight` 模块尚不存在无法收集，store 测试 6 项失败、1 项通过；Vitest 退出码 1。 |
| 整单预检初版 GREEN | Windows Node 22.23.3、仓内 Vitest 2.1.9：runner 24 项、store 7 项，31/31 通过；`tsc --noEmit --project app/tsconfig.json` 退出码 0。 |
| 异常访问器修复 | 新增抛错 getter 回归时 RED，原始异常内容外泄；固定错误归一后 32/32 通过。再新增账号 ID 翻转 getter 回归，初跑 32/33；拒绝 accessor 属性后 33/33 通过。 |
| 类型检查 | 修改后的主库 `tsc --noEmit --project app/tsconfig.json` 退出码 0。测试由 Vitest 转译运行，项目 tsconfig 不独立覆盖测试文件。 |

额外合跑旧 `engine`、`accounts`、`account-id` 与本项两套测试时为 **45/46**。唯一失败是未改动的 `accounts.test.ts:20` 使用 Unix `/` 结尾断言 Windows 路径；本项没有修改 `accounts.ts` 或该测试，因此不把这次合跑记成全绿，也不把路径兼容问题混入六文件白名单。

测试覆盖混合有效与无效目标零次 `getPlatform`、零上传、零虚假进度；完整旧 ID 精确绑定；一次性账号快照；两个有效目标的调用顺序与参数；普通失败、登录失效及取消；Renderer 的 pending/running 兜底与终态保留。预检只接受 IPC/JSON 形态的数据属性，拒绝会在校验后变值的 getter。返回给 runner 的绑定仍引用原任务与账号对象；当前产品输入来自 IPC 克隆和 JSON 注册表，未把此预检当作抵抗其他代码并发修改对象的通用隔离机制。

## 证据边界

- **源码可见**：整批预检发生在平台解析与上传前；旧 ID 与快照记录精确绑定。`AccountStore.list()` 若把损坏 registry 吞成空数组，目标匹配仍会失败，不会被当成可发布账号。
- **自动化测试通过**：上述均为本机 Windows 的合成测试。没有实测 Electron 主进程 IPC、打包启动、平台限流或并发吞吐。
- **真实账号验证**：未进行；需要用户完成登录和授权后逐平台验证。
- **平台最终状态**：未验证；此项不声称真实投稿成功或平台原创判定。商品挂载端口及账号迁移预览不属于本项。

执行代理的 A2-S4a 两次尝试分别产生零实现文件和仅测试草稿，未作为已完成实现验收；Codex 在限定文件内接手实现并在主库独立复跑。GLM-5.3 只读审查 `qwen-code-review-20260926-021607-5210fa` 无 P0/P1，Codex 记录接受 `review-1790389776780697243-80caab`。审查提出三个后续 P2：固定预检码未传达给用户；旧账号注册表的写入侧缺少输入校验，坏条目可能使整库预检阻断所有任务；覆盖率尚缺封面比例、覆盖字段、B 站分区、账号状态/时间和重复注册表 ID 等分支。前两项涉及单独的 UI/IPC 或旧账号写入边界，未在本六文件修复中扩大范围；第三项可在后续回归包补齐。主库精确暂存六文件，`git -c core.whitespace=cr-at-eol diff --cached --check` 退出码 0。提交号以 Git 历史为准。

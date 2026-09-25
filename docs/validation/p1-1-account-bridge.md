# 四平台安全账号桥接验证（P1-1 / A2-S2）

本页记录 `account-v2:*` 主进程服务接入 Electron `main`、preload 和 Renderer 类型后的验证。基线为 `7d5eca7`（A2-S1 已验收）；本阶段不接旧 `publish:*` 发布 runner，不迁移真实旧账号，也不宣称四平台真实登录已经通过。

## 接线与边界

- `app.whenReady()` 后、首次 `createWindow()` 前调用 `bootstrapAccountsV2`。组合根在 `<userData>/publish-v2` 构造 `AccountVault`，生产加密器为 Electron `safeStorage` 适配器；不可用时登录拒绝，不回退明文或旧 `<userData>/publish`。
- 固定五个 `account-v2:create/list/login/check/delete` invoke 通道；四平台白名单为 `douyin/kuaishou/tencent/xiaohongshu`，B 站不进入新仓。preload 单独暴露 `window.accountV2API`，旧 `publishAPI` 保留；Renderer 只能得到脱敏 DTO、固定错误码/消息和 `data:image/png;base64,...` 二维码事件，不能得到 Cookie、Token、会话引用或文件路径。
- 每个账号以 UUID 区分。同平台同名账号有各自的会话密文。登录 Promise 落定后二维码闸门关闭；迟到回调静默丢弃。探针按账号、按最新启动序号写状态；重登轮换或删除使旧探针结果失效。
- 登录二维码只回发起 `invoke` 的 sender。临时目录真实路径、普通文件、同一 fd 有界读取（≤512 KiB）、PNG 魔数和每请求 64 次事件上限均由主进程校验；违规时本次登录失败，不提交候选会话。

## 已执行的离线验证

Codex 在 A2-S2 最终候选字节上使用 Windows Node 22.23.3 和仓内官方 Vitest v2.1.9 独立运行：`accounts-v2-bootstrap.test.ts` **12/12**、`accounts-v2-ipc.test.ts` **44/44**、`accounts-v2.test.ts` **75/75**，合计 **131/131**，退出码 0。测试使用临时目录、假 IPC、假平台和测试专用假加密器，不触真实账号、平台网页或用户生产目录。精确工作树状态仅包含 7 个 A2-S2 代码/测试路径；本验证文档由 Codex 补齐为第 8 个交付路径。

GLM-5.3 经 `qwen-code-review` 路由只读审查 A2-S2 候选：未发现代码级 P0/P1；指出缺少本验证文档为交付阻断，并列出下述 P2 边界。审查本身为源码级，不代替 Codex 的测试和类型检查。

Codex 将这 8 个白名单路径选择性复制到主库 `70c48c6` 后，使用同一 Windows Node 22.23.3 实跑 `tsc --noEmit --project app/tsconfig.json`，退出码 **0**；再跑上述三套官方 Vitest，**131/131**，退出码 **0**。`git -c core.whitespace=cr-at-eol diff --check` 退出码 **0**。这些结果只证明本地类型与合成测试通过，不是 Electron 真实 UI、真实平台或真实账号验收。

## 已知限制与后续门槛

- **二维码实际格式**：抖音、快手、视频号平台模块接受图片 data URL 并写作 `.png`，但没有证明真实页面当前返回 PNG。若返回 JPEG/WebP，新闸门将安全拒绝并给出 `qrcode_failed`；真实四平台扫码验收前不能宣称登录可用。必要时由平台适配层显式转成 PNG。
- **文件替换窗口**：二维码读取的 `lstat → open` 之间仍有理论 TOCTOU；同 fd `fstat/read`、大小和魔数约束收敛后果，但没有消除进程内可替换临时文件的攻击窗口。此项沿用 A2-S1 验证文档的 P2 分级。
- **双进程账号仓**：当前 `publish-v2` registry 是读改写 + 原子 rename，没有跨进程 CAS/锁。两个应用进程并发写同一 userData 可出现 last-writer-wins。产品级 Electron 单实例门槛为后续 Q2-R3a；完成前本接线不应作为可并发运行的正式发行版验收。通用跨进程写者仍需另行存储锁。
- **开发热更新**：主模块重复注册时日志可能误报通道不可用，旧注册处理器仍在。首次生产启动的单次注册不受该文案问题影响。
- **显示名**：当前拒绝 C0/C1 控制字符和超长字段，未处理 U+202E 等方向控制符；A2-S3 设置页需防视觉混淆。

真实 Windows `safeStorage` 跨重启解密、四平台首登/续登、二维码格式、不同账号并发保持、旧 runner 对 UUID 目标的保护、发布最终状态均**未验证**。A2-S3 设置页、A2-S4 旧 runner 未知 ID 保护和只读迁移预览、P1 发布路径切换仍属后续任务。商品挂载仅保留扩展接口，不宣称平台商品 ID 真实挂载；也不承诺平台会认定剪辑或混剪视频为原创。

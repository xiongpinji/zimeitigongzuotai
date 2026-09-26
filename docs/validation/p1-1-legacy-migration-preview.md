# P1-1 / A2-S4b：旧账号只读迁移预览

此项新增 `account-v2:migration-preview`，只对固定 `<userData>/publish/registry.json` 做**只读元数据扫描**。Electron main 在 ready 后将旧根作为闭包传给独立 IPC 注册函数；Renderer 调用 `window.accountV2API.migrationPreview()` 不带参数，不能选择文件路径，也不能启动 `AccountStore`、`AccountVault` 或 `migrateFromLegacy()`。预览注册与新安全账号仓启动独立；新仓不可用时不把只读预览降级为明文迁移。

成功 DTO 只有总量、四平台可预览数量、B 站排除数量、平台计数以及每条旧记录的临时序号/平台/状态/资格标志。它不返回昵称、旧 ID、路径、会话引用、Cookie/Token 或原始异常；**不读取会话文件内容，也不探测会话文件是否存在**。B 站只标记为不在四平台迁移范围，不触发迁移。缺失、损坏、过大、非普通文件、符号链接、重复旧账号或不认识的平台均返回固定错误码与文案，不把坏表当作空列表。

`eligible` 仅表示该条记录的平台在四平台迁移范围内，不表示会话文件存在、账号仍可登录或已通过实际迁移。预览校验有意比旧版迁移解析器严格：额外字段、重复记录、未知平台和无效时间戳均整表拒绝；当前旧账号仓写入的规范记录可通过，但历史版本或手工改动的注册表可能出现保守的 `registry_corrupt`，应人工排查，不能凭预览错误删除旧数据。

## 离线验证

全部记录为合成数据，临时根位于 OS temp；递归清理前检查解析路径确是 `tmpdir()` 的本项前缀直系子目录。测试在预览前后逐字节对比旧 registry 与合成会话哨兵、对比旧目录项，并确认相邻 `publish-v2` 根始终不存在。

| 检查 | 实际结果 |
| --- | --- |
| RED→GREEN | 测试先行：源码不存在时官方 Vitest 无法收集，退出码 1；实现纯预览与假 IPC 后核心 5/5 通过。 |
| 预加载桥回归 | 新方法首次接入时，既有 `accounts-v2-bootstrap` 精确方法列表测试失败；更新契约测试，验证固定通道且 `invoke` 无参数。两套合跑最初 17/17，通过后新增大小上限和 symlink 用例。 |
| Windows 聚焦 | 新预览与既有账号桥合跑 **18 passed、1 skipped**，退出码 0；唯一 skipped 是 Windows 创建 symlink 返回 `EPERM`。 |
| WSL symlink 补充 | WSL Node 22 转译本地预览模块，在合成临时目录创建注册表 symlink 和旧根目录 symlink；两者均返回 `registry_unsafe`，目标字节不变，退出码 0。这是单独运行时烟测，不把 Windows skipped 记成通过。 |
| 类型检查 | Windows 项目 `tsc --noEmit --project app/tsconfig.json` 退出码 0。测试由 Vitest 转译，项目 tsconfig 不单独类型检查测试文件。 |

范围限定为 `app/electron/publish/legacy-migration-preview.ts`、`app/electron/main.ts`、`app/electron/preload.ts`、`app/src/lib/electron-api.ts`、两份合成测试和本文。源码只执行 `lstat/open/fstat/read/close`，没有创建或修改旧/新仓；`registry.json` 有 4 MiB 预览上限。`lstat` 与 `open` 之间的本地 TOCTOU 由同一 fd 的 `fstat` 文件类型及设备/inode 比对收敛，但不声明对同权限本地恶意进程的绝对隔离。

GLM-5.3 只读审查 `qwen-code-review-20260926-031239-1939a5` 未发现开放 P0/P1，Codex 记录 `accepted`（`review-1790392867863895740-52d86d`）。其 P2 跟进为上述预览/迁移校验严格度差异、Windows 上 `ino` 与 `O_NOFOLLOW` 可能无法提供等同 Unix 的交换防护，以及 `fstat` 后若同权限进程并发增长文件，单次 `readFileSync(fd)` 不能严格限制实际读取字节；现阶段依赖固定本地根、文件类型检查与 4 MiB 打开前尺寸检查，后续若要对抗本机并发恶意改写，应改为有界 fd 读取。新安装没有旧注册表时返回 `registry_missing`，Renderer 后续应将其解释为“无旧数据可预览”。

## 证据边界与后续

- **源码可见**：只读 registry 元数据、固定主进程旧根和封闭 DTO；`migrateFromLegacy()` 不可从该 IPC 触达。
- **自动化测试通过**：假 IPC/preload 和合成临时目录；没有使用真实 `userData` 或会话。真实 Electron 打包路径、安装包升级后的目录布局未由这些测试证明。
- **真实账号验证**：未进行；没有扫码、续登或读取真实登录状态。
- **平台最终状态**：未进行；这不是发布或迁移验收。

真正迁移仍须用户确认时机、备份及逐账号加密回读验证；此项只提供无副作用预览。新 UUID 仍不会进入旧 `publish:run`，批量自动发布、商品挂载及四平台真实会话持久性继续受独立门槛约束。

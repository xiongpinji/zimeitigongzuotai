# 未打包源码测试记录（2026-09-27）

用户要求先测试、暂不打包。本轮在 Windows、Node v22.23.3 上验证主库 `bdceb57` 的源码；没有制作安装包、连接真实平台账号、提交视频或挂载商品。此前的失败基线见 [2026-09-26 记录](phase1-test-before-package-2026-09-26.md)，不能把那次结果追溯改写为通过。

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| `app` 默认 `vitest run --reporter=dot` | **退出码 0**；376/376 文件通过，2849 项通过、4 项跳过 | 本地源码自动化测试通过；4 项跳过分别是 Windows 不执行的 3 个符号链接用例和仅适用于 POSIX 的 token 权限位用例。 |
| `tsc --noEmit --project tsconfig.json` | **退出码 0** | TypeScript 静态类型检查通过。 |
| `electron-vite build` | **退出码 0** | 从当前源码生成 Electron 主进程、preload 和 renderer 产物；未执行混淆、打包或安装。 |
| 隔离 `userData` 的源码首窗启动 | **通过**；标题为“灵机剪影”、`file:` 页面、根节点文本长度 235、页面异常 0 | Playwright 启动仓内 Electron，核实 `app.getPath('userData')` 指向被忽略的测试目录，首窗渲染后关闭进程；不是安装包启动验收。 |
| ACP 进程退出与 Windows Electron 双进程聚焦测试 | **2 文件、7/7 通过** | 覆盖真实子进程退出通知、单实例 owner/loser 锁与清理；不证明整套产品首窗启动。 |
| Sonar token 权限聚焦测试 | **8 通过、1 跳过** | Windows 新旧 token 的受保护 ACL、ACL 工具不可用时新文件保持空白；POSIX 权限位测试在 Windows 跳过。 |

完整日志保存在被 Git 忽略的 `data/runtime/validation/full-vitest-2026-09-27-after-flake-fix.log`，SHA-256：`4EBBFF6E588B8D1DBAEB9314425543FB2825A32A4BD8E45A6F1D5BEB8687D6BE`。聚焦测试和类型检查的退出码均为 0。验证在 `bdceb57` 提交前后使用相同测试文件字节完成，文档本身不改变业务代码。

源码构建日志为 `data/runtime/validation/electron-vite-source-build-2026-09-27.log`；首窗检查的 JSON、截图与运行日志分别为同目录中的 `electron-source-smoke-2026-09-27.json`、`electron-source-smoke-2026-09-27.png`、`electron-source-smoke-2026-09-27.log`。这些文件和隔离 profile 均被 Git 忽略，没有使用真实账号目录。

为修复 9 项跨平台路径断言，测试改用当前系统的路径 API；5 个首次加载较大 UI 模块的文件单独设置 60 秒测试时限；默认套件排除了旧的 `.tmp` 打包生成区。另发现 `0600` 在 Windows 上并不能限制 NTFS ACL：本机既有 Sonar token 原先允许 `CodexSandboxUsers` 读取。现在代码在读取旧 token 或写入新 token 前收紧为仅当前用户可访问的受保护 ACL，收紧失败时拒绝生成新秘密。本机既有 token 的 ACL 已单独收紧，经只读复查为 `AreAccessRulesProtected=True` 且仅当前用户 `FullControl`；没有读取或记录 token 内容。由于此前权限较宽，无法证明旧 token 从未被其他本机进程读取；接入扩展可同步更新凭证时应轮换该 token。

测试期间保留了两次失败记录：与类型检查并行运行时，2 个 UI 用例超过 60 秒；单独复跑时，ACP 测试的固定 200 毫秒等待发生竞态，Windows 双进程测试在子进程 `exit` 后、句柄 `close` 前清理临时目录触发 `EBUSY`。现已改为等待真实事件，随后默认完整套件独立复跑通过。失败日志分别在忽略目录下的 `full-vitest-2026-09-27-b83a9a8.log` 和 `full-vitest-2026-09-27-b83a9a8-isolated.log`，不以聚焦通过代替最终全量结果。

指定的 `qwen-code-review / glm-5.3` 只读审查任务 `qwen-code-review-20260927-093451-b63a59` 未产生审查结果：服务端报告 Token Plan 月额度耗尽，任务输入/输出 token 均为 0。Codex 已自行复查改动与测试；外部 GLM 验收仍待额度恢复后的新作业，不能记为通过。

本次通过属于离线源码级证据和隔离目录下的源码首窗检查。真实授权直播录屏的高光质量、素材合成的版权与叙事审查、四平台多账号扫码续登、批量发布远端最终状态、商品 ID 挂载资格和结果均未在本轮验证。此前 HotClip 的合成 MP4/SRT 导入只证明本地字幕导入，不能替代真实直播切片验收。遵照用户要求，打包及安装后验收仍暂停。

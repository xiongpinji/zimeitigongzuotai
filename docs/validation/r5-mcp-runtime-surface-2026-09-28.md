# R5 MCP 运行时入口验证（2026-09-28）

业务源码基线 `c49627e`，与此前通过全量测试的 `9f7f647` 在 `app/electron`、`app/src`、`app/tests`、依赖和 TypeScript 配置上没有差异。本轮只新增测试脚本和验证记录，不修业务代码，不打包。R2 与 R4 的执行者选择仍待答复；这次是 Codex 独立验证现有产品入口，不是接管未授权的实现任务。

## 范围与隔离

新增 `app/scripts/smoke-production-mcp-win.cjs`。它用真实 Electron 加载当前源码构建，再通过已安装 MCP SDK 与产品的本地 Streamable HTTP 服务通信；工具注册、处理函数、主进程和 Renderer 通道没有替换为假件。测试启动器把 `os.homedir()`、Electron 的 home/userData 及应用路径限定到测试目录/本源码库，并记录 MCP 启动错误和其权限子进程错误。启动前确认 19820 端口空闲，连接前以测试端点文件的 PID 确认服务属于当前隔离进程；客户端只允许请求该 loopback 地址。

全程使用空的合成工程，没有真实账号、上传、视频模型、高光模型或编码请求。合成 token 与工程、截图、工具清单只留在 Git 忽略的 `data/runtime/validation/`。真实 `.lingji` 中的端点、token、收件箱和 Agent 配置只检查存在性/大小/修改时间，不读取内容；这些元数据在进程关闭后保持一致。该检查不是全磁盘内容审计。

## 当前运行结果

| 命令 | 结果 | 证据边界 |
| --- | --- | --- |
| `node app/scripts/smoke-production-mcp-win.cjs` | 退出 1。项目盘内的全新隔离 home 初始化失败，MCP `running=false`。 | 原始首次启动红灯，没有改 token 权限准备条件。多次运行分别补充首次复现、启动错误记录、权限子进程错误记录与最终脚本复验，行为一致。 |
| `node app/scripts/smoke-production-mcp-win.cjs --prepare-token-fixture` | 退出 0。先为**自建的空 token 文件**准备仅当前用户可访问的 DACL，再启动未改动的产品服务。 | 这是有明确准备条件的协议/工具测试；不能宣称首次启动问题修复，也不能代替 R5 完整生产链验收。 |
| `npx vitest run tests/sonar-token.test.ts --maxWorkers=2 --minWorkers=2 --reporter=dot`（`app` 目录） | 8 通过、1 POSIX 权限用例在 Windows 跳过，退出 0。 | 该套件使用系统临时目录，不能代替项目盘内隔离 home 的启动测试。 |
| `node --check app/scripts/smoke-production-mcp-win.cjs` | 退出 0。 | 只验证脚本语法。 |

最终脚本严格失败的完整记录位于 `data/runtime/validation/r5-mcp-1790553257200/`：`failure.json`、`mcp-startup-error.json`、`sonar-acl-process-error.json` 和截图。权限子进程 exit 1，未被超时杀死，`FullyQualifiedErrorId` 为 `UnauthorizedAccessException`；错误位于 `System.IO.File.SetAccessControl`。`electron/sonar/token.ts` 在失败后保持空 token，先于 HTTP 服务创建终止；这不是协议请求超时造成的错误。

本例文件所有者是当前用户，但继承的权限没有给当前用户单独的 FullControl 允许项。产品命令新建 `FileSecurity`，同时执行 `SetOwner` 和保护 DACL。最小对照在自建空文件上保留 Owner、只写保护 DACL 成功，验证了 Owner 保持、DACL 受保护、仅当前用户可访问。随后产品自身的权限收紧和 token 初始化可完成。因此后续修复需要覆盖这种权限条件，并检查同时写 Owner 的必要性；本轮没有更改该命令或放宽产品凭证保护。另一条尝试通过工具 shell 直接调用 .NET 方法的诊断因该 shell 的方法不可用而失败，不能作为 ACL 结论；上述成功对照由 Node 调用 `powershell.exe`，与产品调用方式一致。

## 真实工具调用与生产能力缺口

最终脚本有准备条件的成功证据位于 `data/runtime/validation/r5-mcp-1790553503654/`，包括 `result.json`、`advertised-tools.json`、`fixture-acl-precondition.json` 和 `project-opened.png`。重复协议运行结果一致；`tools/list` 经真实协议返回 31 个工具；以下调用全部经过真实 MCP 工具处理函数：

- `lingji_create_project` 创建空工程，磁盘上出现 `project.json`。
- `lingji_get_project_state` 返回空工程的真实产物状态。
- `lingji_open_project` 使桌面切换工程；随后 `lingji_get_active_project` 返回该目录。
- `lingji_get_editor_state` 经过 Renderer IPC 返回同一个工程目录。
- `lingji_list_tasks` 返回空任务列表；页面异常 0。

现有工具包括工程/脚本、媒体转原稿、任务查询、TTS/字幕/封面生成、卡片操作和单工程导出。`lingji_import_video_source` 的参数是单个来源与项目目录；`lingji_export_video` 的参数是 `projectPath` 和可选 `out`。它们不能直接证明新的批量录屏/高光队列、授权素材检索、独立混剪版本或账号发布矩阵已接通。

MCP 清单没有出现九类生产动作的相同标识，Schema 中也没有本次检查的 `recordingIds`、`highlightId`、`compositionPlanId`、`videoVariantId`、`activityGrantId`、`accountIds`。名称/字段缺失本身**不是**“任何别名均不可实现”的证明。结合完整注册入口和 `electron/mcp` / `electron/pipeline` 的依赖检查，当前没有调用新的高光/混剪/新队列或 `agent-action-gate` 服务；该门控的纯函数通过仍不能代替生产工具执行。

本轮新增了基础 MCP 运行时证据和项目盘隔离 home 的首次初始化失败证据。R5 的可信活动授权、九类动作接线、Skills 与工具映射、可暂停审计闭环及发布最终状态仍未完成；不能用 31 个工具的数量关闭 R5。R1–R6 全部目标继续保留。

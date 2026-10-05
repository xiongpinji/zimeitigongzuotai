# R5 智能体渲染混剪版本：源码接线与离线验收

2026-10-05，在既有 `build_compositions` 一次性生成入口之后，为 `render_variants` 增加独立的 30 分钟当前工程授权。桌面端先显示并选择混剪批次，用户点击“准备供智能体渲染一次”；生产 MCP 工具只接收空参数，从主进程消费这份一次性选择。工程变化、授权缺失/到期/撤销、重复调用均拒绝。MCP 只返回版本 ID、状态和安全错误码，不返回本地成片路径。

渲染核心在排队后、编码前与写出成片前后重新核对主进程授权；编码中撤销时取消活跃批次。若授权在编码期间或状态写入时失效，会移除该次成片并把状态改为失败。混剪来源、素材使用许可、输出哈希和审核状态继续由原有 R4 渲染与复核流程校验。渲染完成仅表示有待审核文件，不能推断平台“原创”标签，也不触发账号登录、商品挂载或平台发布。

验证：先新增失败用例，复现编码期间撤销后仍可能落成片，以及桌面预备渲染入口缺失；另补授权在完成状态写入后失效的回滚测试。实现后 `tests/composition*` 与 `tests/production*` 共 23 个文件、247 项测试通过；`npx tsc --noEmit -p tsconfig.node.json`、`npx tsc --noEmit -p tsconfig.json` 与 `npm run build` 均退出 0。源码构建不是安装包。隔离的真实 Electron + MCP HTTP 探针 `node scripts/smoke-production-mcp-win.cjs` 退出 0，结果在 Git 忽略目录 `data/runtime/validation/r5-mcp-1791200763540/`：生产工具列表出现 `lingji_production_render_variants`；无授权返回 `grant_missing`，仅有混剪生成授权时返回 `action_not_allowed`，渲染授权但未在桌面准备时返回 `not_prepared`，撤销后再次返回 `grant_missing`。旧编辑工具仍为 31 项，未触碰真实发现文件。

随后新增可复跑的 `app/scripts/probe-agent-render-mcp-win.cjs`，在隔离用户目录里预置合成录屏、高光候选、人工审核收据和三版工程，经真实 Electron 桌面 IPC 准备一次渲染，再通过生产 MCP HTTP 发起真实 Remotion 编码。最终运行 `node scripts/probe-agent-render-mcp-win.cjs` 退出 0，证据在 Git 忽略目录 `data/runtime/validation/r5-agent-render-1791202465674/`。三版均为 `completed`，输出分别为 264405、259305、258067 字节；三份 SHA-256 不同且与状态文件一致，FFmpeg 完整解码通过。打开工程后采样的根工程与三版工程/清单哈希在渲染前后未变；第二次 MCP 调用返回 `not_prepared`，真实用户目录的发现文件元数据未变。最初夹具收据字段顺序错误时，主进程正确返回三个 `clip_unavailable`，修正夹具后才进入编码；这一失败不算生产源码缺陷。

此探针的审核收据与版本计划由测试代码构造，三版各含约 1 秒合成画面；它证明真实桌面/MCP/渲染链贯通，不证明真实直播录屏的高光与叙事质量。分钟级长视频可能超过 MCP 客户端等待时间，尚未验证中途撤销的真实编码行为、跨进程结果查询或恢复，更不能替代真实录屏双人复核、四平台授权账号或最终发布结果。

按照用户要求，本轮不制作安装包、不连接真实账号、不向平台发布。

## 同日补测：启动即返回与持久状态查询

生产 MCP 的 `lingji_production_render_variants` 现在只启动桌面已准备的一次性任务，立即返回批次和版本 ID；新增 `lingji_production_get_render_status` 按 ID 读取每版持久状态。两次工具调用都重核当前工程的限时渲染授权，状态响应仅含版本状态和安全错误码。这样较长的编码任务不再占用单次 MCP HTTP 调用；客户端仍须自行轮询，并在授权到期后重新由工程所有者授权。进程重启留下的 `queued` 或 `rendering` 状态会转为 `unknown/interrupted`，不会自动重试。

首次端到端轮询出现部分版本 `render_failed`。隔离探针的临时诊断确认是 Windows 在状态读取同时短暂拒绝覆盖 `render-state.json`，报 `EPERM`；该诊断代码已移除。先加可复现的失败测试，再对状态文件原子替换增加有上限的短时重试。最终 23 个混剪/生产相关测试文件共 250 项通过，两套 TypeScript 类型检查与源码构建退出 0；`node scripts/smoke-production-mcp-win.cjs` 退出 0，旧编辑工具仍为 31 项，生产工具为 9 项，结果在忽略目录 `data/runtime/validation/r5-mcp-1791204742395/`。

`node scripts/probe-agent-render-mcp-win.cjs` 连续两次退出 0，证据分别位于忽略目录 `data/runtime/validation/r5-agent-render-1791204677080/`、`data/runtime/validation/r5-agent-render-1791204970265/`。启动调用分别在 59 毫秒、82 毫秒返回，均早于全部编码完成；轮询后 3 个版本均为 `completed`，哈希各不相同且 FFmpeg 完整解码通过，一次性准备消费和原工程文件不变检查通过。两次探针共用同一源码构建，其 `app/dist-electron/main.js` SHA-256 为 `5d9a72c8b0c8c38f4c4dea0391dca7d280ec0e47e2298905727ef57f61f5cab9`。

此轮只证明隔离合成短片的真实桌面/MCP/Remotion 路径。分钟级长视频、进程中断后的人工恢复流程、真实录屏审片和四平台最终状态仍未验收；没有打包、真号登录或发布。

# R5 智能体渲染混剪版本：源码接线与离线验收

2026-10-05，在既有 `build_compositions` 一次性生成入口之后，为 `render_variants` 增加独立的 30 分钟当前工程授权。桌面端先显示并选择混剪批次，用户点击“准备供智能体渲染一次”；生产 MCP 工具只接收空参数，从主进程消费这份一次性选择。工程变化、授权缺失/到期/撤销、重复调用均拒绝。MCP 只返回版本 ID、状态和安全错误码，不返回本地成片路径。

渲染核心在排队后、编码前与写出成片前后重新核对主进程授权；编码中撤销时取消活跃批次。若授权在编码期间或状态写入时失效，会移除该次成片并把状态改为失败。混剪来源、素材使用许可、输出哈希和审核状态继续由原有 R4 渲染与复核流程校验。渲染完成仅表示有待审核文件，不能推断平台“原创”标签，也不触发账号登录、商品挂载或平台发布。

验证：先新增失败用例，复现编码期间撤销后仍可能落成片，以及桌面预备渲染入口缺失；另补授权在完成状态写入后失效的回滚测试。实现后 `tests/composition*` 与 `tests/production*` 共 23 个文件、247 项测试通过；`npx tsc --noEmit -p tsconfig.node.json`、`npx tsc --noEmit -p tsconfig.json` 与 `npm run build` 均退出 0。源码构建不是安装包。隔离的真实 Electron + MCP HTTP 探针 `node scripts/smoke-production-mcp-win.cjs` 退出 0，结果在 Git 忽略目录 `data/runtime/validation/r5-mcp-1791200763540/`：生产工具列表出现 `lingji_production_render_variants`；无授权返回 `grant_missing`，仅有混剪生成授权时返回 `action_not_allowed`，渲染授权但未在桌面准备时返回 `not_prepared`，撤销后再次返回 `grant_missing`。旧编辑工具仍为 31 项，未触碰真实发现文件。

随后新增可复跑的 `app/scripts/probe-agent-render-mcp-win.cjs`，在隔离用户目录里预置合成录屏、高光候选、人工审核收据和三版工程，经真实 Electron 桌面 IPC 准备一次渲染，再通过生产 MCP HTTP 发起真实 Remotion 编码。最终运行 `node scripts/probe-agent-render-mcp-win.cjs` 退出 0，证据在 Git 忽略目录 `data/runtime/validation/r5-agent-render-1791202465674/`。三版均为 `completed`，输出分别为 264405、259305、258067 字节；三份 SHA-256 不同且与状态文件一致，FFmpeg 完整解码通过。打开工程后采样的根工程与三版工程/清单哈希在渲染前后未变；第二次 MCP 调用返回 `not_prepared`，真实用户目录的发现文件元数据未变。最初夹具收据字段顺序错误时，主进程正确返回三个 `clip_unavailable`，修正夹具后才进入编码；这一失败不算生产源码缺陷。

此探针的审核收据与版本计划由测试代码构造，三版各含约 1 秒合成画面；它证明真实桌面/MCP/渲染链贯通，不证明真实直播录屏的高光与叙事质量。分钟级长视频可能超过 MCP 客户端等待时间，尚未验证中途撤销的真实编码行为、跨进程结果查询或恢复，更不能替代真实录屏双人复核、四平台授权账号或最终发布结果。

按照用户要求，本轮不制作安装包、不连接真实账号、不向平台发布。

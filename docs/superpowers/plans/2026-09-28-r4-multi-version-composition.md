# R4 多叙事混剪实现计划

> **面向 AI 代理的工作者：** 按已确认的阶段一方案逐项执行，Codex 对每项完整差异与测试作独立复核。用户已指定当前会话由 Codex 直接补完失败路由的任务；商品挂载、打包、真号发布不在本轮源码测试范围。

**目标：** 从审核切片与授权素材生成三份具有可审计叙事意图的计划，分别落入可编辑 Lingji 时间线，受控批量渲染并送相似度和人工复核。

**架构：** 现有生产契约保持 v1 JSON 可读，给新合成计划添加结构化编辑意图和同段 B-roll 视觉层；只有完整字段的新计划能进入 R4 自动路径。主进程从审核收据和素材库校验真实媒体，再为各计划写独立子工程；渲染与复核状态存项目内，不覆盖已有时间线。

**技术栈：** TypeScript、Electron IPC、Lingji `ProjectData`/`TimelineData`、Remotion、FFmpeg、Vitest；录屏/素材与渲染产物保存在项目数据目录或 Git 忽略目录。

---

## 文件职责

- `app/src/types/production-contracts.ts`、`app/src/lib/production-document.ts`：结构化编辑意图与来源引用的兼容解析。
- `app/electron/composition/plan-proposals.ts`：模型候选端口、三版计划字段校验及结构重复提醒；模型结果永不自行宣称原创。
- `app/electron/composition/source-resolver.ts`：审核切片与素材库的哈希、授权、时间码解析。
- `app/electron/composition/timeline-builder.ts`：将单版计划变成视频、原声、B-roll、文字图层；不接触账户与发布。
- `app/electron/composition/version-projects.ts`：同一项目内的三份独立 Lingji 工程、计划清单和崩溃恢复。
- `app/electron/composition/render-batch.ts`：调用既有 Remotion 路径，限制并发、记录产物哈希与未知状态。
- `app/electron/composition/review.ts`：文本/时间码/帧/音频对照报告与人工盲审记录。
- `app/electron/composition/composition-ipc.ts`、`app/src/components/composition/CompositionWorkbench.tsx`：受限桌面桥与产品操作界面；主进程决定文件路径和授权。

## 任务 1：结构化计划契约

**文件：** 修改 `app/src/types/production-contracts.ts`、`app/src/lib/production-document.ts`；测试 `app/tests/production-contracts.test.ts`、`app/tests/composition-plan-contract.test.ts`。

- [x] 写失败测试：旧 v1 计划 JSON 原样往返；新增计划包含 `editorial`（目标受众、中心问题、开场主张、结尾信息、逐段音画意图）和 `visualLayer`（素材 ID、源时间码、用途）；任一未知字段、悬空素材、越界时间码、疑似凭证字段均拒绝。
- [x] 运行 `cd app; npx vitest run tests/production-contracts.test.ts tests/composition-plan-contract.test.ts`，确认新增测试因缺少结构化字段解析而失败。
- [x] 新增向后兼容的可选结构化字段，保留旧 v1 读取；严格检查新增引用与文本长度。生成路径要求字段齐全，旧计划不能被误标为 R4 合成完成；生成路径将在任务 2 接线。
- [x] 聚焦测试、全量 Vitest、`npx tsc --noEmit`、`npx electron-vite build` 通过后按精确文件提交。本轮证据见 `docs/validation/r4-composition-plan-contract-2026-09-28.md`。

## 任务 2：三版模型候选与重复闸门

**文件：** 创建 `app/electron/composition/plan-proposals.ts`、`app/tests/composition-plan-proposals.test.ts`。

- [x] 写失败测试：模型端口必须返回至少三份引用有效的候选；相同片段序列仅换封面/BGM、仅换顺序且没有新的中心问题/证据路径、空白主张、越界来源均不能成为“可审片的三版”；模型不可用时停止，不用随机排列凑数。
- [x] 运行 `npx vitest run tests/composition-plan-proposals.test.ts`，先观察缺少模块、重复候选和可变批准列表等失败，再逐项修复。
- [x] 实现端口 `proposePlans(input, generate)`：生成器只接收获准进模型的时间码、匿名主题/转写片段与素材描述；输出候选计划及 `reviewRequired: true`，批次返回模型/提示版本供后续持久化。自动相似性只形成明显重复退回或人工复核标记，不作为平台认定。
- [x] 聚焦测试、全量 Vitest 与类型检查通过后按精确文件提交。证据见 `docs/validation/r4-plan-proposals-2026-09-28.md`。

## 任务 3：媒体解析与授权快照

**文件：** 创建 `app/electron/composition/source-resolver.ts`、`app/tests/composition-source-resolver.test.ts`。

- [x] 写失败测试：高光必须有人工审核收据，源绝对时间码可映射到切片内相对时间码；收据哈希/视频字节不一致、素材授权撤销/过期、B-roll 类型错误或时间码超界均阻断；再次调用时重新验证。
- [x] 运行聚焦测试看红灯，覆盖异步任务状态、重复顺序、非法平台、篡改高光范围和回填过期授权时间。
- [x] 通过 `ProductHighlightController`、`ReviewedClipExporter.verifiedOutput`、`LocalAssetLibrary.verifiedForUsage` 取可信路径和权限，不接受 renderer 提供的任意路径。保留录屏原哈希、审核收据、素材授权证据和目标使用上下文的引用。
- [x] 聚焦测试、全量离线回归、类型检查和源码构建通过后按精确文件提交。证据见 `docs/validation/r4-composition-source-resolver-2026-09-28.md`。
- [ ] 任务 5 的真实渲染调度必须在启动每版渲染前再次调用解析器；当前仅验证了重复调用的阻断行为。

## 任务 4：可编辑时间线和独立版本工程

**文件：** 创建 `app/electron/composition/timeline-builder.ts`、`app/electron/composition/version-projects.ts`、对应测试。

- [x] 写失败测试：原声和视频的相对入点相同，B-roll 在更高视觉轨但不截断原声，开场/结尾文字可编辑；三版保存为三个不同工程，主项目 `project.json` 不被覆盖；重开三版后来源哈希和时间线相同。
- [x] 运行聚焦测试看红灯，两个新增模块均先因缺失而失败。
- [x] 使用 `createDefaultTimeline`、`videoData.trimStartMs`、`audioData.trimStartMs` 和既有项目文件格式构建；目标路径只能位于当前项目的 `compositions/<batch-id>/<plan-id>/`，目录级原子提交，遇到不同内容的同名工程拒绝覆盖。已编辑的时间线可重开但标记为 `timelineModified`，渲染前必须重新审阅并核验来源。
- [x] 聚焦测试、类型检查与 synthetic Remotion 实际渲染通过后提交。源码提交 `8da84c9`、`8bd9199`；离线证据见 `docs/validation/r4-timeline-version-projects-2026-09-28.md`。GLM 外部只读审查因百炼月额度 429 未完成，不能据此宣称 R4 验收。

## 任务 5：批量渲染、恢复与质检

**文件：** 创建 `app/electron/composition/render-batch.ts`、`app/electron/composition/review.ts`、对应测试。

- [ ] 写失败测试：两 worker 上限、单版失败不影响其他版本、取消、重启后已完成产物按哈希复用、不确定渲染不得盲重试；对照重复计划被标记待复核。
- [ ] 运行聚焦测试看红灯。
- [ ] 复用 `renderVideoHeadless`，输出每版状态、哈希和技术错误代码；文本、来源镜头区间、画面指纹、音频指纹分别给出相似度证据，不以阈值自动宣布原创。
- [ ] 聚焦测试、类型检查与至少三版合成输入实际渲染通过后提交。

## 任务 6：产品接线和 R4 验收

**文件：** 创建 `app/electron/composition/composition-ipc.ts`、`app/src/components/composition/CompositionWorkbench.tsx`，修改 `app/electron/main.ts`、`app/electron/preload.ts`、`app/src/lib/electron-api.ts`、`app/src/App.tsx`、工作台标签和对应测试。

- [ ] 写失败测试：只有主窗口能选审核切片与素材、生成三版、审阅计划、打开独立时间线、批量渲染；任何未核实授权或媒体变化要在页面给出明确错误；没有人工审片结果不能把版本标为通过。
- [ ] 运行聚焦测试看红灯。
- [ ] 主进程注册受限 IPC，UI 只传 ID、平台/地区/用途和编辑意见；不传任意路径、凭证或素材字节给模型。产品页能打开每版工程回到既有剪辑台。
- [ ] 运行全量 Vitest、`npx tsc --noEmit`、`npx electron-vite build`、独立 diff 审查；归档真实已授权样本的双人盲审之前，R4 维持未通过。不运行安装包或真实平台发布。

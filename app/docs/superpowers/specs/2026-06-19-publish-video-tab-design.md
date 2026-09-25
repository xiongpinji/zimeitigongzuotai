# 发布视频 Tab 设计（social-auto-upload → Node 移植）

- 日期：2026-06-19
- 状态：设计已确认，待评审 → writing-plans
- 关联：参考源 `/Users/yoqu/Documents/social-auto-upload`（Python + Playwright）

## 1. 目标

在「写稿工作台」「视频编辑器」之外，新增第三个工程内 tab「发布视频」，提供 GUI 表单一键把工程导出的 MP4 发布到多个国内平台。能力来自 social-auto-upload（sau），但**全部移植成 TypeScript 跑在 Electron 主进程**，不引入任何 Python 运行时。

首期平台：**抖音 / 视频号 / 小红书 / 快手 / B 站**（5 个）。

## 2. 核心架构决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 集成方式 | 把 sau 的 uploader 逻辑 **1:1 港成 TS**，跑在 Electron 主进程 | 消除 Python 运行时/打包难题，与 pi 进程内迁移方向一致；原 Python 仓库仅作参考 |
| 浏览器自动化引擎 | **Playwright (npm)**，首期随包一份 Chromium | sau 源码就是 Playwright Python，API/选择器/storageState 几乎逐字对应，移植是机械翻译 |
| B 站引擎 | spawn **biliup 二进制**（非 Playwright） | sau 现状即如此；biliup 是独立 Rust 二进制，跨平台 |
| biliup 获取 | **随包内置二进制**（asarUnpack，构建期拉取各平台产物） | 离线可用、首次免联网 |
| 交互形态 | **GUI 表单**（非命令运行器；首期不暴露给 agent/MCP） | 最符合桌面工具体验 |
| tab 位置 | **工程内 tab**（与写稿/编辑器并列的 WorkspaceTab） | 默认发布当前工程导出的 MP4，链路最顺 |
| 账号管理 | **独立 Settings「发布账号」tab**（全局账号库） | 账号跨工程；职责清晰，发布 tab 只选账号 |
| 多平台发布 | **一键多平台同发**（多选账号，统一文案 + 各账号/平台覆盖） | sau 核心卖点 |
| 发布执行 | **默认串行**，单 target 失败不连坐；并发留接口 | 更稳、抗风控、日志清晰 |
| 上传模式 | **默认 headless**（可设置切 headed 排障）；登录为 headed/扫码 | 体验与稳定平衡 |

## 3. 模块边界

### 主进程 `electron/publish/`
- `types.ts` — 共享类型（见 §4）
- `engine.ts` — 引擎抽象，支持两种后端：
  - Playwright 后端：headed 登录窗口 / headless 上传，复用同一份随包 Chromium
  - biliup 后端：spawn biliup 二进制
- `accounts.ts` — 全局账号库：每账号一份 Playwright `storageState` JSON（与 Python 版同 schema，**现有 cookies 可一键导入**），存
  `userData/publish/accounts/<platform>_<account>.json` + `registry.json`（账号清单）
- `biliup-runtime.ts` — 港 `uploader/bilibili_uploader/runtime.py`：定位/spawn 内置 biliup（ensure → spawn），缓存目录 `userData/publish/tools/biliup/<platform-key>/`
- `platforms/douyin.ts` / `tencent.ts` / `xiaohongshu.ts` / `kuaishou.ts` — Playwright，导出 `login()` / `checkCookie()` / `uploadVideo()`，选择器与流程从对应 `uploader/*/main.py` 逐字翻译
- `platforms/bilibili.ts` — biliup 后端，`login()`（扫码 QR）/ `checkCookie()`（renew）/ `uploadVideo()`（带 tid）
- `ipc.ts` — 注册 publish 相关 IPC

### IPC 三件套（CLAUDE.md 铁律，必须同步）
- `electron/main.ts` — 注册 handler
- `electron/preload.ts` — 暴露 `publishAPI`
- `src/lib/electron-api.ts` — 类型契约（含 `AppPage` 增加 `'publish'`）
- 相关测试

IPC（草案）：`publish:list-accounts`、`publish:login`、`publish:check`、`publish:delete-account`、`publish:import-cookies`、`publish:run`、`publish:cancel`；事件流 `publish:progress`。

### Renderer
- `src/store/publish.ts` — Zustand：账号列表、发布任务、表单态
- 工程内 tab：`WorkspaceTabs` 增加第三个 tab；`App.tsx` 用 `display` 切换挂载（与 editor/script-workbench 同模式）；`AppPage` 增加 `'publish'`
- `src/components/publish/PublishWorkbench.tsx`（及子组件）
- Settings 新增 `src/components/settings/PublishAccountsTab.tsx`

## 4. 数据模型（`electron/publish/types.ts`）

```ts
type PublishPlatform = 'douyin' | 'tencent' | 'xiaohongshu' | 'kuaishou' | 'bilibili';

interface PublishAccount {
  id: string;              // `${platform}_${accountName}`
  platform: PublishPlatform;
  accountName: string;     // 用户自定义名，如 "一叶知秋"
  storageStatePath: string;
  status: 'valid' | 'expired' | 'unknown';
  lastCheckedAt?: number;
}

interface PublishTarget {            // 多平台同发时每个被选账号一项
  accountId: string;
  overrides?: { title?: string; desc?: string; tags?: string[] };
  bilibili?: { tid: number };        // B 站专属：分区 id（B 站必填）
}

interface PublishJob {
  id: string;
  filePath: string;                  // 要发布的 MP4
  shared: {
    title: string; desc: string; tags: string[];
    thumbnail?: string; scheduleAt?: number;
  };
  targets: PublishTarget[];
  results: Record<string, PublishResult>;   // accountId -> 结果
}

interface PublishResult {
  state: 'pending' | 'running' | 'success' | 'failed';
  percent?: number;
  message?: string;
  startedAt?: number; finishedAt?: number;
}
```

## 5. 发布 tab UI / 交互流

工程内 tab，默认文件来源 = 最近一次导出路径 + 扫描工程目录下 `*.mp4` + 文件选择器兜底。

```
┌─ 发布视频 ─────────────────────────────────┐
│ 视频文件:  [project-export.mp4    ] [选择…] │
│ 缩略图:    [可选 拖拽/选择]                  │
├────────────────────────────────────────────┤
│ 统一文案                                     │
│   标题/描述/标签/定时（立即|定时）            │
├────────────────────────────────────────────┤
│ 发布到（多选账号，跨平台）                    │
│   ☑ 抖音·一叶知秋    [校验✓] [文案覆盖▸]      │
│   ☑ 视频号·一叶知秋  [校验✓] [文案覆盖▸]      │
│   ☑ B站·一叶知秋     [校验✓] [分区(tid)*▸]   │
│   ☐ 小红书·一叶知秋  [cookie过期·重登]       │
│   ☐ 快手·一叶知秋    [未登录·去设置]         │
├────────────────────────────────────────────┤
│            [ 一键发布 (N 个目标) ]           │
├────────────────────────────────────────────┤
│ 发布进度（每平台一行，实时状态/日志）         │
└────────────────────────────────────────────┘
```

- 账号行从全局账号库**只读**拉取；过期/未登录给"重登/去设置"入口（跳 Settings·发布账号）。
- "文案覆盖"折叠区放各账号单独标题/描述/标签。
- **B 站专属**：被选中时展开 **分区(tid) 必填** + desc 必填校验。
- 进度区是 tab 内内容反馈，**同时**上报底部统一进度系统。

## 6. 账号库与登录（Settings · 发布账号）

- **添加账号**：选平台 + 填账号名 → `publish:login`：
  - 非 B 站：主进程开有头 Playwright 窗口导航到创作者页 → 用户扫码/登录 → `context.storageState()` 落盘 → registry 记一条，状态 `valid`。
  - B 站：spawn `biliup login` → 取 `qrcode.png` → 应用内弹窗显示二维码 → 轮询直到完成 → cookie JSON 落库。
- **校验**：`publish:check`：
  - 非 B 站：用 storageState 起 headless context 访问创作者后台判断登录态。
  - B 站：`biliup -u <account.json> renew`，returncode 0 即有效。
  - 更新 `status` / `lastCheckedAt`。
- **重登 / 删除**：重登覆盖 storageState；删除清 registry + 删文件。
- **导入现有 cookies**（可选）：从 `social-auto-upload/cookies/*.json` 一键导入（同 storageState schema）。

## 7. 发布执行（`publish:run`）

1. 校验文件存在 + 至少一个 target；B 站 target 校验 tid/desc 必填。
2. 每个 target 用该账号 storageState 起 context（默认 headless，可切 headed）→ 调对应 `platforms/<p>.uploadVideo(...)`；B 站走 biliup spawn。
3. **默认串行**执行，每完成一个回报结果。并发开关留接口，首期不做。
4. 主进程经 `publish:progress` 事件把每 target 的 `state/percent/message` 推给 renderer。

### 进度系统接入（CLAUDE.md 铁律）
- 整个发布任务 = 一个父任务 `startTask`；每 target = 子状态经 `updateTask`；全成功 `completeTask`，有失败 `failTask`。
- 复用 `pipeline:task-update → src/lib/pipeline-progress-bridge.ts` 桥，不新造顶部条/弹窗。

## 8. 错误处理

- 登录超时 / 用户关窗 → 取消该流，账号状态不变，UI 提示。
- 上传中 cookie 失效 → 该 target `failed` + 提示去重登，**不影响其他 target**。
- 选择器失效（平台改版）/ biliup 非零退出 → 单 target 失败 + 可读 message + 写日志，不崩整任务。
- 取消 `publish:cancel` → 关闭对应 context / 终止 biliup 进程；已成功 target 不回滚。
- 所有 Playwright context/browser、biliup 子进程在 finally 中确保关闭/回收，避免泄漏。

## 9. 打包 / 依赖（高风险，对照 pi 的 asar/ESM 经验）

- 新增 `playwright` 依赖，首期随包一份 Chromium。
- Playwright 浏览器二进制不能进 asar：`asarUnpack` + 设 `PLAYWRIGHT_BROWSERS_PATH` 指向解包路径（同 `@remotion/renderer` Chrome Headless Shell 处理）。
- biliup 二进制随包内置：构建期按平台拉取 GitHub release 产物，`asarUnpack`，运行时定位解包路径。
- 打包脚本（`scripts/package-mac-helpers.cjs` 等）纳入浏览器与 biliup；Win 打包 spawn 用 `npm.cmd`。
- 体积涨几百 MB（自带 Chromium）——已知代价，后续可换 `playwright-core` 复用现有 Chrome 优化。

## 10. 测试

- Vitest 覆盖纯函数：`accounts.ts`（registry CRUD、storageState 路径推导、cookies 导入解析）、`biliup-runtime.ts`（平台 key/资产选择/路径推导，spawn 注入 mock）、参数拼装、IPC 契约 mock。
- 平台 uploader 真实 Playwright/biliup 流程不进 CI（依赖真实登录态/外网/风控），手动验收；函数结构做到可注入 page/spawn mock，至少能跑"调用顺序"单测。
- IPC 三件套同步后跑相关测试。

## 11. 范围边界

**首期包含**
- 抖音 / 视频号 / 小红书 / 快手 / B 站：登录、校验、视频上传、一键多平台同发、统一文案 + 各账号覆盖、定时、缩略图、B 站 tid。
- 工程内发布 tab + Settings 发布账号库 + 进度接入。

**首期不含**
- 图文 upload-note；TikTok / YouTube / 百家号；agent/MCP 暴露；并发发布开关（留接口）；体积优化（playwright-core 复用浏览器）。

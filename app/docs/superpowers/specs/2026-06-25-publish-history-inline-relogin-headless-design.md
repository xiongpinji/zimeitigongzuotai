# 发布历史 + 内联重登 + 无头登录默认 — 设计规格

日期：2026-06-25
分支：feat/volcengine-ark-provider（当前工作分支）
状态：已确认，待实现计划

## 1. 背景与目标

项目详情页「发布」tab（`PublishWorkbench`）当前只有一次性的发布表单与内存态发布进度，关闭应用即丢失。登录入口只在「设置 > 发布账号」，发布失败（如 cookie 过期）时用户必须跳到设置页重登。登录强制有头浏览器。

本次目标：

1. 发布 tab 内新增**发布历史**：持久化记录该项目的发布情况，可查看每次发布各账号结果，可一键**重新发布**。
2. 发布失败时**就地重新登录**（不跳设置页），复用现有二维码事件在发布 tab 内扫码。
3. 登录**默认无头模式**，设置页提供开关切换有头作为兜底。

## 2. 已确认决策

| 决策点 | 选择 |
| --- | --- |
| 历史存储范围 | 保留最近 N 条（N=20），新→旧，超出淘汰；不按天分组 |
| 历史记录粒度 | 按发布任务一条（含各账号结果） |
| 重登成功后行为 | 仅标记账号为 valid，不自动重发（用户手动再点重新发布） |
| 无头登录 + 抖音 | 默认无头；**抖音也走无头**（用户已知反爬风险，以有头开关兜底） |
| 历史归属 | 项目级，存 `project.json`，随项目走 |

## 3. 现状关键事实（实现依据）

- `electron/publish/types.ts`：`PublishJob` / `PublishShared` / `PublishTarget` / `PublishResult` / `PublishAccount`（`status: 'valid'|'expired'|'unknown'`）。
- `electron/publish/ipc.ts`：`publish:login(platform, accountName)`、`publish:check(id)`、`publish:run(job, headless=true)`、`publish:qrcode` 事件、`publish:progress` 事件。
- `electron/publish/accounts.ts`：账号注册表 `userData/publish/registry.json` + cookie `userData/publish/accounts/*.json`。
- 各 `platforms/*.ts`：`login` 当前写死 `headless: false`；`uploadVideo` 透传 `opts.headless`；抖音 `login`/`checkCookie` 因反爬必须有头（本次按用户选择改为透传设置）。
- `src/store/publish.ts`：`accounts` / `job` / `results`（内存，不落盘）；`startPublish(filePath, shared, targets, headless=true)`。
- `src/lib/project-persistence.ts`：`ProjectPublishMeta { title, desc, tagsInput, thumbnail, covers?, bilibiliTid?, overrides? }`，存 `project.json` 的 `publish` 节。
- `src/components/publish/PublishWorkbench.tsx`：发布表单 + 账号多选 + 「发布进度」区块（`ResultRow`）；600ms 防抖写回 `publish` 元数据。发布失败的 `results[accountId].message` 是不区分类型的字符串。
- 登录失败/错误不区分 cookie 过期与其他错误，统一为 message 字符串。

## 4. 数据模型

### 4.1 发布历史条目（新增）

新增到 `src/lib/project-persistence.ts` 的 publish 节：

```ts
interface PublishHistoryEntry {
  id: string;                 // 唯一 id
  publishedAt: number;        // 发布发起时间戳（毫秒）
  fileName: string;           // basename(filePath)，列表展示用
  filePath: string;           // 重发用
  shared: {                   // 重发用，等价于 PublishShared 的可序列化子集
    title: string;
    desc: string;
    tags: string[];
    covers?: { '16:9'?: string; '4:3'?: string; '3:4'?: string };
    thumbnail?: string;
    bilibiliTid?: number;
  };
  targets: Array<{
    accountId: string;
    platform: PublishPlatform;
    accountName: string;
    bilibiliTid?: number;
  }>;
  results: Record<string, { state: 'success' | 'failed'; message?: string }>; // 按 accountId
  overallState: 'success' | 'partial' | 'failed';
}

interface ProjectPublishMeta {
  // ……现有字段保持不变……
  history?: PublishHistoryEntry[]; // 新增，最近 20 条，新→旧
}
```

- 容量上限 `PUBLISH_HISTORY_MAX = 20`；新条目置于数组头部，`slice(0, 20)`。
- 迁移兼容：旧 `project.json` 无 `history` 字段时读为 `[]`，不破坏旧工程。

### 4.2 发布设置文件（新增）

`userData/publish/settings.json`：

```ts
interface PublishSettings {
  headlessLogin: boolean; // 默认 true（无头登录）
}
```

由 `electron/publish/accounts.ts`（或同目录新建 `settings.ts`）读写，文件缺失时返回默认 `{ headlessLogin: true }`。

## 5. IPC 变更

新增/修改，三件套（`electron/publish/ipc.ts` + `electron/preload.ts` + `src/lib/electron-api.ts`）同步：

| IPC | 变更 | 签名 |
| --- | --- | --- |
| `publish:get-settings` | 新增 | `() => Promise<PublishSettings>` |
| `publish:set-settings` | 新增 | `(settings: Partial<PublishSettings>) => Promise<PublishSettings>` |
| `publish:login` | 改 | 增加 `headless` 参数：`(platform, accountName, headless: boolean) => Promise<{success, message}>` |

历史落盘**不新增 IPC**，沿用现有 `save-project-section`（写 `publish` 节）通道。

## 6. 主进程变更

- `electron/publish/ipc.ts`：
  - `publish:login` handler 接收 `headless` 并透传给 `getPlatform(platform).login({ ..., headless })`。
  - 新增 `publish:get-settings` / `publish:set-settings`。
- `electron/publish/types.ts`：`LoginOptions` 增加 `headless: boolean`；新增 `PublishSettings`。
- 各 `platforms/*.ts`：`login` 内 `headless: false` 改为 `opts.headless`（含抖音；抖音 `checkCookie` 保持现状不在本次范围）。
- 账号设置读写：新增 settings 文件读写函数，默认 `{ headlessLogin: true }`。

## 7. Renderer 变更

### 7.1 store/publish.ts
- `startPublish` 增加 `projectDir: string | null` 入参；任务全部完成（`job` 转 null）时组装 `PublishHistoryEntry`，读取当前 `project.json` 的 publish 节、把新条目插入 `history` 头部并截断到 20，调 `save-project-section` 落盘。
- `addAccount`（或新增 `loginAccount`）接收/读取 `headlessLogin` 设置并传给 `publish:login`。
- 新增读取/缓存 `PublishSettings` 的能力（`loadPublishSettings` / `setHeadlessLogin`）。

### 7.2 PublishWorkbench.tsx
- 「发布进度」区块下方新增**「发布历史」**折叠区，读取 `project.json` publish 节的 `history`：
  - 每条：`fileName` + 相对时间 + 整体状态徽章（success/partial/failed）。
  - 展开：各账号行（platform 图标 + accountName + 成功/失败 + 失败 message）。
  - 每条右侧「**重新发布**」：用该条 `filePath/shared/targets` 调 `startPublish(filePath, shared, targets, projectDir)`。
  - 失败账号行「**重新登录**」按钮（任何 failed 都显示）：触发 `publish:login`，复用 `publish:qrcode` 在发布 tab 内就地展示二维码；成功后 `checkAccount`/标记 valid，**不自动重发**。
- 发布 tab 内新增二维码展示区（复用 `PublishAccountsTab` 现有二维码渲染形态）。

### 7.3 PublishAccountsTab.tsx
- 新增开关「**登录使用有头浏览器**」（绑定 `!headlessLogin`），默认关；改写经 `publish:set-settings` 持久化。
- 现有「登录」「重新登录」按钮调用 `publish:login` 时带上 `headless = headlessLogin`。

## 8. 错误处理

- 底层错误不区分 cookie 过期与其他错误：失败账号一律显示「重新登录」入口，cookie 过期天然涵盖。
- 二维码登录异常：清理二维码展示与 loading 态，给出错误提示，不影响历史与其它账号。
- 历史落盘失败：记录日志，不阻断发布主流程。
- 无头登录失败（尤其抖音）：用户通过设置页有头开关兜底。

## 9. 测试与验证

- `src/lib/project-persistence.ts`：新增 `history` 字段的读写与旧工程迁移（无 `history` → `[]`），容量截断到 20。
- 发布设置文件读写：缺失返回默认、写入回读一致。
- `publish:login` 透传 headless（mock 平台 login 断言收到的 headless）。
- 涉及 IPC 三件套，必要时跑相关 Vitest 与 `npm run build` 验证类型。
- UI：发布历史展示、重新发布、就地重登二维码、设置有头开关，手动验收。

## 10. 不做（YAGNI）

- 不做按天分组 UI（用户选最近 N 条）。
- 不做重登后自动重发（用户选仅标记 valid）。
- 不做错误类型细分解析（统一 message）。
- 不改动抖音 `checkCookie` 的有头策略（仅改 `login`）。
- 不新增历史专用 IPC（复用 `save-project-section`）。

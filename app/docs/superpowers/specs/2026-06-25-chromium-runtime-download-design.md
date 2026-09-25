# Chromium 运行时按需下载 — 设计文档

- 日期：2026-06-25
- 状态：已确认设计，待实现计划
- 相关现有实现参考：`electron/publish/biliup-install.ts`（按需下载二进制的范式模板）

## 背景与目标

项目详情页「发布视频 / 发布账号」Tab 通过 Playwright 自动化抖音、视频号、小红书、快手四个平台。当前 Chromium 在**构建期**通过 `playwright install chromium` 打进 DMG/安装包（解压到 `app.asar.unpacked/playwright-browsers`），导致安装包体积膨胀约 150MB，且大多数用户从不发布视频，属于浪费。

目标：

1. **不再随包打包 Chromium**，让 DMG/安装包瘦身。
2. 在「发布账号」Tab 里**按需下载 Chromium 到用户数据目录**，跨平台（mac/win）。
3. 发布前**检测 Chromium 是否安装**，未安装则门控（禁用发布）并引导下载。
4. 下载进度复用项目**底部统一进度系统**，不新增独立弹窗/进度条。

非目标：

- 不改 B 站发布链路（B 站走独立 `biliup` 二进制，不依赖 Chromium）。
- 不改各平台自动化业务逻辑（仅改 Chromium 的获取与解析方式）。
- 不引入「复用系统已装 Chrome」方案（版本不可控、反爬 stealth 行为不稳定，已排除）。

## 核心决策（已与用户确认）

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 下载机制 | Playwright 官方 CLI + 国内镜像 | 官方维护版本匹配、跨平台、自动校验，工作量最小；版本随捆绑的 playwright 包自动对齐 |
| UI 位置 | 复用发布账号 Tab + 顶部状态卡 | 改动集中、风格统一；发布前在同一处门控 |
| 进度 UI | 复用底部统一进度系统 | 符合 `PROGRESS-SPEC.md` 铁律，不新增弹窗 |

## 架构与改动清单

### 1. 不再随包打包 Chromium（打包脚本）

- `scripts/package-mac.cjs`：删除运行 `playwright install chromium` 的步骤（约 line 141-153），不再向 stage 目录生成 `playwright-browsers`。
- `scripts/package-windows.cjs`：删除对应的 `playwright ... install chromium` 步骤（约 line 278-293）。
- `scripts/package-mac-helpers.cjs`：从 `RENDER_RUNTIME_ASAR_UNPACK_DIRS` 移除 `playwright-browsers`；**保留** `playwright` 与 `playwright-core`（运行时自动化代码 + install CLI 本身需要 unpack，体积小）。
- 验证点：打包后 `app.asar.unpacked/node_modules/playwright/cli.js` 仍存在且可用；`playwright-browsers` 不再存在。

### 2. 新模块 `electron/publish/chromium-install.ts`

对标 `biliup-install.ts` 的结构与进度阶段（`resolve → download → install`）。

- 安装根目录：`userData/publish/chromium/`，即作为 `PLAYWRIGHT_BROWSERS_PATH`。
- `getChromiumStatus(): { installed: boolean; version?: string; path?: string }`
  - 检测安装根目录下是否存在匹配**当前捆绑 playwright 版本**对应的 chromium 构建目录（playwright 以 `chromium-<revision>` 命名）。
  - revision 来源：读取捆绑 playwright 包的内置版本信息（避免硬编码）。
- `downloadChromium(onProgress, signal): Promise<void>`
  - 通过 `ELECTRON_RUN_AS_NODE=1` 用 `process.execPath` spawn `app.asar.unpacked/node_modules/playwright/cli.js install chromium`。
  - 注入环境变量：
    - `PLAYWRIGHT_BROWSERS_PATH = userData/publish/chromium`
    - `PLAYWRIGHT_DOWNLOAD_HOST = https://cdn.npmmirror.com/binaries/playwright`（国内镜像；官方源作为 fallback，必要时重试切换）
  - 解析子进程 stdout/stderr 的下载百分比与字节数，映射成统一进度阶段；阶段含义：
    - `resolve`：解析版本 / 启动 CLI。
    - `download`：下载 Chromium 压缩包（百分比 + 速度 + 总大小）。
    - `install`：解压安装到目标目录。
  - `signal`（AbortSignal）取消：kill 子进程并清理半成品目录，保证可重试。
  - 进度解析需**容错**：playwright 版本升级可能改变输出格式，解析失败时降级为「无百分比的忙碌态」而非报错中断。

### 3. 运行时解析改造 `electron/publish/engine.ts`

- `ensurePlaywrightBrowsersPath()`：
  - packaged 模式：指向 `userData/publish/chromium`（不再指向 `app.asar.unpacked/playwright-browsers`）。
  - dev 模式：保持 Playwright 默认缓存路径，不变。
- `withContext()` 启动前**预检**：若 Chromium 未安装，抛出结构化错误（如 `CHROMIUM_NOT_INSTALLED`），由上层 publish 流程透传给 UI，而不是在 `chromium.launch()` 时崩溃。

### 4. IPC 三件套

- `electron/publish/ipc.ts` 新增：
  - `publish:chromium-status` → 返回 `getChromiumStatus()`。
  - `publish:download-chromium` → 触发 `downloadChromium()`，通过 `publish:chromium-download-progress` 事件回传进度（仿 `onBiliupDownloadProgress`）。
  - `publish:cancel-chromium-download` → 取消下载。
- `electron/preload.ts` `window.publishAPI` 新增：`getChromiumStatus` / `downloadChromium` / `cancelChromiumDownload` / `onChromiumDownloadProgress`。
- `src/lib/electron-api.ts`：同步类型契约，保持与 preload 不漂移。

### 5. UI：复用发布账号 Tab（`src/components/settings/PublishAccountsTab.tsx`）

- 顶部新增一张 **Chromium 运行时组件状态卡**，与现有 biliup 卡并列：
  - 状态：「已安装（含版本）」/「未安装」。
  - 操作：「下载浏览器组件」按钮 → 调用 `downloadChromium`，进度走底部统一进度系统。
- **发布前门控**：当选中需要 Chromium 的平台（抖音 / 视频号 / 小红书 / 快手）且 Chromium 未安装时，禁用登录 / 发布按钮并提示「请先下载浏览器组件」。B 站不受影响（走 biliup）。
- 下载进度复用 `src/store/task-progress.ts` 的 `startTask / updateTask / completeTask / failTask`，与 biliup 下载一致；不新增弹窗或顶部条。

### 6. 数据流

```text
PublishAccountsTab (mount / 选中平台)
  → publishAPI.getChromiumStatus()
  → IPC publish:chromium-status → getChromiumStatus() → { installed, version }
  → installed=false → 显示「未安装」+ 门控发布

用户点「下载浏览器组件」
  → publishAPI.downloadChromium()  + startTask(底部进度)
  → IPC publish:download-chromium → spawn cli.js install chromium
        env: PLAYWRIGHT_BROWSERS_PATH=userData/publish/chromium
             PLAYWRIGHT_DOWNLOAD_HOST=npmmirror
  → 解析 stdout 进度 → publish:chromium-download-progress → updateTask
  → 完成 → completeTask → 重新 getChromiumStatus() → installed=true → 解除门控

发布时
  withContext() → ensurePlaywrightBrowsersPath()=userData/publish/chromium
  → 预检未安装则抛 CHROMIUM_NOT_INSTALLED（理论上已被 UI 门控拦截，作为兜底）
```

## 错误处理

- 下载失败（网络 / 镜像不可用）：镜像源失败时回退官方源重试；最终失败 `failTask` 并提示可重试，清理半成品目录。
- 取消下载：kill 子进程 + 清理半成品，状态回到「未安装」。
- 进度解析失败：降级忙碌态，不中断下载。
- 运行时 Chromium 缺失：`withContext()` 预检抛结构化错误，UI 引导下载（兜底）。

## 测试策略

- `electron/publish/chromium-install.ts` 纯逻辑单测：
  - 状态检测（存在 / 不存在匹配 revision 目录）。
  - 进度解析（典型 stdout 行 → 百分比 / 字节）。
  - 取消清理（mock 子进程，验证 kill + 半成品清理）。
- IPC 三件套契约一致性（main / preload / electron-api）。
- 不在 CI 跑真实网络下载。
- 打包脚本改动：本地 `npm run build` 验证 `playwright`/`playwright-core` 仍正确 unpack、`playwright-browsers` 不再产出；mac/win 实机打包验证留作发布前手动验收。

## 风险

1. **打包脚本改动属高风险**（构建产物结构变化）：需确保 `playwright` / `playwright-core` 仍正确 unpack，否则运行时找不到 `cli.js` 与自动化能力。
2. **packaged 环境 `cli.js` 路径定位**：需在打包后实机确认路径正确（`app.asar.unpacked/node_modules/playwright/cli.js`）。
3. **stdout 进度格式随 playwright 版本变化**：解析需容错，失败降级而非崩溃。
4. **首次发布体验变化**：用户首次发布前需等待 ~150MB 下载；通过门控 + 进度提示降低困惑。

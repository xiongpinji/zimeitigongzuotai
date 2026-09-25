# 声呐 Sonar — 抖音博主监听 Chrome 扩展

个人使用、无需上架的 Manifest V3 扩展。复用浏览器中抖音的正常登录态，采集喜欢的博主及其公开视频，发现新作品，优先解析无水印源并下载，本地完成字幕转录、AI 摘要、Markdown 导出与工作流管理。

> 设计文档：`docs/superpowers/specs/2026-06-19-douyin-chrome-extension-design.md`、`docs/superpowers/specs/2026-06-19-sonar-ui-design.md`。
> 本工程与仓库根的「灵机剪影」Electron 应用**完全隔离**：独立 `package.json`、构建、依赖与测试，不导入 `electron/` 下的 Node 模块，不修改 Electron IPC 或 `project.json`。

## 开发

```bash
cd extensions/sonar
npm install        # 独立依赖，不与根工程共享 node_modules
npm run dev        # Vite + CRXJS 开发（HMR）
npm run build      # 输出到 dist/，可「加载已解压的扩展程序」
npm test           # Vitest 单元测试（纯逻辑 + 固定夹具）
npm run typecheck  # tsc --noEmit
```

加载扩展：Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序 → 选择 `extensions/sonar/dist`。

## 架构（当前已落地的地基）

```text
Popup / Side Panel / 完整工作台
  → DouyinClient（UI 唯一入口，不直接碰 chrome.runtime）
  → 消息协议（可判别联合，protocolVersion/requestId/method/params）
  → Service Worker（路由、协调）
       → Content Script → MAIN World PageBridge → 抖音 fetch/XHR
       → DouyinAdapter（原始响应 → 稳定领域模型）
       → VideoSourceResolver（去重/排序/无水印证据分级）
       → DownloadManager / CreatorMonitor / ProcessingQueue（后续阶段）
```

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/domain/` | 领域模型与标准化错误（不暴露抖音原始字段） |
| `src/protocol/` | 跨上下文消息协议，版本/方法严格校验 |
| `src/content/` | Content Script 与 MAIN world PageBridge |
| `src/adapter/` | 抖音响应 → 领域模型（按响应类别拆分） |
| `src/resolver/` | 视频源去重、排序、无水印判断、文件名清理 |
| `src/background/` | Service Worker |
| `src/popup/` `src/side-panel/` `src/workbench/` | 四个产品表面 |
| `tests/` | 单元测试与脱敏夹具 |

## 实施阶段

见设计文档第 15 节。地基（工程骨架、领域模型、消息协议、PageBridge、抖音适配器、解析排序、下载、ASR、摘要、监控、导出）已落地并有回归测试。

四个 UI 表面已按用户原型 1:1 还原并接通 `DouyinClient`：

- **完整工作台**（`src/workbench/`）：macOS 深色磨砂壳 + 标题栏 + 侧栏（品牌 / 导航 / 监听博主快捷列表）。视图：动态流（列表 + 详情）、视频库（网格 + 6 筛选 + 全局搜索）、博主管理（卡片 + 监听开关）、工作流看板、设置。详情含封面、指标、下载/水印置信度、AI 摘要、关键要点、字幕转录。添加双 Tab 模态 + Toast。
- **Popup**（`src/popup/`）：380px，当前页面识别（监听 / 下载）、最近新视频、打开工作台 / Side Panel。
- **Side Panel**（`src/side-panel/`）：360px，动态流 / 视频库分段、上下文状态栏、竖向卡片、底部链接入库。
- **抖音注入**（`src/content/inject-ui.ts`）：Shadow DOM 浮层，博主页「加入声呐监听 / 已监听 / 同步」、视频页「下载原片 / 入库并分析 / 重点」。

共享视觉层在 `src/ui/`：`theme.ts`（取自原型的色板/字体 token）、`icons.tsx`、`kit.tsx`、`format.ts`、`video-status.ts`（已读/重点/归档本地状态，经 `chrome.storage.local` 跨表面同步）。

> 仍依赖后端补齐的点：博主「暂停/恢复监听」缺协议方法（工作台 toggle 暂为本地乐观态）；设置页的监听周期/下载目录/存储/诊断分组待后端配置接口。

## 安全边界

- 不保存或导出抖音 Cookie / Token / 完整认证请求头。
- 带签名视频地址仅作短期缓存。
- 音频与字幕仅在用户明确配置并确认后，发送给用户指定的 Provider。
- API Key 仅存 `chrome.storage.local`，不进 Chrome Sync、不写入导出或日志。

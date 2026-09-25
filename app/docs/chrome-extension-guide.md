# 灵机采风 Chrome 插件使用指南

> 灵机采风是灵机剪影配套的 Chrome 扩展，用来监听你关注的抖音博主、采集公开视频、本地转录字幕，并把成稿素材一键推送到灵机剪影桌面端的「待创作箱」，打通「监听选题 → 二次创作 → 成片发布」的链路。
>
> 工程位置：[`extensions/sonar/`](../extensions/sonar/)（目录代号 sonar，扩展安装后在浏览器中显示为「灵机采风」）。它与灵机剪影 Electron 应用**完全隔离**：独立 `package.json`、独立构建、独立依赖，不导入 `electron/` 下的任何 Node 模块。

## 这个插件能做什么

- **博主监听**：订阅你喜欢的抖音博主，定时（默认约 30 分钟）发现他们的新作品，并在工作台标记未读 / 重点。
- **主页滚动采集**：在博主主页滚动 DOM 采集其公开视频列表（以 `secUid` 作为博主 id），后台编排采集任务并展示进度。
- **无水印优先下载**：解析视频源、去重排序，并按证据分级判断无水印源，下载到浏览器默认下载目录。
- **本地转录**：在浏览器内通过 offscreen + `ffmpeg.wasm` 抽取音频，再调用 B站必剪（bcut）免费 ASR 生成字幕（也可配置 OpenAI 等 Provider）。
- **AI 摘要**：用你配置的 LLM Provider 生成摘要、关键要点和分类标签。
- **联动桥推送**：转录完成后把「文稿 + 元数据」推送到灵机剪影的「待创作箱」，在桌面端一键「生成初稿」开始二创。
- **本地优先**：所有数据保存在浏览器本地（`chrome.storage.local` + IndexedDB），不上架、不需要云端账号，复用浏览器里抖音的正常登录态（不导出 Cookie / Token）。

插件在浏览器工具栏显示为 **「灵机采风」**，并提供四个产品表面：Popup（弹窗）、Side Panel（侧边栏）、完整工作台、以及注入抖音页面的浮层。

## 一、安装

### 环境要求

- Chrome / Chromium **116 及以上**
- Node.js + npm（仅源码构建时需要）

### 官网 ZIP 安装（推荐）

下载地址：

```text
https://yoqu.github.io/lingji-cut-homepage/downloads/lingji-caifeng-chrome-extension-v0.1.0.zip
```

安装到 Chrome：

1. 下载 ZIP 后解压，得到 `lingji-caifeng-chrome-extension-v0.1.0` 文件夹。
2. 打开 `chrome://extensions/`。
3. 右上角打开「开发者模式」。
4. 点击「加载已解压的扩展程序」。
5. 选择刚解压出来的 `lingji-caifeng-chrome-extension-v0.1.0` 文件夹。
6. 工具栏出现「灵机采风」图标即安装成功。

可选校验：

```text
SHA256 5e6451ed56e7202e52a961c3b7e665d7756551e7ee0f8c4624914731929b8a3e
```

### 源码构建并加载

```bash
cd extensions/sonar
npm install      # 独立依赖，不与根工程共享 node_modules
npm run build    # 类型检查 + Vite 构建，输出到 extensions/sonar/dist/
```

> `prebuild` / `predev` 会自动执行 `scripts/copy-ffmpeg-assets.mjs`，把 `ffmpeg.wasm` 资源拷进工程（这些资源不入库）。

源码加载到 Chrome：

1. 打开 `chrome://extensions/`。
2. 右上角打开「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择 `extensions/sonar/dist` 目录。
5. 工具栏出现「灵机采风」图标即安装成功。

开发模式（带 HMR）：

```bash
npm run dev        # Vite + CRXJS 开发服务
npm test           # Vitest 单元测试
npm run typecheck  # tsc --noEmit
```

## 二、四个使用入口

| 入口 | 形态 | 用途 |
| --- | --- | --- |
| **Popup** | 点击工具栏图标弹出（约 380px） | 识别当前抖音页面（博主 / 视频），快速「监听 / 下载 / 入库并分析」，查看最近新视频 |
| **Side Panel** | 右侧边栏（约 360px） | 动态流 / 视频库分段浏览，粘贴抖音链接手动导入 |
| **完整工作台** | 独立标签页 | 动态流、视频库、博主管理、工作流看板、设置的完整界面 |
| **抖音页面浮层** | 注入在 douyin.com 页面的 Shadow DOM 浮层 | 博主页「加入监听 / 已监听 / 同步」、视频页「下载原片 / 入库并分析 / 重点」 |

## 三、配置（设置页）

进入「完整工作台 → 设置」完成以下配置。

### 1. 转录（ASR）

- 内置 **B站必剪（bcut）** 免费转录，**零配置**即可用。
- 音频会上传到 B站的接口完成识别，需勾选数据同意提示。

### 2. AI Provider（摘要 / 分析）

要使用摘要、关键要点、分类等能力，需要配置一个 LLM Provider。插件内置了常见 Provider 预设（OpenAI、Anthropic Claude、Google Gemini、DeepSeek、MiniMax、OpenRouter、LM Studio 等），也支持自定义。

每个 Provider 字段：

- **名称**：显示标签。
- **协议**：OpenAI 兼容 或 Anthropic。
- **Base URL**：例如 `https://api.openai.com/v1`。
- **模型**：可填多个（换行 / 逗号分隔）。
- **API Key**：仅保存在 `chrome.storage.local`，不会同步、不会日志输出。

配置后可点「测试连通」验证，并设置默认模型与温度。勾选「自动分析新视频」后，转录完成会自动触发摘要。

> ⚠️ 新增自定义 Provider 的 host 必须在扩展 `manifest` 的 `host_permissions` 中放行，否则 Service Worker 发请求会触发 CORS 失败。常见 Provider 预设已内置放行。

### 3. 灵机剪影联动桥

把转录成稿推送到桌面端「待创作箱」。

**一键连接（推荐）**：

1. 在同一台机器上启动灵机剪影桌面端。
2. 设置页点「🔗 一键连接灵机剪影」。
3. 插件向桌面端 `GET /sonar/pair` 拉取本机端点与 token 自动完成配置，显示「已连接灵机剪影」。

**手动配置**：

- **端点**：默认 `http://127.0.0.1:19820`（仅本机回环，不走远程）。
- **Token**：与桌面端共享的密钥，可在灵机剪影欢迎页「待创作箱 → 桥配置」获取。
- 打开「开启联动（转录完成后推送到灵机剪影）」开关，点「测试连通」验证。

桥协议（本机回环）：

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/sonar/health` | GET | 无 | 健康检查 |
| `/sonar/pair` | GET | 无 | 一键配对，返回端点与 token |
| `/sonar/enqueue` | POST | `x-sonar-token` 头 | 推送文稿 + 元数据到待创作箱 |

推送以视频 `awemeId` 幂等去重：同一视频被重复发现时刷新已有条目，而不是重复入箱。

## 四、典型工作流

### A. 监听博主并发现新作品

1. 打开某博主的抖音主页。
2. 页面浮层点「加入监听」，或在 Popup 里点「监听」。
3. 博主进入工作台「正在监听」列表，后台按周期自动检查；也可手动「同步全部 / 立即同步」。

### B. 下载某条视频（优先无水印）

1. 在视频页用 Popup 或浮层点「下载原片」。
2. 插件解析候选源，优先选择无水印源并给出置信度。
3. 下载到浏览器默认下载目录，并展示进度。

### C. 入库并分析

1. 在视频页点「入库并分析」。
2. 插件抽音频 → 转录（bcut / 你配置的 ASR）→（可选）AI 摘要。
3. 处理状态可在工作台查看（排队 → 解析 → 取流 → 抽音频 → 转录 → 摘要 → 完成）。

### D. 推送到灵机剪影做二创

1. 开启联动桥后，转录完成会自动 POST 到桌面端 `待创作箱`。
2. 在灵机剪影欢迎页打开「待创作箱」，看到新条目（含封面 / 标题 / 文稿）。
3. 点「生成初稿」：桌面端把转录文稿写入 `original.md` → AI 二创改写为 `script.md` → TTS → 字幕 → 封面 → 时间线，进入完整创作链路。

## 五、隐私与数据

- 仅保存在本机：博主与视频元数据、下载记录、转录与摘要、设置（含 API Key）都在浏览器本地。
- 不导出登录态：复用浏览器里抖音的正常登录态，不读取 / 不导出 Cookie 或 Token。
- 会发送到外部的内容：音频 → ASR 服务（默认 bcut）；转录文本 → 你配置的 LLM Provider（仅在开启分析时）；文稿 + 元数据 → 灵机剪影桌面端（本机回环，非远程）。
- 联动桥可随时在设置里关闭。

## 六、常见问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| Popup 提示「当前不是抖音页面」 | 不在 douyin.com 页面 | 打开博主主页或视频页再试 |
| 下载得到的是 html / 403 | 抖音 CDN 签名地址过期 | 重新解析（现取流），不要复用旧签名地址 |
| 提示需重新登录抖音 | 浏览器抖音登录态过期 | 在浏览器登录 douyin.com 后重开插件 |
| 摘要 / 分析不触发 | 未配置 LLM Provider | 设置 → 添加 Provider 并填 API Key |
| 自定义 Provider 请求 CORS 失败 | host 未在 `host_permissions` 放行 | 在 `src/manifest.config.ts` 增加该 host 后重新构建 |
| 联动桥连接失败 | 桌面端未启动 | 启动灵机剪影后再「一键连接 / 测试连通」 |

---

更多设计细节见 `extensions/sonar/README.md` 与 `docs/superpowers/specs/` 下的扩展设计文档。

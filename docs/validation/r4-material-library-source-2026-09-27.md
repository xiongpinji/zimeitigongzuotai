# R4 授权素材库与本地文本语义索引：源码阶段验收

范围：`P3-1` 的持久素材库、结构化授权、受限桌面桥接与人工素材选择。测试基线为主库 `7f580745fe57f4869e2980d6a3506170c8041372` 上的本轮改动；Windows、Node v24.17.0、Ollama 0.34.4。**未执行打包、安装或真实平台登录/发布**。媒体仅使用本地合成 1×1 PNG，素材、索引和截图保存在 Git 忽略的 `data/runtime/validation/` 或隔离临时目录。

| 证据 | 结果与边界 |
| --- | --- |
| 素材库 + 索引 + IPC + 工作区过渡聚焦测试 | 24 项通过：目录重启恢复、按 SHA 去重、授权撤销、篡改拒绝、模型 digest / 文本失配、畸形向量拒绝、异步索引身份快照、非主窗口和路径注入拒绝。仅证明合成输入与模拟模型响应下的行为。 |
| 默认 Vitest 全量回归 | 首次高并发运行 385/386 文件通过，脚本文件树空状态用例 60 秒超时；该文件单独重跑 10/10 通过。最终改动下运行 `npx vitest run --reporter=dot --no-cache --maxWorkers=4 --minWorkers=2` 为 **386/386 文件、2906 项通过、4 项按 Windows 条件跳过**。 |
| `npx tsc --noEmit`、`npx electron-vite build` | 两项退出码 0。后者只构建 main、preload、renderer 源码，不生成安装包。构建中仍有既有 AI SDK 浏览器端 Node 内建模块 externalized 警告。 |
| `node scripts/smoke-asset-library-win.cjs` | 真实 Electron 源码窗口中打开“授权素材”页、通过系统选择链导入合成 PNG、缺少模型时拒绝索引、关闭重开后恢复目录、撤销自动使用；页面异常 0。最终源码结果在 `data/runtime/validation/r4-materials-1790523912793/result.json`，截图同目录。没有用真实视频、真实授权证据或模型向量。 |
| 已装旧模型的真实中文对照 | `nomic-embed-text:latest` 在“夜景霓虹灯”查询下，把“白天在厨房做饭”排在“夜晚的城市霓虹街道”之前：加检索前缀后分数分别约 0.7025 / 0.5860。因此旧模型中文相关性**未通过**，不能作为可用语义质量证据。 |
| 多语言模型 | 代码固定要求 `nomic-embed-text-v2-moe:latest`、`search_document:` / `search_query:` 前缀和 `truncate:false`，只访问本机 loopback；模型缺失时 fail closed。2026-09-27 尝试 `ollama pull nomic-embed-text-v2-moe` 时 registry manifest TLS 握手超时。当前 `ollama list` 只有旧模型，多语言中文质量尚未实测。 |

当前实现中，画面描述与标签由用户填写，embedding 是**文本对文本检索**；它既不识别视频画面，也不验证描述与画面一致。推荐前后检查结构化平台/地区/商业用途授权、证据引用与媒体哈希；索引不保存账号信息、授权证据内容或原始媒体字节。进入剪辑台目前是人工点选路径，后续自动合成/渲染仍须在实际读取素材时再次校验授权与哈希。

R4 完成验收仍缺：多语言模型在一批中文素材上的检索质量与负样本、真实视频画面或帧级语义索引、同一直播录屏生成三条实质不同叙事时间线、批量合成成片、授权证据人工核实及盲审。任何平台是否认定“原创”只能由平台真实反馈确认，本阶段不作保证。

模型说明依据：[Ollama 多语言模型与检索前缀](https://registry.ollama.com/library/nomic-embed-text-v2-moe)、[Nomic v1.5 作者关于检索前缀的说明](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)。

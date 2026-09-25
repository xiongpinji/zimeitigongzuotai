# 开源组件选择与集成边界

研究快照：2026-09-25。下面的 SHA 是已经审阅的本地检出版本，不代表开发开始时的最新版本；导入前必须重新比较上游变更、依赖、许可证和安全边界。

| 项目 | 审阅 SHA / 许可 | 已有可用边界 | 集成决定 |
| --- | --- | --- | --- |
| [Lingji Cut](https://github.com/yoqu/lingji-cut) | `59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1` / Apache-2.0 | Electron/React 时间线、Remotion 导出、Pi Agent/MCP、抖音/快手/视频号/小红书发布入口；`electron/publish/accounts.ts` 按平台和账号名保存浏览器状态 | **产品基座**。先导入固定版本并取得 Windows 可重复构建；保留原作者许可和来源。现有发布路径不能当作已验证的高并发或带货能力。 |
| [Easel](https://github.com/ZJU-REAL/Easel) | `3fe2d9904c1619281ef57f81d9ee0b7854998399` / Apache-2.0 | 运营 Agent、画像与技能流程；有创作/发布技能脚本 | **按需迁移 Skills 设计和少量已审阅代码**。不把其 Web 工作台整体嵌入 Electron，不假设它已解决同平台多账号批量调度。 |
| [HotClip](https://github.com/xixihhhh/hotclip) | `62aef3919fdd7d8a974f80a9b721e0177eb408c2` / AGPL-3.0 | 本地直播/长视频高光识别，转写、视觉和音频线索，CLI/MCP | **独立高光进程候选**。优先用清晰输入输出契约验证效果；分发前完成 AGPL 源码提供、声明与组合方式审查。若许可或运行边界不合适，按同一契约替换为自实现。 |
| [OpenCut-AI](https://github.com/GinoongFlores/OpenCut-AI) | `cf6da741d624f4bf22afc70e991afab8788d5c11` / MIT（本地快照） | CLIP 帧索引与 B-roll 语义检索，`services/ai-backend/app/routes/broll.py` | **算法与接口参考**。只移植必要、经测试的语义索引模块；新增版权元数据、镜头匹配解释和重复度检查。导入前复核上游许可。 |
| [social-auto-upload](https://github.com/dreammis/social-auto-upload) | `0012d2c355f88f683cc38dde2a2db209e14091bc` / MIT | 多平台上传器、平台+账号 Cookie 命名 | **发布适配器参考/补位**。优先复用灵剪发布实现，缺口才选择性移植；不并存两套可写账号会话源。 |

排除直接作为基座的原因：Easel 没有足够的独立多轨剪辑台和可证明的批量账号队列；MatrixMedia 的批量输入偏串行，且 GPL-2.0 影响整体许可设计；MultiPublish 的三任务并发并非高吞吐保证；MoneyPrinterPlus 的许可文字存在冲突。这些仓库可用于测试用例或设计对照，但不得凭 README 把能力标为已实现。

组件引入规则：记录上游 URL、固定 SHA、许可证、NOTICE、改动清单和 SBOM；先跑对应组件测试，再接入产品契约。不得把 AGPL 代码复制进 Apache/MIT 模块后仍声称整体仅为宽松许可。最终仓库许可在 HotClip 接入方式明确后决定，不在规划阶段伪称已完成兼容性审查。

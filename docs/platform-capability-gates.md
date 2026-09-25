# 平台发布与带货能力准入门槛

核查时间：2026-09-25。此表仅依据公开可访问的官方资料和已审阅开源代码；**不是**对用户账号已获权限、平台允许无人值守批量发布或真实发布成功的证明。此表的商品列是后续 R6-C 调研线索，不是阶段一商品开发任务或阶段一普通发布的阻塞门槛。开发和验收前需复核变化。

| 平台 | 公开资料已证明什么 | 仍待证明的关键事项 | 后续 R6-C 接入条件 |
| --- | --- | --- | --- |
| 快手 | [官方视频发布接口](https://open.kuaishou.com/platformDocs/openAbility/contentManagement/createAVideo)有可选 `merchant_product_id`，注明只支持挂载自建商品；发布接口为异步，必须查询最终结果。 | 使用的账号/应用是否获视频发布权限；达人分销或其他商品类型是否有可用的独立能力；真实限流与挂车结果。 | 先按 `self_owned_product` 建适配器；没有对应商品 ID/资格则显示不可用，不将普通 URL 当商品卡。 |
| 抖音 | [短视频自主挂载说明](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/flow-entrance/douyin/video/self-mount)和[准入规范](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/operation/platform-capabilities/video/self-mount-activate-spec)证明小程序锚点需申请、绑定账号并满足资格；[官方分享说明](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/operation/douyin-video/share-video-to-douyin)指出某些分享/挂载流程必须由用户手动触发。 | 小程序锚点**不等于**抖店商品卡或精选联盟带货；需按用户实际商品类型找到相应官方能力/已授权 UI 流程并实测。 | 把 `miniapp_anchor`、`shop_product`、`affiliate_product` 分开；未证实某类型前不得暴露可自动挂载承诺。 |
| 微信视频号 | 已审阅的 Lingji Cut 提供视频号浏览器发布适配器；本轮公开官方文档检索未确认“桌面端无人值守批量发布并自动关联商品”的开放接口。 | 账号是否有视频带货权限、店铺商品是否已进入可选目录、PC 发布页能否稳定挂商品和回查最终结果、平台是否允许该自动化路径。 | 先用有资格的用户账号做只读页面/权限核查；提交前再按获准路径试点，不能用普通“扩展链接”冒充平台商品卡。 |
| 小红书 | [开放平台 Scope](https://openaccount.xiaohongshu.com/docs/scope)当前仅开放 `basic_info`，`write_notes` 标为规划中；[官方分享平台](https://agora.xiaohongshu.com/doc)提供把素材唤起到小红书 App 发布页的 SDK。 | OAuth 登录不等于发布授权；分享 SDK 不证明无人值守桌面批量发布；商品笔记/店铺商品关联的账号资格、自动化入口及最终结果仍需核查。 | 先设计辅助发布和可恢复人工接管；若尝试用户授权的浏览器流程，必须真实账号逐步验证且失败即停止。R1/R6-P 的全自动验收在获得可用路径前保持未通过。 |

## 预留商品挂载契约（阶段一不实施）

阶段一发布任务仅预留可选 `CommerceRequest(platform, accountId, kind, platformProductId, required)`，有商品请求时四平台商品插件一律返回 `not_implemented`。`kind` 候选包括 `self_owned_product`、`shop_product`、`affiliate_product`、`miniapp_anchor`，但各平台实际可用类型待用户研究；`platformProductId` 必须是对应平台的 ID，不能用普通 URL 代替。`required=true` 返回 `COMMERCE_NOT_CONFIGURED`；`required=false` 也不静默改为普通发布，而是进入 `needs_user_action`，待用户显式移除商品请求并另建普通任务。

未来 R6-C 的每次商品发布验收链为：账号持有人授权 → 平台/账号/商品类型资格可见 → 商品存在且可选 → 本地预检通过 → 任务提交 → 平台最终发布状态 → 作品页面实际展示正确商品入口。上传成功、分享 SDK 回调、网页显示已选商品都不是最终验收。

## 对整体计划的影响

阶段一 M1/M6 的普通发布验收与未来 R6-C 商品挂载分开。阶段一 M5 只验证接口占位与有商品请求时的拒绝路径，不能宣称任何挂车能力。四平台普通自动发布若缺少获准且稳定的路径，R6-P 对应平台保持未通过；商品能力另按账号、商品类型与平台真实权限研究，不能因普通发布通过便宣称“全平台自动带货”。

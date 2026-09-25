# 平台发布与带货能力准入门槛

核查时间：2026-09-25。此表仅依据公开可访问的官方资料和已审阅开源代码；**不是**对用户账号已获权限、平台允许无人值守批量发布或真实发布成功的证明。开发和验收前需复核变化。

| 平台 | 公开资料已证明什么 | 仍待证明的关键事项 | 开发门槛 |
| --- | --- | --- | --- |
| 快手 | [官方视频发布接口](https://open.kuaishou.com/platformDocs/openAbility/contentManagement/createAVideo)有可选 `merchant_product_id`，注明只支持挂载自建商品；发布接口为异步，必须查询最终结果。 | 使用的账号/应用是否获视频发布权限；达人分销或其他商品类型是否有可用的独立能力；真实限流与挂车结果。 | 先按 `self_owned_product` 建适配器；没有对应商品 ID/资格则显示不可用，不将普通 URL 当商品卡。 |
| 抖音 | [短视频自主挂载说明](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/flow-entrance/douyin/video/self-mount)和[准入规范](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/operation/platform-capabilities/video/self-mount-activate-spec)证明小程序锚点需申请、绑定账号并满足资格；[官方分享说明](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/operation/douyin-video/share-video-to-douyin)指出某些分享/挂载流程必须由用户手动触发。 | 小程序锚点**不等于**抖店商品卡或精选联盟带货；需按用户实际商品类型找到相应官方能力/已授权 UI 流程并实测。 | 把 `miniapp_anchor`、`shop_product`、`affiliate_product` 分开；未证实某类型前不得暴露可自动挂载承诺。 |
| 微信视频号 | 已审阅的 Lingji Cut 提供视频号浏览器发布适配器；本轮公开官方文档检索未确认“桌面端无人值守批量发布并自动关联商品”的开放接口。 | 账号是否有视频带货权限、店铺商品是否已进入可选目录、PC 发布页能否稳定挂商品和回查最终结果、平台是否允许该自动化路径。 | 先用有资格的用户账号做只读页面/权限核查；提交前再按获准路径试点，不能用普通“扩展链接”冒充平台商品卡。 |
| 小红书 | [开放平台 Scope](https://openaccount.xiaohongshu.com/docs/scope)当前仅开放 `basic_info`，`write_notes` 标为规划中；[官方分享平台](https://agora.xiaohongshu.com/doc)提供把素材唤起到小红书 App 发布页的 SDK。 | OAuth 登录不等于发布授权；分享 SDK 不证明无人值守桌面批量发布；商品笔记/店铺商品关联的账号资格、自动化入口及最终结果仍需核查。 | 先设计辅助发布和可恢复人工接管；若尝试用户授权的浏览器流程，必须真实账号逐步验证且失败即停止。R1/R6 的全自动验收在获得可用路径前保持未通过。 |

## 统一商品挂载契约

`CommerceIntent` 必须声明 `kind`：`self_owned_product`、`shop_product`、`affiliate_product`、`miniapp_anchor` 或平台明确允许的其他类型；同时保存 `platformProductId`、`accountId`、`permissionEvidence`、`required=true|false`、`fallbackPolicy`。这些类型不能互相替换。`required=true` 时若权限、目录、产品 ID 或 UI 选择失败，任务转到 `needs_permission` / `needs_user_action`，**不得自动改为无商品视频发布**。

每次发布的验收链为：账号持有人授权 → 平台/账号/商品类型资格可见 → 商品存在且可选 → 本地预检通过 → 任务提交 → 平台最终发布状态 → 作品页面实际展示正确商品入口。上传成功、分享 SDK 回调、网页显示已选商品都不是最终验收。

## 对整体计划的影响

M1 的普通发布与 M5 的商品挂载必须分别验收。若四平台中任一平台没有可获授权且可稳定执行的自动路径，不能宣称 R6 或“全平台自动带货”交付；产品可保留人工接管模式，但那只是降级能力。开发前应获得各平台测试账号、商品类型、已有带货资格及是否接受经账号持有人授权的页面自动化这一产品决策。没有这些材料时仍可实现并测试本地契约和模拟流程，真实平台验收保持待完成。

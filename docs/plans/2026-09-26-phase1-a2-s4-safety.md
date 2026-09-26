# Goal

旧 `runPublishJob` 对不存在的账号 `continue`，因此混入未知或新 UUID 目标时可能上传部分账号，而 Renderer 仍等待被跳过账号的终态。先在任何上传前校验整批目标并一次性拒绝无效任务，再提供完全只读的旧账号迁移预览。新 `account-v2` UUID 仍不得进入旧上传链；预览不触发迁移。

# Decisions and assumptions

先交付 S4a 的整单发布预检，再做 S4b 只读预览；两项不把新账号接到旧发布链，也不执行真实迁移。

## S4a：发布前整单校验

- 在 `runPublishJob` 进入首个上传前，读取一次旧账号快照并校验 `job.targets`：非空数组、每项有效旧账号 ID、无重复、全部存在于快照、账号记录与 ID/平台一致。未知、UUID、畸形、重复或空目标均整单拒绝，混合有效与无效目标也不得上传任何一个账号。
- 校验失败只给固定安全错误码/文案，不把账号名、会话路径、平台原始错误写入消息。Runner 不发出虚假的 `success`；Renderer 中原本 `pending` 的行转为明确失败，并解除任务进度。正常旧账号发布路径、平台调用入参和取消逻辑保持兼容。
- 先做失败用例：未知/UUID、重复、空/畸形、有效+无效混合均零上传；有效旧目标只上传一次；异常前后事件/结果可判读。测试只用合成账号和假平台，不触实际发布。

## S4b：无副作用迁移预览

- 新增独立只读预览函数与 `account-v2:migration-preview` IPC。只从显式旧根目录读取 `registry.json` 元数据；不得实例化会 `mkdir` 的旧 `AccountStore`/新 vault，不读会话 JSON 内容，不调用 `migrateFromLegacy()`，不写任何文件。
- 预览输出只含安全计数/状态/匿名标识，不暴露旧账号名、文件绝对路径或会话内容到 Renderer。B 站排除在四平台迁移范围之外；损坏 registry、非普通文件与 symlink 均安全拒绝并给固定错误码。
- 测试以字节和目录项快照证明预览前后旧根、新根不变，覆盖缺失、损坏、B 站、symlink、重复记录与读取失败。真实 userData 迁移仍禁止。

# Constraints and guardrails

- 只使用用户已批准的三条 Agent Orchestrator 路由；实现工作树隔离，同期至多两个实现任务。执行 Agent 不提交、不推送、不部署、不改凭证；Codex 审核合入。
- S4a 的混合有效/无效目标必须零上传，不能靠循环内 `continue` 替代整单预检；取消和有效目标的平台入参保持兼容。
- S4b 遇到缺失、损坏、非普通文件或 symlink 安全拒绝。旧/新目录和文件字节不变；测试只用合成临时目录。
- 不触真实账号、真实发布、真实迁移、商品挂载、依赖安装或发行；离线测试不等于平台验收。

# Validation strategy

两项分别由 Agent Orchestrator 隔离工作树实现、GLM 只读审查、Codex 独立聚焦测试和类型检查后选择性合入。Q2 产品单实例与真实账号验证尚未完成前，不把新账号切到发布路径，也不开放批量自动发布。

# Checklist

- [x] S4a：旧 runner 在任何上传前整单校验目标；未知/UUID、畸形、重复或空目标零上传，Renderer 显示明确失败；离线 RED→GREEN 验收。主库 `b03a5bc`，聚焦 33/33、类型检查通过，详见[验证记录](../validation/p1-1-old-runner-preflight.md)；真实平台发布仍未验收。
- [x] S4b：新增完全只读的旧账号迁移预览及安全 IPC；旧/新目录字节不变、B 站排除、symlink/损坏注册表安全拒绝；真实迁移不触发。主库 `99c6099`，Windows 聚焦 18 passed、1 个 symlink 用例 skipped，类型检查与构建通过，GLM 无开放 P0/P1；详见[验证记录](../validation/p1-1-legacy-migration-preview.md)。

# Completion criteria

S4a/S4b 均通过精确 diff、失败先行、独立聚焦测试、类型检查和安全审查后，A2-S4 离线工作才算完成。Q2 产品单实例与真实账号验证未完成前，新账号仍不接旧发布链，也不开放批量自动发布。

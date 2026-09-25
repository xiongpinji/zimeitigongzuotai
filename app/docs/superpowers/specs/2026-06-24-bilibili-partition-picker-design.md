# B站分区选择器 + AI 智能推荐分区 — 设计规格

日期：2026-06-24
范围：发布 Tab（`PublishWorkbench`）B站分区（tid）输入

## 背景与问题

发布到 B站时必须提供分区 ID（tid）。当前 UI（`src/components/publish/PublishWorkbench.tsx:648`）是一个
`<Input type="number">` 自由输入框，仅在 hint 里列了少数常用 tid。用户需要记忆 / 手填数字，体验差且易填错。

目标：

1. 把自由输入换成**全量分区可选列表**，手选即可，不再手填数字。
2. 增加**「智能推荐分区」一键按钮**，根据当前标题 + 描述自动选中合适分区。

## 关键约束（决定数据源）

上传链路是 biliup-rs（`biliupR`，**已 pin v1.2.1**，`electron/publish/biliup-install.ts:37`），
通过 `--tid <n>` 直接透传给 B站投稿接口（`electron/publish/platforms/bilibili.ts:42`）。

该二进制使用**经典分区体系**（默认 tid `171`），**不是** B站 2024 新分区。与之精确对齐的全量权威清单是
biliup 官方 tid 参考表（https://biliup.github.io/tid-ref.html）。其中可投稿主分区 17 个（PGC 区番剧/电视剧/电影不计）。

因此**不能**改去拉 B站新分区 live API——那会给 pin 的二进制喂它可能拒绝的 tid。

**决策（已与用户确认）：**
- 数据源 = **仅内置全量列表**（硬编码 biliup tid-ref，离线可用，零网络依赖；biliup 升级时手动同步，罕发生）。
- AI 推荐提示词 = **新增可覆盖 prompt kind `publish.partition`**，与项目提示词分层架构一致。

## 设计

### 1. 分区数据（内置，全量）

新增 `src/lib/publish/bilibili-partitions.ts`：

```ts
export interface BilibiliSubPartition { id: number; name: string }
export interface BilibiliPartition { id: number; name: string; children: BilibiliSubPartition[] }

/** 全量分区树，严格对齐 biliup tid-ref（v1.2.1 经典分区）。 */
export const BILIBILI_PARTITIONS: BilibiliPartition[] = [
  { id: 160, name: '生活', children: [
    { id: 138, name: '搞笑' }, { id: 239, name: '家居房产' }, { id: 161, name: '手工' },
    { id: 162, name: '绘画' }, { id: 21, name: '日常' } ] },
  { id: 4, name: '游戏', children: [
    { id: 17, name: '单机游戏' }, { id: 65, name: '网络游戏' }, { id: 172, name: '手机游戏' },
    { id: 171, name: '电子竞技' }, { id: 173, name: '桌游棋牌' }, { id: 136, name: '音游' },
    { id: 121, name: 'GMV' }, { id: 19, name: 'Mugen' } ] },
  { id: 5, name: '娱乐', children: [ { id: 71, name: '综艺' }, { id: 137, name: '明星' } ] },
  { id: 36, name: '知识', children: [
    { id: 201, name: '科学科普' }, { id: 124, name: '社科·法律·心理' }, { id: 228, name: '人文历史' },
    { id: 207, name: '财经商业' }, { id: 208, name: '校园学习' }, { id: 209, name: '职业职场' },
    { id: 229, name: '设计·创意' }, { id: 122, name: '野生技能协会' } ] },
  { id: 181, name: '影视', children: [
    { id: 85, name: '短片' }, { id: 182, name: '影视杂谈' }, { id: 183, name: '影视剪辑' },
    { id: 184, name: '预告·资讯' } ] },
  { id: 3, name: '音乐', children: [
    { id: 130, name: '音乐综合' }, { id: 29, name: '音乐现场' }, { id: 59, name: '演奏' },
    { id: 31, name: '翻唱' }, { id: 193, name: 'MV' }, { id: 30, name: 'VOCALOID·UTAU' },
    { id: 194, name: '电音' }, { id: 28, name: '原创音乐' } ] },
  { id: 1, name: '动画', children: [
    { id: 24, name: 'MAD·AMV' }, { id: 25, name: 'MMD·3D' }, { id: 27, name: '综合' },
    { id: 47, name: '短片·手书·配音' }, { id: 210, name: '手办·模玩' }, { id: 86, name: '特摄' } ] },
  { id: 155, name: '时尚', children: [
    { id: 157, name: '美妆护肤' }, { id: 158, name: '穿搭' }, { id: 159, name: '时尚潮流' } ] },
  { id: 211, name: '美食', children: [
    { id: 76, name: '美食制作' }, { id: 212, name: '美食侦探' }, { id: 213, name: '美食测评' },
    { id: 214, name: '田园美食' }, { id: 215, name: '美食记录' } ] },
  { id: 223, name: '汽车', children: [
    { id: 176, name: '汽车生活' }, { id: 224, name: '汽车文化' }, { id: 225, name: '汽车极客' },
    { id: 240, name: '摩托车' }, { id: 226, name: '智能出行' }, { id: 227, name: '购车攻略' } ] },
  { id: 234, name: '运动', children: [
    { id: 235, name: '篮球·足球' }, { id: 164, name: '健身' }, { id: 236, name: '竞技体育' },
    { id: 237, name: '运动文化' }, { id: 238, name: '运动综合' } ] },
  { id: 188, name: '科技', children: [
    { id: 95, name: '数码' }, { id: 230, name: '软件应用' }, { id: 231, name: '计算机技术' },
    { id: 232, name: '工业·工程·机械' }, { id: 233, name: '极客DIY' } ] },
  { id: 217, name: '动物圈', children: [
    { id: 218, name: '喵星人' }, { id: 219, name: '汪星人' }, { id: 221, name: '野生动物' },
    { id: 222, name: '爬宠' }, { id: 220, name: '大熊猫' }, { id: 75, name: '动物综合' } ] },
  { id: 129, name: '舞蹈', children: [
    { id: 20, name: '宅舞' }, { id: 154, name: '舞蹈综合' }, { id: 156, name: '舞蹈教程' },
    { id: 198, name: '街舞' }, { id: 199, name: '明星舞蹈' }, { id: 200, name: '中国舞' } ] },
  { id: 167, name: '国创', children: [
    { id: 153, name: '国产动画' }, { id: 168, name: '国产原创相关' }, { id: 169, name: '布袋戏' },
    { id: 170, name: '资讯' }, { id: 195, name: '动态漫·广播剧' } ] },
  { id: 119, name: '鬼畜', children: [
    { id: 22, name: '鬼畜调教' }, { id: 26, name: '音MAD' }, { id: 126, name: '人力VOCALOID' },
    { id: 216, name: '鬼畜剧场' }, { id: 127, name: '教程演示' } ] },
  { id: 177, name: '纪录片', children: [
    { id: 37, name: '人文·历史' }, { id: 178, name: '科学·探索·自然' }, { id: 179, name: '军事' },
    { id: 180, name: '社会·美食·旅行' } ] },
];
```

辅助函数（同文件）：
- `flattenPartitions(): { tid: number; label: string; parent: string }[]` — 拍平，`label = "主分区 / 子分区"`。
- `findPartition(tid: number): { parent, sub } | null` — 反查显示名（picker 回填用）。
- `isValidTid(tid: number): boolean` — 校验 tid 在已知集合内（AI 推荐结果做服务端校验用）。

> 番剧(13)/电视剧(11)/电影(23) 等 PGC 分区不在表内（普通投稿不可选），与 biliup tid-ref 一致，无需特殊处理。

### 2. UI — picker 替换自由输入

`PublishWorkbench.tsx`：把 `bilibiliTid` 字段（line 169 state、line 648 输入）改造为**级联选择**：
- 主分区 `<Select>` → 子分区 `<Select>`（复用 `src/ui/.../select.tsx`）。
- 选中子分区后把其 `tid` 写回现有 `bilibiliTid` state（**仍存为字符串**）。
- 旁边放「智能推荐分区」按钮（见 §3）。
- 已选时展示 `主分区 / 子分区（tid）` 文案，便于确认。

**持久化零迁移**：`ProjectPublishMeta.bilibiliTid?: string`（`src/lib/project-persistence.ts:59`）保持不变，
现有自动保存依赖与校验（line 344–358）原样工作。旧工程里残留的任意 tid 字符串：若能 `findPartition` 命中则
回填选中态，命中不了则视为未选（提示用户重选），不报错。

### 3. AI — 独立「智能推荐分区」按钮

复用现有 `generate-publish-metadata` 的全套管线形态，新增一条并行链路：

**新 prompt kind `publish.partition`**（`src/lib/prompts/types.ts` 的 `PROMPT_KINDS` 数组 + `PROMPT_KIND_META`；
`src/lib/prompts/defaults.ts` 的 `DEFAULT_PROMPT_YAML`）：
- `group: 'project'`，可被全局 / 项目覆盖。
- `lockedContract`：锁定输出为 JSON `{ "tid": <number> }`，理由＝业务按 tid 校验回填，改契约会导致无法落库。
- 提示词正文：要求模型**只能**从随后追加的【可选分区清单】里选 1 个 tid，结合【标题】【描述】判断；
  清单与标题描述由主进程在请求时作为内容消息自动追加（与 publish.metadata 同模式，提示词正文不写变量占位）。

**新 lib `src/lib/publish-partition-recommend.ts`**（镜像 `src/lib/publish-metadata.ts`）：
- `buildPartitionRecommendMessages(template, { title, desc, partitions })` → `{ systemPrompt, userMessage }`；
  userMessage 内嵌拍平的分区清单（`tid: 主/子`）+ 标题 + 描述。
- `parsePartitionRecommend(payload): number` → 解析 `{ tid }`，并用 `isValidTid` 校验；不在集合内则抛错。

**IPC `recommend-bilibili-partition`**：
- `electron/main.ts`：新 handler，加载 `publish.partition` 模板 + 解析 binding（复用 `resolvePromptBinding`），
  调 `generateStructuredData`，**服务端二次校验** `isValidTid`，返回 `{ tid }`；非法时抛明确错误。
- `electron/preload.ts` + `src/lib/electron-api.ts`：暴露 `recommendBilibiliPartition(args)`，
  入参 `{ settings, title, desc, projectDir?, projectBindings? }`（分区清单主进程内置，不必从 renderer 传）。

**触发逻辑**（PublishWorkbench）：
- 输入＝当前 `title` + `desc`；二者皆空时回退用 AI 分析 summary/keywords（复用 `buildMetadataSource`）兜底，
  仍为空则提示「先填写或生成标题/描述」。
- 成功后 picker 自动选中返回的 tid（`findPartition` 回填级联态），并 toast 简短说明。
- 失败 / 非法 tid：复用现有 `validationError` / toast 通道提示，不静默。
- 走统一任务进度？此调用为秒级单次 LLM，沿用 publish.metadata 现有的局部 loading 态即可（无需接 task-progress）。

### 4. 测试

- `tests/publish/bilibili-partitions.test.ts`：数据完整性——主分区数＝17、tid 全局唯一、每个子分区 tid 为正整数、
  `findPartition`/`isValidTid`/`flattenPartitions` 正确；抽样校验若干已知 tid（21→生活/日常，171→游戏/电子竞技）。
- `tests/publish/partition-recommend.test.ts`：`parsePartitionRecommend` 正常解析；非法 tid（不在集合 / 非数字 / 缺字段）抛错。
- 现有 `tests/publish/bilibili.test.ts`（argv 透传）保持绿色——上传链路与存储格式均未变。

## 改动文件清单

新增：
- `src/lib/publish/bilibili-partitions.ts`
- `src/lib/publish-partition-recommend.ts`
- `tests/publish/bilibili-partitions.test.ts`
- `tests/publish/partition-recommend.test.ts`

修改：
- `src/components/publish/PublishWorkbench.tsx`（picker + 推荐按钮 + 触发逻辑）
- `src/lib/prompts/types.ts`（注册 `publish.partition` kind + meta）
- `src/lib/prompts/defaults.ts`（默认提示词）
- `electron/main.ts`（`recommend-bilibili-partition` IPC handler）
- `electron/preload.ts`（暴露桥）
- `src/lib/electron-api.ts`（类型契约）

## 非目标（YAGNI）

- 不接 B站 live 分区 API、不做运行时拉取 / 缓存（与 pin 的 biliup 对不上，且列表罕变）。
- 不改 `project.json` 结构、不做持久化迁移。
- 不改上传链路 / biliup argv。
- 不接统一底部任务进度（推荐调用为秒级单次）。

## 风险

- **biliup 升级换分区**：内置表与 binary 漂移时需手动同步本文件。低频，且 pin 在 v1.2.1，可控。
- **AI 返回越界 tid**：主进程 `isValidTid` 二次校验 + 明确报错兜底，不会把非法 tid 送进上传。

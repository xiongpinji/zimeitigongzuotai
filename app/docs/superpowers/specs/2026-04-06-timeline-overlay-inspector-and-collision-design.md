# 时间轴 Overlay 详情与轨道防碰撞设计

## 背景

当前编辑器里的视觉素材已经具备“导入素材库”和“拖入时间轴”的基本能力，但编辑链路仍然是不完整的：

- 文字 overlay 已经拥有独立的 Inspector，可以修改内容、样式和动画
- 图片和视频只能被放进时间轴，不能像文字一样点击后进入详情配置
- 时间轴同一根视觉轨道允许两个区块在同一时间段重叠
- 这种重叠既会出现在用户手动拖拽时，也会出现在素材拖入或手动新增时

这带来两个直接问题：

1. 视觉素材的编辑体验不一致，文字是“可编辑对象”，图片和视频只是“可放置资源”
2. 时间轴缺少最基本的轨道占用约束，时间块布局不可信

这次设计的目标，不是给图片和视频临时补一个设置面板，而是把“视觉区块”的概念统一起来，并在此基础上建立一致的时间轴放置规则。

## 结论

采用统一方案：

- 用一个通用的 `OverlayInspector` 取代“只有文字才有详情”的现状
- 将“入场 / 循环 / 出场”动画提升为 overlay 级通用能力
- 保留文字专属配置作为 overlay 子类型扩展
- 为 `video | image | text` 建立统一的轨道占用解析器
- 在新增、拖动、拉伸三个入口统一接入碰撞处理

本次不扩展到 AI 卡片的排轨规则，也不重构预览区为完整的多媒体框选编辑器。范围聚焦在：

- 时间轴可以稳定地新增、移动、拉伸视觉素材
- 视觉素材都能打开详情面板
- 同一根视觉轨道上的区块不能重叠

## 现状诊断

### 1. 详情面板能力不对称

当前 `EditorInspector` 仅支持以下选择态：

- `subtitle-style`
- `ai-card`
- `text-overlay`
- `empty`

这意味着：

- 文字区块有详情
- AI 卡片有详情
- 图片和视频区块没有详情入口

同时，`Timeline` 中的点击逻辑也只对文字和 AI 卡片做了 Inspector 打开分支，图片和视频只是被选中高亮。

### 2. 动画能力被硬编码为文字专属

当前动画模型放在 `textData.animation` 内部，动画渲染也只在 `TextOverlay` 中消费。

这导致：

- 图片 / 视频无法直接复用动画设置
- “入场 / 出场 / 循环”这种本应是视觉区块共性的能力，被绑死在文字数据模型里
- `typewriter` 这类文字专属效果与通用动画混放在一起，不利于抽象

### 3. 轨道只负责展示，不负责约束

当前时间轴对视觉轨道的处理只包含：

- track 渲染
- drag over 高亮
- drop 落点计算
- 拖动区块时的 `trackId` 切换

但没有任何轨道占用规则。结果是：

- `placeAssetOnTrack()` 直接创建 overlay，不检查重叠
- `OverlayBlock` 拖动时直接 `updateOverlay()`
- `OverlayBlock` 拉伸时只 clamp 总时长与素材时长，不 clamp 邻居边界

### 4. 预览区交互层暂时只覆盖文字

`CanvasInteractionLayer` 当前只渲染正在播放区间内的文字 overlay 选框。

这说明系统已经有“选中 overlay 并更新位置”的基础能力，但这套能力还没有被提升为通用 overlay 交互层。

本次设计不会把预览区也一并升级成媒体框选编辑器，但会确保整体状态管理向通用 overlay 靠拢，避免后续继续返工。

## 目标

### 功能目标

1. 图片、视频、文字三类视觉素材都能在时间轴点击后打开详情面板
2. 图片、视频、文字共用同一套基础动画模型
3. 同一视觉轨道上的视觉素材不能时间重叠
4. 新增、拖动、拉伸时都遵守同一套防碰撞规则
5. 用户主动放入某轨道时，系统优先尊重该轨道，但会在冲突时自动寻找合法位置

### 工程目标

1. 规则收口，不把碰撞判断散落在组件事件里
2. 数据模型清晰，区分通用 overlay 数据与类型专属数据
3. 尽量复用现有文字动画资产和 Inspector 结构，避免完全重写
4. 对旧 timeline 数据保持兼容，旧项目打开后能自动补齐默认值

## 非目标

本次明确不包含：

- AI 卡片 overlay 的防碰撞规则重构
- 默认背景 overlay 的轨道占用约束
- 预览区对图片 / 视频的框选拖拽与缩放
- 媒体裁剪、音量、滤镜、关键帧等高级媒体编辑能力
- 自动推开其他区块的复杂时间轴联动

## 设计原则

### 1. Overlay 统一，内容分层

所有视觉区块都视为 overlay，但 overlay 内部区分：

- 通用字段：时间、轨道、位置、动画
- 类型字段：文字内容 / 字体样式 / 媒体显示配置

这意味着：

- “动画”属于 overlay 自身
- “文字内容”属于文字子类型
- “媒体显示”属于媒体子类型

### 2. 规则由 store / lib 保证，不由组件兜底

组件只负责表达用户意图：

- 想新增到哪里
- 想拖到哪里
- 想拉伸到哪里

是否合法、是否冲突、是否要自动换轨，统一交给独立的轨道解析逻辑完成。

### 3. 自动兜底，但不能黑箱

系统可以帮用户：

- 自动找当前轨道最近合法位置
- 自动换到其他空轨
- 必要时自动新建轨道

但系统不应悄悄推开别的区块，也不应在用户拖动结束后做不可预期的大规模重排。

## 统一数据模型

### 1. Overlay 选择态统一

`InspectorSelection` 从按对象类型拆分，调整为以 overlay 为主：

- `empty`
- `subtitle-style`
- `ai-card`
- `overlay`

其中 `overlay` 通过 `overlayId` 查出具体对象，再由 Inspector 决定显示哪种细分面板。

### 2. 通用动画模型

新增 overlay 级字段：

```ts
interface OverlayMotion {
  enter: 'none' | 'fadeIn' | 'slideInLeft' | 'slideInRight' | 'slideInUp' | 'slideInDown' | 'scaleIn' | 'bounceIn';
  enterDurationMs: number;
  exit: 'none' | 'fadeOut' | 'slideOutLeft' | 'slideOutRight' | 'slideOutUp' | 'slideOutDown' | 'scaleOut' | 'bounceOut';
  exitDurationMs: number;
  loop: 'none' | 'pulse' | 'float' | 'flicker';
}
```

说明：

- 通用层只保留图片、视频、文字都可成立的效果
- `typewriter` 从通用动画层剥离，作为文字专属效果保留在 `TextOverlayData` 中的后续扩展区
- 第一阶段不再为媒体新增独占动画类型，先完成统一抽象

### 3. OverlayItem 结构调整

`OverlayItem` 增加通用 `motion` 字段。

`textData` 保留，但不再保存通用动画。

结果会变成：

- `OverlayItem.motion` 负责进出场与循环
- `OverlayItem.textData` 负责文字内容和文字样式
- `OverlayItem` 的 `type === 'image' | 'video'` 不需要新的复杂子结构，也能先获得详情能力

### 4. 默认值与旧数据兼容

旧 timeline 不要求升级版本号，继续保持向后兼容。

`normalizeTimelineData()` 负责在加载时补齐：

- `motion` 缺失时写入默认 motion
- 老的 `textData.animation` 若存在，则迁移到 `overlay.motion`
- 老结构中无法映射的文字专属字段保持原样

默认 motion 建议为：

- `enter: 'none'`
- `enterDurationMs: 400`
- `exit: 'none'`
- `exitDurationMs: 400`
- `loop: 'none'`

## Inspector 设计

### 1. 新的 Inspector 结构

新增统一组件：

- `OverlayInspector`

它负责：

- 根据 `overlayId` 从 store 读取 overlay
- 渲染通用区块
- 根据 `overlay.type` 渲染类型专属区块

组件内部结构建议拆成：

- `OverlayInspector`
- `OverlayMotionSection`
- `OverlayTimingSection`
- `TextOverlayFields`
- `MediaOverlayFields`

### 2. 面板内容

#### 通用区块

所有视觉 overlay 都显示：

- 基础信息：名称、类型、所在轨道
- 时间信息：开始时间、时长
- 动画信息：入场、循环、出场、持续时间
- 删除动作

#### 文字专属区块

继续保留当前文字能力：

- 内容
- 字体
- 颜色
- 对齐
- 背景
- 描边
- 阴影
- 字距 / 行高 / 透明度 / 旋转
- 模板

只是把“动画”从 `TextInspector` 中拆出去，改由通用区块承载。

#### 媒体专属区块

第一阶段媒体专属区块保持极简：

- 素材名称 / 路径摘要
- 素材原始时长（视频）
- 画布位置摘要

不在这一轮强行补做裁剪、object-fit、旋转、滤镜等高级媒体设置。

核心目的是先让图片 / 视频获得“可选中、可查看、可改动画、可删、可调时长”的完整编辑闭环。

## 时间轴占用规则

### 1. 适用对象

本轮占用规则适用于：

- `type === 'video'`
- `type === 'image'`
- `type === 'text'`

以下对象先排除：

- `overlayRole === 'default-background'`
- `overlayType === 'ai-card'`

这样可以先解决素材库和文字编辑的问题，不影响当前 AI 卡片的生成逻辑。

### 2. 区间定义

同一轨道上的 overlay 占用区间定义为：

```text
[startMs, startMs + durationMs)
```

因此：

- 前一个区块结束时间等于后一个区块开始时间，视为不冲突
- 只要两个区间有真实交叉，就视为冲突

### 3. 放置优先级

当用户把素材拖入某轨道，或系统在某个时刻新增 overlay 时，放置策略如下：

1. 优先尝试用户目标轨道
2. 若目标轨道冲突，尝试在该轨道寻找最近合法位置
3. 若该轨道无合法位置，扫描其他已有视觉轨道
4. 若现有轨道都无法满足，自动新增一根视觉轨道并放入

### 4. 拖动策略

拖动已有区块时：

- 鼠标移动期间允许看到候选位置预览
- 实际提交时，若候选位置与同轨其他区块冲突：
  - 优先吸附到最近合法边界
  - 若仍无法合法放置，则回退到拖动前状态

这里不采用“拖动一个区块自动推开其他区块”的机制。

### 5. 拉伸策略

右侧拉伸时：

- 最小值仍保持现有下限
- 最大值除项目总时长、素材原始时长外，还要受同轨下一个区块开始时间约束

后续如果支持左侧拉伸，也遵守同样规则：

- 不能侵入上一个区块的结束时间

## 核心模块设计

### 1. timeline-placement

新增独立模块，负责所有时间轴合法性计算。

建议提供的能力：

- 判断两个 overlay 是否时间重叠
- 获取某轨道上某区块的前后邻居
- 检查一个放置方案是否合法
- 在目标轨道上寻找最近合法区间
- 扫描可用轨道
- 在必要时请求新增轨道

组件层与 store 层都不直接手写 overlap 判断。

### 2. store 接口收口

`addOverlay()` 和 `updateOverlay()` 需要升级为“带约束”的写入入口。

推荐方向：

- `addOverlay()` 在内部调用 placement resolver
- `updateOverlay()` 针对 `startMs / durationMs / trackId` 变更时调用 placement resolver
- 对只改文本样式、位置、动画这类不影响轨道占用的更新，保持直接更新

这样可以保证：

- 任何新增都会过规则
- 任何轨道时间变更都会过规则

### 3. Timeline 组件职责收缩

`Timeline` 不再直接决定区块是不是能放。

它只负责：

- 计算用户 drop 的目标轨道和时间
- 把“想放在这里”的意图传给 store
- 根据 store 返回结果更新选中态和 Inspector

## 交互流程

### 1. 从素材库拖入

```text
AssetPanel dragstart
  -> Timeline drop
  -> store.addOverlay(intent)
  -> placement resolver
  -> 创建合法 overlay
  -> 自动选中该 overlay
  -> 打开 OverlayInspector
```

### 2. 手动新增文字

```text
点击“添加文字”
  -> 生成默认文字 overlay draft
  -> store.addOverlay(intent)
  -> placement resolver
  -> 创建合法 overlay
  -> 自动选中该 overlay
  -> 打开 OverlayInspector
```

### 3. 拖动已有区块

```text
OverlayBlock drag
  -> 计算候选 startMs / trackId
  -> store.updateOverlay(intent)
  -> placement resolver
  -> 合法则提交
  -> 冲突则吸附或回退
```

### 4. 拉伸已有区块

```text
OverlayBlock resize
  -> 计算候选 durationMs
  -> resolver 结合后邻居进行 clamp
  -> store.updateOverlay
```

## 测试策略

### 1. 纯逻辑测试

新增 placement 层测试，覆盖：

- overlap 判断
- 同轨最近合法位置搜索
- 跨轨搜索
- 自动新增轨道
- resize 上限 clamp

### 2. store 测试

扩展 timeline store 测试，覆盖：

- 新增 overlay 时冲突自动避让
- 更新 overlay 时禁止同轨重叠
- 添加文字也走同样的排轨逻辑
- 背景与 AI 卡片不参与该规则

### 3. 组件测试

扩展组件测试，覆盖：

- 图片 / 视频点击时间轴区块后打开 Inspector
- OverlayInspector 根据类型渲染不同内容
- 动画设置改动后能更新到通用 motion 字段

## 风险与取舍

### 1. AI 卡片与普通素材暂时并存两套排轨规则

这是有意为之。

原因是 AI 卡片的业务生成时机和呈现逻辑与手工素材不同，若本轮强行统一，会把范围拉大，影响当前已存在的 AI 生成功能。

### 2. 预览区选框仍然以文字为主

本次统一的是“选中态”和“详情面板”，不是完整的媒体画布编辑器。

因此：

- 时间轴里点图片 / 视频可以打开详情
- 预览区暂不提供图片 / 视频的拖拽缩放框

这个限制是可接受的，因为它不影响当前用户最核心的问题：素材区块不能编辑详情。

### 3. 自动新增轨道会改变当前轨道数量

这是系统兜底能力，但必须保持可解释：

- 只有在没有合法轨道时才自动新增
- 新增后立即在 UI 中可见
- Inspector 和选中态跟随新位置

## 实施顺序

推荐顺序：

1. 先做通用 motion 数据模型与渲染复用
2. 再做 OverlayInspector 和时间轴点击选中统一
3. 最后把新增 / 拖动 / 拉伸接入 placement resolver

这样可以先让“图片 / 视频可以打开详情”落地，再补强时间轴合法性，不会把调试点全部混在一起。

## 总结

这次改造的核心，不是多一个图片面板，而是把视觉区块从“按类型分散处理”升级成“通用 overlay + 类型扩展”的编辑模型。

完成后，编辑器会获得两项基础能力：

- 所有视觉素材都能进入同一套详情编辑体系
- 时间轴视觉轨道具备最基本的占用约束，不再出现同轨重叠

这会把当前文字、图片、视频三套逐渐分叉的逻辑重新收回到一条可持续演进的主线上。

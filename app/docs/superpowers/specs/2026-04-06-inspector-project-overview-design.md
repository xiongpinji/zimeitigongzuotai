# Inspector Project Overview Design

## 背景

当前编辑器右侧 `Inspector` 在 `selection.type === 'empty'` 时展示的是纯空状态提示：

- 标题：右侧配置区
- 描述：提示用户从左侧卡片列表或时间轴中选择对象

这个交互在“项目刚创建、还没有添加任何内容”时会显得非常空，也无法提供任何与当前工程相关的信息。用户希望空态回退为一个**全局项目面板**，至少能看到当前项目的基础信息，而不是一个空提示。

## 目标

把右侧 `Inspector` 的空态改造成**项目概览面板**，在未选中任何具体对象时展示：

- 项目名称
- 项目路径
- 项目目录大小
- 创建时间
- 分辨率
- FPS
- 当前素材 / 图层规模信息

## 非目标

- 不引入新的复杂导航层级
- 不把该面板做成可编辑表单
- 不新增项目配置持久化模型

## 方案

### 1. 空态语义切换

`EditorInspector` 的 `empty` 分支不再渲染 `EmptyState`，而是渲染一个新的“项目概览”内容块。

这意味着右侧面板在没有具体选区时，语义从“等待用户选择对象”切换为“展示当前工程全局信息”。

### 2. 数据来源

#### 同步数据

以下信息已经在渲染层可直接获得：

- 项目路径：当前 projectDir
- 项目名称：从 projectDir 推导
- 分辨率：`timeline.width × timeline.height`
- FPS：`timeline.fps`
- overlay 数量：`timeline.overlays.length`
- 素材数量：`assets.length`

#### 异步数据

以下信息需要 Electron 主进程补充：

- 项目目录大小
- 项目创建时间

新增 IPC：`get-project-metadata`

返回值建议：

```ts
interface ProjectMetadata {
  projectDir: string;
  sizeBytes: number;
  createdAtMs: number;
}
```

### 3. 组件边界

为避免 `EditorInspector` 继续膨胀，新增一个只负责展示项目概览的组件，例如：

- `src/components/ProjectOverviewPanel.tsx`
- `src/components/ProjectOverviewPanel.module.css`

职责划分：

- `Editor`：负责拉取异步项目元数据并维护 loading 状态
- `EditorInspector`：只负责根据 `selection` 路由到对应子面板
- `ProjectOverviewPanel`：负责把项目基础信息渲染成右侧概览视图

### 4. 展示形式

整体不使用“居中空状态卡片”，而是采用更像桌面编辑器信息面板的布局：

1. 顶部概览区
   - 项目名
   - 简短说明

2. 信息列表区
   - 路径
   - 大小
   - 创建时间
   - 分辨率
   - FPS
   - 素材数量
   - 图层数量

3. 加载兜底
   - 目录大小 / 创建时间在异步拉取期间显示“读取中”
   - 拉取失败时显示“暂时不可用”

## 数据流

```text
App(currentProjectDir)
  -> Editor(projectDir)
      -> useEffect 调 get-project-metadata
      -> EditorInspector(selection=empty, projectDir, projectMetadata)
          -> ProjectOverviewPanel
```

## 测试策略

### 组件测试

更新 `tests/editor-inspector.test.tsx` 或新增 `tests/project-overview-panel.test.tsx`，覆盖：

- empty 态不再出现旧的空提示文案
- empty 态展示项目路径
- empty 态展示分辨率 / FPS / 数量信息
- 元数据存在时展示大小与创建时间

### IPC / 类型测试

- 更新 `tests/electron-api.test.ts`，至少覆盖前端 Electron API 共享层没有破坏现有菜单命令定义
- 如有必要补充纯函数格式化测试

## 风险与处理

### 1. 目录大小递归读取开销

项目目录通常较小，可以接受。为避免阻塞：

- 使用异步 `fs.promises`
- 只在项目切换或关键依赖变化时拉取

### 2. 测试环境没有 Electron

组件不直接依赖 `window.electronAPI`，由 `Editor` 负责获取数据并通过 props 下传，可以降低 SSR / vitest 兼容风险。

## 结论

这是一次很小但体验价值很高的交互修正：把“无内容时的空提示”升级为“有信息的项目全局面板”。这样即便用户还没开始编辑，右侧区域也依然在表达当前工程状态，而不是空着。

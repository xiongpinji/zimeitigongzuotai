# Editor Inspector 项目概览设计

## 1. 背景

当前右侧 `EditorInspector` 在 `selection.type === 'empty'` 时展示的是居中的空状态文案。对于一个刚打开、尚未添加素材或尚未选中对象的项目，这个面板信息量过低，无法承担“全局配置 / 项目概览”角色。

目标是在未选中具体对象时，将右侧面板切换为“项目概览面板”，展示当前项目的基础信息，而不是展示空提示。

## 2. 目标

- 在 `empty` 状态下展示当前项目的全局基础信息
- 至少展示：
  - 项目名称
  - 项目路径
  - 项目目录总大小
  - 项目创建时间
  - 时间线分辨率
  - FPS
  - overlay 数量
- 当项目目录附加信息读取失败时，仍然展示路径、分辨率、FPS 等前端可得信息，不让面板回退为空

## 3. 非目标

- 不把这个面板扩展为完整的“项目设置中心”
- 不在本次改动中加入项目重命名、路径修改、导出设置等编辑能力
- 不重构现有 AI / 字幕 / 文字 Inspector 的行为

## 4. 方案

### 4.1 面板状态

`EditorInspector` 维持现有状态机：

```ts
type InspectorSelection =
  | { type: 'empty' }
  | { type: 'ai-card'; cardId: string }
  | { type: 'subtitle-style' }
  | { type: 'text-overlay'; overlayId: string };
```

仅替换 `empty` 分支的渲染内容：

- 旧行为：`EmptyState`
- 新行为：`ProjectOverviewPanel`

### 4.2 数据来源

#### 前端现有可得数据

- `projectDir`：来自当前项目目录状态
- `timeline.width` / `timeline.height`：当前时间线分辨率
- `timeline.fps`：当前项目帧率
- `timeline.overlays.length`：当前 overlay 数量

#### 新增 Electron IPC 数据

新增一个只读 IPC，用于读取项目目录元数据：

- IPC 名称：`get-project-meta`
- 入参：`projectDir: string`
- 返回：
  - `projectName`
  - `projectPath`
  - `createdAt`
  - `sizeBytes`

目录大小按“当前项目文件夹总占用大小”计算。

### 4.3 展示结构

右侧 `empty` 态展示两层信息：

1. 顶部概览区
   - 项目名称
   - 简短说明，如“当前未选中对象，右侧展示项目概览”
2. 信息列表
   - 路径
   - 大小
   - 创建时间
   - 分辨率
   - FPS
   - Overlay 数量

视觉上保持与现有 Inspector 深色 grouped panel 风格一致，不使用居中空状态排版。

### 4.4 异常与兜底

- 当 `projectDir` 为空时：
  - 显示“未打开项目”
  - 隐藏路径/目录大小/创建时间
  - 仍可展示时间线默认分辨率与 FPS
- 当 IPC 读取失败时：
  - 路径仍直接使用前端 `projectDir`
  - 目录大小、创建时间显示为 `--`
  - 控制台记录错误，UI 不抛异常

## 5. 测试策略

- `EditorInspector` 新增 empty 态测试：
  - 有项目路径和项目元数据时，展示项目概览字段
  - IPC 数据缺失时，仍展示前端可得信息
- 保留现有 AI card header 测试，确保非 empty 分支未回归

## 6. 涉及文件

- `src/components/EditorInspector.tsx`
- `src/components/EditorInspector.module.css`
- `src/lib/electron-api.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `tests/editor-inspector.test.tsx`

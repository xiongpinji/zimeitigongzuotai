# AI 封面图编辑器设计

- 创建时间：2026-04-21
- 状态：Design（待 review）
- 主负责：yoqu

## 背景

当前视频编辑器的 AI 助手面板（`AICoverPanel`）只支持「生成封面候选 → 选中 → 拖到时间轴 / 设为全局背景」三种操作，无法对 AI 产出图片做二次加工。这导致：

1. AI 生成的封面比例经常与最终视频目标宽高比不一致（例如 16:9 时间线用了 1:1 的图）。
2. 无法直接在封面上叠加标题 / 副标题文字，用户需要切走到 Photoshop / 在线工具再导回，工作流断裂。
3. 滤镜、调色、裁剪、旋转等"最后一公里"的打磨无法完成。

本设计为 AI 封面追加一套轻量但完整的图片编辑能力，保持项目 macOS 专业创作工具的克制风格，并与现有 `CoverCandidate` 数据模型、`project.json` 持久化、Electron IPC 三件套保持一致。

## 目标与非目标

### 目标

- 在 AI 封面面板中对任意候选进行二次编辑：裁剪、比例调整、文字叠加、基础调色、旋转/翻转、撤销/重做。
- 默认编辑比例跟随当前时间线分辨率，最大程度减少"导出比例不对"的错误。
- 保存提供两种模式：
  - **另存为新候选**：追加到列表，`editedFrom` 指向来源，保留 AI 原图
  - **覆盖原图**：原地替换 `imageUrl`，带二次确认
- 编辑状态（`CoverEditState`）持久化到 `project.json`，支持「再次编辑」时恢复工具状态。
- UI 与现有 darwin-ui tokens 保持视觉一致。

### 非目标（YAGNI）

- 不实现 AI 智能抠图、背景替换（未来迭代）。
- 不做多图层管理 / 图层树（封面场景只有 1 底图 + 少量文字，平铺即可）。
- 不做基础图形工具（矩形/圆形/箭头），已降为 P3。
- 不做模板系统（保存「封面模板」复用）。
- 不做贴纸商店、云端字体加载。
- 不替换现有封面生成链路（仅追加编辑能力）。
- 不做视频缩略图 / 动图封面。

## 功能分层（业务优先级）

本期交付范围：**P0 + P1**。P2 作为 stretch goal，若 M1-M4 提前完成则在 M5 内实现；否则延后。

| 优先级 | 功能 | 说明 | 本期 |
|---|---|---|---|
| **P0** | 裁剪 + 比例预设 | 16:9、9:16、1:1、4:3、4:5、自由；默认跟随时间线宽高比 | ✅ |
| **P0** | 文字叠加 | 标题 / 副标题；字体（读系统字体）、字号、颜色、描边、阴影、对齐、行距 | ✅ |
| **P0** | 保存候选（双模式） | 「另存为新候选」追加；「覆盖原图」原地替换 | ✅ |
| **P1** | 基础调色 | 亮度、对比度、饱和度、色温 | ✅ |
| **P1** | 滤镜预设 | 原图、黑白、鲜艳、复古、冷色、暖色 | ✅ |
| **P1** | 旋转 / 水平翻转 / 垂直翻转 | 常规变换 | ✅ |
| **P1** | 撤销 / 重做 | 编辑器内栈式操作历史 | ✅ |
| **P2** | 画笔 / 马赛克 | 涂鸦、模糊敏感区域 | 🟡 stretch |
| **P3**（未纳入本期） | 图形（矩形/圆形/箭头）、抠图、模板、图层树 | 后续版本 | ❌ |

> **用户决策（2026-04-21）**：
> - 技术方案采用 Fabric.js + 自研 UI（详见下一节）
> - 需要同时提供「另存为新候选」与「覆盖原图」两种保存模式
> - 字体来源：系统默认（CSS 降级） + 通过 Electron API 读取用户机器的系统字体库
> - P2 基础图形（矩形/圆形/箭头）本期不做

## 技术选型

### 最终方案：Fabric.js + 自研 UI

| 方案 | P0 覆盖 | 集成成本 | UI 一致性 | 维护性 | 结论 |
|---|---|---|---|---|---|
| A. `react-photo-editor` | ❌ 无文字/裁剪比例 | 极低 | 需完全定制 | 好 | 淘汰：P0 不满足 |
| B. `filerobot-image-editor` | ✅ 开箱即用 | 低 | 需 theme 覆盖 | 中 | 已评估，未采纳（UI 风格难完全对齐 darwin-ui） |
| **C. Fabric.js + 自研 UI** | ✅（全部自建） | 中–高（4–5d） | **完美** | **高** | ✅ **采用** |
| D. `react-konva` + 自研 UI | ✅（全部自建） | 中–高 | 完美 | 高 | 备选 |

### 为什么选 Fabric.js

1. **视觉完全贴合 darwin-ui**：自研工具栏与 Inspector，不需要反向覆盖第三方 DOM，保持 macOS 专业创作工具调性。
2. **复用项目既有 UI primitives**：按钮 / 输入 / 滑杆 / 颜色拾取器复用 `src/ui/components` 与 `src/ui/primitives`，不引入第二套视觉系统。
3. **能力天花板高**：Fabric 内置完整的对象模型（Image / Textbox / Rect / Circle / Path / Group / Filter），天然支持撤销/重做（通过 `toJSON` / `loadFromJSON` 快照）、序列化为 `CoverEditState`、滤镜链（亮度/对比度/饱和度/色温 + 预设）。
4. **裁剪比例实现简洁**：使用 `clipPath` + 背景图 cover 模式，切换 aspect ratio 只需调整 `clipPath` 宽高，不触发图像重采样。
5. **与 Remotion 无冲突**：Fabric 在 Renderer 单独 Canvas 实例，与 Remotion 预览互不干扰。
6. **长期演进友好**：后续若扩展到模板系统、动态封面、AI 抠图，Fabric 的对象模型都可直接承接。

### 对比备注

- `react-fabricjs` 等 React 封装年久失修，**直接使用 `fabric` 原生 API** + 自写 React hook 管理生命周期更稳妥。
- `react-konva` 同样可行，但 Fabric 在「图片 + 文字 + 滤镜」场景的 API 更成熟，文档资源丰富，社区滤镜库现成。
- 工时从方案 B 的 3d 上调到 4–5d，增量主要在裁剪交互、文字 Inspector、滤镜面板的自研 UI。

## 架构设计

### 模块关系

```
AICoverPanel (现有)
  ├─ 候选卡片 hover → 显示"编辑"按钮（与"选中"并列）
  └─ 点击编辑 → 打开 CoverEditorModal
                  │
                  └─ CoverEditorCanvas (自研，基于 fabric.Canvas)
                       │
                       ├─ 读取：候选 imageUrl + 可选的历史 edits 状态
                       ├─ 默认比例：timelineStore 宽高比
                       ├─ 工具栏：裁剪 / 文字 / 滤镜 / 调色 / 变换
                       ├─ Inspector：选中对象属性面板（字体/颜色/对齐/…）
                       ├─ 历史管理：基于 fabric.toJSON 的 undo/redo 栈
                       └─ 保存（两种模式）
                             ├─ 另存为新候选 → IPC save-cover-edit (append)
                             └─ 覆盖原图     → IPC save-cover-edit (overwrite)
                                   │
                                   └─ 写入 {projectDir}/covers/{cover|edited}-{uuid}.png
                                         │
                                         └─ AIStore append / replaceCoverCandidate
                                               │
                                               └─ project.json 持久化
```

### 新增文件与职责

| 文件 | 职责 |
|---|---|
| `src/components/CoverEditorModal.tsx` | 全屏 Modal 容器，布局 + 顶栏 + 保存模式下拉 |
| `src/components/cover-editor/CoverEditorCanvas.tsx` | Fabric Canvas 初始化、图像加载、比例 clipPath、事件桥接 |
| `src/components/cover-editor/ToolRail.tsx` | 左侧工具栏（裁剪、文字、滤镜、调色、变换） |
| `src/components/cover-editor/Inspector.tsx` | 右侧 Inspector：选中对象属性（文字字体/字号/颜色/描边/阴影/行距） |
| `src/components/cover-editor/FilterPanel.tsx` | 滤镜预设 + 亮度/对比度/饱和度/色温滑杆 |
| `src/components/cover-editor/FontPicker.tsx` | 字体选择下拉（读系统字体 + 搜索 + 默认 fallback） |
| `src/lib/cover-editor/fabric-bridge.ts` | Fabric 生命周期 Hook（`useFabricCanvas`）+ 快照栈 |
| `src/lib/cover-editor/cover-edit-state.ts` | `CoverEditState` 类型 + `fabric.toJSON <-> CoverEditState` 序列化 |
| `src/lib/cover-editor/filters.ts` | 滤镜预设矩阵（黑白、鲜艳、复古、冷暖）+ fabric.Image.filters 映射 |
| `src/lib/cover-editor/aspect-ratios.ts` | 比例预设定义 + timelineStore 推导默认值 |
| `src/lib/cover-editor/system-fonts.ts` | 调用 IPC `list-system-fonts` + 缓存 |
| `electron/cover-editor-io.ts` | 主进程：保存编辑后图片（append/overwrite），返回候选 |
| `electron/system-fonts.ts` | 主进程：读取系统字体列表 |
| `tests/cover-editor.test.tsx` | Modal 挂载、比例切换、文字叠加、保存两种模式、再编辑恢复 |
| `tests/cover-edit-state.test.ts` | 序列化往返、旧/新版本兼容 |

### 修改的既有文件

- `src/types/ai.ts`：扩展 `CoverCandidate`（新增可选字段 `editedFrom` / `edits` / `createdAt`），新增 `CoverEditState`
- `src/store/ai.ts`：新增 `appendCoverCandidate`、`replaceCoverCandidate`、`updateCoverEdits` 三个 action
- `src/components/AICoverPanel.tsx`：候选卡片增加「编辑」按钮，接线 Modal 打开
- `src/components/AIPanel.tsx`：集成 `CoverEditorModal`，注入 store action
- `src/lib/project-persistence.ts`：`CoverCandidate` 新增字段可选，向后兼容；无需迁移代码
- `electron/main.ts`：注册 `save-cover-edit`、`list-system-fonts` 两个 IPC handler
- `electron/preload.ts`：暴露 `saveCoverEdit`、`listSystemFonts` 桥
- `src/lib/electron-api.ts`：类型声明

## 数据模型

### CoverCandidate 扩展

```typescript
export interface CoverCandidate {
  id: string;
  prompt: string;
  imageUrl: string;
  selected: boolean;
  error?: string;
  // 新增字段（均可选，向后兼容）
  editedFrom?: string;   // 来源候选 id；未编辑过的 AI 原图为 undefined
  edits?: CoverEditState; // 编辑状态快照，用于再次编辑时恢复工具面板
  createdAt?: number;     // 生成时间戳（AI 原图/编辑生成都可填）
}
```

### CoverEditState（编辑状态）

```typescript
export interface CoverEditState {
  version: 1;
  aspectRatio?: string; // "16:9" | "9:16" | "1:1" | "4:3" | "4:5" | "free"
  crop?: { x: number; y: number; width: number; height: number };
  textOverlays?: Array<{
    id: string;
    text: string;
    x: number; y: number;
    fontSize: number;
    fontFamily: string;       // 来自 system-fonts，缺失时 fallback
    color: string;
    strokeColor?: string;
    strokeWidth?: number;
    shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
    align?: 'left' | 'center' | 'right';
    rotation?: number;
  }>;
  // 注：shapes（矩形/圆形/箭头）本期不做
  filters?: {
    brightness?: number; // -100 ~ 100
    contrast?: number;
    saturation?: number;
    temperature?: number;
    preset?: 'none' | 'bw' | 'vivid' | 'vintage' | 'cool' | 'warm';
  };
  transform?: { rotate?: number; flipX?: boolean; flipY?: boolean };
  paintStrokes?: Array<{ path: string; color: string; width: number }>; // P2 画笔
  mosaicRegions?: Array<{ x: number; y: number; width: number; height: number }>; // P2 马赛克
}
```

> **序列化策略**：`CoverEditState` 与 Fabric `toJSON` 的产物**分离**。`CoverEditState` 是跨版本稳定的业务模型；Fabric 快照仅用于编辑器内撤销/重做栈（不持久化）。保存时通过 `fabric-bridge` 映射层双向转换。这样即使未来替换底层（Konva / 原生 Canvas），已保存的 `edits` 仍可读。

## IPC 设计（三件套）

### `save-cover-edit`

- **输入**：
  ```typescript
  {
    projectDir: string;
    sourceCandidateId: string;
    dataUrl: string;              // PNG base64
    edits: CoverEditState;
    mode: 'append' | 'overwrite'; // 另存为新候选 / 覆盖原图
  }
  ```
- **输出**：`{ candidate: CoverCandidate; replacedId?: string }`
- **主进程实现**：
  1. 从 dataURL 解析 bytes
  2. `append` 模式：生成 `edited-{uuid}.png`，构造新候选（`editedFrom = sourceCandidateId`）
  3. `overwrite` 模式：写入 `{sourceCandidateId对应文件名}.png`（保留原路径），返回的候选 `id` 仍为原 id，`edits` 回写；`replacedId` 填原 id 方便 store 做原地替换
  4. 写入同步刷盘，避免后续读图竞争

### `list-system-fonts`

- **输入**：无
- **输出**：`{ fonts: Array<{ family: string; subfamilies?: string[] }> }`
- **主进程实现**：
  1. macOS：使用 `font-list` npm 包（基于 `system_profiler`）或 fallback 到 `fc-list`
  2. 结果缓存 60s，避免频繁 IPC 扫盘
  3. 返回去重后的 family 列表 + 常见中英文分组
- **Renderer 侧**：`src/lib/cover-editor/system-fonts.ts` 再做一层 60s 内存缓存；FontPicker 懒加载

### 文件位置约定

- 原 AI 图：`covers/cover-{uuid}.png`
- 编辑后（append）：`covers/edited-{uuid}.png`（`{uuid}` 为新候选 id）
- 覆盖原图（overwrite）：沿用来源候选 `imageUrl` 所对应的文件名，不变更路径；`imageUrl` 附加 `?v={timestamp}` query 作为缓存破坏
- 统一被 `project.json` 的 `aiAnalysis.coverCandidates` 引用，无额外索引

## UI 交互

### 入口

- 候选卡片 hover 时，右下角浮出两个按钮：
  - 📥 选中 / 取消选中（现有）
  - ✏️ 编辑（新增）
- 点击编辑 → 打开全屏 Modal（背景半透明遮罩，内容居中宽度 1280px / 高度 80vh），顶部标题栏显示「编辑封面 - 基于 {来源 prompt 前 20 字}」。

### 编辑器布局

Modal 尺寸：**宽度 min(1280px, 90vw)，高度 80vh**。画布区自适应填充中间空间。

```
┌────────────────────────────────────────────────────────────────────────┐
│ 编辑封面   [时间线 16:9 ▼] [↩][↪]              [取消] [覆盖 ▾][保存] │
├──────┬──────────────────────────────────────────────────┬──────────────┤
│ 工具 │                                                  │  Inspector   │
│ ─── │                                                  │ ───────────  │
│ 选择 │                                                  │ 选中：文本   │
│ 裁剪 │                  Fabric Canvas                   │              │
│ 文字 │                 (clipPath 按比例)                │ 字体[PingFang│
│ 调色 │                                                  │ 字号 [48 ▼]  │
│ 滤镜 │                                                  │ 颜色 [■]     │
│ 变换 │                                                  │ 描边 [○] 2px │
│ 画笔*│  （* = P2，stretch 才启用）                     │ 阴影 [□]     │
│ 马赛*│                                                  │ 对齐 [⬒⬒⬒]  │
│      │                                                  │              │
└──────┴──────────────────────────────────────────────────┴──────────────┘
```

### 关键交互点

- **比例下拉**：第一项为「时间线比例」（动态显示，如 `时间线 16:9`），其后 `16:9 / 9:16 / 1:1 / 4:3 / 4:5 / 自由`；切换比例时 Canvas `clipPath` 实时更新，底图保持居中 cover
- **文字工具**：
  - 点击画布空白处创建新文本对象，进入编辑模式
  - 选中文本时 Inspector 显示完整属性面板
  - 字体来自 `FontPicker`（读系统字体 + 搜索 + 最近使用）
  - 未加载的字体使用 Font Face API 动态注入 `@font-face`；失败时退回 fallback
- **保存按钮**：分裂按钮形态
  - 主按钮：上次使用的模式（默认"另存为新候选"）
  - 下拉副项：切换到「覆盖原图」；切换后记住用户偏好（本地 preference，不入 project.json）
  - 覆盖模式点击时弹出二次确认："将覆盖原图，且无法恢复，确定继续？"
- **取消**：若有未保存更改，弹出确认；否则直接关闭
- **ESC 键**：等同取消
- **快捷键**：`⌘Z` 撤销、`⌘⇧Z` 重做、`⌫` 删除选中、`⌘A` 全选、`⌘C/V` 复制粘贴对象

## 主题适配

由于 UI 完全自研（复用 `src/ui/components`、`src/ui/primitives`），**无需任何第三方主题覆盖**。所有按钮、下拉、滑杆、输入、颜色拾取器直接使用项目既有组件，自然对齐 darwin-ui tokens。

Canvas 内部的选中框、辅助线等 Fabric 原生视觉元素通过 Fabric 配置项统一：

```typescript
fabric.Object.prototype.set({
  borderColor: tokens.colorSystemBlue,
  cornerColor: tokens.colorSystemBlue,
  cornerStyle: 'circle',
  cornerSize: 8,
  transparentCorners: false,
  padding: 2,
});
```

## 中文化

全部 UI 文案在自研组件中硬编码中文即可；Fabric 无用户可见文案。

## 测试策略

Vitest + React Testing Library：

1. `CoverEditorModal` 打开后正确挂载 Fabric Canvas（mock `fabric.Canvas`）
2. 切换比例预设后 `clipPath` 的 width/height 按预期更新
3. 「另存为新候选」模式：IPC 调用参数含 `mode: 'append'`，store `coverCandidates.length + 1`，新候选 `editedFrom` 正确
4. 「覆盖原图」模式：IPC 调用参数含 `mode: 'overwrite'`，store 长度不变，原候选的 `imageUrl`（含 cache-bust query）/ `edits` 被替换
5. 已有 `edits` 的候选再次编辑时，Fabric `loadFromJSON` 被调用且状态还原
6. `cover-edit-state.ts` 序列化往返：`toCoverEditState(canvas) → applyToCanvas(canvas) → toCoverEditState(canvas)` 等幂
7. FontPicker：未加载字体动态注入 `@font-face`，失败时 fallback 到系统默认

Electron 层单独测试：

- `electron/cover-editor-io.ts`：两种模式各自的 dataURL 解析、路径拼装、文件写入、返回候选对象字段完整
- `electron/system-fonts.ts`：mock `font-list`，验证缓存命中 / 失效、去重、字段结构

不做端到端（Remotion 导出链路不在本期变更范围）。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Fabric 自研 UI 工期超预估 | 延期 | 按里程碑严格分段，MVP 只含 P0；P1 分支可开 follow-up PR |
| 覆盖原图破坏性操作 | 用户误操作丢失原图 | 二次确认弹窗；副按钮颜色区分；文案强警示 |
| 大图（>4K）性能问题 | Canvas 卡顿 | 画布显示尺寸按容器缩放（`canvas.setZoom` + `setDimensions`），底图 `fabric.Image` 初始化时以 `scaleX/scaleY` 等比缩放至容器；保存时用 `canvas.toDataURL({ multiplier })` 还原到原分辨率导出 |
| 系统字体渲染不一致 | 跨机器表现差异 | 保存 `CoverEditState.textOverlays[].fontFamily` 原始名；加载时若字体缺失用 fallback 并 toast 提示 |
| `font-list` 在某些 macOS 权限失败 | 字体列表空 | 降级到浏览器可用字体白名单（10 款常见中英文） |
| `project.json` 迁移风险 | 旧项目打不开 | 新增字段全部可选，无需迁移；`edits` 缺失时编辑器以空白状态打开 |
| Fabric 产物包体积 | 安装包变大 | Fabric 核心约 300KB gzip；按需引入（不引入 video/filter 全量模块） |

## 里程碑

| 阶段 | 内容 | 时长 |
|---|---|---|
| M1 | 依赖引入、`CoverEditorModal` 骨架、Fabric Canvas 挂载、图像加载、比例 clipPath | 1d |
| M2 | 工具栏 + Inspector + 文字工具 + 字体 IPC（list-system-fonts） | 1d |
| M3 | 滤镜/调色/变换/撤销重做 + 快捷键 | 1d |
| M4 | IPC `save-cover-edit`（append + overwrite）+ Store 扩展 + 再编辑状态恢复 | 0.5d |
| M5 | 回归测试（Vitest 覆盖率 + 手动走查） + UI 打磨 | 0.5d |

**合计预估 4 天**。

## 决策记录（2026-04-21）

用户已确认：

- ✅ 技术方案：**Fabric.js + 自研 UI**（不采用 react-photo-editor / filerobot）
- ✅ 保存行为：**同时提供「另存为新候选」与「覆盖原图」**
- ✅ 字体：**系统默认 + Electron API 读取系统字体库**（`font-list` npm 包）
- ✅ 形状工具（矩形/圆形/箭头）：**本期不做**，降为 P3

## 依赖变更

新增：

- `fabric`（约 300KB gzip）
- `font-list`（主进程读系统字体；约 15KB）

## 后续可扩展（P3+）

- 封面模板系统：保存当前编辑状态为模板，新封面一键套用
- AI 智能建议：基于脚本标题自动生成推荐文字 + 字体 + 色值
- 抠图 / 背景替换（接入现有图片 Provider 的编辑端点）
- 多图层树（演进为简易海报设计器）
- 动态封面（导出 WebP / APNG，进入时间线首帧）

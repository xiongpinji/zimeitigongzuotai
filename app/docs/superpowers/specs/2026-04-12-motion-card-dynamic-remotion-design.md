# Motion Card — AI 生成 Remotion 动态动画组件

> **日期**：2026-04-12
> **状态**：Draft
> **范围**：编辑器 AI 面板新增"动画"标签页，通过对话式交互让 AI 生成 Remotion 原生 React 动画组件，支持预览、上轨和视频导出。

---

## 1. 背景与目标

### 现状

灵机剪影的 AI 卡片系统支持 5 种静态卡片类型（summary / data / insight / chapter / quote）和 web-card 渲染模式（iframe srcDoc）。这些卡片以固定布局展示信息，缺乏动画表现力。

### 目标

新增 **Motion Card** 类型 — 用户通过自然语言描述动画效果，AI 生成 Remotion 原生 React 组件代码，在视频中播放帧级精确同步的动画。

### 核心价值

- **帧级精确**：使用 Remotion 的 `interpolate()` / `spring()` 逐帧计算，零偏移
- **导出兼容**：原生 React 组件，Remotion bundler 直接渲染，无 iframe SSR 白屏问题
- **AI 生成可靠**：HTML/CSS/React 是 LLM 最擅长的领域
- **全量 API**：注入完整 Remotion 生态（noise / shapes / paths / transitions / motion-blur）

### 信任前提

本功能面向**本地开发者自用工作流**：

- AI 生成代码视为受信输入
- 本期不额外设计多租户隔离、权限收敛或安全沙箱策略
- 风险由使用者自行评估并承担

---

## 2. 数据模型

### 新增类型

```typescript
// src/types/ai.ts 扩展

// 卡片类型新增 'motion'
type AICardType = 'summary' | 'data' | 'insight' | 'chapter' | 'quote' | 'motion';

// 渲染模式新增 'motion-card'
type AICardRenderMode = 'legacy' | 'web-card' | 'motion-card';

// Motion Card 专属数据
interface MotionCardPayload {
  sourceCode: string;          // AI 生成的原始 JSX 源码
  compiledCode: string;        // Babel 编译后的 JS
  compiledAt: number;          // 编译时间戳
  compileError?: string;       // 编译错误信息（如有）
  prompt: string;              // 用户的原始描述
  retryCount: number;          // AI 自动修复重试次数
}

interface PersistedAIState {
  version: 1;
  analysisResult: AIAnalysisResult | null;
  coverCandidates: CoverCandidate[];
  motionCards: AICard[];
}
```

### 与现有模型的关系

Motion Card 复用现有的 `AICard` → `OverlayItem` 体系，但**不并入**已有的
`analysisResult.cards`。它走单独的 `motionCards` 状态分支，并在落轨时复用
现有 `overlayType: 'ai-card'` 的时间线通道：

```
motionCards: AICard[] {
  type: 'motion',
  renderMode: 'motion-card',
  motionCard: MotionCardPayload,     // 新增字段
  displayDurationMs: number,         // 动画时长（复用）
  displayMode: 'fullscreen' | 'pip', // 显示模式（复用）
  style: CardStyle,                  // 样式（复用）
}
    ↓ addAICardsToTimeline()
OverlayItem {
  overlayType: 'ai-card',
  aiCardData: {
    cardType: 'motion',
    renderMode: 'motion-card',
    motionCard: MotionCardPayload,   // 透传
    ...其余字段复用
  }
}
```

---

## 3. 编译与执行引擎

### 3.1 编译层 — `src/lib/motion-compiler.ts`

**职责**：JSX 源码 → 可执行 JS

**依赖**：`@babel/standalone`（~800KB），配置 `preset-react`（classic runtime）+ `preset-typescript`（仅去类型）

**接口**：

```typescript
compile(sourceCode: string): { compiledCode: string } | { error: string }
```

**编译产物**：纯 `React.createElement` 调用，无 import/export。

**AI 代码约束（写入 prompt）**：

- 必须定义 `const MotionComponent = (props) => { ... }`
- props 签名固定：`{ frame, fps, durationInFrames, width, height }`
- 禁止 import/export — 所有依赖从沙箱注入
- 禁止 async/await — Remotion 逐帧渲染是同步的
- 可通过 `React.` 前缀访问 React hooks（`React.useState`、`React.useMemo` 等）

### 3.2 执行层 — `src/lib/motion-runtime.ts`

**职责**：编译后的 JS → React 组件实例

**执行方式**：

```typescript
function createMotionComponent(compiledCode: string): React.FC<MotionProps> | null {
  const paramNames = Object.keys(sandbox);
  const paramValues = Object.values(sandbox);
  const factory = new Function(
    ...paramNames,
    `${compiledCode}\nreturn MotionComponent;`
  );
  return factory(...paramValues);
}
```

**沙箱注入原则**：

```typescript
const sandbox = {
  // React
  React,

  // Remotion 核心动画
  interpolate, interpolateColors, spring, Easing, random,

  // Remotion Hooks
  useCurrentFrame, useVideoConfig, delayRender, continueRender,

  // Remotion 组件
  AbsoluteFill, Sequence, Series, Loop, Img, OffthreadVideo, Audio, IFrame,
  staticFile,

  // @remotion/shapes — SVG 几何图形
  Circle, Rect, Triangle, Star, Pie, Ellipse,
  makeCircle, makeRect, makeTriangle, makeStar, makePie, makeEllipse,

  // @remotion/paths — SVG 路径动画
  evolvePath, getPointAtLength, getLength, interpolatePath,
  ...pathHelpers,

  // @remotion/noise — 程序化噪声
  noise2D, noise3D,

  // @remotion/transitions — 转场效果
  ...transitionHelpers,

  // @remotion/motion-blur — 运动模糊
  CameraMotionBlur,

  // @remotion/media-utils — 音频可视化
  visualizeAudio, getWaveformPortion, createSmoothSvgPath,
};
```

说明：

- `motion-runtime.ts` 负责维护**唯一的 sandbox API 真相源**
- prompt 构建层不再手写一份独立 API 名单，而是直接消费 runtime 导出的
  `SANDBOX_API_KEYS` / `MOTION_SANDBOX_REFERENCE`
- `@remotion/shapes` / `@remotion/paths` / `@remotion/transitions` 的具体导出名，
  以安装后的真实包导出为准，不在 spec 中重复硬编码两份

**运行时错误捕获**：外层 React ErrorBoundary 捕获渲染错误，错误信息传回 AI 自动修复流程。

---

## 4. Remotion 渲染集成

### 4.1 新增组件 — `src/remotion/MotionCardOverlay.tsx`

```
MotionCardOverlay
├── ErrorBoundary（捕获运行时错误，显示 fallback 占位）
│   └── DynamicMotionRenderer
│       ├── useMemo → createMotionComponent()（缓存，compiledCode 不变不重建）
│       ├── useCurrentFrame() 获取当前帧
│       └── 渲染 <DynamicComponent frame={...} fps={...} ... />
```

**关键设计**：

1. **组件缓存**：`compiledCode` 不变时，`useMemo` 缓存组件实例，避免每帧重新 `new Function()`
2. **ErrorBoundary 双层**：
   - 外层 React ErrorBoundary：捕获渲染错误，显示 fallback
   - 内层 try/catch：包裹 `createMotionComponent()`，捕获代码即时执行错误
3. **props 透传**：`frame` / `fps` / `durationInFrames` / `width` / `height` 由外层计算后传入

### 4.2 AICardOverlay 派发扩展

```typescript
// src/remotion/AICardOverlay.tsx renderCard() 新增分支
if (renderMode === 'motion-card' && overlay.aiCardData.motionCard) {
  return <MotionCardOverlay motionCard={overlay.aiCardData.motionCard} />;
}
```

### 4.3 素材引用

V1 版本**不把项目媒体素材引用作为核心验收路径**。

本期约束：

- Motion Card 主要面向纯 React / Remotion 文本、图形、SVG、路径和转场动画
- `MotionGenerateParams` 仍保留 `assets` 扩展位，便于后续接入素材上下文
- 如上层传入 `assets`，仅作为 prompt 辅助信息，不作为 V1 必过能力
- 直接要求 AI 使用 `staticFile('原文件名')` 不是本期契约，避免预览/导出路径不一致

### 4.4 导出兼容性

无需额外处理：
1. `bundle()` 打包时 `MotionCardOverlay` 作为静态导入被包含
2. `renderMedia()` 在 headless Chromium 中逐帧渲染，`new Function()` 正常执行
3. `motionCard.compiledCode` 作为 props 数据传入

---

## 5. AI 生成与自动修复流程

### 5.1 服务层 — `src/lib/motion-card-service.ts`

所有生成逻辑在服务层闭合，内部 UI 和外部 MCP/ACP 共用同一接口：

```typescript
interface MotionCardService {
  // 根据自然语言描述生成 motion card
  generate(params: {
    prompt: string;
    durationMs?: number;            // 默认 5000ms
    displayMode?: 'fullscreen' | 'pip';
    canvasSize?: { width: number; height: number };  // 默认 1920×1080
    assets?: MotionAssetInfo[];
  }): Promise<MotionCardResult>;

  // 基于现有代码 + 修改指令生成新版本
  modify(params: {
    sourceCode: string;
    instruction: string;
  }): Promise<MotionCardResult>;

  // 编译 JSX 源码（纯编译，不涉及 LLM）
  compile(params: {
    sourceCode: string;
  }): MotionCompileResult;

  // 获取可用 Remotion API 参考文档（用于外部工具构建 prompt）
  getApiReference(): string;
}

interface MotionCardResult {
  success: boolean;
  sourceCode?: string;
  compiledCode?: string;
  error?: string;
  retryCount: number;
}
```

**MCP 预留**：服务层方法可直接映射为 MCP tools
（`generate_motion_card` / `modify_motion_card` / `compile_motion_card` /
`get_remotion_api_reference`）。素材扫描由调用方负责，本期不在服务层内耦合
Electron/项目目录扫描。

### 5.2 Prompt 构建 — `src/lib/motion-prompt.ts`

**System Prompt 包含**：
1. 角色定义："你是一个 Remotion 动画组件生成器"
2. 代码约束（无 import、固定 props 签名、组件名 `MotionComponent`）
3. 可用 API 完整清单（分类列出全部沙箱 API）
4. 每个 API 的简要用法示例
5. 输出格式约束：只输出 JSX 代码块，不输出解释文字

**User Prompt 包含**：
1. 用户的自然语言描述
2. 可选的项目素材列表上下文：`["logo.png (image)", "intro.mp4 (video)"]`
3. 画布尺寸：`1920×1080`
4. 用户指定的动画时长

### 5.3 修改指令流程

构建 prompt：原始代码 + 修改指令 → LLM 返回完整新版本代码（非 diff）→ 编译 → 替换。

### 5.4 自动修复 — `src/lib/motion-auto-fix.ts`

```
编译/运行时错误捕获
    ↓
构建修复 prompt：原始代码 + 错误信息 + 错误类型
    ↓
LLM 生成修复版本 → 重新编译
    ↓ 成功         ↓ 失败（retryCount < 3）
替换代码          递增 retryCount，再次修复
                   ↓ 失败（retryCount >= 3）
                  标记为失败，显示错误占位卡片
```

LLM 调用复用现有 `src/lib/llm/` 基础设施（`generateText()`），模型和 API 配置复用用户 LLM 设置。

---

## 6. UI 交互设计

### 6.1 AIPanel 新增"动画"子标签

```
AIPanel
├── SubTabs: [ cards | cover | 动画 ]
└── Body
    └── If activeTab === 'motion':
        └── MotionPanel
            ├── PromptSection
            │   ├── Textarea "描述你想要的动画效果..."
            │   ├── DurationInput（时长，默认 5s）
            │   ├── DisplayModePicker（全屏 / PiP）
            │   └── GenerateButton "生成动画"
            ├── MotionCardList
            │   └── MotionCardItem ×N
            │       ├── 状态徽章（生成中 / 就绪 / 错误）
            │       ├── 标题（AI 命名或描述截取）
            │       ├── 时长标签
            │       ├── 操作按钮：修改 / 删除
            │       └── Checkbox（勾选用于上轨）
            ├── ErrorState（最终失败提示）
            └── Footer: "上轨 N" 按钮
```

### 6.2 生成交互流程

1. 用户输入描述，点击"生成动画"
2. 按钮进入 loading，列表顶部出现"生成中..."占位卡片
3. AI 返回 → 编译成功 → 占位变为就绪，显示标题
4. 编译失败 → 自动修复（占位显示"修复中 1/3"）
5. 最终成功 → 就绪；最终失败 → 错误状态 + "重新描述"提示

### 6.3 修改交互流程

1. 用户点击 motion card 的"修改"按钮
2. 弹出 inline 输入框："输入修改指令..."
3. 提交后卡片进入 loading
4. AI 基于现有代码 + 修改指令生成新版本 → 编译 → 替换

### 6.4 预览联动

- 点击 MotionCardItem → 右侧 Inspector 显示详情（描述 + 时长 + 状态 + 显示模式）
- 勾选并上轨后，统一通过现有中央 Remotion Player 预览
- 本期不单独创建 detached `<Player>` 作为未上轨预览容器
- Inspector 以状态查看和删除操作为主，不承担独立播放控制

### 6.5 上轨流程

复用现有 `addAICardsToTimeline()` 机制，motion card 作为 `overlayType: 'ai-card'` 加入 `visual-2` 轨道。

---

## 7. 新增依赖与文件清单

### 新增 npm 依赖

| 包 | 用途 |
|---|---|
| `@babel/standalone` | 运行时 JSX/TS 编译 |
| `@remotion/noise` | noise2D/noise3D 程序化噪声 |
| `@remotion/shapes` | SVG 几何图形组件 |
| `@remotion/paths` | SVG 路径动画工具 |
| `@remotion/transitions` | TransitionSeries + 预置转场 |
| `@remotion/motion-blur` | CameraMotionBlur 运动模糊 |

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/lib/motion-compiler.ts` | Babel 编译层 |
| `src/lib/motion-runtime.ts` | 执行层：沙箱 + 组件实例化 |
| `src/lib/motion-card-service.ts` | 服务层：生成/修改/编译/素材/API 参考 |
| `src/lib/motion-prompt.ts` | Prompt 构建 |
| `src/lib/motion-auto-fix.ts` | 自动修复重试 |
| `src/remotion/MotionCardOverlay.tsx` | Remotion 渲染组件 |
| `src/components/MotionPanel.tsx` | AI 面板"动画"标签页主组件 |
| `src/components/MotionCardItem.tsx` | 单个 motion card 卡片 UI |
| `src/components/MotionCardInspector.tsx` | 右侧 Inspector 详情面板 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/types/ai.ts` | 新增 `'motion'` 类型、`'motion-card'` 渲染模式、`MotionCardPayload` |
| `src/remotion/AICardOverlay.tsx` | `renderCard()` 新增 `motion-card` 分支 |
| `src/components/AIPanel.tsx` | SubTabs 新增"动画"tab |
| `src/components/EditorInspector.tsx` | 新增 motion card Inspector 渲染 |
| `src/pages/Editor.tsx` | Inspector 入口按 cardId 解析普通 AI card / motion card |
| `src/store/ai.ts` | 新增 motion cards 状态和 actions |
| `src/lib/ai-persistence.ts` | PersistedAIState 扩展 `motionCards` 并更新类型守卫 |
| `src/App.tsx` | 项目打开/清空时同步恢复与清理 motion cards |
| `src/lib/ai-analysis.ts` | `normalizeCard()` 兼容 `type: 'motion'` |
| `package.json` | 新增依赖 |

### 不改动的文件

| 文件 | 理由 |
|---|---|
| `src/remotion/PodcastComposition.tsx` | 走现有 ai-card overlay 路径 |
| `src/remotion/Root.tsx` | composition 配置不变 |
| `electron/main.ts` | 导出流程不变，MCP 后续迭代 |
| `src/lib/timeline-placement.ts` | 复用 ai-card 放置逻辑 |
| `src/lib/timeline-tracks.ts` | overlay 排序不变 |

---

## 8. 测试策略与验收标准

### 测试覆盖

| 层级 | 范围 | 方式 |
|---|---|---|
| 编译层 | `motion-compiler.ts` | 单元测试：正常编译、语法错误、错误信息格式 |
| 执行层 | `motion-runtime.ts` | 单元测试：沙箱完整性、组件实例化、运行时错误、缓存 |
| 服务层 | `motion-card-service.ts` | 单元测试：生成/修改/编译流程、自动修复重试（mock LLM） |
| 渲染层 | `MotionCardOverlay.tsx` | 单元测试：ErrorBoundary、props 透传、缓存 |
| 持久化层 | `ai-persistence.ts` + 工程恢复链路 | 单元/集成测试：保存、重开项目后 motionCards 不丢失 |
| 数据层 | 类型扩展 | 补充 `normalizeCard()` 的 `type: 'motion'` 用例 |
| 集成 | 端到端 | 手动验证：生成 → 预览 → 上轨 → 导出 |

### 验收标准

**P0 — 核心流程**：
1. 用户输入自然语言描述，AI 生成 motion card 并展示在列表中
2. motion card 上轨后，Remotion Player 正确播放动画
3. 视频导出后 MP4 中动画正常渲染
4. 编译错误触发自动修复，至少 1 次修复成功率 > 70%

**P1 — 修改与迭代**：
5. 修改指令成功更新已有 motion card
6. 修改后预览和导出均反映新效果

**P2 — 状态持久化**：
7. 关闭并重新打开工程后，motion card 列表、状态与已保存源码仍可恢复

**P3 — 错误处理**：
8. 编译失败 3 次 → 优雅错误占位卡片
9. 运行时错误 → ErrorBoundary 捕获，不影响整体渲染

**P4 — MCP 预留**：
10. `MotionCardService` 接口可被外部调用（本期验证接口，不做完整 MCP server）

---

## 9. 非目标（本期不做）

- 完整的 MCP/ACP server 实现（仅预留服务层接口）
- 代码编辑器暴露给用户（纯对话驱动）
- 可视化参数面板（拖滑块调参数）
- 动画模板库（预置常用动画）
- AI 在自动分析流程中主动生成 motion card
- 未上轨独立 Player 预览
- 项目素材直连 helper（如稳定的 `resolveAsset()` 运行时协议）

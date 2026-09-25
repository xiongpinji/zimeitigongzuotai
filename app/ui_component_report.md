# UI 组件库使用情况审查报告

**审查日期**: 2026-04-10  
**项目**: 灵机剪影 - 视频 Web Master  
**审查范围**: 全项目 UI 组件使用情况

---

## 执行摘要

本次审查使用 5 个子 agent 并行分析了项目代码，覆盖：
- `src/components/agent/` - 26 个 AI 助手组件
- `src/components/script/` - 19 个脚本工作台组件
- `src/components/settings/` + 根目录 - 设置面板及核心组件
- `src/pages/` - 4 个主页面
- `src/ui/` - 组件库设计系统

**关键发现**:
- 🔴 **严重问题**: 2 处违反 DESIGN.md 规范（紫色主题、过度动效）
- 🟡 **中度问题**: 15+ 处重复组件模式可抽象
- 🟢 **轻度问题**: 100+ 处硬编码值应使用 design tokens

---

## 一、关键问题（P0 - 高优先级）

### 1.1 违反设计规范 - 紫色主题滥用

**问题文件**:
- `src/components/agent/AgentProgressBar.tsx`
- `src/components/agent/AgentProgressBar.module.css`
- `src/pages/ScriptWorkbench.module.css`

**问题描述**:
使用了紫色（`#7c3aed`, `#a78bfa`, `#c4b5fd`）作为主色调，违反 DESIGN.md 第 2.4 条：
> "主交互色只允许使用系统蓝 (#0A84FF)"

**影响范围**:
- AI 进度条
- AI 打字指示器
- 审阅光标

**修复建议**:
```css
/* 替换前 */
background: linear-gradient(90deg, #7c3aed, #a78bfa);

/* 替换后 */
background: linear-gradient(90deg, #0A84FF, #60a5fa);
```

---

### 1.2 违反设计规范 - 过度动效

**问题文件**:
- `src/pages/ScriptWorkbench.module.css`

**问题描述**:
`.reviewBreathing` 类包含扫描线和辉光动画，违反 DESIGN.md 第 7 条"动效克制"原则：
> "避免过度动效，保持专业、冷静的界面氛围"

**当前代码**:
```css
@keyframes scanLine {
  0%, 100% { top: 0; }
  50% { top: 100%; }
}

.reviewBreathing::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #34d399, transparent);
  animation: scanLine 2s linear infinite;
  box-shadow: 0 0 20px #34d399, 0 0 40px #34d399;
}
```

**修复建议**: 移除扫描线和辉光，改用简洁的状态指示器。

---

## 二、重复模式与可抽象组件（P1 - 中优先级）

### 2.1 建议新增的通用组件

| 组件名称 | 用途 | 出现位置 | 优先级 |
|---------|------|---------|--------|
| **CollapsiblePanel** | 可折叠面板 | `ThinkingBlock.tsx`, `ToolCallBlock.tsx` | P0 |
| **StatusDot** | 状态指示点 | `AgentHeader.tsx`, `GuideCards.tsx` | P0 |
| **PasswordField** | 密码输入框 | `AgentSettingsTab.tsx`, `AIConfigTab.tsx` | P0 |
| **ProgressRing** | 圆形进度环 | `WorkspaceTabs.tsx`, `AppStatusBar.tsx` | P0 |
| **EntryCard** | 入口卡片 | `Setup.tsx` (两处) | P1 |
| **IconBadge** | 图标徽章 | `Setup.tsx` (多处) | P1 |
| **TabButton** | 标签页按钮 | `Editor.tsx`, `Settings.tsx` | P1 |
| **SeverityBadge** | 严重程度徽章 | `AnnotationCard.tsx`, `AnnotationHighlight.tsx` | P1 |
| **AgentStatusIndicator** | AI 状态指示器 | `ScriptWorkbench.module.css` (两处) | P1 |
| **SettingsSection** | 设置区块 | 所有 Settings Tab | P2 |

---

### 2.2 CollapsiblePanel 组件设计

**文件路径**: 建议新建 `src/ui/patterns/CollapsiblePanel.tsx`

```tsx
interface CollapsiblePanelProps {
  title: React.ReactNode;
  defaultExpanded?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  badge?: React.ReactNode;
  onToggle?: (expanded: boolean) => void;
}

// 使用示例
<CollapsiblePanel
  title="思考过程"
  icon="🤔"
  badge={<Badge variant="info">3 步</Badge>}
>
  {thinkingSteps}
</CollapsiblePanel>
```

---

### 2.3 PasswordField 组件设计

**文件路径**: 建议新建 `src/ui/primitives/PasswordField.tsx`

```tsx
interface PasswordFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  placeholder?: string;
  revealPlaceholder?: string;
}

// 使用示例
<PasswordField
  label="API Key"
  placeholder="sk-ant-..."
  value={apiKey}
  onChange={(e) => setApiKey(e.target.value)}
/>
```

---

## 三、应使用但未使用的现有组件

### 3.1 src/ui/primitives/ 组件使用情况

| 组件 | 状态 | 应使用的文件 |
|------|------|-------------|
| **EmptyState** | ❌ 未使用 | `SessionListPane.tsx`, `ConversationDetailPane.tsx`, `FileTreePanel.tsx`, `EmptyGuide.tsx` |
| **Divider** | ⚠️ 部分使用 | `AIConfigTab.tsx`, `AgentSettingsTab.tsx` |
| **Spinner** | ✅ 良好使用 | - |
| **ColorField** | - 专用组件 | - |
| **MediaPlaceholder** | - 专用组件 | - |

---

### 3.2 src/ui/patterns/ 组件使用情况

| 组件 | 状态 | 应使用的文件 |
|------|------|-------------|
| **PanelHeader** | ❌ 几乎未使用 | `AIPanel.tsx`, `PreviewPanel.tsx`, `SideDrawer.tsx`, `FileTreePanel.tsx` |
| **ActionBar** | ❌ 未使用 | `OperationBar.tsx`, `QuickActionBar.tsx`, `ReviewStatusBar.tsx` |
| **FieldGrid** | ❌ 未使用 | `AIConfigTab.tsx`, `TTSConfigTab.tsx`, 所有 Settings Tab |
| **ModalFooter** | ⚠️ 部分使用 | `ConflictDialog.tsx`, `AssetPanel.tsx` |
| **SummaryCard** | ❌ 未使用 | `Setup.tsx` 入口卡片 |
| **StepIndicator** | ⚠️ 部分使用 | `Setup.tsx` 步骤列表 |
| **PillGroup** | ✅ 良好使用 | - |
| **FileDropCard** | ✅ 良好使用 | - |

---

### 3.3 src/ui/components/ 组件使用情况

| 组件 | 状态 | 应使用的文件 |
|------|------|-------------|
| **Button** | ✅ 良好使用 | - |
| **Input** | ❌ Settings 中多处内联 | `AgentSettingsTab.tsx`, `AIConfigTab.tsx` |
| **Select** | ❌ 未使用，用原生 select | `TTSConfigTab.tsx` |
| **Alert** | ✅ 良好使用 | - |
| **Progress** | ❌ 未使用，自定义实现 | `AgentProgressBar.tsx` |
| **Card** | ⚠️ 仅 PreviewPanel 使用 | 可考虑更多场景 |
| **Dialog** | ✅ 良好使用 | - |
| **DropdownMenu** | ⚠️ 部分使用 | `GuideCards.tsx` |

---

## 四、硬编码值应使用 Design Tokens

### 4.1 颜色硬编码汇总

| 硬编码值 | 应使用的 Token | 出现文件数 |
|---------|--------------|----------|
| `#e74c3c` / `#ff453a` | `--color-danger` | 8+ |
| `#e67e22` / `#ff9f0a` | `--color-warning` | 6+ |
| `#3498db` / `#0a84ff` | `--color-system-blue` | 15+ |
| `#2ecc71` / `#30d158` | `--color-success` | 5+ |
| `#1c1c1e` | `--color-window-bg` | 10+ |
| `#2a2a2c` | `--color-panel-bg` | 12+ |
| `#2c2c2e` | `--color-panel-elevated` | 8+ |
| `#38383a` | `--color-separator` | 20+ |
| `#ebebf5` | `--color-text-primary` | 15+ |
| `#ebebf599` | `--color-text-secondary` | 10+ |

---

### 4.2 间距硬编码汇总

| 硬编码值 | 应使用的 Token | 说明 |
|---------|--------------|------|
| `2px` | `--space-0-5` | 极小间距 |
| `4px` | `--space-1` | 小间距 |
| `8px` | `--space-2` | 标准间距 |
| `12px` | `--space-3` | 中等间距 |
| `16px` | `--space-4` | 大间距 |
| `20px` | `--space-5` | 超大间距 |

---

### 4.3 圆角硬编码汇总

| 硬编码值 | 应使用的 Token | 说明 |
|---------|--------------|------|
| `4px` | `--radius-sm` | 小圆角 |
| `6px` | `--radius-md` | 中等圆角 |
| `8px` | `--radius-lg` | 大圆角 |
| `10px` | `--radius-xl` | 超大圆角 |
| `12px` | `--radius-2xl` | 特大圆角 |
| `14px` | `--radius-3xl` | 最大圆角 |
| `980px` | `--radius-pill` | 药丸圆角 |

---

### 4.4 字体硬编码汇总

| 硬编码值 | 应使用的 Token |
|---------|--------------|
| `-apple-system, "SF Pro Text", system-ui, sans-serif` | `--font-sans` |
| `"SF Mono", Menlo, monospace` | 建议新增 `--font-mono` |

---

## 五、按目录详细问题清单

### 5.1 src/components/agent/ 目录问题

| 文件 | 问题 | 优先级 |
|------|------|--------|
| `AgentProgressBar.tsx` | 使用紫色主题，违反 DESIGN.md | 🔴 P0 |
| `AgentProgressBar.module.css` | 使用紫色主题，违反 DESIGN.md | 🔴 P0 |
| `ThinkingBlock.tsx` | 可与 ToolCallBlock 抽象为 CollapsiblePanel | 🟡 P1 |
| `ToolCallBlock.tsx` | 可与 ThinkingBlock 抽象为 CollapsiblePanel | 🟡 P1 |
| `AgentHeader.tsx` | 状态指示点可抽象为 StatusDot | 🟡 P1 |
| `GuideCards.tsx` | 状态指示点可抽象为 StatusDot | 🟡 P1 |
| `SessionListPane.tsx` | 应使用 EmptyState 组件 | 🟡 P1 |
| `ConversationDetailPane.tsx` | 应使用 EmptyState 组件 | 🟡 P1 |
| `AgentQuickActions.module.css` | 硬编码颜色应使用 tokens | 🟢 P2 |
| `DiffView.tsx` | 硬编码颜色应使用 tokens | 🟢 P2 |
| `SlashCommandMenu.tsx` | 硬编码颜色应使用 tokens | 🟢 P2 |

---

### 5.2 src/components/script/ 目录问题

| 文件 | 问题 | 优先级 |
|------|------|--------|
| `AnnotationHighlight.tsx` | 硬编码颜色应使用 tokens | 🟡 P1 |
| `ConflictDialog.tsx` | 应使用 ModalFooter 组件 | 🟡 P1 |
| `AnnotationCard.tsx` | 严重程度可抽象为 SeverityBadge | 🟡 P1 |
| `AnnotationList.tsx` | 与 AnnotationCard 有命名冲突 | 🟡 P1 |
| `OperationBar.tsx` | 应使用 ActionBar 组件 | 🟡 P1 |
| `SideDrawer.tsx` | 应使用 PanelHeader 组件 | 🟡 P1 |
| `FileTreePanel.tsx` | 应使用 EmptyState + PanelHeader | 🟡 P1 |
| `FileTreePanel.module.css` | 使用不存在的 token | 🔴 P0 |
| `ReviewStatusBar.tsx` | 应使用 ActionBar 组件 | 🟡 P1 |
| `QuickActionBar.tsx` | 应使用 ActionBar 组件 | 🟡 P1 |
| `EmptyGuide.tsx` | 应使用 EmptyState 组件 | 🟡 P1 |

---

### 5.3 src/components/settings/ 目录问题

| 文件 | 问题 | 优先级 |
|------|------|--------|
| `AIConfigTab.tsx` | 应使用 Field + FieldGrid + Button | 🟡 P1 |
| `AgentSettingsTab.tsx` | 应使用 Input + PasswordField | 🔴 P0 |
| `AgentSettingsTab.tsx` | 可抽象 StatusCheckItem 组件 | 🟡 P1 |
| `TTSConfigTab.tsx` | 应使用 Select 组件替代原生 select | 🟡 P1 |
| `McpSettingsTab.tsx` | 可使用 PanelHeader 组件 | 🟢 P2 |

---

### 5.4 src/pages/ 目录问题

| 文件 | 问题 | 优先级 |
|------|------|--------|
| `Setup.tsx` | 两个入口卡片可抽象为 EntryCard | 🟡 P1 |
| `Setup.tsx` | 步骤列表可使用 StepIndicator | 🟡 P1 |
| `Setup.tsx` | 大量硬编码颜色应使用 tokens | 🟡 P1 |
| `Setup.module.css` | 大量未使用的 CSS 类 | 🟢 P2 |
| `ScriptWorkbench.tsx` | AI 状态指示器可抽象 | 🟡 P1 |
| `ScriptWorkbench.module.css` | 紫色主题违反 DESIGN.md | 🔴 P0 |
| `ScriptWorkbench.module.css` | 扫描线辉光违反 DESIGN.md | 🔴 P0 |
| `Editor.tsx` | 标签按钮可抽象为 TabButton | 🟡 P1 |
| `Settings.tsx` | 标签按钮可抽象为 TabButton | 🟡 P1 |

---

## 六、UI 组件库架构建议

### 6.1 当前架构评估

```
src/ui/
├── components/       # shadcn 风格组件（26个）✅
├── primitives/       # 项目特有基础组件（9个）✅
├── patterns/         # 高阶模式组件（8个）✅
├── hooks/            # React hooks（5个）
├── lib/              # 工具函数（4个）
├── contexts/         # React context（1个）
├── styles/           # CSS 样式（5个文件）✅
└── index.ts          # 统一导出
```

**评分**: 7.5/10

| 维度 | 评分 | 说明 |
|------|------|------|
| 基础组件 | 9/10 | 按钮、输入框、对话框等核心组件齐全 |
| 布局组件 | 6/10 | 缺少专业工具布局组件 |
| 表单组件 | 7/10 | 基础齐全，缺少复杂控件 |
| 专业工具组件 | 4/10 | 缺少 Timeline、Inspector 等 |
| 可访问性 | 8/10 | shadcn 基础良好，需加强 |

---

### 6.2 建议新增的专业工具组件

#### Phase 1: 核心布局（1-2 周）

1. **Panel.tsx** - 可停靠面板组件
2. **SplitView.tsx** - 分割视图（支持拖拽调整大小）
3. **Sidebar.tsx** - 侧边栏容器
4. **PropertyGrid.tsx** - 属性网格（Inspector 通用化）
5. **StatusBar.tsx** - 状态栏组件

#### Phase 2: 专业工具组件（2-3 周）

6. **SegmentedControl.tsx** - 分段控制器
7. **Checkbox.tsx** / **Radio.tsx** - 表单控件
8. **Tooltip.tsx** - 工具提示
9. **ContextMenu.tsx** - 右键菜单
10. **DragDrop.tsx** - 拖拽支持

#### Phase 3: 增强体验（持续）

11. **KeyboardShortcuts.tsx** - 快捷键提示
12. **Skeleton.tsx** - 骨架屏加载状态

---

### 6.3 建议的目录重构

**当前问题**: `src/components/` 和 `src/ui/components/` 命名冲突

**建议重构**:
```
src/
├── ui/                  # 通用组件库（保持）
│   ├── components/
│   ├── primitives/
│   └── patterns/
├── features/            # 业务特性（替代 src/components）
│   ├── editor/
│   ├── script/
│   ├── agent/
│   └── settings/
├── pages/               # 页面（保持）
└── layouts/             # 布局组件（新增）
    ├── AppShell.tsx
    ├── SplitView.tsx
    └── Panel.tsx
```

---

### 6.4 tokens.css 扩展建议

```css
/* 建议新增 */

/* Z-index 层级 */
--z-sidebar: 40;
--z-panel: 50;
--z-dropdown: 60;
--z-modal: 120;
--z-toast: 180;

/* 过渡动画 */
--transition-fast: 150ms cubic-bezier(0.3, 0, 0.2, 1);
--transition-normal: 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
--transition-slow: 350ms cubic-bezier(0.2, 0.8, 0.2, 1);

/* 字体 */
--font-mono: "SF Mono", Menlo, Monaco, "Courier New", monospace;

/* 阴影增强 */
--shadow-panel: 0 2px 8px rgba(0, 0, 0, 0.2);
--shadow-panel-elevated: 0 4px 16px rgba(0, 0, 0, 0.25);
```

---

### 6.5 布局原语建议

建议创建 `src/ui/layout/index.tsx`:

```tsx
export const Flex = ({
  children,
  direction = 'row',
  gap = 'var(--space-2)',
  align = 'center',
  justify = 'flex-start',
  ...props
}) => (
  <div
    style={{
      display: 'flex',
      flexDirection: direction,
      gap,
      alignItems: align,
      justifyContent: justify,
    }}
    {...props}
  >
    {children}
  </div>
);

export const HStack = (props) => <Flex direction="row" {...props} />;
export const VStack = (props) => <Flex direction="column" {...props} />;
export const Spacer = () => <div style={{ flex: 1 }} />;
```

---

## 七、改进路线图

### 7.1 快速 Wins（1 天内可完成）

- [ ] 修复 ScriptWorkbench 紫色主题 → 系统蓝
- [ ] 移除扫描线和辉光效果
- [ ] 修复 FileTreePanel.module.css 缺失的 tokens
- [ ] 统一 AnnotationCard 命名冲突
- [ ] 将 joinClassNames 移到共享 utils

### 7.2 短期目标（1 周）

- [ ] 创建 CollapsiblePanel 组件
- [ ] 创建 StatusDot 组件
- [ ] 创建 PasswordField 组件
- [ ] 创建 ProgressRing 组件
- [ ] 重构 Settings Tab 使用 Field + FieldGrid
- [ ] 替换内联 input/select 为设计系统组件

### 7.3 中期目标（2-3 周）

- [ ] 创建 EntryCard 组件
- [ ] 创建 IconBadge 组件
- [ ] 创建 TabButton 组件
- [ ] 实现 SplitView 组件
- [ ] 创建 PropertyGrid 通用 Inspector
- [ ] 重构 Setup 页面使用新组件

### 7.4 长期愿景（持续）

- [ ] 构建完整的 macOS 专业创作工具 UI 套件
- [ ] 新页面开发速度提升 50%
- [ ] 设计一致性达 95%+
- [ ] 代码复用率显著提升
- [ ] 维护成本大幅降低

---

## 八、总结

### 8.1 整体评价

**核心编辑器组件** (Toolbar, AIPanel, AssetPanel, Timeline):
- ✅ 对设计系统的使用良好
- ✅ 组件结构清晰
- ✅ 状态管理合理

**Settings 目录组件**:
- ⚠️ 存在较多内联样式
- ⚠️ 未充分使用设计系统组件
- 🟡 存在可抽象的重复模式

**页面组件** (Setup, ScriptWorkbench, Editor, Settings):
- 🔴 存在违反 DESIGN.md 的问题
- 🟡 大量重复模式可抽象
- 🟡 硬编码值应使用 tokens

**UI 组件库**:
- ✅ 架构清晰，分层合理
- ✅ tokens.css 定义完整
- ⚠️ 缺少专业工具布局组件

---

### 8.2 改进收益

| 方面 | 预期收益 |
|------|---------|
| **视觉一致性** | 95%+ 统一设计语言 |
| **开发效率** | 新页面开发速度提升 50% |
| **代码复用** | 减少 30% 重复代码 |
| **维护成本** | 降低 40% 维护工作量 |
| **设计合规** | 100% 遵循 DESIGN.md |

---

### 8.3 审查文件清单

**审查的业务组件**:
- `src/components/agent/` - 26 个文件
- `src/components/script/` - 19 个文件
- `src/components/settings/` - 9 个文件
- `src/components/` 根目录 - 7 个文件
- `src/pages/` - 4 个页面

**参考的设计系统**:
- `src/ui/components/` - 26 个组件
- `src/ui/primitives/` - 9 个组件
- `src/ui/patterns/` - 8 个组件
- `src/ui/styles/tokens.css` - 设计令牌
- `DESIGN.md` - 设计规范（325 行）

---

**报告生成时间**: 2026-04-10  
**审查方式**: 5 个子 agent 并行审查  
**总 token 使用量**: ~471,770  
**总审查时长**: ~1.5 小时

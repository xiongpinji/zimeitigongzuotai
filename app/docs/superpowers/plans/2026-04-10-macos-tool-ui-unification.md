# macOS Tool UI Unification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前界面统一为“macOS 专业创作工具”风格，消除与 Apple 官网式规范的冲突，并降低关键业务流的认知负担。

**Architecture:** 保留当前 Darwin/macOS dark desktop 的总体方向，不再追求 Apple 官网式产品展示语言。流程改为“先统一设计基线文档，再先用 Pencil MCP 调整 `design.pen` 设计稿并人工验稿，确认方向后再落组件、页面和交互代码”，避免实现先跑偏再返工。

**Tech Stack:** React 19、Electron、TypeScript、Tailwind v4、CSS Modules、Darwin UI 本地源码

---

## Chunk 1: 设计基线统一

### Task 1: 重写设计规范文档，明确产品方向

**Files:**
- Modify: `DESIGN.md`
- Reference: `docs/superpowers/specs/2026-04-05-darwin-ui-macos-overhaul-design.md`

- [ ] **Step 1: 将现有设计目标改写为 macOS 专业工具风格**

要求：
- 删除 “Inspired by Apple website” 的表述
- 改成 “macOS / Darwin 风格专业创作工具”
- 明确允许的视觉特征：深色桌面容器、分区面板、轻量分隔线、系统蓝 focus、高频操作栏
- 明确禁止项：紫色辉光、无意义 emoji、与系统语义无关的多色强调、假拟态 Apple 官网模块

- [ ] **Step 2: 重写色彩与字体规则**

要求：
- 定义主背景 / 面板 / elevated / control / separator / primary text / secondary text / system blue
- 明确哪些状态色只允许出现在反馈和告警，不允许成为常态视觉主角
- 字体规则改成：整体采用 `SF Pro Text` 为主，少量大标题可用 `SF Pro Display`

- [ ] **Step 3: 补充“信息架构原则”和“真实反馈原则”**

要求：
- 每页只允许一个主任务
- 非主任务功能延后曝光
- 所有按钮必须对应真实行为
- “取消”必须真的取消正在进行的任务，否则只能写“关闭”

- [ ] **Step 4: 人工校对文档与代码方向是否一致**

检查项：
- 文档是否还残留 Apple 官网措辞
- 文档是否与 `tokens.css` / `darwin-ui.css` 的桌面应用方向一致

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md docs/superpowers/specs/2026-04-05-darwin-ui-macos-overhaul-design.md
git commit -m "docs: align design system with macos tool direction"
```

---

## Chunk 2: 设计稿先行

### Task 2: 使用 Pencil MCP 调整 `design.pen` 设计稿

**Files:**
- Modify: `design.pen`
- Reference: `DESIGN.md`
- Reference: `src/pages/Setup.tsx`
- Reference: `src/pages/ScriptWorkbench.tsx`
- Reference: `src/pages/Editor.tsx`
- Reference: `src/pages/Settings.tsx`

- [ ] **Step 1: 读取当前 `design.pen` 结构与关键画板**

要求：
- 使用 Pencil MCP 读取当前画板结构
- 识别至少以下关键画板或等价页面：Setup、ScriptWorkbench、Editor、Settings
- 如果现有画板缺失，新增对应画板而不是跳过

- [ ] **Step 2: 基于新版 `DESIGN.md` 重定设计稿方向**

要求：
- 统一为 macOS 专业创作工具风格
- 保留深色桌面容器、分区面板、系统蓝 focus、克制的状态反馈
- 移除或弱化紫色辉光、扫描线、emoji 装饰、多色品牌化入口
- 让 Setup、ScriptWorkbench、Editor、Settings 的层级关系更清晰

- [ ] **Step 3: 先只做高层结构和视觉基线，不急着补所有细节**

优先调整：
- Setup：单主路径 + 次路径辅助
- ScriptWorkbench：减少同时竞争的状态层
- Editor：预览 / 时间轴 / inspector / asset/AI panel 的主次关系
- Settings：按“创作 / 系统”分组

- [ ] **Step 4: 导出设计稿截图供人工验收**

要求：
- 使用 Pencil MCP 导出关键画板截图
- 至少输出 Setup、ScriptWorkbench、Editor、Settings 四张截图
- 如有需要，附上简短改动说明

- [ ] **Step 5: 人工验稿 Gate**

要求：
- 把截图和设计摘要交给用户确认
- 在用户明确表示“设计稿满意 / 可以继续”之前，**不得进入任何代码实现任务**

- [ ] **Step 6: 根据人工反馈迭代 `design.pen`**

要求：
- 如果用户不满意，优先继续改 `design.pen`
- 只在设计稿通过后，才继续后面的实现任务

- [ ] **Step 7: Commit**

```bash
git add design.pen DESIGN.md
git commit -m "design: align pencil mockups with macos tool direction"
```

---

## Chunk 3: 基础令牌与组件收敛

### Task 3: 清理全局 design tokens，收敛视觉语义

**Files:**
- Modify: `src/ui/styles/tokens.css`
- Modify: `src/ui/styles/darwin-ui.css`
- Reference: `DESIGN.md`

- [ ] **Step 1: 删除或降级品牌暖色的常规存在感**

要求：
- 保留 `danger/success/warning` 作为反馈色
- 不再把橙/绿/黄定义为常规品牌层级
- 保留系统蓝为主交互色

- [ ] **Step 2: 统一圆角与阴影**

要求：
- 面板 / card / dialog 的圆角统一到一套更窄的桌面工具体系
- 降低 modal / toast / dropdown 阴影强度
- 避免在常规面板上使用过重的漂浮感

- [ ] **Step 3: 统一字号层级**

要求：
- 补齐 `15/17/20/24/28` 这些实际界面需要的 token
- 不再让多数界面停留在 `12/13px`

- [ ] **Step 4: 运行静态验证**

Run: `npm run build`
Expected: build 成功，无 token 命名或样式引用错误

- [ ] **Step 5: Commit**

```bash
git add src/ui/styles/tokens.css src/ui/styles/darwin-ui.css
git commit -m "refactor(ui): align tokens with macos desktop tool language"
```

### Task 4: 收敛基础组件的视觉和交互模型

**Files:**
- Modify: `src/ui/components/button.tsx`
- Modify: `src/ui/components/input.tsx`
- Modify: `src/ui/components/card.tsx`
- Modify: `src/ui/components/dialog.tsx`
- Modify: `src/ui/components/modal.tsx`
- Modify: `src/ui/components/select.tsx`
- Modify: `src/ui/components/toast.tsx`

- [ ] **Step 1: Button 变体减法**

要求：
- 收敛为 `primary / secondary / ghost / destructive / link`
- 删除或停止业务使用 `accent / success / warning / info`
- 提升常规按钮字号到更像桌面工具的层级

- [ ] **Step 2: Input / Select focus 与边框统一**

要求：
- 统一 focus 到系统蓝边框或 ring
- 移除夸张发光
- 让输入框和选择器更像系统面板内控件，而非营销卡片

- [ ] **Step 3: Card / Dialog / Modal 降低边框与阴影噪音**

要求：
- 常规卡片弱化边框存在感
- Dialog / Modal 降低阴影和圆角膨胀
- close 按钮维持系统工具感

- [ ] **Step 4: 运行构建和单测**

Run: `npm test`
Expected: tests 通过

Run: `npm run build`
Expected: build 通过

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/button.tsx src/ui/components/input.tsx src/ui/components/card.tsx src/ui/components/dialog.tsx src/ui/components/modal.tsx src/ui/components/select.tsx src/ui/components/toast.tsx
git commit -m "refactor(ui): simplify component language for desktop workflow"
```

---

## Chunk 4: 高流量页面信息架构收敛

### Task 5: 重做 Setup 首屏的决策结构

**Files:**
- Modify: `src/pages/Setup.tsx`
- Modify: `src/pages/Setup.module.css`

- [ ] **Step 1: 改成单主路径 + 次路径辅助**

要求：
- 明确主路径：例如“开始创作”
- 次路径“导入现有音频与字幕”退居次层
- 最近项目和系统设置重新分层

- [ ] **Step 2: 移除 emoji 和多色入口包装**

要求：
- 去掉 `✨ 🎵 📁 📤 ⚙️`
- 降低绿/橙在首页的比重
- 以标题、说明、次级说明表达差异，而非靠装饰图标

- [ ] **Step 3: 减少首屏解释密度**

要求：
- 两个入口都不要再显示 3 步流程
- 让用户 2 秒内看懂主选择

- [ ] **Step 4: 本地手工验收**

检查项：
- 无项目打开时的首屏
- 有项目恢复时的首屏
- 窄屏时不出现两张同权大卡压迫感

- [ ] **Step 5: Commit**

```bash
git add src/pages/Setup.tsx src/pages/Setup.module.css
git commit -m "refactor(setup): simplify entry flow for desktop creation app"
```

### Task 6: 收敛顶栏、工作区切换和设置页导航

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/components/Toolbar.module.css`
- Modify: `src/components/WorkspaceTabs.tsx`
- Modify: `src/components/WorkspaceTabs.module.css`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/Settings.module.css`

- [ ] **Step 1: 让顶栏只保留最关键状态**

要求：
- 项目名 + 保存状态 + 关键操作
- 减少次级信息竞争

- [ ] **Step 2: 工作区 tabs 更像桌面工具切换器**

要求：
- 减少营销式 active 高亮
- 更像 segmented control / workspace switcher

- [ ] **Step 3: 重组设置导航**

建议分组：
- 创作：AI、模板、审查、TTS
- 系统：Agent、MCP

- [ ] **Step 4: 运行构建**

Run: `npm run build`
Expected: build 成功

- [ ] **Step 5: Commit**

```bash
git add src/components/Toolbar.tsx src/components/Toolbar.module.css src/components/WorkspaceTabs.tsx src/components/WorkspaceTabs.module.css src/pages/Settings.tsx src/pages/Settings.module.css
git commit -m "refactor(shell): unify toolbar tabs and settings hierarchy"
```

---

## Chunk 5: 关键工作流降噪与真实性修复

### Task 7: 给 ScriptWorkbench 做“界面减法”

**Files:**
- Modify: `src/pages/ScriptWorkbench.tsx`
- Modify: `src/pages/ScriptWorkbench.module.css`
- Modify: `src/components/script/QuickActionBar.tsx`
- Modify: `src/components/script/EmptyGuide.tsx`
- Modify: `src/components/script/ReviewStatusBar.tsx`
- Modify: `src/components/script/SideDrawer.tsx`

- [ ] **Step 1: 列出所有会同时出现的状态层**

要求：
- 明确哪些可以并存，哪些必须互斥
- 例如“审稿推荐横幅”和“思考块”不要同时抢眼

- [ ] **Step 2: 删除 AI 工作台式高强调视觉**

要求：
- 移除紫色横幅、扫描线、辉光、悬浮 typing pill
- 将状态反馈改成更克制的 inline/status bar 形式

- [ ] **Step 3: 保留一个主要 AI 反馈位**

要求：
- 选择固定区域承载“正在生成 / 正在审查 / 已完成”
- 其他状态退到次级

- [ ] **Step 4: 手工验收以下场景**

场景：
- 空白写稿
- 正在生成
- 正在审查
- 有冲突
- 抽屉打开

- [ ] **Step 5: Commit**

```bash
git add src/pages/ScriptWorkbench.tsx src/pages/ScriptWorkbench.module.css src/components/script/QuickActionBar.tsx src/components/script/EmptyGuide.tsx src/components/script/ReviewStatusBar.tsx src/components/script/SideDrawer.tsx
git commit -m "refactor(script): reduce competing layers in workbench"
```

### Task 8: 修正 Editor 的“假控件”和导出反馈

**Files:**
- Modify: `src/components/PreviewPanel.tsx`
- Modify: `src/components/PreviewPanel.module.css`
- Modify: `src/components/ExportProgress.tsx`
- Modify: `src/pages/Editor.tsx`

- [ ] **Step 1: 处理 PreviewPanel 中没有行为的按钮**

二选一：
- 真正实现“上一段 / 下一段 / 倍速”
- 或先隐藏 / 禁用，并给出明确不可用状态

- [ ] **Step 2: 修正导出弹窗按钮文案和行为**

要求：
- 如果不能取消导出，就只能写“后台继续 / 关闭窗口”
- 如果要叫“取消导出”，必须补真实取消逻辑

- [ ] **Step 3: 校验导出期间状态流**

检查项：
- 导出中关闭弹窗后任务是否继续
- 成功后是否能正确定位文件
- 失败后是否保留错误说明

- [ ] **Step 4: 运行验证**

Run: `npm test`
Expected: tests 通过

Run: `npm run build`
Expected: build 通过

- [ ] **Step 5: Commit**

```bash
git add src/components/PreviewPanel.tsx src/components/PreviewPanel.module.css src/components/ExportProgress.tsx src/pages/Editor.tsx
git commit -m "fix(editor): make playback and export feedback truthful"
```

### Task 9: 简化 Agent 与 Agent 设置的人话表达

**Files:**
- Modify: `src/components/agent/ConversationDetailPane.tsx`
- Modify: `src/components/agent/SessionListPane.tsx`
- Modify: `src/components/agent/AgentProgressBar.module.css`
- Modify: `src/components/settings/AgentSettingsTab.tsx`

- [ ] **Step 1: 改写会话区文案**

要求：
- 少提 ACP / 显式进入 / 恢复旧会话
- 多写用户能做什么、当前是否可发送、出错后怎么办

- [ ] **Step 2: 降低 Agent 进度条的视觉存在感**

要求：
- 去掉紫色品牌化处理
- 改成系统中性进度反馈

- [ ] **Step 3: 重新分组 Agent 设置**

建议顺序：
- 连接状态
- 认证
- 高级配置
- 危险操作（安装/卸载）

- [ ] **Step 4: 手工验收**

场景：
- 无项目时 Agent 面板
- 新会话
- 已有会话
- 连接失败
- Agent 配置保存

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/ConversationDetailPane.tsx src/components/agent/SessionListPane.tsx src/components/agent/AgentProgressBar.module.css src/components/settings/AgentSettingsTab.tsx
git commit -m "refactor(agent): simplify language and settings hierarchy"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-10-macos-tool-ui-unification.md`. Ready to execute?

# Welcome Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构欢迎页，采用剪映风格布局，减少功能入口占用空间，同时严格遵循 macOS 设计规范。

**Architecture:** 保留现有组件结构（ImportCard、ProjectList），重构 Setup.tsx 主布局，采用玻璃态 Hero 区域 + 展开式导入面板 + 紧凑的最近项目区域。

**Tech Stack:** React 19 + TypeScript + CSS Modules + Vitest

---

## 文件结构映射

### 需要修改的文件
1. **`src/pages/Setup.tsx`** —— 主要布局重构
   - 移除双入口卡片布局
   - 添加玻璃态 Hero 区域
   - 添加大按钮下拉菜单
   - 添加快捷入口图标
   - 添加展开式导入面板

2. **`src/pages/Setup.module.css`** —— 样式完全重写
   - 玻璃态样式
   - 大按钮样式
   - 快捷图标样式
   - 下拉菜单样式
   - 展开面板动画样式

3. **`tests/setup.test.tsx`** —— 更新测试用例
   - 适配新布局的测试断言

### 复用的现有组件
- `src/components/ProjectList.tsx` —— 保持不变
- `src/ui/FileDropCard.tsx` —— 保持不变
- `src/ui/Button.tsx` —— 保持不变

---

## Task 1: Setup.module.css 样式重写

**Files:**
- Modify: `src/pages/Setup.module.css`

---

### Task 1.1: 定义基础布局样式

- [ ] **Step 1: 替换 .page 和 .welcomeContent 样式**

```css
.page {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--color-window-bg);
  overflow: hidden;
}

.welcomeContent {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
```

---

### Task 1.2: 添加玻璃态 Hero 区域样式

- [ ] **Step 2: 添加 .heroGlass 样式**

```css
.heroGlass {
  position: relative;
  padding: 40px 20px 32px;
  background: rgba(25, 25, 26, 0.85);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid #38383A;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  flex-shrink: 0;
}
```

---

### Task 1.3: 添加大按钮样式

- [ ] **Step 3: 添加 .bigActionButton 样式**

```css
.bigActionButton {
  position: relative;
  width: 420px;
  height: 96px;
  background: #0A84FF;
  border: none;
  border-radius: 16px;
  color: white;
  font-family: "SF Pro Display", "SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.bigActionButton:hover {
  background: #409CFF;
}

.bigActionButton:active {
  background: #0071E3;
}

.bigActionButtonIcon {
  font-size: 28px;
  line-height: 1;
}

.bigActionButtonArrow {
  font-size: 14px;
  margin-left: 8px;
  opacity: 0.8;
}
```

---

### Task 1.4: 添加下拉菜单样式

- [ ] **Step 4: 添加 .dropdownMenu 样式**

```css
.dropdownMenu {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 380px;
  background: #2C2C2E;
  border: 1px solid #38383A;
  border-radius: 12px;
  padding: 8px;
  box-shadow: rgba(0, 0, 0, 0.35) 0px 10px 40px 0px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dropdownMenuItem {
  width: 100%;
  padding: 14px 16px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: white;
  font-family: "SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.dropdownMenuItem:hover {
  background: rgba(255, 255, 255, 0.08);
}

.dropdownMenuItemIcon {
  font-size: 20px;
}
```

---

### Task 1.5: 添加快捷入口图标样式

- [ ] **Step 5: 添加 .quickActions 样式**

```css
.quickActions {
  display: flex;
  gap: 24px;
  justify-content: center;
}

.quickActionButton {
  width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}

.quickActionIcon {
  width: 64px;
  height: 64px;
  background: #2C2C2E;
  border: 1px solid #38383A;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.quickActionButton:hover .quickActionIcon {
  border-color: #0A84FF;
  background: #3A3A3C;
}

.quickActionLabel {
  color: #EBEBF599;
  font-family: "SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
  font-weight: 500;
}
```

---

### Task 1.6: 添加导入面板样式

- [ ] **Step 6: 添加 .importPanel 样式**

```css
.importPanel {
  background: #1E1E20;
  border-bottom: 1px solid #38383A;
  padding: 20px;
  overflow: hidden;
  transition: max-height 0.16s ease-out, opacity 0.16s ease-out, padding-top 0.16s ease-out, padding-bottom 0.16s ease-out;
}

.importPanel.collapsed {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.importPanel.expanded {
  max-height: 260px;
  opacity: 1;
}

.importPanelContent {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.importPanelCards {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.importPanelCancel {
  flex-shrink: 0;
}
```

---

### Task 1.7: 添加最近项目区域样式

- [ ] **Step 7: 添加 .projectsSection 样式**

```css
.projectsSection {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
}

/* 移除旧的样式，保留 ProjectList 需要的 */
.recentChip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  background: #2C2C2E;
  border: 1px solid #38383A;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.recentChip:hover {
  border-color: #0A84FF;
  background: #3A3A3C;
}

/* 底部提示样式 */
.footerNote {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid #38383A;
}

.footerNoteText {
  color: #EBEBF54D;
  font-family: "SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  letter-spacing: 0.06em;
}

.footerNoteButton {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  color: #EBEBF54D;
  font-family: "SF Pro Text", "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  transition: color 0.15s ease;
}

.footerNoteButton:hover {
  color: #EBEBF599;
}
```

---

### Task 1.8: 清理旧样式

- [ ] **Step 8: 删除旧的不需要的样式**
  - 删除 `.hero`、`.heroEyebrow`、`.heroTitle`、`.heroDescription`
  - 删除 `.entryCards`、`.entryCard`、`.entryCardTitle`、`.entryCardDesc`、`.entrySteps`、`.entryStep`、`.entryStepDot`
  - 删除 `.importGrid` 及其他不再需要的样式

---

### Task 1.9: 验证样式文件

- [ ] **Step 9: 运行项目验证样式语法**

Run: `npm run build`
Expected: 编译成功，无 CSS 语法错误

---

## Task 2: Setup.tsx 组件重构

**Files:**
- Modify: `src/pages/Setup.tsx`

---

### Task 2.1: 重构组件状态管理

- [ ] **Step 1: 更新 imports 和添加新状态**

```typescript
import type { DragEvent } from 'react';
import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useViewportSize } from '../hooks/useViewportSize';
import { getDroppedFilePath, getImportFileError, type ImportKind } from '../lib/import-files';
import { getFileNameFromPath } from '../lib/utils';
import type { RecentProject } from '../store/timeline';
import type { RecentProjectEntry } from '../lib/electron-api';
import { Alert, Button, FileDropCard } from '../ui';
import { ProjectList } from '../components/ProjectList';
import styles from './Setup.module.css';
```

添加新状态：
```typescript
const [audioPath, setAudioPath] = useState<string | null>(null);
const [srtPath, setSrtPath] = useState<string | null>(null);
const [localError, setLocalError] = useState<string | null>(null);
const [detailedRecentProjects, setDetailedRecentProjects] = useState<RecentProjectEntry[]>(
  () => fallbackRecentProjects,
);
const [dropdownVisible, setDropdownVisible] = useState(false);
const [importPanelVisible, setImportPanelVisible] = useState(false);
const dropdownRef = useRef<HTMLDivElement>(null);
const canStart = useMemo(() => Boolean(audioPath && srtPath && !busy), [audioPath, busy, srtPath]);
```

---

### Task 2.2: 添加点击外部关闭下拉菜单的逻辑

- [ ] **Step 2: 添加点击外部检测的 useEffect**

```typescript
useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setDropdownVisible(false);
    }
  };

  if (dropdownVisible) {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }
}, [dropdownVisible]);
```

---

### Task 2.3: 添加新的事件处理函数

- [ ] **Step 3: 添加新的事件处理函数**

```typescript
const toggleDropdown = useCallback(() => {
  setDropdownVisible((prev) => !prev);
}, []);

const handleStartScriptWorkbench = useCallback(() => {
  setDropdownVisible(false);
  onStartScriptWorkbench();
}, [onStartScriptWorkbench]);

const handleOpenImportPanel = useCallback(() => {
  setDropdownVisible(false);
  setImportPanelVisible(true);
}, []);

const handleQuickScriptWorkbench = useCallback(() => {
  onStartScriptWorkbench();
}, [onStartScriptWorkbench]);

const handleQuickImport = useCallback(() => {
  setImportPanelVisible(true);
}, []);

const handleCancelImport = useCallback(() => {
  setImportPanelVisible(false);
  setAudioPath(null);
  setSrtPath(null);
  setLocalError(null);
}, []);

const handleImportComplete = useCallback(() => {
  if (audioPath && srtPath) {
    void onComplete(audioPath, srtPath);
  }
}, [audioPath, srtPath, onComplete]);
```

---

### Task 2.4: 重构 JSX 结构

- [ ] **Step 4: 重写主 JSX 返回结构**

```typescript
return (
  <div className={styles.page}>
    <div className={styles.welcomeContent}>
      {/* 玻璃态 Hero 区域 */}
      <div className={styles.heroGlass}>
        {/* Eyebrow (仅在无项目时显示) */}
        {!projectName && (
          <div style={{ fontSize: 11, letterSpacing: 2, color: '#EBEBF54D' }}>
            LOCAL PODCAST VIDEO EDITOR
          </div>
        )}

        {/* 项目名称标签 (如果有) */}
        {projectName && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            borderRadius: 8,
            background: '#32D74B1A',
            color: '#32D74B',
            fontSize: 13,
            fontWeight: 600,
          }}>
            <span style={{ fontSize: 15 }}>📁</span>
            {projectName}
          </div>
        )}

        {/* 大按钮 + 下拉菜单 */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className={styles.bigActionButton}
            onClick={toggleDropdown}
          >
            <span className={styles.bigActionButtonIcon}>🎬</span>
            开始创作
            <span className={styles.bigActionButtonArrow}>▼</span>
          </button>

          {dropdownVisible && (
            <div className={styles.dropdownMenu}>
              <button
                type="button"
                className={styles.dropdownMenuItem}
                onClick={handleStartScriptWorkbench}
              >
                <span className={styles.dropdownMenuItemIcon}>✨</span>
                AI 写稿创作
              </button>
              <button
                type="button"
                className={styles.dropdownMenuItem}
                onClick={handleOpenImportPanel}
              >
                <span className={styles.dropdownMenuItemIcon}>🎵</span>
                导入音频字幕
              </button>
            </div>
          )}
        </div>

        {/* 快捷入口图标 */}
        <div className={styles.quickActions}>
          <button
            type="button"
            className={styles.quickActionButton}
            onClick={handleQuickScriptWorkbench}
          >
            <div className={styles.quickActionIcon}>✨</div>
            <span className={styles.quickActionLabel}>AI写稿</span>
          </button>
          <button
            type="button"
            className={styles.quickActionButton}
            onClick={handleQuickImport}
          >
            <div className={styles.quickActionIcon}>🎵</div>
            <span className={styles.quickActionLabel}>导入音频</span>
          </button>
        </div>
      </div>

      {/* 导入面板 */}
      <div
        className={`${styles.importPanel} ${importPanelVisible ? styles.expanded : styles.collapsed}`}
      >
        {importPanelVisible && (
          <div className={styles.importPanelContent}>
            <div className={styles.importPanelCards}>
              <ImportCard
                label="AUDIO"
                helper="拖入 MP3 口播音频"
                value={audioPath}
                accentColor="#79c4ff"
                icon="🎙"
                selectLabel="选择 MP3 文件"
                onPickFile={() => {
                  void createSelectHandler('audio')();
                }}
                onDrop={createDropHandler('audio')}
                compact={false}
              />
              <ImportCard
                label="SUBTITLE"
                helper="拖入对应 SRT 字幕"
                value={srtPath}
                accentColor="#ffb547"
                icon="📝"
                selectLabel="选择 SRT 文件"
                onPickFile={() => {
                  void createSelectHandler('srt')();
                }}
                onDrop={createDropHandler('srt')}
                compact={false}
              />
            </div>
            <div className={styles.importPanelCancel}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Button
                  variant="ghost"
                  onClick={handleCancelImport}
                >
                  取消
                </Button>
                {errorMessage || localError ? (
                  <Alert variant="destructive">{localError || errorMessage}</Alert>
                ) : null}
                <Button
                  disabled={!canStart}
                  onClick={handleImportComplete}
                  variant={canStart ? 'accent' : 'secondary'}
                  style={{
                    background: canStart ? undefined : '#3A3A3C',
                  }}
                  leftIcon={<span style={{ fontSize: 14 }}>📤</span>}
                >
                  {busy ? '正在初始化工程...' : '导入文件'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 最近项目 */}
      <div className={styles.projectsSection}>
        <ProjectList
          projects={detailedRecentProjects}
          onOpenProject={onOpenRecentProject}
          onRemoveProject={handleRemoveRecentProject}
        />
      </div>
    </div>

    {/* 底部提示 */}
    <div className={styles.footerNote}>
      <span className={styles.footerNoteText}>
        所有文件均在本地处理，不会上传至任何服务器
      </span>
      <button
        type="button"
        className={styles.footerNoteButton}
        onClick={onOpenSettings}
      >
        ⚙️ 系统设置
      </button>
    </div>
  </div>
);
```

---

### Task 2.5: 清理旧代码

- [ ] **Step 5: 删除旧的 ImportCard 和不再需要的代码**
  - 删除旧的 `ImportCard` 组件定义（保留在 Task 2.4 中内联使用的）
  - 删除旧的双入口卡片 JSX 代码
  - 删除 `compact` 变量（不再需要）

---

### Task 2.6: 验证组件编译

- [ ] **Step 6: 运行 TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

---

## Task 3: 更新测试用例

**Files:**
- Modify: `tests/setup.test.tsx`

---

### Task 3.1: 更新测试断言

- [ ] **Step 1: 更新测试用例以适配新布局**

```typescript
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Setup } from '../src/pages/Setup';

describe('Setup', () => {
  it('renders big action button and quick actions on welcome page', () => {
    const html = renderToStaticMarkup(
      <Setup
        busy={false}
        errorMessage={null}
        projectName=""
        recentProjects={[]}
        onComplete={async () => undefined}
        onOpenRecentProject={async () => undefined}
        onStartScriptWorkbench={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    expect(html).toContain('开始创作');
    expect(html).toContain('AI写稿');
    expect(html).toContain('导入音频');
    expect(html).toContain('本地草稿');
  });

  it('renders project name label when project is active', () => {
    const html = renderToStaticMarkup(
      <Setup
        busy={false}
        errorMessage={null}
        projectName="my-project"
        recentProjects={[]}
        onComplete={async () => undefined}
        onOpenRecentProject={async () => undefined}
        onStartScriptWorkbench={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    expect(html).toContain('my-project');
    expect(html).toContain('📁');
  });

  it('renders recent projects in projects section', () => {
    const html = renderToStaticMarkup(
      <Setup
        busy={false}
        errorMessage={null}
        projectName=""
        recentProjects={[
          {
            path: '/tmp/demo-project',
            name: 'demo-project',
            lastOpenedAt: new Date('2026-04-06T20:30:00+08:00').getTime(),
          },
        ]}
        onComplete={async () => undefined}
        onOpenRecentProject={async () => undefined}
        onStartScriptWorkbench={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    expect(html).toContain('最近项目');
    expect(html).toContain('demo-project');
  });
});
```

---

### Task 3.2: 运行测试

- [ ] **Step 2: 运行测试验证**

Run: `npx vitest run tests/setup.test.tsx -v`
Expected: 所有测试通过

---

## Task 4: 整体验证与提交

**Files:**
- All modified files

---

### Task 4.1: 完整功能验证

- [ ] **Step 1: 启动开发服务器验证**

Run: `npm run dev`
Expected: 应用正常启动，欢迎页显示新布局

手动验证：
- ✅ 大按钮显示在顶部
- ✅ 点击大按钮显示下拉菜单
- ✅ 点击下拉菜单外部关闭菜单
- ✅ 快捷图标按钮可点击
- ✅ 导入面板可以展开和收起
- ✅ 导入面板中的文件选择功能正常
- ✅ 最近项目显示正常
- ✅ 网格/列表切换功能正常
- ✅ 响应式布局在不同窗口尺寸下正常

---

### Task 4.2: 运行完整测试套件

- [ ] **Step 2: 运行所有测试**

Run: `npm test`
Expected: 所有测试通过

---

### Task 4.3: 提交更改

- [ ] **Step 3: 提交重构后的代码**

```bash
git add src/pages/Setup.tsx src/pages/Setup.module.css tests/setup.test.tsx
git commit -m "refactor: 剪映风格欢迎页重构"
```

---

## 验收标准检查清单

在认为完成前，验证以下各项：

- [ ] 大按钮位于 Hero 区域中央，点击展开下拉菜单
- [ ] 快捷入口图标在大按钮下方，可直接点击
- [ ] 导入面板按需展开/收起，带有平滑动画
- [ ] 最近项目区域可滚动，保持原有功能
- [ ] 所有原有功能（AI 写稿、导入、最近项目、设置）都可用
- [ ] 严格遵循 DESIGN.md 规范（无渐变、只用系统蓝、克制的设计）
- [ ] 所有测试通过
- [ ] TypeScript 编译无错误

---

## Plan Self-Review

**1. Spec coverage:** ✅ 完整覆盖设计文档所有要求
- 玻璃态 Hero 区域 ✓
- 大按钮下拉菜单 ✓
- 快捷入口图标 ✓
- 展开式导入面板 ✓
- 紧凑的最近项目区域 ✓

**2. Placeholder scan:** ✅ 无占位符，所有步骤都有完整代码和命令

**3. Type consistency:** ✅ 所有类型、方法名、属性名一致

**4. Design compliance:** ✅ 严格遵循 DESIGN.md 规范
- 无渐变背景 ✓
- 只用系统蓝作为主交互色 ✓
- 专业工具风格 ✓

# 待创作箱「生成初稿」复用一键创作弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让欢迎页「待创作箱」的「生成初稿」按钮打开现有「导入文稿」弹窗（预填转录稿与项目名），用户在弹窗里选生成目录/写稿模型/角色/音色后走完全相同的 `onImportScript` 流水线——不新增第二个弹窗或第二条流水线。

**Architecture:** 待创作箱不再静默起飞、不再自带目录选择器；它只向上层 `Setup` 上报「请为这条素材创作」。`Setup` 复用其唯一的 `ImportScriptDialog` 实例，按是否存在 `inboxDraftItem` 决定预填内容（转录稿、派生项目名、一键模式默认开、模板锁定二创转述）。模板覆盖逻辑抽成纯函数 `computeImportDialogSeed` 便于单测；弹窗在「打开瞬间」按 props 播种状态。确认成功后 `Setup` 把该 inbox 项标记为 `drafted`。

**Tech Stack:** React 19 + TypeScript、Zustand（不直接改）、Vitest（node 环境 + `renderToStaticMarkup` SSR 断言 + 纯函数直测）。

---

## 背景与约束（实现者必读）

- 测试环境是 **vitest `node` + `renderToStaticMarkup`**（见 `vitest.config.ts`、`tests/auto-mode-section.test.tsx` 顶部注释）。**没有 jsdom / @testing-library 的点击模拟**。因此：
  - **纯函数**（无 hooks）→ 直接调用并断言返回值。
  - **有状态组件**（含 hooks，如 `ImportScriptDialog`）→ 只能用 `renderToStaticMarkup` 做「初始渲染结构断言」。注意：`useEffect` 在 SSR **不执行**，所以预填必须在 `useState` 初始化器里生效（首屏即正确），不能只靠 effect。
- 测试代码不被 tsc 类型检查（vitest 走 esbuild）。**类型契约的唯一守门是 `npx tsc --noEmit -p tsconfig.json`**（`tsconfig.json` 的 `include` 覆盖 `src/**` 与 `electron/**`）。
- `SonarInboxPanel` 仅在 `window.electronAPI?.sonarInboxList` 存在、且列表/桥非空时渲染，且其列表经 `useEffect` 异步加载——在 SSR 下不可观测。故**不为该面板写 SSR 行为测试**，其正确性由 `tsc`（prop 契约）+ 纯函数测试 + 弹窗 SSR 测试 + 人工验收共同保证。这是本计划已知的、刻意的测试边界。

## 文件结构

- 修改 `src/components/script/ImportScriptDialog.tsx`
  - 新增导出纯函数 `computeImportDialogSeed`（+ 类型 `ImportDialogSeedInput` / `ImportDialogSeed`）。
  - `ImportScriptDialogProps` 新增可选 props：`initialContent` / `initialProjectName` / `initialParentDir` / `initialAutoMode` / `templateIdOverride`。
  - `useState` 初始化器改为从种子取值；「关闭重置」effect 改为「打开瞬间播种」effect。
- 新增 `tests/import-script-dialog.test.tsx`
  - `computeImportDialogSeed` 纯函数单测 + 弹窗 SSR 预填渲染测试。
- 修改 `src/components/setup/SonarInboxPanel.tsx`
  - prop `onDraft(item, parentDir)` → `onRequestDraft(item)`；删除自带目录选择 UI/state、`busyId`、点击即起飞逻辑。
- 修改 `src/pages/Setup.tsx`
  - 新增 `inboxDraftItem` state；新增 `handleRequestDraftFromInbox`；`handleConfirmImportScript` 成功后标记 `drafted`；弹窗 `onOpenChange`/普通入口清空 `inboxDraftItem`；给弹窗传预填 props；`SonarInboxPanel` 改传 `onRequestDraft`；删除旧 `handleDraftFromInbox`。

---

## Task 1: 纯函数 `computeImportDialogSeed` + 单测

把「弹窗初始状态种子」（含模板覆盖逻辑）抽成纯函数，便于不依赖 DOM 的单测。

**Files:**
- Modify: `src/components/script/ImportScriptDialog.tsx`（在 `ImportScriptDialogProps` 定义附近新增导出）
- Test: `tests/import-script-dialog.test.tsx`（新建）

- [ ] **Step 1: 写失败测试（纯函数部分）**

新建 `tests/import-script-dialog.test.tsx`：

```tsx
import { describe, expect, it } from 'vitest';
import { computeImportDialogSeed } from '../src/components/script/ImportScriptDialog';
import type { AutoWorkflowParams } from '../src/store/ai';

const defaults: AutoWorkflowParams = {
  templateId: 'news-broadcast',
  roleId: 'none',
  voiceId: 'female-shaonv',
};

describe('computeImportDialogSeed', () => {
  it('无 initial 入参时回退到空值/默认参数', () => {
    const seed = computeImportDialogSeed({ defaults, defaultModelBinding: null });
    expect(seed.content).toBe('');
    expect(seed.projectName).toBe('');
    expect(seed.parentDir).toBeNull();
    expect(seed.autoMode).toBe(false);
    expect(seed.autoParams.templateId).toBe('news-broadcast');
    expect(seed.modelBinding).toBeNull();
  });

  it('应用预填值并以 templateIdOverride 覆盖模板（其余参数沿用 defaults）', () => {
    const seed = computeImportDialogSeed({
      defaults,
      defaultModelBinding: { providerId: 'p1', model: 'gpt' },
      initialContent: '转录稿正文',
      initialProjectName: '博主-标题',
      initialParentDir: '/tmp/out',
      initialAutoMode: true,
      templateIdOverride: 'rewrite-remix',
    });
    expect(seed.content).toBe('转录稿正文');
    expect(seed.projectName).toBe('博主-标题');
    expect(seed.parentDir).toBe('/tmp/out');
    expect(seed.autoMode).toBe(true);
    expect(seed.autoParams.templateId).toBe('rewrite-remix');
    expect(seed.autoParams.roleId).toBe('none');
    expect(seed.autoParams.voiceId).toBe('female-shaonv');
    expect(seed.modelBinding).toEqual({ providerId: 'p1', model: 'gpt' });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/import-script-dialog.test.tsx`
Expected: FAIL（`computeImportDialogSeed` 未从 ImportScriptDialog 导出 / 不存在）

- [ ] **Step 3: 实现纯函数**

在 `src/components/script/ImportScriptDialog.tsx` 中，紧跟现有 `import` 之后、`ImportScriptDialogProps` 之前，新增：

```tsx
export interface ImportDialogSeedInput {
  defaults: AutoWorkflowParams;
  defaultModelBinding: AutoModeModelBinding | null;
  initialContent?: string;
  initialProjectName?: string;
  initialParentDir?: string | null;
  initialAutoMode?: boolean;
  templateIdOverride?: string;
}

export interface ImportDialogSeed {
  content: string;
  projectName: string;
  parentDir: string | null;
  autoMode: boolean;
  autoParams: AutoWorkflowParams;
  modelBinding: AutoModeModelBinding | null;
}

/**
 * 计算「导入文稿」弹窗打开时的初始状态种子。
 * 纯函数（无 hooks），便于在 node 测试环境直接断言；模板覆盖逻辑集中于此。
 */
export function computeImportDialogSeed(input: ImportDialogSeedInput): ImportDialogSeed {
  return {
    content: input.initialContent ?? '',
    projectName: input.initialProjectName ?? '',
    parentDir: input.initialParentDir ?? null,
    autoMode: input.initialAutoMode ?? false,
    autoParams: {
      ...input.defaults,
      templateId: input.templateIdOverride ?? input.defaults.templateId,
    },
    modelBinding: input.defaultModelBinding,
  };
}
```

> 说明：`AutoWorkflowParams`、`AutoModeModelBinding` 已在该文件顶部 import（分别来自 `../../store/ai` 和 `./AutoModeSection`）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/import-script-dialog.test.tsx`
Expected: PASS（2 个 `computeImportDialogSeed` 用例通过）

- [ ] **Step 5: 提交**

```bash
git add src/components/script/ImportScriptDialog.tsx tests/import-script-dialog.test.tsx
git commit -m "feat(import-dialog): 抽出 computeImportDialogSeed 纯函数（含模板覆盖）"
```

---

## Task 2: `ImportScriptDialog` 接入预填 props + 打开瞬间播种

让弹窗支持外部预填，并把模板覆盖落到一键参数；普通「导入文稿」入口不传新 props，行为不变。

**Files:**
- Modify: `src/components/script/ImportScriptDialog.tsx:50-72`（props 接口）
- Modify: `src/components/script/ImportScriptDialog.tsx:82-111`（state 初始化 + reset effect）
- Test: `tests/import-script-dialog.test.tsx`（追加 SSR 用例）

- [ ] **Step 1: 写失败测试（SSR 预填）**

在 `tests/import-script-dialog.test.tsx` 顶部 import 处补充：

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportScriptDialog } from '../src/components/script/ImportScriptDialog';
```

在文件末尾追加：

```tsx
const autoModeOptions = {
  roles: [{ value: 'none', label: '不指定角色' }],
  voices: [{ value: 'female-shaonv', label: '少女音' }],
  models: [{ value: 'p1::gpt', label: 'P1 / gpt' }],
  defaults,
  defaultModelBinding: { providerId: 'p1', model: 'gpt' },
};

describe('ImportScriptDialog 预填渲染 (SSR)', () => {
  it('给定 initial 入参时，首屏预填转录稿、项目名、目录预览，且一键模式默认展开', () => {
    const html = renderToStaticMarkup(
      <ImportScriptDialog
        open
        busy={false}
        errorMessage={null}
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        autoModeOptions={autoModeOptions}
        initialContent="这是声呐转录稿"
        initialProjectName="测试博主-测试标题"
        initialParentDir="/tmp/out"
        initialAutoMode
        templateIdOverride="rewrite-remix"
      />,
    );
    // textarea 子内容 = 预填转录稿
    expect(html).toContain('这是声呐转录稿');
    // 路径预览 = parentDir/projectName（不依赖 Input value 属性，稳）
    expect(html).toContain('/tmp/out/测试博主-测试标题');
    // 一键模式默认开 → AutoModeSection 展开，角色/音色文案可见
    expect(html).toContain('不指定角色');
    expect(html).toContain('少女音');
  });

  it('不传 initial 入参时为干净弹窗（普通导入路径，回归保护）', () => {
    const html = renderToStaticMarkup(
      <ImportScriptDialog
        open
        busy={false}
        errorMessage={null}
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        autoModeOptions={autoModeOptions}
      />,
    );
    expect(html).toContain('导入文稿');
    expect(html).not.toContain('这是声呐转录稿');
    // 一键模式默认关 → 不展开角色/音色
    expect(html).not.toContain('不指定角色');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/import-script-dialog.test.tsx`
Expected: FAIL（弹窗未支持 `initialContent` 等 props；预填断言不满足）

- [ ] **Step 3a: 扩展 props 接口**

把 `src/components/script/ImportScriptDialog.tsx` 的 `ImportScriptDialogProps`（约 50-72 行）中 `autoModeOptions` 字段后追加可选 props：

```tsx
  /** 一键成稿下拉选项与默认值（由父组件提供） */
  autoModeOptions: {
    roles: AutoModeOption[];
    voices: AutoModeOption[];
    models: AutoModeOption[];
    defaults: AutoWorkflowParams;
    defaultModelBinding: AutoModeModelBinding | null;
  };
  /** 打开时预填文稿内容（如声呐转录稿）；缺省为空 */
  initialContent?: string;
  /** 打开时预填项目名；缺省为空 */
  initialProjectName?: string;
  /** 打开时预填存放目录；缺省为 null */
  initialParentDir?: string | null;
  /** 一键成稿开关初值；缺省 false */
  initialAutoMode?: boolean;
  /** 写稿模板覆盖（如待创作箱用 'rewrite-remix' 二创转述）；模板在 UI 上不暴露，仅落到一键参数 */
  templateIdOverride?: string;
```

- [ ] **Step 3b: 解构新 props**

把组件签名（约 74-81 行）的解构改为：

```tsx
export function ImportScriptDialog({
  open,
  busy,
  errorMessage,
  onOpenChange,
  onConfirm,
  autoModeOptions,
  initialContent,
  initialProjectName,
  initialParentDir,
  initialAutoMode,
  templateIdOverride,
}: ImportScriptDialogProps) {
```

- [ ] **Step 3c: state 初始化器改用种子**

把现有 state 初始化（约 82-93 行）替换为：

```tsx
  const seed0 = computeImportDialogSeed({
    defaults: autoModeOptions.defaults,
    defaultModelBinding: autoModeOptions.defaultModelBinding,
    initialContent,
    initialProjectName,
    initialParentDir,
    initialAutoMode,
    templateIdOverride,
  });
  const [content, setContent] = useState(seed0.content);
  const [projectName, setProjectName] = useState(seed0.projectName);
  const [parentDir, setParentDir] = useState<string | null>(seed0.parentDir);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(seed0.autoMode);
  const [autoParams, setAutoParams] = useState<AutoWorkflowParams>(seed0.autoParams);
  const [modelBinding, setModelBinding] = useState<AutoModeModelBinding | null>(seed0.modelBinding);
  const dragDepthRef = useRef(0);
  const prevOpenRef = useRef(false);
```

> `seed0` 每次渲染都会重算（廉价的纯对象），但 `useState` 仅在首挂载用其值；首屏（含 SSR）即反映预填。

- [ ] **Step 3d: 用「打开瞬间播种」effect 替换「关闭重置」effect**

把现有 reset effect（约 96-111 行的 `useEffect(() => { if (!open) {...} }, [...])`）整体替换为：

```tsx
  // 弹窗每次「打开」时按当前 props 播种，保证下一次复用（普通导入 / 待创作箱预填）状态干净。
  // 用 prevOpenRef 仅在 false→true 跳变时播种，避免 props 变化时清空用户正在编辑的内容。
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const seed = computeImportDialogSeed({
        defaults: autoModeOptions.defaults,
        defaultModelBinding: autoModeOptions.defaultModelBinding,
        initialContent,
        initialProjectName,
        initialParentDir,
        initialAutoMode,
        templateIdOverride,
      });
      setContent(seed.content);
      setProjectName(seed.projectName);
      setParentDir(seed.parentDir);
      setSourceFileName(null);
      setIsDragging(false);
      setReadingFile(false);
      setLocalError(null);
      setAutoMode(seed.autoMode);
      setAutoParams(seed.autoParams);
      setModelBinding(seed.modelBinding);
      dragDepthRef.current = 0;
    }
    prevOpenRef.current = open;
  }, [
    open,
    autoModeOptions.defaults,
    autoModeOptions.defaultModelBinding,
    initialContent,
    initialProjectName,
    initialParentDir,
    initialAutoMode,
    templateIdOverride,
  ]);
```

> 注意：删除旧的关闭重置 effect，不要两个 effect 并存。`handleConfirm`（约 199-202 行）保持不变——它已把当前 `autoParams`（含被覆盖的 `templateId`）原样回传给 `onConfirm`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/import-script-dialog.test.tsx`
Expected: PASS（纯函数 2 + SSR 2，共 4 用例通过）

- [ ] **Step 5: 类型检查 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/components/script/ImportScriptDialog.tsx tests/import-script-dialog.test.tsx
git commit -m "feat(import-dialog): 支持外部预填与模板覆盖（打开瞬间播种）"
```
Expected: tsc 无错误退出（码 0）。

---

## Task 3: `SonarInboxPanel` 瘦身为「只请求」

面板不再自带目录选择、不再点击即起飞；只把「请为这条素材创作」上报给上层。

**Files:**
- Modify: `src/components/setup/SonarInboxPanel.tsx`（props、state、UI、按钮）

- [ ] **Step 1: 改 props 契约**

把 props 接口（约 17-20 行）改为：

```tsx
interface SonarInboxPanelProps {
  /** 生成初稿：上报需要创作的收件项，由上层打开预填的「导入文稿」弹窗选目录/模型。 */
  onRequestDraft: (item: SonarInboxItem) => void;
}
```

并把组件签名（约 29 行）改为 `export function SonarInboxPanel({ onRequestDraft }: SonarInboxPanelProps) {`。

- [ ] **Step 2: 删除目录与忙碌相关 state / 逻辑**

- 删除 `const [parentDir, setParentDir] = useState<string | null>(null);`（约 32 行）。
- 删除 `const [busyId, setBusyId] = useState<string | null>(null);`（约 35 行）。
- 删除 `pickDir`（约 68-71 行的整个 `useCallback`）。
- 把 `handleDraft`（约 73-95 行）整段替换为：

```tsx
  const handleDraft = useCallback(
    (item: SonarInboxItem) => {
      setError(null);
      onRequestDraft(item);
    },
    [onRequestDraft],
  );
```

- [ ] **Step 3: 删除目录选择 UI、修正按钮**

- 删除目录行（约 160-166 行）：

```tsx
      <div className={styles.dirRow}>
        <Button variant="secondary" size="sm" onClick={() => void pickDir()}>
          <FolderOpen size={14} />
          {parentDir ? '更改父目录' : '选择父目录'}
        </Button>
        <span className={styles.dirText}>{parentDir ?? '未选择保存位置'}</span>
      </div>
```

- 把生成按钮（约 188-196 行）替换为：

```tsx
              <Button
                size="sm"
                onClick={() => handleDraft(item)}
                disabled={!canDraftInboxItem(item) || item.status === 'creating'}
              >
                <Sparkles size={14} />
                生成初稿
              </Button>
```

- 清理无用 import：从第 9 行的 `lucide-react` import 中移除 `FolderOpen`（目录行删除后不再使用）。保留 `Inbox, RefreshCw, Trash2, Sparkles, Copy, ChevronDown, ChevronRight`。检查 `Button` 仍被桥配置/刷新区使用——保留 `Button` import。

> 说明：状态标记（`creating`/`drafted`/`failed`）移交上层 `Setup` 在确认成功/失败时处理；面板点击不再写状态，避免用户取消弹窗后残留 `creating`。

- [ ] **Step 4: 类型检查（此时 Setup 尚未改完会报 1 处调用方错误，预期）**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 仅 `src/pages/Setup.tsx` 因仍传旧 `onDraft` 报类型错误（下个 Task 修复）。`SonarInboxPanel.tsx` 自身无错误。

> 这是预期的中间态——本 Task 不单独提交，与 Task 4 合并提交以保持仓库可编译。

---

## Task 4: `Setup` 复用弹窗预填 + 确认后标记 drafted

把 inbox 请求接到唯一的 `ImportScriptDialog` 上，预填转录稿/项目名/二创模板，确认成功后标记该 inbox 项。

**Files:**
- Modify: `src/pages/Setup.tsx`（state、handlers、弹窗渲染、面板 prop）

- [ ] **Step 1: 新增 inboxDraftItem state**

在 Setup 的「导入文稿弹窗状态」区（约 100-103 行）后追加：

```tsx
  // ── 待创作箱触发的预填项（非空表示当前弹窗服务于某条 inbox 素材）──
  const [inboxDraftItem, setInboxDraftItem] = useState<SonarInboxItem | null>(null);
```

- [ ] **Step 2: 普通导入入口清空预填**

把 `handleOpenImportScript`（约 244-248 行）替换为：

```tsx
  const handleOpenImportScript = useCallback(() => {
    setInboxDraftItem(null);
    setImportScriptError(null);
    setImportScriptCreating(false);
    setImportScriptOpen(true);
  }, []);
```

- [ ] **Step 3: 用「请求打开预填弹窗」替换旧的直接起飞 handler**

把 `handleDraftFromInbox`（约 183-201 行整段）替换为：

```tsx
  // 待创作箱「生成初稿」：打开预填的「导入文稿」弹窗，让用户选目录/写稿模型/角色/音色，
  // 默认一键模式开 + 二创转述模板；确认后走与普通导入完全相同的 onImportScript。
  const handleRequestDraftFromInbox = useCallback((item: SonarInboxItem) => {
    setInboxDraftItem(item);
    setImportScriptError(null);
    setImportScriptCreating(false);
    setImportScriptOpen(true);
  }, []);
```

- [ ] **Step 4: 确认成功后标记 drafted；弹窗关闭清空预填**

把 `handleConfirmImportScript`（约 250-271 行整段）替换为：

```tsx
  const handleConfirmImportScript = useCallback(
    async (
      parentDir: string,
      projectNameInput: string,
      content: string,
      autoMode: boolean,
      autoParams: AutoWorkflowParams,
      modelBinding: AutoModeModelBinding | null,
    ) => {
      setImportScriptCreating(true);
      setImportScriptError(null);
      try {
        await onImportScript(parentDir, projectNameInput, content, autoMode, autoParams, modelBinding);
        // 来自待创作箱：项目已创建并起飞流水线 → 标记该收件项为「已生成」并记录项目路径，避免重复创作。
        if (inboxDraftItem) {
          void window.electronAPI
            .sonarInboxMarkStatus?.(inboxDraftItem.id, 'drafted', {
              projectPath: `${parentDir}/${projectNameInput}`,
            })
            .catch(() => {});
          setInboxDraftItem(null);
        }
        setImportScriptOpen(false);
      } catch (err) {
        setImportScriptError(err instanceof Error ? err.message : '创建项目失败');
      } finally {
        setImportScriptCreating(false);
      }
    },
    [onImportScript, inboxDraftItem],
  );

  // 弹窗关闭（含取消）：清空 inbox 预填，收件项保持 pending。
  const handleImportScriptOpenChange = useCallback((next: boolean) => {
    setImportScriptOpen(next);
    if (!next) setInboxDraftItem(null);
  }, []);
```

- [ ] **Step 5: 面板改传 onRequestDraft**

把 `<SonarInboxPanel onDraft={handleDraftFromInbox} />`（约 498 行）替换为：

```tsx
        <SonarInboxPanel onRequestDraft={handleRequestDraftFromInbox} />
```

- [ ] **Step 6: 弹窗渲染传入预填 props + 新 onOpenChange**

把 `<ImportScriptDialog ... />`（约 643-650 行）替换为：

```tsx
      <ImportScriptDialog
        open={importScriptOpen}
        busy={importScriptCreating}
        errorMessage={importScriptError}
        onOpenChange={handleImportScriptOpenChange}
        onConfirm={handleConfirmImportScript}
        autoModeOptions={autoModeOptions}
        initialContent={inboxDraftItem ? inboxItemToOriginalMarkdown(inboxDraftItem) : undefined}
        initialProjectName={inboxDraftItem ? deriveProjectName(inboxDraftItem) : undefined}
        initialAutoMode={inboxDraftItem ? true : undefined}
        templateIdOverride={inboxDraftItem ? 'rewrite-remix' : undefined}
      />
```

> `inboxItemToOriginalMarkdown` / `deriveProjectName` 已在 Setup 顶部 import（约 26-28 行），无需新增 import。`SonarInboxItem` 类型同样已 import。

- [ ] **Step 7: 类型检查，确认全绿**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 退出码 0，无错误（Task 3 的中间态错误已被本 Task 修复）。

- [ ] **Step 8: 提交 Task 3 + Task 4**

```bash
git add src/components/setup/SonarInboxPanel.tsx src/pages/Setup.tsx
git commit -m "feat(sonar-inbox): 生成初稿复用导入文稿弹窗（预填+选目录/模型），移除面板自带目录选择"
```

---

## Task 5: 全量验证

确认改动无回归、契约一致。

- [ ] **Step 1: 跑相关测试**

Run: `npx vitest run tests/import-script-dialog.test.tsx tests/auto-mode-section.test.tsx tests/setup.test.tsx tests/sonar-inbox.test.ts tests/sonar-inbox-helpers.test.ts`
Expected: 全部 PASS。

- [ ] **Step 2: 全量测试套件**

Run: `npm test`
Expected: 全绿（根工程；`extensions/**` 不在其中）。

- [ ] **Step 3: 类型检查兜底**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 退出码 0。

- [ ] **Step 4: 人工验收（在 plan 之外，向用户说明）**

由于待创作箱面板与 Setup 串联在 SSR/node 环境不可点测，需在 `npm run dev` 下人工确认：
1. 欢迎页待创作箱有素材时，面板**不再**有「选择父目录」按钮。
2. 点「生成初稿」弹出「导入文稿」弹窗，文稿**已预填**转录稿、项目名为「博主-标题」、一键成稿**默认开**。
3. 弹窗内可选存放目录与写稿模型/角色/音色；确认后进入 auto-run 流水线。
4. 返回欢迎页该素材状态变为「已生成」；取消弹窗则仍为「待创作」。

> 人工验收结果如实记录，不要在未实跑前声称通过。

---

## Self-Review（作者已核对）

- **Spec 覆盖**：复用「导入文稿」弹窗（Task 2+4）、移除面板目录选择器（Task 3）、预填转录稿/派生名/二创模板/一键默认开（Task 1/2/4）、确认后标记 drafted（Task 4）、取消保持 pending（Task 4 Step 4）、错误不标记（沿用 try/catch，Task 4 Step 4）、不改流水线/抖音本地视频弹窗/桥（未触及）——均有对应任务。
- **占位符扫描**：无 TBD / “适当处理” 等；每个代码步骤含完整代码。
- **类型一致性**：`computeImportDialogSeed` / `ImportDialogSeedInput` / `ImportDialogSeed`、新 props 名（`initialContent` 等）、`onRequestDraft`、`handleRequestDraftFromInbox`、`handleImportScriptOpenChange` 在各任务间命名一致；`autoParams.templateId` 覆盖路径自洽（种子 → useState → handleConfirm 原样回传）。
- **已知测试边界**：`SonarInboxPanel`/`Setup` 串联无自动化点测，由 tsc + 纯函数/弹窗测试 + 人工验收兜底（已在背景与 Task 5 Step 4 标注）。

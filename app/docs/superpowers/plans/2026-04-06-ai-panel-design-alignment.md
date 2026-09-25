# AI Panel Design Alignment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the editor left AI assistant panel with `design.pen`, covering both the cards tab and the cover tab, without changing analysis/store behavior.

**Architecture:** Keep all AI data flow, actions, and persistence logic intact. Replace the current left-panel presentation layer with a design-specific shell in `Editor`, a design-aligned `AIPanel`, and matching `AICardList` / `AICoverPanel` view components. Use targeted SSR tests as regression coverage for the new structure.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest SSR rendering tests

---

## Chunk 1: Regression Tests First

### Task 1: Lock the AI shell and card tab markup

**Files:**
- Modify: `tests/ai-panel.test.tsx`
- Modify: `tests/ai-card-list.test.tsx`

- [ ] **Step 1: Write the failing assertions for the new AI shell**

Add assertions that expect:
- the top-level AI header title to be `AI 分析`
- the header badge copy to use `已选 x/y`
- the cards sub-tab to be the active underline tab
- the footer CTA copy to be `上轨 x`
- the prompt label and compact action row copy to match the design

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npm test -- tests/ai-panel.test.tsx tests/ai-card-list.test.tsx
```

Expected: FAIL because the current markup still uses the older shell, action copy, and card-row structure.

- [ ] **Step 3: Add failing card-list assertions for the design-specific row**

Add assertions that expect:
- checkbox markup to exist
- no per-card delete affordance in the default visible layout
- card body copy to remain visible
- selected cards to expose a selected state marker compatible with the new stylesheet

- [ ] **Step 4: Re-run the targeted tests**

Run:

```bash
npm test -- tests/ai-panel.test.tsx tests/ai-card-list.test.tsx
```

Expected: FAIL with the new assertions.

### Task 2: Lock the AI cover tab markup

**Files:**
- Modify: `tests/ai-cover-panel.test.tsx`

- [ ] **Step 1: Write the failing assertions for the cover tab**

Add assertions that expect:
- prompt section heading/copy to match the design
- the primary button copy to be `重新生成`
- the candidate helper copy to remain visible
- the footer CTA copy to be `设为整期背景`
- the candidate grid to expose a design-specific selected state hook

- [ ] **Step 2: Run the targeted cover test to verify it fails**

Run:

```bash
npm test -- tests/ai-cover-panel.test.tsx
```

Expected: FAIL because the current cover tab still uses generic `Card/Button/Field` styling and markup.

## Chunk 2: Editor Sidebar Shell

### Task 3: Replace the generic left shell with a design-specific panel shell

**Files:**
- Modify: `src/pages/Editor.tsx`
- Modify: `src/pages/Editor.module.css`

- [ ] **Step 1: Remove the generic card-shell framing around the left sidebar**

Change the left sidebar wrapper so the tab bar and panel content render inside a dedicated shell that mirrors the 224px flat panel from `design.pen`.

- [ ] **Step 2: Keep asset/AI tab behavior intact**

Preserve:
- `activePanel`
- asset panel rendering
- AI panel rendering
- responsive stacked sidebar behavior

- [ ] **Step 3: Run the editor regression test**

Run:

```bash
npm test -- tests/editor.test.tsx
```

Expected: PASS after the shell markup and width/grid assertions are updated to the new structure.

## Chunk 3: AI Cards Tab View

### Task 4: Rebuild the AI panel cards-tab presentation to match `Left Panel — AI Tab State`

**Files:**
- Modify: `src/components/AIPanel.tsx`
- Modify: `src/components/AIPanel.module.css`

- [ ] **Step 1: Replace `PanelHeader` and generic tab visuals**

Implement a design-specific header with:
- bare icon + title + compact badge
- bare refresh/settings icon actions
- underline-style sub-tabs for `内容卡片` and `封面`

- [ ] **Step 2: Replace the generic prompt / empty / action bar layouts**

Keep the same callbacks and state transitions, but render:
- design-specific prompt field container
- compact selection/action row
- tighter loading/empty states that do not pull in the current generic card/overlay layout

- [ ] **Step 3: Keep analysis behavior unchanged**

Preserve:
- analyze / reanalyze flow
- error rendering
- select-all / delete-selected behavior
- apply-to-timeline behavior

- [ ] **Step 4: Rebuild card rows in `AICardList`**

**Files:**
- Modify: `src/components/AICardList.tsx`
- Modify: `src/components/AICardList.module.css`

Implement:
- compact card rows matching the design spacing
- visible checkbox
- colored type badge
- multi-line body copy
- selection border treatment
- click-to-edit behavior without the old floating delete affordance

- [ ] **Step 5: Run the cards-tab regression tests**

Run:

```bash
npm test -- tests/ai-panel.test.tsx tests/ai-card-list.test.tsx
```

Expected: PASS.

## Chunk 4: AI Cover Tab View

### Task 5: Rebuild the cover tab presentation to match `Left Panel — AI Cover Tab State`

**Files:**
- Modify: `src/components/AICoverPanel.tsx`
- Modify: `src/components/AICoverPanel.module.css`

- [ ] **Step 1: Replace generic primitives in the cover prompt section**

Render:
- prompt heading row
- prompt card with design-aligned spacing/copy
- compact edit/regenerate controls
- primary generate button sized to the design

- [ ] **Step 2: Rebuild the candidate grid**

Implement:
- two-column compact grid
- selected-border treatment
- failed candidate fallback tile
- bottom CTA sized and worded like the design

- [ ] **Step 3: Preserve existing interactions**

Keep:
- prompt editing flow
- generate/regenerate actions
- candidate selection
- drag payload behavior
- `设为整期背景` callback

- [ ] **Step 4: Run the cover regression test**

Run:

```bash
npm test -- tests/ai-cover-panel.test.tsx
```

Expected: PASS.

## Chunk 5: Final Verification

### Task 6: Run focused verification for the aligned left panel

**Files:**
- Verify only

- [ ] **Step 1: Run all targeted AI/editor tests**

Run:

```bash
npm test -- tests/editor.test.tsx tests/ai-panel.test.tsx tests/ai-card-list.test.tsx tests/ai-cover-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the full suite only if the targeted checks are green**

Run:

```bash
npm test
```

Expected: PASS, or if unrelated pre-existing failures exist, capture them explicitly.

- [ ] **Step 3: Run a production build**

Run:

```bash
npm run build
```

Expected: PASS.

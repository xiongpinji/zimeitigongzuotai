// src/ui/components/script-editor-search.ts
// 自定义 CM6 搜索面板 — macOS 暗色风格浮动组件

import type { Panel, ViewUpdate } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from '@codemirror/search';

/* ── SVG 图标 ── */

function svg(pathD: string, size = 14): Element {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('viewBox', '0 0 16 16');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.5');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.innerHTML = pathD;
  return el;
}

const chevronRight = () => svg('<path d="M6 3l4 5-4 5"/>');
const chevronDown = () => svg('<path d="M3 6l5 4 5-4"/>');
const arrowUp = () => svg('<path d="M8 13V4M4 8l4-4 4 4"/>');
const arrowDown = () => svg('<path d="M8 3v9M4 8l4 4 4-4"/>');
const closeIcon = () => svg('<path d="M4 4l8 8M12 4l-8 8"/>');

/* ── 工具函数 ── */

function btn(cls: string, title: string, child: Element | string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.title = title;
  b.type = 'button';
  if (typeof child === 'string') b.textContent = child;
  else b.appendChild(child);
  return b;
}

function countMatches(view: EditorView): { current: number; total: number } {
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return { current: 0, total: 0 };

  const iter = query.getCursor(view.state);
  const sel = view.state.selection.main;
  let total = 0;
  let current = 0;

  let r = iter.next();
  while (!r.done) {
    total++;
    if (total > 9999) return { current, total: 10000 };
    if (r.value.from === sel.from && r.value.to === sel.to) current = total;
    r = iter.next();
  }
  return { current, total };
}

/* ── 打开时展开替换的标志 ── */

let _openWithReplace = false;

/** 标记下次打开搜索面板时自动展开替换行 */
export function setOpenWithReplace(): void {
  _openWithReplace = true;
}

/* ── 面板工厂 ── */

export function createSearchPanel(view: EditorView): Panel {
  // 从当前查询初始化状态
  const q = getSearchQuery(view.state);
  let caseSensitive = q.caseSensitive;
  let replaceVisible = false;

  /* ── DOM 构建 ── */
  const dom = document.createElement('div');
  dom.className = 'cm-search-float';

  // 搜索行
  const searchRow = document.createElement('div');
  searchRow.className = 'cm-sf-row';

  const toggleBtn = btn('cm-sf-toggle', '切换替换', chevronRight());

  const searchFieldWrap = document.createElement('div');
  searchFieldWrap.className = 'cm-sf-field-wrap';

  const searchInput = document.createElement('input');
  searchInput.className = 'cm-sf-input';
  searchInput.placeholder = '搜索';
  searchInput.value = q.search;
  searchInput.setAttribute('main-field', 'true');
  searchInput.spellcheck = false;

  const caseBtn = btn('cm-sf-opt' + (caseSensitive ? ' active' : ''), '区分大小写', 'Aa');
  searchFieldWrap.append(searchInput, caseBtn);

  const matchCount = document.createElement('span');
  matchCount.className = 'cm-sf-count';

  const prevBtn = btn('cm-sf-nav', '上一个 (Shift+Enter)', arrowUp());
  const nextBtn = btn('cm-sf-nav', '下一个 (Enter)', arrowDown());
  const closeBtnEl = btn('cm-sf-nav cm-sf-close', '关闭 (Escape)', closeIcon());

  searchRow.append(toggleBtn, searchFieldWrap, matchCount, prevBtn, nextBtn, closeBtnEl);

  // 替换行
  const replaceRow = document.createElement('div');
  replaceRow.className = 'cm-sf-row cm-sf-replace-row';
  replaceRow.style.display = 'none';

  const spacer = document.createElement('div');
  spacer.className = 'cm-sf-spacer';

  const replaceFieldWrap = document.createElement('div');
  replaceFieldWrap.className = 'cm-sf-field-wrap';

  const replaceInput = document.createElement('input');
  replaceInput.className = 'cm-sf-input';
  replaceInput.placeholder = '替换';
  replaceInput.spellcheck = false;
  replaceFieldWrap.append(replaceInput);

  const replaceBtnEl = btn('cm-sf-action', '替换当前 (⌘⇧1)', '替换');
  const replaceAllBtnEl = btn('cm-sf-action', '全部替换 (⌘⌥Enter)', '全部');

  replaceRow.append(spacer, replaceFieldWrap, replaceBtnEl, replaceAllBtnEl);
  dom.append(searchRow, replaceRow);

  /* ── 查询分发 ── */

  function dispatchQuery() {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: searchInput.value,
          replace: replaceInput.value,
          caseSensitive,
        }),
      ),
    });
  }

  function updateMatchCount() {
    const { current, total } = countMatches(view);
    if (total === 0) {
      matchCount.textContent = searchInput.value ? '无结果' : '';
      matchCount.classList.toggle('cm-sf-no-match', !!searchInput.value);
    } else {
      matchCount.textContent = total > 9999 ? `${current}/${total}+` : `${current}/${total}`;
      matchCount.classList.remove('cm-sf-no-match');
    }
  }

  /* ── 事件绑定 ── */

  // 展开/收起替换
  toggleBtn.addEventListener('click', () => {
    replaceVisible = !replaceVisible;
    replaceRow.style.display = replaceVisible ? 'flex' : 'none';
    toggleBtn.innerHTML = '';
    toggleBtn.appendChild(replaceVisible ? chevronDown() : chevronRight());
    if (replaceVisible) replaceInput.focus();
  });

  // 搜索输入
  searchInput.addEventListener('input', () => { dispatchQuery(); updateMatchCount(); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
      updateMatchCount();
    }
    if (e.key === 'Escape') { e.preventDefault(); closeSearchPanel(view); }
  });

  // 替换输入
  replaceInput.addEventListener('input', dispatchQuery);
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceNext(view); updateMatchCount(); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearchPanel(view); }
  });

  // 选项切换
  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle('active', caseSensitive);
    dispatchQuery();
    updateMatchCount();
  });

  // 导航与关闭
  prevBtn.addEventListener('click', () => { findPrevious(view); updateMatchCount(); });
  nextBtn.addEventListener('click', () => { findNext(view); updateMatchCount(); });
  closeBtnEl.addEventListener('click', () => closeSearchPanel(view));
  replaceBtnEl.addEventListener('click', () => { replaceNext(view); updateMatchCount(); });
  replaceAllBtnEl.addEventListener('click', () => { replaceAll(view); updateMatchCount(); });

  /* ── Panel 接口 ── */

  return {
    dom,
    top: true,
    mount() {
      // 预填选中文本（仅单行）
      const sel = view.state.selection.main;
      if (!sel.empty) {
        const text = view.state.sliceDoc(sel.from, sel.to);
        if (!text.includes('\n')) {
          searchInput.value = text;
          dispatchQuery();
        }
      }
      // 如果标记了打开替换行，则自动展开
      if (_openWithReplace) {
        _openWithReplace = false;
        replaceVisible = true;
        replaceRow.style.display = 'flex';
        toggleBtn.innerHTML = '';
        toggleBtn.appendChild(chevronDown());
      }
      searchInput.focus();
      searchInput.select();
      updateMatchCount();
    },
    update(update: ViewUpdate) {
      // 响应外部查询变更
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) {
            const eq = effect.value;
            if (eq.search !== searchInput.value) searchInput.value = eq.search;
            if (eq.replace !== replaceInput.value) replaceInput.value = eq.replace;
            if (eq.caseSensitive !== caseSensitive) {
              caseSensitive = eq.caseSensitive;
              caseBtn.classList.toggle('active', caseSensitive);
            }
          }
        }
      }
      if (update.docChanged || update.selectionSet) updateMatchCount();
    },
  };
}

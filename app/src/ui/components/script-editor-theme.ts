import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const theme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-window-bg)',
      color: 'var(--color-text-primary)',
      height: '100%',
    },
    '.cm-content': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--font-size-lg)',
      lineHeight: 'var(--line-height-relaxed)',
      padding: '12px 16px',
      caretColor: 'var(--color-system-blue)',
    },
    '.cm-cursor': { borderLeftColor: 'var(--color-system-blue)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-window-bg)',
      color: 'var(--color-border-strong)',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor:
        'color-mix(in srgb, var(--color-panel-elevated) 31%, transparent)',
    },
    '.cm-selectionBackground': {
      backgroundColor:
        'color-mix(in srgb, var(--color-system-blue) 19%, transparent) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor:
        'color-mix(in srgb, var(--color-system-blue) 25%, transparent) !important',
    },
    '.cm-placeholder': { color: 'var(--color-border-strong)' },
    // annotation decoration styles
    '.cm-annotation-error': {
      backgroundColor:
        'color-mix(in srgb, var(--color-danger) 19%, transparent)',
      borderBottom: '2px wavy var(--color-danger)',
      borderRadius: '2px',
      cursor: 'pointer',
    },
    '.cm-annotation-warning': {
      backgroundColor:
        'color-mix(in srgb, var(--color-brand-warm) 19%, transparent)',
      borderBottom: '2px wavy var(--color-brand-warm)',
      borderRadius: '2px',
      cursor: 'pointer',
    },
    '.cm-annotation-info': {
      backgroundColor:
        'color-mix(in srgb, var(--color-system-blue) 19%, transparent)',
      borderBottom: '2px wavy var(--color-system-blue)',
      borderRadius: '2px',
      cursor: 'pointer',
    },
    // hover tooltip
    '.cm-tooltip': {
      background: 'transparent',
      border: 'none',
      padding: '0',
    },
    // MCP 变更行高亮
    '.cm-mcp-change-highlight': {
      backgroundColor:
        'color-mix(in srgb, var(--color-success) 15%, transparent)',
      transition: 'background-color 0.5s ease-out',
    },
    '.cm-annotation-tooltip': {
      backgroundColor: 'var(--color-panel-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-lg)',
      padding: '8px 12px',
      fontSize: 'var(--font-size-md)',
      color: 'var(--color-text-secondary)',
      maxWidth: '300px',
      lineHeight: '1.4',
      boxShadow: 'var(--shadow-dropdown)',
    },

    // --- 浮动搜索面板（macOS 暗色风格） ---

    // 面板容器：透明化，不占据编辑器空间
    '& .cm-panels': {
      backgroundColor: 'transparent',
      border: 'none',
    },
    '& .cm-panels.cm-panels-top': {
      borderBottom: 'none',
    },

    // 浮动搜索面板主体
    '.cm-search-float': {
      position: 'absolute',
      top: '6px',
      right: '20px',
      zIndex: '20',
      width: '380px',
      maxWidth: 'calc(100% - 40px)',
      backgroundColor: 'var(--color-panel-elevated)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-dropdown)',
      padding: '6px 6px 6px 4px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--font-size-md)',
      pointerEvents: 'auto',
    },

    // 行布局
    '.cm-sf-row': {
      display: 'flex',
      alignItems: 'center',
      gap: '3px',
    },

    // 展开/收起替换按钮
    '.cm-sf-toggle': {
      width: '20px',
      height: '22px',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-placeholder)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      padding: '0',
    },
    '.cm-sf-toggle:hover': {
      color:
        'color-mix(in srgb, var(--color-text-primary) 80%, transparent)',
      backgroundColor: 'var(--color-border-strong)',
    },

    // 输入框外壳
    '.cm-sf-field-wrap': {
      display: 'flex',
      alignItems: 'center',
      flex: '1',
      minWidth: '0',
      backgroundColor: 'var(--color-window-bg)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
    },
    '.cm-sf-field-wrap:focus-within': {
      borderColor: 'var(--color-system-blue)',
    },

    // 搜索/替换输入框
    '.cm-sf-input': {
      flex: '1',
      minWidth: '0',
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-primary)',
      padding: '4px 6px',
      fontSize: 'var(--font-size-md)',
      fontFamily: 'var(--font-mono)',
      outline: 'none',
    },
    '.cm-sf-input::placeholder': {
      color: 'var(--color-text-quaternary)',
    },

    // 选项切换按钮（Aa）
    '.cm-sf-opt': {
      width: '24px',
      height: '22px',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 'none',
      color:
        'color-mix(in srgb, var(--color-text-primary) 25%, transparent)',
      cursor: 'pointer',
      borderRadius: '3px',
      padding: '0',
      fontSize: 'var(--font-size-sm)',
      fontWeight: '600',
      fontFamily: 'var(--font-mono)',
      marginRight: '2px',
    },
    '.cm-sf-opt:hover': {
      color:
        'color-mix(in srgb, var(--color-text-primary) 80%, transparent)',
      backgroundColor:
        'color-mix(in srgb, var(--color-border-strong) 25%, transparent)',
    },
    '.cm-sf-opt.active': {
      color: 'var(--color-text-primary)',
      backgroundColor: 'var(--color-system-blue)',
      borderRadius: '3px',
    },

    // 匹配计数
    '.cm-sf-count': {
      color: 'var(--color-text-secondary-strong)',
      fontSize: 'var(--font-size-sm)',
      whiteSpace: 'nowrap',
      padding: '0 4px',
      minWidth: '32px',
      textAlign: 'center',
      flexShrink: '0',
    },
    '.cm-sf-no-match': {
      color: 'var(--color-danger)',
    },

    // 导航按钮（上/下/关闭）
    '.cm-sf-nav': {
      width: '22px',
      height: '22px',
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-secondary-strong)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      padding: '0',
    },
    '.cm-sf-nav:hover': {
      color: 'var(--color-text-primary)',
      backgroundColor: 'var(--color-border-strong)',
    },
    '.cm-sf-close:hover': {
      color: 'var(--color-danger)',
    },

    // 替换行占位
    '.cm-sf-spacer': {
      width: '20px',
      flexShrink: '0',
    },

    // 替换操作按钮
    '.cm-sf-action': {
      height: '22px',
      padding: '0 8px',
      background: 'transparent',
      border: '1px solid var(--color-border-strong)',
      color: 'var(--color-text-secondary)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--font-size-sm)',
      whiteSpace: 'nowrap',
      flexShrink: '0',
    },
    '.cm-sf-action:hover': {
      color: 'var(--color-text-primary)',
      backgroundColor: 'var(--color-border-strong)',
      borderColor: 'var(--color-text-quaternary)',
    },

    // 搜索匹配高亮
    '.cm-searchMatch': {
      backgroundColor:
        'color-mix(in srgb, var(--color-brand-warm) 33%, transparent)',
      borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor:
        'color-mix(in srgb, var(--color-system-blue) 40%, transparent)',
      outline: '1px solid var(--color-system-blue)',
      borderRadius: '2px',
    },
    // 选中文本高亮匹配
    '.cm-selectionMatch': {
      backgroundColor:
        'color-mix(in srgb, var(--color-brand-accent) 15%, transparent)',
      borderRadius: '2px',
    },
  },
  { dark: true },
);

const highlighting = HighlightStyle.define([
  {
    tag: tags.heading1,
    color: 'var(--color-text-primary)',
    fontWeight: 'bold',
    fontSize: '1.4em',
  },
  {
    tag: tags.heading2,
    color: 'var(--color-text-primary)',
    fontWeight: 'bold',
    fontSize: '1.2em',
  },
  {
    tag: tags.heading3,
    color: 'var(--color-text-primary)',
    fontWeight: 'bold',
    fontSize: '1.1em',
  },
  { tag: tags.emphasis, color: 'var(--color-brand-warm)', fontStyle: 'italic' },
  { tag: tags.strong, color: 'var(--color-brand-warm)', fontWeight: 'bold' },
  {
    tag: tags.link,
    color: 'var(--color-system-blue)',
    textDecoration: 'underline',
  },
  {
    tag: tags.url,
    color: 'color-mix(in srgb, var(--color-system-blue) 50%, transparent)',
  },
  { tag: tags.monospace, color: 'var(--color-success)' },
  {
    tag: tags.quote,
    color: 'var(--color-text-secondary-strong)',
    fontStyle: 'italic',
  },
  { tag: tags.processingInstruction, color: 'var(--color-border-strong)' },
]);

export const scriptEditorTheme = [theme, syntaxHighlighting(highlighting)];

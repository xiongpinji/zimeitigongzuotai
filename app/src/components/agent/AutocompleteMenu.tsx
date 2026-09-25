import { useEffect, useRef } from 'react';
import { FileText, FolderOpen, Terminal } from 'lucide-react';

// ─── 通用浮动菜单项 ───────────────────────────────────────────

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: 'file' | 'folder' | 'command';
}

interface AutocompleteMenuProps {
  items: MenuItem[];
  selectedIndex: number;
  onSelect: (item: MenuItem) => void;
  /** 显示在菜单顶部的提示文字 */
  hint?: string;
}

const iconMap = {
  file: <FileText size={12} className="shrink-0 text-mac-text-muted/50" />,
  folder: <FolderOpen size={12} className="shrink-0 text-mac-blue/70" />,
  command: <Terminal size={12} className="shrink-0 text-mac-text-muted/50" />,
};

/**
 * 浮动自动补全菜单，显示在输入框上方。
 * 支持 / 命令和 @ 文件提及两种场景。
 */
export function AutocompleteMenu({ items, selectedIndex, onSelect, hint }: AutocompleteMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 选中项自动滚动到可视区
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[hint ? selectedIndex + 1 : selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, hint]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-[200px] overflow-y-auto rounded-[8px] border border-mac-border bg-mac-elevated shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
    >
      {hint && (
        <div className="px-2.5 py-1.5 text-[10px] text-mac-text-muted/40 border-b border-mac-separator select-none">
          {hint}
        </div>
      )}
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          // 使用 mouseDown 而非 click，防止 textarea blur 先于选中执行
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors ${
            index === selectedIndex
              ? 'bg-mac-blue/15 text-white'
              : 'text-mac-text-muted/80 hover:bg-white/5'
          }`}
        >
          {item.icon ? iconMap[item.icon] : null}
          <span className="truncate font-mono text-[11px]">{item.label}</span>
          {item.description ? (
            <span className="ml-auto truncate text-[10px] text-mac-text-muted/40 max-w-[50%]">
              {item.description}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

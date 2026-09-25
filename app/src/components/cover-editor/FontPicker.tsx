import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './FontPicker.module.css';
import {
  ensureFontLoaded,
  loadSystemFonts,
} from '../../lib/cover-editor/system-fonts';

interface FontPickerProps {
  value: string;
  onChange: (family: string) => void;
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSystemFonts().then((list) => setFonts(list.map((f) => f.family)));
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fonts.slice(0, 50);
    return fonts.filter((f) => f.toLowerCase().includes(q)).slice(0, 50);
  }, [fonts, query]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: value }}
      >
        {value}
      </button>
      {open && (
        <div className={styles.popover}>
          <input
            className={styles.search}
            autoFocus
            placeholder="搜索字体…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={styles.list}>
            {filtered.map((f) => (
              <button
                key={f}
                type="button"
                className={f === value ? styles.itemActive : styles.item}
                onMouseEnter={() => ensureFontLoaded(f)}
                onClick={() => {
                  ensureFontLoaded(f);
                  onChange(f);
                  setOpen(false);
                }}
                style={{ fontFamily: f }}
              >
                {f}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className={styles.empty}>未找到匹配字体</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

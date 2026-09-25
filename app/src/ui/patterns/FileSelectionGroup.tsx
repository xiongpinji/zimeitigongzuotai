import type { ReactNode } from 'react';
import styles from './FileSelectionGroup.module.css';

export interface FileSelectionGroupFile {
  name: string;
  key?: string;
}

export interface FileSelectionGroupProps {
  icon: ReactNode;
  title: string;
  count?: number;
  emptyHint?: string;
  files?: FileSelectionGroupFile[];
  intent?: 'ok' | 'warn';
  className?: string;
}

/**
 * 文件扫描结果分组：Setup 扫描结果中按类型展示音频 / SRT 等文件列表。
 * Header 区域为 icon + title + count，主体区为文件列表或空态提示。
 */
export function FileSelectionGroup({
  className,
  count,
  emptyHint,
  files,
  icon,
  intent = 'ok',
  title,
}: FileSelectionGroupProps) {
  const hasFiles = Array.isArray(files) && files.length > 0;
  return (
    <div
      className={joinClassNames(
        styles.root,
        intent === 'warn' ? styles.intentWarn : styles.intentOk,
        className,
      )}
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.title}>{title}</span>
        {typeof count === 'number' ? <span className={styles.count}>{count}</span> : null}
      </div>
      {hasFiles ? (
        <ul className={styles.list}>
          {files!.map((file, index) => (
            <li key={file.key ?? `${file.name}-${index}`} className={styles.item}>
              <span className={styles.itemDot} aria-hidden="true" />
              <span className={styles.itemName}>{file.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>{emptyHint ?? '暂无文件'}</div>
      )}
    </div>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

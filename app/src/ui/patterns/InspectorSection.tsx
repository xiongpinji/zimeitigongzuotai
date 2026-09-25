import type { ReactNode } from 'react';
import styles from './InspectorSection.module.css';

export interface InspectorSectionProps {
  title?: string;
  children: ReactNode;
  /** 是否为危险区（应用红色标题） */
  dangerous?: boolean;
  className?: string;
}

/**
 * Inspector 面板属性分组：title + 字段组合，作为 Inspector 面板中反复出现的分段容器。
 * 每个 section 顶部有分隔线（首个 section 自动去掉）。
 */
export function InspectorSection({
  children,
  className,
  dangerous = false,
  title,
}: InspectorSectionProps) {
  return (
    <section
      className={joinClassNames(
        styles.root,
        dangerous ? styles.dangerous : '',
        className,
      )}
    >
      {title ? <div className={styles.title}>{title}</div> : null}
      <div className={styles.body}>{children}</div>
    </section>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

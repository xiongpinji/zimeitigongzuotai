import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from 'lucide-react';
import type { Annotation } from '../../store/script';
import { Badge, Button } from '../../ui';
import styles from './ReviewStatusBar.module.css';

interface ReviewStatusBarProps {
  annotations: Annotation[];
  onAcceptAll: () => void;
  onDismissAll: () => void;
  /** 面板是否折叠 */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** 导航按钮是否禁用（无批注或只有 1 条时） */
  navDisabled?: boolean;
}

export function ReviewStatusBar({
  annotations,
  onAcceptAll,
  onDismissAll,
  collapsed,
  onToggleCollapse,
  onPrev,
  onNext,
  navDisabled,
}: ReviewStatusBarProps) {
  const pending = annotations.filter((a) => a.status === 'pending').length;
  const accepted = annotations.filter((a) => a.status === 'accepted').length;
  const dismissed = annotations.filter((a) => a.status === 'dismissed').length;
  const total = annotations.length;

  if (total === 0) return null;

  const allResolved = pending === 0;
  const showNav = Boolean(onPrev && onNext);
  const showCollapse = Boolean(onToggleCollapse);

  return (
    <div className={styles.bar}>
      <div className={styles.stats}>
        {showCollapse && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onToggleCollapse}
            title={collapsed ? '展开批注列表' : '折叠批注列表'}
            aria-label={collapsed ? '展开批注列表' : '折叠批注列表'}
          >
            {collapsed ? (
              <ChevronUp size={12} strokeWidth={2} />
            ) : (
              <ChevronDown size={12} strokeWidth={2} />
            )}
          </button>
        )}
        {pending > 0 && (
          <Badge variant="warning" className={styles.badge}>
            {pending} 待处理
          </Badge>
        )}
        {accepted > 0 && (
          <Badge variant="success" className={styles.badge}>
            {accepted} 采纳
          </Badge>
        )}
        {dismissed > 0 && (
          <Badge variant="secondary" className={styles.badge}>
            {dismissed} 忽略
          </Badge>
        )}
        <span className={styles.sep}>/</span>
        <span className={styles.total}>{total} 条批注</span>
      </div>

      <div className={styles.actions}>
        {showNav && (
          <div className={styles.navGroup}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onPrev}
              disabled={navDisabled}
              title="上一条批注"
              aria-label="上一条批注"
            >
              <ChevronLeft size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onNext}
              disabled={navDisabled}
              title="下一条批注"
              aria-label="下一条批注"
            >
              <ChevronRight size={12} strokeWidth={2} />
            </button>
          </div>
        )}
        {!allResolved ? (
          <>
            <Button
              variant="destructive"
              size="xs"
              leftIcon={<X size={10} strokeWidth={2} />}
              onClick={onDismissAll}
              title="忽略所有待处理批注"
            >
              全部忽略
            </Button>
            <Button
              variant="primary"
              size="xs"
              leftIcon={<Check size={10} strokeWidth={2.5} />}
              onClick={onAcceptAll}
              title="采纳所有待处理批注"
            >
              全部采纳
            </Button>
          </>
        ) : (
          <span className={styles.resolvedHint}>已全部处理</span>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import type { Annotation } from '../../store/script';
import styles from './AnnotationList.module.css';

function AnnotationCard({
  annotation,
  index,
  selected,
  onAccept,
  onDismiss,
  onSelect,
  registerRef,
}: {
  annotation: Annotation;
  index: number;
  selected: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onSelect?: () => void;
  registerRef?: (el: HTMLDivElement | null) => void;
}) {
  const accepted = annotation.status === 'accepted';
  const dismissed = annotation.status === 'dismissed';
  const pending = annotation.status === 'pending';
  const hasSuggestion =
    annotation.suggestion && annotation.suggestion !== annotation.originalText;

  const cardClass = [
    styles.card,
    !pending ? styles.cardResolved : '',
    selected ? styles.cardActive : '',
    onSelect ? styles.cardClickable : '',
  ].filter(Boolean).join(' ');

  const stripeClass = [
    styles.severityStripe,
    accepted ? styles.severityStripeAccepted : '',
    dismissed ? styles.severityStripeDismissed : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={registerRef}
      className={cardClass}
      data-annotation-id={annotation.id}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      <div
        className={stripeClass}
        data-severity={annotation.severity}
      />
      <div className={styles.cardBody}>
        {/* 元信息行 */}
        <div className={styles.cardMeta}>
          <span className={styles.cardIndex}>#{index + 1}</span>
          <span
            className={`${styles.statusTag} ${
              accepted
                ? styles.statusAccepted
                : dismissed
                  ? styles.statusDismissed
                  : styles.statusPending
            }`}
          >
            {accepted ? '已采纳' : dismissed ? '已忽略' : '待处理'}
          </span>
        </div>

        {/* 问题描述 */}
        <div className={styles.issueText}>{annotation.issue}</div>

        {/* 原文引用 */}
        <div className={styles.quoteBlock}>
          <div className={styles.quoteBorder} />
          <div className={styles.quoteText}>{annotation.originalText}</div>
        </div>

        {/* 修改建议 */}
        {hasSuggestion && (
          <div className={styles.suggestion}>
            <div className={styles.suggestionBorder} />
            <div className={styles.suggestionText}>{annotation.suggestion}</div>
          </div>
        )}

        {/* 操作按钮 */}
        {pending && (
          <div className={styles.cardActions}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.btnDismiss}`}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
            >
              <X size={11} strokeWidth={2} />
              忽略
            </button>
            {hasSuggestion && (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.btnAccept}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept();
                }}
              >
                <Check size={11} strokeWidth={2.5} />
                采纳
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AnnotationList({
  annotations,
  selectedId,
  onAccept,
  onDismiss,
  onSelect,
}: {
  annotations: Annotation[];
  selectedId?: string | null;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onSelect?: (id: string) => void;
}) {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 选中卡片变化时自动滚动到视野内
  useEffect(() => {
    if (!selectedId) return;
    const el = cardRefs.current.get(selectedId);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedId]);

  if (!annotations.length) {
    return (
      <div className={styles.empty}>
        暂无批注
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {annotations.map((annotation, index) => (
        <AnnotationCard
          key={annotation.id}
          annotation={annotation}
          index={index}
          selected={selectedId === annotation.id}
          onAccept={() => onAccept(annotation.id)}
          onDismiss={() => onDismiss(annotation.id)}
          onSelect={onSelect ? () => onSelect(annotation.id) : undefined}
          registerRef={(el) => {
            if (el) cardRefs.current.set(annotation.id, el);
            else cardRefs.current.delete(annotation.id);
          }}
        />
      ))}
    </div>
  );
}

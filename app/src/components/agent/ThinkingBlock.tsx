import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import styles from './AgentTranscript.module.css';

export function ThinkingBlock({
  text,
  label = '思考过程',
  streaming = false,
  isLatest = false,
}: {
  text: string;
  label?: string;
  streaming?: boolean;
  /**
   * 是否为「最新」的思考过程：最新的默认展开实时查看；当更新的思考出现、
   * 本块不再是最新时自动折叠，避免历史推理内容堆叠占屏。
   */
  isLatest?: boolean;
}) {
  const [expanded, setExpanded] = useState(isLatest);
  const prevLatestRef = useRef(isLatest);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prevLatestRef.current !== isLatest) {
      setExpanded(isLatest);
      prevLatestRef.current = isLatest;
    }
  }, [isLatest]);

  useEffect(() => {
    if (!streaming || !expanded) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text, streaming, expanded]);

  const summary = streaming
    ? '持续中'
    : text.length > 0
      ? `${text.length.toLocaleString()} 字`
      : '等待输出';

  return (
    <div className={styles.event}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`${styles.eventHeader} ${styles.eventHeaderInteractive}`}
        aria-expanded={expanded}
      >
        <span className={styles.eventIcon}>
          <Brain size={14} strokeWidth={1.8} />
        </span>
        <span className={styles.eventLabel}>{label}</span>
        <span className={styles.eventStatus}>{summary}</span>
        <span className={styles.eventChevron} aria-hidden>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {expanded ? (
        <div ref={bodyRef} className={styles.thinkingBody}>
          {text || <span>等待模型输出推理...</span>}
          {streaming && text ? <span className={styles.thinkingCursor} /> : null}
        </div>
      ) : null}
    </div>
  );
}

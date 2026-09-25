import type { MediaCardContent } from '../../types/ai';
import styles from './MediaCardPreview.module.css';

interface Props {
  content: MediaCardContent;
  /** 实际可访问的本地预览 src（file:// 或 http(s):// 或 staticFile 解析后的路径） */
  previewSrc: string | null;
  percent?: number;
}

export function MediaCardPreview({ content, previewSrc, percent }: Props) {
  if (content.generationStatus === 'failed') {
    return (
      <div className={styles.errorBox} data-testid="media-card-preview">
        <div className={styles.errorTitle}>生成失败</div>
        <div className={styles.errorMsg}>{content.errorMessage ?? '请重试或检查 Provider'}</div>
      </div>
    );
  }

  if (content.generationStatus === 'generating' || content.generationStatus === 'pending') {
    return (
      <div className={styles.loading} data-testid="media-card-preview">
        <div className={styles.spinner} />
        <div className={styles.loadingLabel}>生成中… {Math.max(0, Math.min(100, percent ?? 0))}%</div>
      </div>
    );
  }

  if (content.generationStatus === 'cancelled') {
    return (
      <div className={styles.placeholder} data-testid="media-card-preview">
        已取消，点击「重新生成」
      </div>
    );
  }

  if (content.generationStatus !== 'ready' || !previewSrc) {
    return (
      <div className={styles.placeholder} data-testid="media-card-preview">
        未生成。填写 prompt 后点击「生成」
      </div>
    );
  }

  if (content.mediaType === 'image') {
    return <img className={styles.media} src={previewSrc} alt="" data-testid="media-card-preview" />;
  }

  return (
    <video
      className={styles.media}
      src={previewSrc}
      muted
      controls
      preload="metadata"
      data-testid="media-card-preview"
    />
  );
}

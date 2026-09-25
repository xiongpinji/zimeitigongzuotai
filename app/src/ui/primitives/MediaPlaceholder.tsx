import styles from './MediaPlaceholder.module.css';

export type MediaPlaceholderVariant = 'audio' | 'srt' | 'generic';

export interface MediaPlaceholderProps {
  variant: MediaPlaceholderVariant;
  label?: string;
}

export function MediaPlaceholder({
  label,
  variant,
}: MediaPlaceholderProps) {
  if (variant === 'audio') {
    return (
      <div className={[styles.root, styles.variantAudio].join(' ')}>
        <div className={styles.audioWavePrimary} />
        <div className={styles.audioWaveSecondary} />
        <div className={styles.audioLabel}>{label ?? 'AUDIO'}</div>
      </div>
    );
  }

  if (variant === 'srt') {
    return (
      <div className={[styles.root, styles.variantSrt].join(' ')}>
        <div className={styles.srtLine} style={{ width: '90%' }} />
        <div className={styles.srtLine} style={{ width: '78%' }} />
        <div className={[styles.srtLine, styles.srtLineAccent].join(' ')} style={{ width: '62%' }} />
        <div className={styles.srtLabel}>{label ?? 'SRT'}</div>
      </div>
    );
  }

  return (
    <div className={[styles.root, styles.variantGeneric].join(' ')}>
      {label ?? 'FILE'}
    </div>
  );
}

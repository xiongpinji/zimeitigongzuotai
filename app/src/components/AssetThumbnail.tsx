import { useEffect, useRef, useState } from 'react';
import type { AssetItem } from '../types';
import { toFileSrc } from '../lib/utils';
import { MediaPlaceholder } from '../ui';
import styles from './AssetThumbnail.module.css';

interface AssetThumbnailProps {
  asset: AssetItem;
}

export function AssetThumbnail({ asset }: AssetThumbnailProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasError, setHasError] = useState(false);
  const assetSrc = toFileSrc(asset.path);
  const isMediaPreview = asset.type === 'image' || asset.type === 'video';

  useEffect(() => {
    if (asset.type !== 'video') {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    const seekToPreviewFrame = () => {
      try {
        video.currentTime = 0.05;
      } catch {
        video.pause();
      }
    };

    const pauseOnSeeked = () => {
      video.pause();
    };

    video.addEventListener('loadeddata', seekToPreviewFrame);
    video.addEventListener('seeked', pauseOnSeeked);

    if (video.readyState >= 2) {
      seekToPreviewFrame();
    }

    return () => {
      video.removeEventListener('loadeddata', seekToPreviewFrame);
      video.removeEventListener('seeked', pauseOnSeeked);
    };
  }, [asset.type, assetSrc]);

  if (!isMediaPreview || hasError) {
    const label = asset.type === 'audio' ? 'MP3' : asset.type === 'srt' ? 'SRT' : asset.type.toUpperCase();

    if (asset.type === 'audio') {
      return <MediaPlaceholder variant="audio" label="AUDIO" />;
    }

    if (asset.type === 'srt') {
      return <MediaPlaceholder variant="srt" label="SRT" />;
    }

    return <MediaPlaceholder variant="generic" label={label} />;
  }

  if (asset.type === 'image') {
    return (
      <img
        src={assetSrc}
        alt={asset.name}
        draggable={false}
        onError={() => setHasError(true)}
        className={[styles.media, styles.image].join(' ')}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      src={assetSrc}
      muted
      playsInline
      preload="metadata"
      draggable={false}
      onError={() => setHasError(true)}
      className={styles.media}
    />
  );
}

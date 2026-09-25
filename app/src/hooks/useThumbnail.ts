import { useEffect, useState } from 'react';
import type { AssetType } from '../types';
import { toFileSrc } from '../lib/utils';

function extractVideoFrame(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    video.addEventListener('loadeddata', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
      cleanup();
    });

    video.addEventListener('error', () => {
      cleanup();
      resolve(null);
    });

    video.src = toFileSrc(filePath);
  });
}

/**
 * 为图片/视频素材生成缩略图 URL。
 * - image：直接返回 file:// URL
 * - video：截取首帧返回 data URL
 * - audio/srt：返回 null
 */
export function useThumbnail(filePath: string, type: AssetType): string | null {
  const [thumbnail, setThumbnail] = useState<string | null>(
    type === 'image' ? toFileSrc(filePath) : null,
  );

  useEffect(() => {
    if (type !== 'video') return;

    let cancelled = false;
    extractVideoFrame(filePath).then((url) => {
      if (!cancelled && url) {
        setThumbnail(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, type]);

  return thumbnail;
}

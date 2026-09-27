import { AbsoluteFill, OffthreadVideo, Video } from 'remotion';
import type { OverlayItem } from '../../types';
import { resolveAssetSrc } from '../asset-src';
import { useIsRendering } from '../use-is-rendering';

export function VideoOverlay({ overlay, zIndex, fps }: { overlay: OverlayItem; zIndex: number; fps: number }) {
  const isRendering = useIsRendering();
  const V = isRendering ? OffthreadVideo : Video;
  const sourceStartFrame = Math.round(((overlay.videoData?.trimStartMs ?? 0) / 1000) * fps);
  return (
    <AbsoluteFill
      style={{
        left: overlay.position.x,
        top: overlay.position.y,
        width: overlay.position.width,
        height: overlay.position.height,
        zIndex,
        overflow: 'hidden',
      }}
    >
      <V src={resolveAssetSrc(overlay.assetPath)} startFrom={sourceStartFrame} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}

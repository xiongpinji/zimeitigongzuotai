import { AbsoluteFill, OffthreadVideo, Video } from 'remotion';
import type { OverlayItem } from '../../types';
import { resolveAssetSrc } from '../asset-src';
import { useIsRendering } from '../use-is-rendering';

export function VideoOverlay({ overlay, zIndex }: { overlay: OverlayItem; zIndex: number }) {
  const isRendering = useIsRendering();
  const V = isRendering ? OffthreadVideo : Video;
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
      <V src={resolveAssetSrc(overlay.assetPath)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}

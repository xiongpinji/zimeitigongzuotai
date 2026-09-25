import { AbsoluteFill, Img } from 'remotion';
import type { OverlayItem } from '../../types';
import { resolveAssetSrc } from '../asset-src';

export function ImageOverlay({ overlay, zIndex }: { overlay: OverlayItem; zIndex: number }) {
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
      <Img src={resolveAssetSrc(overlay.assetPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}

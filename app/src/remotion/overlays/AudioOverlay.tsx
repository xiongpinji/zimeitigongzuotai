import { Audio } from 'remotion';
import type { RenderableAudio } from '../timeline-to-sequences';
import { resolveAssetSrc } from '../asset-src';

export function AudioOverlay({ clip, fps }: { clip: RenderableAudio; fps: number }) {
  return (
    <Audio
      src={resolveAssetSrc(clip.assetPath)}
      volume={clip.volume}
      startFrom={Math.round((clip.trimStartMs / 1000) * fps)}
    />
  );
}

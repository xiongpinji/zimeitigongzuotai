import { Composition } from 'remotion';
import { createDefaultTimeline } from '../types';
import { MainComposition, type MainCompositionProps } from './MainComposition';
import { buildRenderPlan } from './timeline-to-sequences';

const DEFAULT_PROPS: MainCompositionProps = {
  timeline: createDefaultTimeline(),
  srtEntries: [],
};

export function RemotionRoot() {
  return (
    <Composition
      id="lingji-composition"
      component={MainComposition}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={({ props }) => {
        const plan = buildRenderPlan(props.timeline, props.srtEntries, props.timeline.fps ?? 30);
        return {
          durationInFrames: plan.durationFrames,
          fps: plan.fps,
          width: plan.width,
          height: plan.height,
        };
      }}
    />
  );
}

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubtitleLayer } from '../src/remotion/overlays/SubtitleLayer';
import { createDefaultTimeline } from '../src/types';

describe('SubtitleLayer in the standalone render page', () => {
  it('sets its own sans-serif font instead of inheriting a browser default', () => {
    const html = renderToStaticMarkup(
      <SubtitleLayer
        cue={{ index: 0, text: 'SUBTITLE_A7Q2', startFrame: 15, durationFrames: 50 }}
        style={createDefaultTimeline().subtitle}
        highlights={[]}
      />,
    );

    expect(html).toMatch(/<span style="[^"]*font-family:[^"]*sans-serif/);
  });
});

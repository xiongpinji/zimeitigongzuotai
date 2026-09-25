import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimelineSubtitleBlocks } from '../src/components/TimelineSubtitleBlocks';

describe('TimelineSubtitleBlocks', () => {
  it('renders visible subtitle blocks for non-empty entries', () => {
    const html = renderToStaticMarkup(
      <TimelineSubtitleBlocks
        entries={[
          { index: 1, startMs: 0, endMs: 2000, text: '第一句 文案' },
          { index: 2, startMs: 2200, endMs: 4000, text: '第二句字幕' },
        ]}
        durationMs={10_000}
        pxPerMs={0.1}
        trackHeight={38}
      />,
    );

    expect(html).toContain('data-subtitle-entry="subtitle-1"');
    expect(html).toContain('第一句 文案');
    expect(html).toContain('第二句字幕');
  });
});

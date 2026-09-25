import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { toFileSrc } from '../src/lib/utils';
import { AssetPanel } from '../src/components/AssetPanel';

vi.mock('../src/store/timeline', () => ({
  useTimelineStore: () => ({
    assets: [
      {
        path: '/tmp/podcast.mp3',
        type: 'audio',
        name: 'podcast.mp3',
        durationMs: 12_000,
        locked: true,
      },
      {
        path: '/tmp/subtitles.srt',
        type: 'srt',
        name: 'subtitles.srt',
        durationMs: 12_000,
        locked: true,
      },
      {
        path: '/tmp/cover #1.png',
        type: 'image',
        name: 'cover #1.png',
        durationMs: 5_000,
      },
      {
        path: '/tmp/intro.mp4',
        type: 'video',
        name: 'intro.mp4',
        durationMs: 8_000,
      },
    ],
    timeline: {
      podcast: {
        audioPath: '/tmp/podcast.mp3',
        srtPath: '/tmp/subtitles.srt',
        durationMs: 12_000,
      },
      overlays: [],
    },
    addAsset: () => undefined,
    removeAsset: () => undefined,
  }),
}));

describe('AssetPanel', () => {
  it('renders the design-aligned asset library search, filters and cards', () => {
    const html = renderToStaticMarkup(<AssetPanel compact={false} />);

    expect(html).toContain(`<img`);
    expect(html).toContain(`src="${toFileSrc('/tmp/cover #1.png')}"`);
    expect(html).not.toContain(`<video`);
    expect(html).toContain('placeholder="搜索素材…"');
    expect(html).toContain('全部');
    expect(html).toContain('视频');
    expect(html).toContain('音频');
    expect(html).toContain('podcast.mp3');
    expect(html).toContain('subtitles.srt');
    expect(html).toContain('cover #1.png');
    expect(html).toContain('intro.mp4');
    expect(html).toContain('导入');
    expect((html.match(/data-asset-context-menu="image-background"/g) ?? []).length).toBe(1);
  });

  it('renders dedicated timeline attach actions for audio and srt assets', () => {
    const html = renderToStaticMarkup(<AssetPanel compact={false} />);

    expect(html).toContain('设为音频轨');
    expect(html).toContain('设为字幕轨');
  });

  it('renders podcast resource section with replace actions', () => {
    const html = renderToStaticMarkup(<AssetPanel compact={false} />);

    expect(html).toContain('口播资源');
    expect(html).toContain('podcast.mp3');
    expect(html).toContain('subtitles.srt');
    expect(html).toContain('替换音频');
    expect(html).toContain('替换字幕');
  });

  it('keeps podcast resource section visible in compact mode', () => {
    const html = renderToStaticMarkup(<AssetPanel compact />);

    expect(html).toContain('口播资源');
  });
});

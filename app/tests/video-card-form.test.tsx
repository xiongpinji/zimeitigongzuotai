// tests/video-card-form.test.tsx
//
// 静态 SSR（renderToStaticMarkup）结构断言，与 image-card-form.test.tsx 保持一致。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VideoCardForm } from '../src/components/media-card/VideoCardForm';
import type { AICard, MediaCardContent } from '../src/types/ai';

function makeCard(
  status: MediaCardContent['generationStatus'] = 'idle',
  overrides?: Partial<AICard>,
): AICard {
  const base: AICard = {
    id: 'c1',
    segmentId: 's1',
    type: 'video',
    title: 'demo',
    content: {
      mediaType: 'video',
      assetPath: status === 'ready' ? 'ai-cards/c1/video.mp4' : null,
      posterPath: status === 'ready' ? 'ai-cards/c1/poster.jpg' : null,
      mediaDurationMs: status === 'ready' ? 6000 : undefined,
      aspectRatio: '16:9',
      prompt: 'a cat running',
      providerId: 'v1',
      model: 'vidu-2',
      generationStatus: status,
    },
    startMs: 0,
    endMs: 6000,
    displayDurationMs: 6000,
    displayMode: 'fullscreen',
    template: 'video-default',
    enabled: true,
    style: { primaryColor: '#fff', backgroundColor: '#000', fontSize: 48 },
  };
  return { ...base, ...overrides };
}

describe('VideoCardForm', () => {
  it('idle 显示主按钮 生成 + 时长档位', () => {
    const html = renderToStaticMarkup(
      <VideoCardForm
        card={makeCard('idle')}
        previewSrc={null}
        videoProviders={[
          { id: 'v1', name: 'v1', models: ['vidu-2'], durationOptions: [4, 6, 8] },
        ]}
        durationSeconds={6}
        onDurationSecondsChange={() => {}}
        onGenerate={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toMatch(/生成/);
    expect(html).toMatch(/4s|4 s|4秒|4 秒/);
  });

  it('ready 显示重新生成 + displayDurationMs readonly', () => {
    const html = renderToStaticMarkup(
      <VideoCardForm
        card={makeCard('ready')}
        previewSrc="file:///fake.mp4"
        videoProviders={[
          { id: 'v1', name: 'v1', models: ['vidu-2'], durationOptions: [4, 6, 8] },
        ]}
        durationSeconds={6}
        onDurationSecondsChange={() => {}}
        onGenerate={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toMatch(/重新生成/);
    expect(html).toMatch(/6000/);
    expect(html).toMatch(/readonly|disabled/);
  });

  it('aspectRatio 只列出 16:9 / 9:16 / 1:1', () => {
    const html = renderToStaticMarkup(
      <VideoCardForm
        card={makeCard('idle')}
        previewSrc={null}
        videoProviders={[
          { id: 'v1', name: 'v1', models: ['vidu-2'], durationOptions: [4, 6, 8] },
        ]}
        durationSeconds={6}
        onDurationSecondsChange={() => {}}
        onGenerate={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toMatch(/16:9/);
    expect(html).toMatch(/9:16/);
    expect(html).toMatch(/1:1/);
    expect(html).not.toMatch(/4:3/);
    expect(html).not.toMatch(/3:4/);
  });
});

// tests/image-card-form.test.tsx
//
// 注意：项目测试环境为 vitest node + 静态 SSR（renderToStaticMarkup），
// 未引入 @testing-library/react / jsdom。本文件遵循 media-card-preview.test.tsx
// 的范式做结构断言。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageCardForm } from '../src/components/media-card/ImageCardForm';
import type { AICard, MediaCardContent } from '../src/types/ai';

function makeCard(status: MediaCardContent['generationStatus'] = 'idle'): AICard {
  return {
    id: 'c1',
    segmentId: 's1',
    type: 'image',
    title: 'demo',
    content: {
      mediaType: 'image',
      assetPath: status === 'ready' ? 'ai-cards/c1/image.png' : null,
      aspectRatio: '16:9',
      prompt: 'a cat',
      providerId: 'p1',
      model: 'm1',
      generationStatus: status,
    },
    startMs: 0,
    endMs: 5000,
    displayDurationMs: 5000,
    displayMode: 'fullscreen',
    template: 'image-default',
    enabled: true,
    style: { primaryColor: '#fff', backgroundColor: '#000', fontSize: 48 },
  };
}

describe('ImageCardForm', () => {
  it('idle 渲染主按钮文案为 生成', () => {
    const html = renderToStaticMarkup(
      <ImageCardForm
        card={makeCard('idle')}
        previewSrc={null}
        imageProviders={[{ id: 'p1', name: 'p1', models: ['m1'] }]}
        onGenerate={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toMatch(/生成/);
    expect(html).not.toMatch(/重新生成/);
  });

  it('ready 渲染主按钮文案为 重新生成', () => {
    const html = renderToStaticMarkup(
      <ImageCardForm
        card={makeCard('ready')}
        previewSrc="file:///fake.png"
        imageProviders={[{ id: 'p1', name: 'p1', models: ['m1'] }]}
        onGenerate={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toMatch(/重新生成/);
  });

  it('generating 主按钮变成 取消', () => {
    const html = renderToStaticMarkup(
      <ImageCardForm
        card={makeCard('generating')}
        previewSrc={null}
        percent={50}
        imageProviders={[{ id: 'p1', name: 'p1', models: ['m1'] }]}
        onGenerate={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toMatch(/取消/);
    expect(html).toMatch(/50%/);
  });

  it('content.prompt 显示在 textarea 中', () => {
    const html = renderToStaticMarkup(
      <ImageCardForm
        card={makeCard('idle')}
        previewSrc={null}
        imageProviders={[{ id: 'p1', name: 'p1', models: ['m1'] }]}
        onGenerate={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toMatch(/a cat/);
  });
});

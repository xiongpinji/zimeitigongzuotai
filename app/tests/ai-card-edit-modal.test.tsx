import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AICardEditModal } from '../src/components/AICardEditModal';

describe('AICardEditModal', () => {
  const baseStyle = {
    primaryColor: '#6366f1',
    backgroundColor: '#0f172a',
    fontSize: 48,
  } as const;

  it('renders editing fields and motion-card status for the selected ai card', () => {
    const html = renderToStaticMarkup(
      <AICardEditModal
        visible
        card={{
          id: 'card-1',
          segmentId: 'segment-1',
          type: 'summary',
          title: '本期要点',
          content: '重点内容',
          startMs: 0,
          endMs: 45_000,
          displayDurationMs: 5_000,
          displayMode: 'fullscreen',
          template: 'summary-default',
          enabled: true,
          renderMode: 'motion-card',
          motionCard: {
            tsx: 'export default function Card(){ return null; }',
            compiledAt: 1_715_000_000_000,
            prompt: 'demo',
            retryCount: 0,
          },
          style: baseStyle,
        }}
        isRegenerating={false}
        previewWidth={1080}
        previewHeight={1920}
        onClose={() => undefined}
        onRegenerate={async () => null}
        onSave={() => undefined}
      />,
    );

    expect(html).toContain('编辑卡片');
    expect(html).toContain('文字内容');
    expect(html).toContain('展示设置');
    expect(html).toContain('Motion 卡片状态');
    expect(html).toContain('Motion 卡片已就绪');
    expect(html).toContain('危险操作');
    expect(html).toContain('重新生成');
    expect(html).toContain('data-ai-card-preview-frame="true"');
    expect(html).toContain('删除此卡片');
  });

  it('shows the regenerating affordance while the card is being regenerated', () => {
    const html = renderToStaticMarkup(
      <AICardEditModal
        visible
        card={{
          id: 'card-1',
          segmentId: 'segment-1',
          type: 'summary',
          title: '本期要点',
          content: '重点内容',
          startMs: 0,
          endMs: 45_000,
          displayDurationMs: 5_000,
          displayMode: 'pip',
          template: 'summary-default',
          enabled: true,
          style: baseStyle,
        }}
        isRegenerating
        previewWidth={1920}
        previewHeight={1080}
        onClose={() => undefined}
        onRegenerate={async () => null}
        onSave={() => undefined}
      />,
    );

    expect(html).toContain('重生成中...');
  });
});

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AICoverPanel } from '../src/components/AICoverPanel';

describe('AICoverPanel', () => {
  it('renders prompts and generated cover candidates', () => {
    const html = renderToStaticMarkup(
      <AICoverPanel
        coverPrompts={['一张科技感播客封面', '第二条不应显示']}
        candidates={[
          {
            id: 'cover-1',
            prompt: '一张科技感播客封面',
            imageUrl: '/tmp/cover-1.png',
            selected: true,
          },
        ]}
        isGenerating={false}
        isRegeneratingPrompt={false}
        selectedCandidateId="cover-1"
        onGenerateCovers={() => undefined}
        onRegeneratePrompt={() => undefined}
        onSelectCover={() => undefined}
        onAddToTimeline={() => undefined}
      />,
    );

    expect(html).toContain('data-ai-cover-root="true"');
    expect(html).toContain('data-ai-cover-prompt="true"');
    expect(html).toContain('提示词');
    expect(html).toContain('一张科技感播客封面');
    expect(html).not.toContain('第二条不应显示');
    expect(html).toContain('AI 重新生成提示词');
    expect(html).toContain('候选封面');
    expect(html).toContain('可直接拖到时间轴，也可以一键设为整期背景。');
    expect(html).toContain('data-ai-cover-grid="true"');
    expect(html).toContain('data-ai-cover-selected="true"');
    expect(html).toContain('设为整期背景');
    expect(html).toContain('draggable="true"');
  });
});

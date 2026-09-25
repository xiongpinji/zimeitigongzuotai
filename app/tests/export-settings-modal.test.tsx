import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportSettingsModal } from '../src/components/ExportSettingsModal';

describe('ExportSettingsModal', () => {
  it('renders the export dialog with the design-aligned header, summary badges and footer actions', () => {
    const html = renderToStaticMarkup(
      <ExportSettingsModal
        visible
        timelineWidth={1920}
        timelineHeight={1080}
        onClose={() => undefined}
        onConfirm={async () => undefined}
      />,
    );

    expect(html).toContain('EXPORT');
    expect(html).toContain('导出设置');
    expect(html).toContain('还未选择导出位置');
    expect(html).toContain('选择位置');
    expect(html).toContain('720p');
    expect(html).toContain('平衡');
    expect(html).toContain('1280 × 720');
    expect(html).toContain('3 Mbps');
    expect(html).toContain('128 kbps');
    expect(html).toContain('x264 veryfast');
    expect(html).toMatch(/<button[^>]*bg-transparent[^>]*>取消<\/button>/);
    expect(html).toContain('开始导出');
  });
});

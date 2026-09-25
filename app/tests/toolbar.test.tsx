import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Toolbar } from '../src/components/Toolbar';

describe('Toolbar', () => {
  it('renders a desktop titlebar shell for setup', () => {
    const html = renderToStaticMarkup(
      <Toolbar
        compact={false}
        page="setup"
        projectName=""
        saveStatus="idle"
        canUndo={false}
        canRedo={false}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain('欢迎页');
    expect(html).toContain('未打开工程');
    expect(html).not.toContain('aria-label="导出"');
    expect(html).not.toContain('aria-label="撤销"');
    expect(html).not.toContain('aria-label="重做"');
    expect(html).not.toContain('播客视频编辑器');
  });

  it('renders a centered project chip without helper copy in editor mode', () => {
    const html = renderToStaticMarkup(
      <Toolbar
        compact
        page="editor"
        projectName=""
        saveStatus="idle"
        canUndo={false}
        canRedo={false}
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain('未命名工程');
    expect(html).toContain('未打开工程');
    expect(html).toContain('aria-label="撤销"');
    expect(html).toContain('aria-label="重做"');
    expect(html).not.toContain('拖入素材');
    expect(html).not.toContain('编辑中');
  });

  it('renders save state metadata and exposes enabled history actions in editor mode', () => {
    const html = renderToStaticMarkup(
      <Toolbar
        compact={false}
        page="editor"
        projectName="demo-project"
        saveStatus="saved"
        canUndo
        canRedo
        onCommand={() => undefined}
      />,
    );

    expect(html).toContain('demo-project');
    expect(html).toContain('已保存');
    expect(html).toContain('data-command="undo"');
    expect(html).toContain('data-command="redo"');
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('aria-label="导出"');
    expect(html).not.toContain('播客视频编辑器');
    expect(html).not.toContain('编辑中');
    expect(html).not.toContain('拖入素材');
    expect(html).not.toContain('>项目<');
    expect(html).not.toContain('>编辑<');
    expect(html).not.toContain('>媒体<');
  });
});

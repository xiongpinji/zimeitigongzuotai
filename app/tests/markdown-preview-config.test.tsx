import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MDEditor from '@uiw/react-md-editor';
import { buildSafeMarkdownPreviewOptions } from '../src/ui/lib/markdown-preview';

function getPreviewHtml(html: string): string {
  const [, previewSection = ''] = html.split('<div class="w-md-editor-preview ">');
  return previewSection.split('</div></div><div class="w-md-editor-bar">')[0] ?? '';
}

describe('markdown preview safety', () => {
  it('blocks raw style tags from report content in the live preview', () => {
    const html = renderToStaticMarkup(
      <MDEditor
        value={'<style>body{display:none}</style>\n\n# 报告标题'}
        previewOptions={buildSafeMarkdownPreviewOptions()}
      />,
    );
    const previewHtml = getPreviewHtml(html);

    expect(previewHtml).not.toContain('<style>');
    expect(previewHtml).toContain('报告标题');
  });

  it('removes inline style attributes from raw html blocks in report content', () => {
    const html = renderToStaticMarkup(
      <MDEditor
        value={'<p style="position:fixed;inset:0;background:#fff">报告正文</p>'}
        previewOptions={buildSafeMarkdownPreviewOptions()}
      />,
    );
    const previewHtml = getPreviewHtml(html);

    expect(previewHtml).not.toContain('position:fixed');
    expect(previewHtml).toContain('报告正文');
  });
});

import { describe, it, expect } from 'vitest';
import { buildExportFilename, buildMarkdownDataUrl } from '@/background/export/markdown-export-service';

describe('buildExportFilename', () => {
  it('uses a single sanitized title for one video', () => {
    expect(buildExportFilename(['标题/标题'], 1, Date.UTC(2026, 5, 19))).toBe(
      '灵机采风/导出/20260619_标题标题.md',
    );
  });

  it('uses a batch name for multiple videos', () => {
    expect(buildExportFilename(['a', 'b'], 2, Date.UTC(2026, 5, 19))).toBe(
      '灵机采风/导出/20260619_批量导出_2条.md',
    );
  });

  it('falls back when there are no titles', () => {
    expect(buildExportFilename([], 0, Date.UTC(2026, 5, 19))).toBe('灵机采风/导出/20260619_导出.md');
  });
});

describe('buildMarkdownDataUrl', () => {
  it('encodes markdown as a utf-8 data url', () => {
    const url = buildMarkdownDataUrl('# 标题\n内容');
    expect(url.startsWith('data:text/markdown;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1])).toBe('# 标题\n内容');
  });
});

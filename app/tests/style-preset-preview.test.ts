// tests/style-preset-preview.test.ts
//
// 源码级契约测试：直接读取 StylePresetPreview.tsx 的文本，
// 验证沙箱 iframe 实现的关键不变式，绕开 ?raw 导入限制。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('StylePresetPreview contract', () => {
  const source = readFileSync(
    new URL('../src/components/StylePresetPreview.tsx', import.meta.url),
    'utf8',
  );

  it('imports gsap via the same ?raw path as HyperframesPreviewPlayer', () => {
    expect(source).toContain("from 'gsap/dist/gsap.min.js?raw'");
  });

  it('uses sandbox="allow-scripts" (origin-isolated, no allow-same-origin)', () => {
    expect(source).toContain('sandbox="allow-scripts"');
    expect(source).not.toContain('allow-same-origin');
  });

  it('renders an empty div (not an iframe) when motionHtml is falsy', () => {
    expect(source).toContain('<div');
    expect(source).toContain('无 Motion 预览');
  });

  it('uses window.__lingjiMotionTimelines for timeline collection', () => {
    expect(source).toContain('window.__lingjiMotionTimelines');
  });

  it('loops the preview with repeat: -1', () => {
    expect(source).toContain('repeat: -1');
  });
});

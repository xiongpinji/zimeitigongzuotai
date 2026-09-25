import { describe, expect, it } from 'vitest';
import {
  createDefaultTextData,
  TEXT_TEMPLATES,
  getTextTemplateAssets,
} from '../src/lib/text-templates';

describe('text-templates', () => {
  describe('createDefaultTextData', () => {
    it('returns a TextOverlayData with default values', () => {
      const data = createDefaultTextData();
      expect(data.content).toBe('请输入文字');
      expect(data.fontFamily).toBe('PingFang SC');
      expect(data.fontSize).toBe(64);
      expect(data.fontColor).toBe('#FFFFFF');
      expect(data.bold).toBe(false);
      expect(data.italic).toBe(false);
      expect(data.underline).toBe(false);
      expect(data.textAlign).toBe('center');
      expect(data.backgroundColor).toBe('transparent');
      expect(data.strokeColor).toBe('#000000');
      expect(data.strokeWidth).toBe(0);
      expect(data.shadowColor).toBe('#000000');
      expect(data.shadowOffsetX).toBe(0);
      expect(data.shadowOffsetY).toBe(2);
      expect(data.shadowBlur).toBe(0);
      expect(data.letterSpacing).toBe(0);
      expect(data.lineHeight).toBe(1.5);
      expect(data.opacity).toBe(1);
      expect(data.rotation).toBe(0);
      expect(data.animation).toEqual({
        enter: 'fadeIn',
        enterDurationMs: 500,
        exit: 'fadeOut',
        exitDurationMs: 500,
        loop: 'none',
      });
    });

    it('merges overrides into defaults', () => {
      const data = createDefaultTextData({ fontSize: 80, bold: true, content: '大标题' });
      expect(data.fontSize).toBe(80);
      expect(data.bold).toBe(true);
      expect(data.content).toBe('大标题');
      expect(data.fontColor).toBe('#FFFFFF');
    });
  });

  describe('TEXT_TEMPLATES', () => {
    it('has 5 templates', () => {
      expect(TEXT_TEMPLATES).toHaveLength(5);
    });

    it('each template has id, name, and textData', () => {
      for (const template of TEXT_TEMPLATES) {
        expect(template.id).toMatch(/^text-template:/);
        expect(template.name).toBeTruthy();
        expect(template.textData.content).toBeTruthy();
      }
    });

    it('heading template has fontSize 80 and bold', () => {
      const heading = TEXT_TEMPLATES.find((t) => t.id === 'text-template:heading')!;
      expect(heading.textData.fontSize).toBe(80);
      expect(heading.textData.bold).toBe(true);
    });

    it('caption template has dark background', () => {
      const caption = TEXT_TEMPLATES.find((t) => t.id === 'text-template:caption')!;
      expect(caption.textData.backgroundColor).toBe('rgba(0,0,0,0.6)');
    });

    it('fancy template has red stroke', () => {
      const fancy = TEXT_TEMPLATES.find((t) => t.id === 'text-template:fancy')!;
      expect(fancy.textData.strokeColor).toBe('#EF4444');
      expect(fancy.textData.strokeWidth).toBe(2);
    });
  });

  describe('getTextTemplateAssets', () => {
    it('returns AssetItem[] for all templates', () => {
      const assets = getTextTemplateAssets();
      expect(assets).toHaveLength(5);
      for (const asset of assets) {
        expect(asset.type).toBe('text');
        expect(asset.durationMs).toBe(5000);
        expect(asset.path).toMatch(/^text-template:/);
      }
    });
  });
});

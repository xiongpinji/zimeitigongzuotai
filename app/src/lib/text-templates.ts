import type { AssetItem, TextOverlayData } from '../types';

export function createDefaultTextData(
  overrides?: Partial<TextOverlayData>,
): TextOverlayData {
  return {
    content: '请输入文字',
    fontFamily: 'PingFang SC',
    fontSize: 64,
    fontColor: '#FFFFFF',
    bold: false,
    italic: false,
    underline: false,
    textAlign: 'center',
    backgroundColor: 'transparent',
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowColor: '#000000',
    shadowOffsetX: 0,
    shadowOffsetY: 2,
    shadowBlur: 0,
    letterSpacing: 0,
    lineHeight: 1.5,
    opacity: 1,
    rotation: 0,
    animation: {
      enter: 'fadeIn',
      enterDurationMs: 500,
      exit: 'fadeOut',
      exitDurationMs: 500,
      loop: 'none',
    },
    ...overrides,
  };
}

export interface TextTemplate {
  id: string;
  name: string;
  textData: TextOverlayData;
}

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: 'text-template:heading',
    name: '大标题',
    textData: createDefaultTextData({ fontSize: 80, bold: true, content: '大标题' }),
  },
  {
    id: 'text-template:subheading',
    name: '小标题',
    textData: createDefaultTextData({ fontSize: 56, bold: true, content: '小标题' }),
  },
  {
    id: 'text-template:body',
    name: '正文文字',
    textData: createDefaultTextData({
      fontSize: 40,
      fontColor: '#E0E0E0',
      textAlign: 'left',
      content: '正文文字',
    }),
  },
  {
    id: 'text-template:caption',
    name: '字幕条',
    textData: createDefaultTextData({
      fontSize: 36,
      backgroundColor: 'rgba(0,0,0,0.6)',
      content: '字幕条',
    }),
  },
  {
    id: 'text-template:fancy',
    name: '花字效果',
    textData: createDefaultTextData({
      fontSize: 64,
      bold: true,
      strokeColor: '#EF4444',
      strokeWidth: 2,
      content: '花字效果',
    }),
  },
];

export function getTextTemplateAssets(): AssetItem[] {
  return TEXT_TEMPLATES.map((template) => ({
    path: template.id,
    type: 'text' as const,
    name: template.name,
    durationMs: 5000,
  }));
}

export function getTextTemplateById(id: string): TextTemplate | undefined {
  return TEXT_TEMPLATES.find((template) => template.id === id);
}

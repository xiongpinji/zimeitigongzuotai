import type { AICardType } from '../types/ai';
import type { AppIconName } from '../components/AppIcon';

export type ManualCardKind = 'motion' | 'image' | 'video';
export type ManualCardContentType = Extract<
  AICardType,
  'summary' | 'data' | 'insight' | 'chapter' | 'quote'
>;

export const MANUAL_CARD_KIND_OPTIONS: Array<{
  kind: ManualCardKind;
  label: string;
  icon: AppIconName;
}> = [
  { kind: 'motion', label: 'Motion 卡', icon: 'sparkles' },
  { kind: 'image', label: '图片卡', icon: 'image' },
  { kind: 'video', label: '视频卡', icon: 'film' },
];

export const MANUAL_CARD_CONTENT_TYPE_OPTIONS: Array<{
  value: ManualCardContentType;
  label: string;
}> = [
  { value: 'summary', label: '摘要' },
  { value: 'insight', label: '观点 / 洞察' },
  { value: 'quote', label: '金句' },
  { value: 'data', label: '数据' },
  { value: 'chapter', label: '章节' },
];

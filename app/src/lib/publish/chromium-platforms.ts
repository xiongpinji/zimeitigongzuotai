import type { PublishPlatform } from '../electron-api';

/** 需要 Chromium 自动化的发布平台（B 站走 biliup，不在此列）。 */
export const CHROMIUM_PLATFORMS = new Set<PublishPlatform>([
  'douyin',
  'tencent',
  'xiaohongshu',
  'kuaishou',
]);

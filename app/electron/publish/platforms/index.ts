import type { PlatformModule, PublishPlatform } from '../types';
import { bilibili } from './bilibili';
import { douyin } from './douyin';
import { kuaishou } from './kuaishou';
import { tencent } from './tencent';
import { xiaohongshu } from './xiaohongshu';

export const PLATFORMS: Partial<Record<PublishPlatform, PlatformModule>> = {
  bilibili,
  douyin,
  kuaishou,
  tencent,
  xiaohongshu,
};

export function getPlatform(p: PublishPlatform): PlatformModule {
  const mod = PLATFORMS[p];
  if (!mod) throw new Error(`平台未实现: ${p}`);
  return mod;
}

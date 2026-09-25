import type { PublishPlatform } from './types';

export function buildAccountId(platform: PublishPlatform, accountName: string): string {
  return `${platform}_${accountName}`;
}

export function parseAccountId(id: string): { platform: PublishPlatform; accountName: string } {
  const idx = id.indexOf('_');
  return {
    platform: id.slice(0, idx) as PublishPlatform,
    accountName: id.slice(idx + 1),
  };
}

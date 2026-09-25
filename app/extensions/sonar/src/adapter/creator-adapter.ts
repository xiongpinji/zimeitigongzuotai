/**
 * 抖音 author 对象 → 稳定 Creator 模型。容忍 snake_case / camelCase。
 */
import type { Creator } from '@/domain/models';
import { asNumber, asString, firstUrl, isRecord, pick } from './field';

export function adaptCreator(author: unknown, now: number = Date.now()): Creator | null {
  if (!isRecord(author)) return null;
  const id = asString(pick(author, ['uid', 'id']));
  const secUid = asString(pick(author, ['sec_uid', 'secUid']));
  const nickname = asString(pick(author, ['nickname']));
  if (!id || !secUid || nickname === undefined) return null;

  const avatarUrl = firstUrl(pick(author, ['avatar_thumb', 'avatarThumb', 'avatar_larger', 'avatarLarger']));
  const signature = asString(pick(author, ['signature']));
  const followerCount = asNumber(pick(author, ['follower_count', 'followerCount']));
  const videoCount = asNumber(pick(author, ['aweme_count', 'awemeCount']));

  return {
    id,
    secUid,
    nickname,
    profileUrl: `https://www.douyin.com/user/${secUid}`,
    updatedAt: now,
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    ...(signature !== undefined ? { signature } : {}),
    ...(followerCount !== undefined ? { followerCount } : {}),
    ...(videoCount !== undefined ? { videoCount } : {}),
  };
}

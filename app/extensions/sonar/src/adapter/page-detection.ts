/**
 * 页面类型识别（设计文档第 8 节第 1 步）。
 *
 * 仅依据 URL 结构判定，不读取页面 DOM 或认证数据。捕获缓存中的 awemeId 由调用方
 * 在 detectCurrentPage 流程里补充；此处给出基于 URL 的结构性判断。
 */
import type { PageDetectionResult } from '@/domain/models';

const AWEME_ID_RE = /^\d+$/;
const SHARE_HOSTS = new Set(['v.douyin.com']);
const MAIN_HOSTS = new Set(['www.douyin.com']);

export function detectPageFromUrl(url: string): PageDetectionResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { type: 'unsupported', url };
  }

  if (SHARE_HOSTS.has(parsed.hostname)) {
    return { type: 'share_link', url };
  }

  if (!MAIN_HOSTS.has(parsed.hostname)) {
    return { type: 'unsupported', url };
  }

  // 作品弹层优先：modal_id 可叠加在博主页 / 发现页之上。
  const modalId = parsed.searchParams.get('modal_id');
  if (modalId && AWEME_ID_RE.test(modalId)) {
    return { type: 'video_modal', url, awemeId: modalId };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  // 视频作品与图文/动态作品（/note/、/slides/）都按作品页处理。
  if (
    (segments[0] === 'video' || segments[0] === 'note' || segments[0] === 'slides') &&
    segments[1] &&
    AWEME_ID_RE.test(segments[1])
  ) {
    return { type: 'video', url, awemeId: segments[1] };
  }
  if (segments[0] === 'user' && segments[1]) {
    return { type: 'creator', url, secUid: segments[1] };
  }

  return { type: 'unsupported', url };
}

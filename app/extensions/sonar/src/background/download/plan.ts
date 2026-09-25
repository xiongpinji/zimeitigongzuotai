/**
 * 下载计划：从领域对象推导安全文件名与下载 URL（纯逻辑，可单测）。
 *
 * 扩展名优先取已判定的 source.mimeType；否则从 URL 路径嗅探已知容器后缀；都没有时兜底 mp4。
 * 真实下载时 chrome 还会按已验证的 Content-Type 落盘，这里只给出建议文件名。
 */
import type { DownloadRequest } from '../services';
import type { VideoSource } from '@/domain/models';
import { buildDownloadFilename, extensionFromMime } from '@/resolver/filename';

const KNOWN_URL_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v']);

export function extensionFromSource(source: VideoSource): string {
  if (source.mimeType) return extensionFromMime(source.mimeType);
  try {
    const { pathname } = new URL(source.url);
    const dot = pathname.lastIndexOf('.');
    if (dot >= 0) {
      const ext = pathname.slice(dot + 1).toLowerCase();
      if (KNOWN_URL_EXT.has(ext)) return ext;
    }
  } catch {
    /* ignore malformed url */
  }
  return 'mp4';
}

export interface DownloadPlan {
  url: string;
  filename: string;
}

export function planDownload(req: DownloadRequest): DownloadPlan {
  const ext = extensionFromSource(req.source);
  const filename = buildDownloadFilename({
    creatorNickname: req.creator?.nickname ?? '未知博主',
    title: req.video.description,
    awemeId: req.video.id,
    ext,
    publishedAt: req.video.publishedAt,
  });
  return { url: req.source.url, filename };
}

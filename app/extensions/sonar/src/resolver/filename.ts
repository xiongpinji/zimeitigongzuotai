/**
 * 文件名清理与下载路径构造（设计文档第 8 节第 7 步）。
 *
 * 默认下载到：灵机剪影/抖音/{博主昵称}/{日期}_{标题}_{awemeId}.{媒体扩展名}
 * 文件名需移除操作系统不支持字符、控制字符与尾部空格/点，并设置合理长度上限。
 * 媒体扩展名由已验证的 Content-Type / 容器 / 最终 URL 决定（此处提供 MIME 映射兜底）。
 */

const ILLEGAL_CHARS_RE = /[/\\:*?"<>|]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;
const WHITESPACE_RUN_RE = /\s+/g;
const TRAILING_DOTS_SPACES_RE = /[.\s]+$/;
const DEFAULT_SEGMENT_MAX = 80;
const PLACEHOLDER = '未命名';

export function sanitizeSegment(input: string, options: { maxLength?: number } = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_SEGMENT_MAX;
  let out = input
    .replace(CONTROL_CHARS_RE, '')
    .replace(ILLEGAL_CHARS_RE, '')
    .replace(WHITESPACE_RUN_RE, ' ')
    .trim()
    .replace(TRAILING_DOTS_SPACES_RE, '');
  if (out.length > maxLength) out = out.slice(0, maxLength).trim();
  if (out.length === 0) return PLACEHOLDER;
  return out;
}

/** 把毫秒时间戳格式化为 UTC 的 YYYYMMDD（确定性，便于跨时区一致）。 */
export function formatDateUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${day}`;
}

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  // 图文/动态作品的静态图
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
};

/** 由 MIME 推断扩展名；未知或缺失兜底为 mp4。 */
export function extensionFromMime(mime: string | undefined): string {
  if (mime) {
    const normalized = mime.split(';')[0].trim().toLowerCase();
    if (MIME_EXT[normalized]) return MIME_EXT[normalized];
  }
  return 'mp4';
}

function normalizeExt(ext: string): string {
  return ext.replace(/^\.+/, '').trim().toLowerCase() || 'mp4';
}

export interface DownloadFilenameInput {
  creatorNickname: string;
  title: string;
  awemeId: string;
  ext: string;
  publishedAt: number;
}

/** 构造默认下载相对路径。各段单独清理；标题为空时使用占位符。 */
export function buildDownloadFilename(input: DownloadFilenameInput): string {
  const nickname = sanitizeSegment(input.creatorNickname);
  const title = sanitizeSegment(input.title);
  const date = formatDateUTC(input.publishedAt);
  const awemeId = sanitizeSegment(input.awemeId, { maxLength: 40 });
  const ext = normalizeExt(input.ext);
  return `灵机剪影/抖音/${nickname}/${date}_${title}_${awemeId}.${ext}`;
}

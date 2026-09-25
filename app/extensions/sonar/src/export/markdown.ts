/**
 * Markdown 导出（设计文档 5.10）。
 *
 * 按固定模板把视频元数据、指标、摘要、关键点、标签与字幕渲染为 Markdown；
 * 对标题/正文做控制字符清理与长度限制。纯逻辑，可单测。
 */
import type { Creator, TranscriptDocument, Video, VideoAnalysis } from '@/domain/models';

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const TITLE_MAX = 120;
const SUMMARY_MAX = 4000;

function sanitize(text: string, max = SUMMARY_MAX): string {
  const out = text.replace(CONTROL_RE, '').replace(/[ \t]+/g, ' ').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function formatDisplayDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function sanitizeTag(tag: string): string {
  return tag.replace(CONTROL_RE, '').replace(/[#\s]+/g, '').trim();
}

export interface VideoMarkdownInput {
  video: Video;
  creator?: Creator | null;
  analysis?: VideoAnalysis | null;
  transcript?: TranscriptDocument | null;
}

function statisticsLine(video: Video): string | null {
  const s = video.statistics;
  if (!s) return null;
  const parts: string[] = [];
  if (s.likeCount !== undefined) parts.push(`点赞 ${s.likeCount}`);
  if (s.commentCount !== undefined) parts.push(`评论 ${s.commentCount}`);
  if (s.collectCount !== undefined) parts.push(`收藏 ${s.collectCount}`);
  if (s.shareCount !== undefined) parts.push(`分享 ${s.shareCount}`);
  return parts.length > 0 ? `- 互动：${parts.join(' · ')}` : null;
}

export function buildVideoMarkdown(input: VideoMarkdownInput): string {
  const { video, creator, analysis, transcript } = input;
  const title = sanitize(video.description, TITLE_MAX) || '未命名作品';
  const lines: string[] = [`# ${title}`, ''];

  if (creator) lines.push(`- 博主：${sanitize(creator.nickname, TITLE_MAX)}`);
  lines.push(`- 发布时间：${formatDisplayDate(video.publishedAt)}`);
  lines.push(`- 原视频：${video.sourcePageUrl}`);
  const stats = statisticsLine(video);
  if (stats) lines.push(stats);
  lines.push('');

  if (analysis) {
    lines.push('## 内容分类', analysis.category, '');
    lines.push('## 摘要', sanitize(analysis.summary), '');
    if (analysis.keyPoints.length > 0) {
      lines.push('## 关键要点');
      for (const p of analysis.keyPoints) lines.push(`- ${sanitize(p, TITLE_MAX)}`);
      lines.push('');
    }
    if (analysis.tags.length > 0) {
      const tags = analysis.tags.map(sanitizeTag).filter(Boolean).map((t) => `#${t}`);
      if (tags.length > 0) lines.push('## 标签', tags.join(' '), '');
    }
    lines.push(`> 由 ${analysis.model} 生成`, '');
  }

  if (transcript) {
    lines.push('## 字幕', '', transcript.fullText, '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function buildBatchMarkdown(items: VideoMarkdownInput[]): string {
  return items.map(buildVideoMarkdown).join('\n\n---\n\n');
}

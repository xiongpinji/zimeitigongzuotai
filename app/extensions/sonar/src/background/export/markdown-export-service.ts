/**
 * Markdown 导出服务（设计文档 5.10）。
 *
 * 从 Repository 汇集视频/博主/摘要/字幕，渲染为 Markdown，经 data URL + chrome.downloads
 * 保存到「灵机采风/导出/」。Service Worker 无 DOM，故用 data URL 而非 Blob URL。
 */
import type { ExportTask, MarkdownExportInput } from '@/domain/api-types';
import type { ExportService } from '../services';
import type { Repository } from '../repository';
import { SonarException, makeError } from '@/domain/errors';
import { buildBatchMarkdown, type VideoMarkdownInput } from '@/export/markdown';
import { sanitizeSegment, formatDateUTC } from '@/resolver/filename';

export function buildExportFilename(titles: string[], count: number, dateMs: number): string {
  const date = formatDateUTC(dateMs);
  if (count === 0) return `灵机采风/导出/${date}_导出.md`;
  if (count === 1) return `灵机采风/导出/${date}_${sanitizeSegment(titles[0] || '导出')}.md`;
  return `灵机采风/导出/${date}_批量导出_${count}条.md`;
}

export function buildMarkdownDataUrl(markdown: string): string {
  return `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;
}

export interface ExportDeps {
  repo: Repository;
  now: () => number;
  newId: () => string;
}

export function createMarkdownExportService(deps: ExportDeps): ExportService {
  return {
    async exportMarkdown(input: MarkdownExportInput): Promise<ExportTask> {
      const id = deps.newId();
      if (input.videoIds.length === 0) {
        throw new SonarException(makeError('EXPORT_FAILED', '没有要导出的视频'));
      }
      const items: VideoMarkdownInput[] = [];
      const titles: string[] = [];
      for (const videoId of input.videoIds) {
        const video = await deps.repo.getVideo(videoId);
        if (!video) continue;
        titles.push(video.description);
        items.push({
          video,
          creator: await deps.repo.getCreator(video.creatorId),
          analysis: await deps.repo.getAnalysis(videoId),
          transcript: await deps.repo.getTranscript(videoId),
        });
      }
      if (items.length === 0) {
        throw new SonarException(makeError('EXPORT_FAILED', '未找到要导出的视频数据'));
      }

      const markdown = buildBatchMarkdown(items);
      const filename = buildExportFilename(titles, items.length, deps.now());
      try {
        await chrome.downloads.download({
          url: buildMarkdownDataUrl(markdown),
          filename,
          conflictAction: 'uniquify',
          saveAs: false,
        });
      } catch (e) {
        throw new SonarException(
          makeError('EXPORT_FAILED', '保存 Markdown 失败', {
            detail: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      return { id, status: 'completed', filename };
    },
  };
}

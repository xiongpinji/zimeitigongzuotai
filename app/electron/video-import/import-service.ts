import type {
  VideoImportProgress,
  VideoImportRequest,
  VideoImportResult,
  VideoImportStatus,
} from '../../src/lib/video-import-types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { transcribeWithBcut } from './bcut-asr';
import { douyinDownloader } from './douyin-downloader';
import { convertAudioToMp3, extractAudioToMp3 } from './media-extractor';
import {
  buildDouyinImportPaths,
  buildVideoImportPaths,
  writePreviewMetadata,
  syncTranscriptToOriginal,
  writeImportResult,
  writeSourceMetadata,
  writeTranscriptMarkdown,
} from './transcript-writer';
import type {
  DouyinImportPaths,
  TranscriptResult,
  VideoImportAsrRunner,
  VideoImportService,
  VideoImportServiceOptions,
  VideoImportTaskSnapshot,
} from './types';

const defaultAsrRunner: VideoImportAsrRunner = {
  transcribe: transcribeWithBcut,
};

function slugifyLocalMediaId(filePath: string): string {
  const parsed = filePath.replace(/\\/g, '/').split('/').pop() ?? 'media';
  const stem = parsed.replace(/\.[^.]+$/, '') || 'media';
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'media';
}

function getLocalMediaTitle(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? '本地媒体';
}

function getInitialStepLabel(sourceType: VideoImportRequest['sourceType']): string {
  if (sourceType === 'douyin') return '准备导入抖音视频';
  if (sourceType === 'local_video') return '准备导入本地视频';
  return '准备导入本地音频';
}

interface PreparedImportSource {
  paths: DouyinImportPaths;
  title: string;
  videoId: string;
  sourceUrl?: string;
  resolvedPageUrl?: string;
  sourcePath?: string;
  coverUrl?: string;
}

class DefaultVideoImportService implements VideoImportService {
  private readonly tasks = new Map<string, VideoImportTaskSnapshot>();

  private readonly progressListeners = new Set<(snapshot: VideoImportTaskSnapshot) => void>();

  private readonly downloader;

  private readonly mediaExtractor;

  private readonly asrRunner;

  private readonly now;

  constructor(options: VideoImportServiceOptions = {}) {
    this.downloader = options.downloader ?? douyinDownloader;
    this.mediaExtractor = options.mediaExtractor ?? { extractAudioToMp3, convertAudioToMp3 };
    this.asrRunner = options.asrRunner ?? defaultAsrRunner;
    this.now = options.now ?? (() => new Date());
  }

  getImportStatus(importId: string): VideoImportTaskSnapshot | null {
    return this.tasks.get(importId) ?? null;
  }

  onProgress(callback: (snapshot: VideoImportTaskSnapshot) => void): () => void {
    this.progressListeners.add(callback);
    return () => {
      this.progressListeners.delete(callback);
    };
  }

  private emitProgress(snapshot: VideoImportTaskSnapshot): void {
    for (const listener of this.progressListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[video-import] progress listener error', error);
      }
    }
  }

  startImport(request: VideoImportRequest): VideoImportProgress {
    const importId = this.beginTask(request);
    void this.executeImport(importId, request).catch(() => undefined);
    const snapshot = this.tasks.get(importId);
    if (!snapshot) {
      throw new Error('导入任务初始化失败');
    }
    return snapshot;
  }

  async importVideoSource(request: VideoImportRequest): Promise<VideoImportResult> {
    const importId = this.beginTask(request);
    return this.executeImport(importId, request);
  }

  private beginTask(request: VideoImportRequest): string {
    const importId = `${request.sourceType}_${Date.now()}`;
    const startedAt = this.now().toISOString();
    const snapshot: VideoImportTaskSnapshot = {
      importId,
      sourceType: request.sourceType,
      status: 'downloading',
      progress: 0,
      stepLabel: getInitialStepLabel(request.sourceType),
      request,
      startedAt,
    };
    this.tasks.set(importId, snapshot);
    this.emitProgress(snapshot);
    return importId;
  }

  private updateTask(
    importId: string,
    status: VideoImportStatus,
    progress: number,
    stepLabel: string,
    extras: Partial<VideoImportTaskSnapshot> = {},
  ): void {
    const current = this.tasks.get(importId);
    if (!current) {
      return;
    }

    const next: VideoImportTaskSnapshot = {
      ...current,
      status,
      progress,
      stepLabel,
      ...extras,
    };
    this.tasks.set(importId, next);
    this.emitProgress(next);
  }

  private async executeImport(
    importId: string,
    request: VideoImportRequest,
  ): Promise<VideoImportResult> {
    const startedAt = this.tasks.get(importId)?.startedAt ?? this.now().toISOString();

    try {
      const resolved = await this.prepareSource(importId, request, startedAt);
      const { paths, title, videoId, sourceUrl, resolvedPageUrl, sourcePath, coverUrl } = resolved;

      this.updateTask(importId, 'transcribing', 70, '正在进行 bcut 转录');
      const transcript = await this.asrRunner.transcribe(paths.audioPath);
      await writeTranscriptMarkdown(paths, transcript.fullText, transcript.srtText);

      const shouldSync = request.syncToOriginal !== false;
      if (shouldSync) {
        this.updateTask(importId, 'syncing', 90, '正在同步 original.md');
        await syncTranscriptToOriginal(paths);
      }

      const result: VideoImportResult = {
        importId,
        sourceType: request.sourceType,
        videoId,
        title,
        projectDir: request.projectDir,
        importDir: paths.importDir,
        videoPath: paths.videoPath,
        audioPath: paths.audioPath,
        transcriptPath: paths.transcriptPath,
        transcriptSrtPath: paths.transcriptSrtPath,
        originalPath: paths.originalPath,
        sourceMetadataPath: paths.sourceMetadataPath,
        resultMetadataPath: paths.resultMetadataPath,
        previewMetadataPath: paths.previewMetadataPath,
        sourceUrl,
        resolvedPageUrl,
        sourcePath,
        coverUrl,
        engine: transcript.engine,
        syncedToOriginal: shouldSync,
        createdAt: startedAt,
      };

      await writeImportResult(paths, result);
      await writePreviewMetadata(paths, {
        schema: 'video-import-preview',
        version: 1,
        sourceType: request.sourceType,
        title,
        videoId,
        createdAt: startedAt,
        syncedToOriginal: shouldSync,
        engine: transcript.engine,
        projectDir: request.projectDir,
        importDir: paths.importDir,
        media: {
          videoPath: paths.videoPath,
          audioPath: paths.audioPath,
          coverUrl,
        },
        transcript: {
          markdownPath: paths.transcriptPath,
          srtPath: paths.transcriptSrtPath,
          text: transcript.fullText,
          srtText: transcript.srtText,
          segments: transcript.segments,
        },
        metadata: {
          sourceUrl,
          resolvedPageUrl,
          sourcePath,
          originalPath: paths.originalPath,
          sourceMetadataPath: paths.sourceMetadataPath,
          resultMetadataPath: paths.resultMetadataPath,
        },
      });
      this.updateTask(importId, 'done', 100, '导入完成', {
        result,
        finishedAt: this.now().toISOString(),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateTask(importId, 'error', 100, '导入失败', {
        error: message,
        finishedAt: this.now().toISOString(),
      });
      throw error;
    }
  }

  private async prepareSource(
    importId: string,
    request: VideoImportRequest,
    startedAt: string,
  ): Promise<PreparedImportSource> {
    if (request.sourceType === 'douyin') {
      if (!request.url.trim()) {
        throw new Error('请提供抖音分享链接');
      }
      this.updateTask(importId, 'downloading', 5, '正在解析抖音链接');
      const source = await this.downloader.resolveSource(request.url);
      const paths = buildDouyinImportPaths(request.projectDir, source.videoId);

      await writeSourceMetadata(paths, {
        sourceType: 'douyin',
        sourceUrl: request.url,
        importedAt: startedAt,
        ...source,
      });

      this.updateTask(importId, 'downloading', 20, '正在下载抖音视频');
      await this.downloader.downloadToPath(source.downloadUrl, paths.videoPath);

      this.updateTask(importId, 'extracting_audio', 45, '正在提取音频');
      await this.mediaExtractor.extractAudioToMp3(paths.videoPath, paths.audioPath);

      return {
        paths,
        title: source.title,
        videoId: source.videoId,
        sourceUrl: request.url,
        resolvedPageUrl: source.resolvedPageUrl,
        coverUrl: source.coverUrl,
      };
    }

    if (!request.filePath.trim()) {
      throw new Error('请提供本地媒体文件路径');
    }

    const videoId = `${slugifyLocalMediaId(request.filePath)}-${Date.now()}`;
    const title = getLocalMediaTitle(request.filePath);
    const paths = buildVideoImportPaths(request.projectDir, request.sourceType, videoId);

    await writeSourceMetadata(paths, {
      sourceType: request.sourceType,
      sourcePath: request.filePath,
      title,
      videoId,
      importedAt: startedAt,
    });

    if (request.sourceType === 'local_video') {
      this.updateTask(importId, 'downloading', 20, '正在复制本地视频');
      await this.copyLocalMedia(request.filePath, paths.videoPath);

      this.updateTask(importId, 'extracting_audio', 45, '正在提取音频');
      await this.mediaExtractor.extractAudioToMp3(paths.videoPath, paths.audioPath);
    } else {
      this.updateTask(importId, 'extracting_audio', 45, '正在转换音频');
      const convert = this.mediaExtractor.convertAudioToMp3 ?? convertAudioToMp3;
      await convert(request.filePath, paths.audioPath);
    }

    return {
      paths,
      title,
      videoId,
      sourcePath: request.filePath,
    };
  }

  private async copyLocalMedia(sourcePath: string, targetPath: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

export function createVideoImportService(
  options: VideoImportServiceOptions = {},
): VideoImportService {
  return new DefaultVideoImportService(options);
}

const sharedVideoImportService = createVideoImportService();

export function getVideoImportService(): VideoImportService {
  return sharedVideoImportService;
}

import type {
  VideoImportProgress,
  VideoImportPreviewDocument,
  VideoImportRequest,
  VideoImportResult,
  TranscriptSegment,
} from '../../src/lib/video-import-types';

export interface DouyinImportPaths {
  importDir: string;
  videoPath: string;
  audioPath: string;
  transcriptPath: string;
  transcriptSrtPath: string;
  sourceMetadataPath: string;
  resultMetadataPath: string;
  previewMetadataPath: string;
  originalPath: string;
}

export type VideoImportPaths = DouyinImportPaths;

export interface DouyinSourceResolution {
  videoId: string;
  title: string;
  resolvedPageUrl: string;
  downloadUrl: string;
  coverUrl?: string;
}

export interface DouyinSourceMetadata extends DouyinSourceResolution {
  sourceType: 'douyin';
  sourceUrl: string;
  importedAt: string;
}

export interface LocalMediaSourceMetadata {
  sourceType: 'local_video' | 'local_audio';
  sourcePath: string;
  title: string;
  videoId: string;
  importedAt: string;
}

export interface TranscriptResult {
  engine: 'bcut';
  fullText: string;
  srtText: string;
  segments: TranscriptSegment[];
}

export type { VideoImportPreviewDocument };

export interface VideoImportTaskSnapshot extends VideoImportProgress {
  request: VideoImportRequest;
  startedAt: string;
  finishedAt?: string;
}

export interface VideoImportDownloader {
  resolveSource: (url: string) => Promise<DouyinSourceResolution>;
  downloadToPath: (url: string, targetPath: string) => Promise<void>;
}

export interface VideoImportMediaExtractor {
  extractAudioToMp3: (videoPath: string, audioPath: string) => Promise<string>;
  convertAudioToMp3?: (sourceAudioPath: string, audioPath: string) => Promise<string>;
}

export interface VideoImportAsrRunner {
  transcribe: (audioPath: string) => Promise<TranscriptResult>;
}

export interface VideoImportServiceOptions {
  downloader?: VideoImportDownloader;
  mediaExtractor?: VideoImportMediaExtractor;
  asrRunner?: VideoImportAsrRunner;
  now?: () => Date;
}

export interface VideoImportService {
  importVideoSource: (request: VideoImportRequest) => Promise<VideoImportResult>;
  startImport: (request: VideoImportRequest) => VideoImportProgress;
  getImportStatus: (importId: string) => VideoImportTaskSnapshot | null;
  onProgress: (callback: (snapshot: VideoImportTaskSnapshot) => void) => () => void;
}

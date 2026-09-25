import { describe, expect, it } from 'vitest';
import {
  VIDEO_IMPORT_SOURCE_TYPES,
  VIDEO_IMPORT_STATUSES,
  type VideoImportProgress,
  type VideoImportPreviewDocument,
  type VideoImportResult,
} from '../src/lib/video-import-types';

describe('video import types', () => {
  it('supports remote and local media source types', () => {
    expect(VIDEO_IMPORT_SOURCE_TYPES).toEqual(['douyin', 'local_video', 'local_audio']);
  });

  it('defines the expected video import lifecycle states', () => {
    expect(VIDEO_IMPORT_STATUSES).toEqual([
      'downloading',
      'extracting_audio',
      'transcribing',
      'syncing',
      'done',
      'error',
    ]);
  });

  it('keeps the expected result fields for downstream consumers', () => {
    const result: VideoImportResult = {
      importId: 'douyin_123',
      sourceType: 'douyin',
      videoId: '123',
      title: '测试标题',
      projectDir: '/tmp/demo',
      importDir: '/tmp/demo/imports/douyin/123',
      videoPath: '/tmp/demo/imports/douyin/123/video.mp4',
      audioPath: '/tmp/demo/imports/douyin/123/audio.mp3',
      transcriptPath: '/tmp/demo/imports/douyin/123/transcript.md',
      transcriptSrtPath: '/tmp/demo/imports/douyin/123/transcript.srt',
      originalPath: '/tmp/demo/original.md',
      sourceMetadataPath: '/tmp/demo/imports/douyin/123/source.json',
      resultMetadataPath: '/tmp/demo/imports/douyin/123/import-result.json',
      previewMetadataPath: '/tmp/demo/imports/douyin/123/preview.json',
      sourceUrl: 'https://v.douyin.com/demo',
      resolvedPageUrl: 'https://www.douyin.com/video/123',
      engine: 'bcut',
      syncedToOriginal: true,
      createdAt: '2026-04-10T00:00:00.000Z',
    };

    expect(result.videoPath.endsWith('video.mp4')).toBe(true);
    expect(result.transcriptPath.endsWith('transcript.md')).toBe(true);
    expect(result.originalPath.endsWith('original.md')).toBe(true);
  });

  it('allows local audio import results to carry a source path', () => {
    const result: VideoImportResult = {
      importId: 'local_audio_123',
      sourceType: 'local_audio',
      videoId: 'voice-123',
      title: 'voice.mp3',
      projectDir: '/tmp/demo',
      importDir: '/tmp/demo/imports/local_audio/voice-123',
      videoPath: '/tmp/demo/imports/local_audio/voice-123/video.mp4',
      audioPath: '/tmp/demo/imports/local_audio/voice-123/audio.mp3',
      transcriptPath: '/tmp/demo/imports/local_audio/voice-123/transcript.md',
      transcriptSrtPath: '/tmp/demo/imports/local_audio/voice-123/transcript.srt',
      originalPath: '/tmp/demo/original.md',
      sourceMetadataPath: '/tmp/demo/imports/local_audio/voice-123/source.json',
      resultMetadataPath: '/tmp/demo/imports/local_audio/voice-123/import-result.json',
      previewMetadataPath: '/tmp/demo/imports/local_audio/voice-123/preview.json',
      sourcePath: '/Users/demo/voice.mp3',
      engine: 'bcut',
      syncedToOriginal: true,
      createdAt: '2026-04-10T00:00:00.000Z',
    };

    expect(result.sourceType).toBe('local_audio');
    expect(result.sourcePath).toContain('voice.mp3');
    expect(result.sourceUrl).toBeUndefined();
  });

  it('defines a standard preview document shape for custom rendering', () => {
    const preview: VideoImportPreviewDocument = {
      schema: 'video-import-preview',
      version: 1,
      sourceType: 'douyin',
      title: '测试标题',
      videoId: '123',
      createdAt: '2026-04-10T00:00:00.000Z',
      syncedToOriginal: true,
      engine: 'bcut',
      projectDir: '/tmp/demo',
      importDir: '/tmp/demo/imports/douyin/123',
      media: {
        videoPath: '/tmp/demo/imports/douyin/123/video.mp4',
        audioPath: '/tmp/demo/imports/douyin/123/audio.mp3',
      },
      transcript: {
        markdownPath: '/tmp/demo/imports/douyin/123/transcript.md',
        srtPath: '/tmp/demo/imports/douyin/123/transcript.srt',
        text: '第一段\n\n第二段',
        srtText: '1\n00:00:00,000 --> 00:00:01,000\n第一段\n',
        segments: [
          { text: '第一段', startMs: 0, endMs: 1000 },
          { text: '第二段', startMs: 1000, endMs: 2000 },
        ],
      },
      metadata: {
        sourceUrl: 'https://v.douyin.com/demo',
        resolvedPageUrl: 'https://www.douyin.com/video/123',
        originalPath: '/tmp/demo/original.md',
        sourceMetadataPath: '/tmp/demo/imports/douyin/123/source.json',
        resultMetadataPath: '/tmp/demo/imports/douyin/123/import-result.json',
      },
    };

    expect(preview.schema).toBe('video-import-preview');
    expect(preview.transcript.segments).toHaveLength(2);
  });

  it('allows progress payloads to surface the current step label', () => {
    const progress: VideoImportProgress = {
      importId: 'douyin_123',
      sourceType: 'douyin',
      status: 'transcribing',
      progress: 68,
      stepLabel: '正在进行 bcut 转录',
    };

    expect(progress.status).toBe('transcribing');
    expect(progress.stepLabel).toContain('bcut');
  });
});

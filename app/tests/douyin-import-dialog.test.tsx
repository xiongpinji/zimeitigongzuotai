import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DouyinImportDialog } from '../src/components/script/DouyinImportDialog';

describe('DouyinImportDialog', () => {
  it('renders imported video summary and preview entry when a result is available', () => {
    const html = renderToStaticMarkup(
      <DouyinImportDialog
        open
        busy={false}
        progress={null}
        errorMessage={null}
        onOpenChange={() => undefined}
        onSubmit={async () => undefined}
        onOpenPreview={() => undefined}
        lastResult={{
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
        }}
      />,
    );

    expect(html).toContain('最近一次导入');
    expect(html).toContain('video');
    expect(html).toContain('打开预览');
    expect(html).toContain('preview.json');
    expect(html).toContain('立即关闭');
    expect(html).not.toContain('取消');
  });

  it('renders local audio results with an audio preview', () => {
    const html = renderToStaticMarkup(
      <DouyinImportDialog
        open
        busy={false}
        progress={null}
        errorMessage={null}
        onOpenChange={() => undefined}
        onSubmit={async () => undefined}
        onOpenPreview={() => undefined}
        lastResult={{
          importId: 'local_audio_123',
          sourceType: 'local_audio',
          videoId: 'voice-123',
          title: 'voice.wav',
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
          sourcePath: '/Users/demo/voice.wav',
          engine: 'bcut',
          syncedToOriginal: true,
          createdAt: '2026-04-10T00:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('<audio');
    expect(html).toContain('voice.wav');
    expect(html).not.toContain('<video');
  });
});

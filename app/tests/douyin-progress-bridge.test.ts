import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoImportService } from '../electron/video-import/import-service';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-progress-bridge-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('VideoImportService.onProgress', () => {
  it('emits progress snapshot when task updates', async () => {
    const service = createVideoImportService({
      downloader: {
        resolveSource: vi.fn().mockResolvedValue({
          videoId: 'v1',
          title: 't',
          downloadUrl: 'url',
          resolvedPageUrl: 'url',
          coverUrl: '',
        }),
        downloadToPath: vi.fn().mockResolvedValue(undefined),
      },
      mediaExtractor: { extractAudioToMp3: vi.fn().mockResolvedValue(undefined) },
      asrRunner: {
        transcribe: vi.fn().mockResolvedValue({
          fullText: '',
          srtText: '',
          segments: [],
          engine: 'bcut',
        }),
      },
    });
    const seen: string[] = [];
    const off = service.onProgress((snapshot) => seen.push(snapshot.status));
    await service.importVideoSource({
      sourceType: 'douyin',
      url: 'https://v.douyin.com/x',
      projectDir: tmpDir,
      syncToOriginal: false,
    });
    off();
    expect(seen).toContain('downloading');
    expect(seen).toContain('done');
  });
});

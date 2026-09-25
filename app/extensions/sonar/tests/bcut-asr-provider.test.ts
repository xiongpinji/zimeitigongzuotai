import { describe, it, expect, vi } from 'vitest';
import {
  bcutUtterancesToSegments,
  createBcutAsrProvider,
} from '@/processing/bcut-asr-provider';
import { SonarException } from '@/domain/errors';

describe('bcutUtterancesToSegments', () => {
  it('trims, drops empties and sorts by start time', () => {
    const segs = bcutUtterancesToSegments([
      { transcript: ' 第二句 ', start_time: 1000, end_time: 2000 },
      { transcript: '', start_time: 0, end_time: 500 },
      { transcript: '第一句', start_time: 0, end_time: 900 },
    ]);
    expect(segs).toEqual([
      { text: '第一句', startMs: 0, endMs: 900 },
      { text: '第二句', startMs: 1000, endMs: 2000 },
    ]);
  });
});

function okJson(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: { get: (k: string) => headers[k] ?? null },
  } as unknown as Response;
}

describe('createBcutAsrProvider', () => {
  it('runs the full upload→task→poll flow and maps the result', async () => {
    const fetchImpl = vi
      .fn()
      // 1. resource/create
      .mockResolvedValueOnce(
        okJson({
          data: {
            in_boss_key: 'boss',
            resource_id: 'res',
            upload_id: 'up',
            upload_urls: ['https://boss.hdslb.com/part0'],
            per_size: 1024,
          },
        }),
      )
      // 2. PUT chunk → exposes Etag
      .mockResolvedValueOnce(okJson({}, { Etag: 'etag-0' }))
      // 3. resource/create/complete
      .mockResolvedValueOnce(okJson({ data: { download_url: 'https://dl' } }))
      // 4. task
      .mockResolvedValueOnce(okJson({ data: { task_id: 'task-1' } }))
      // 5. task/result (done)
      .mockResolvedValueOnce(
        okJson({
          data: {
            state: 4,
            result: JSON.stringify({
              utterances: [{ transcript: '你好', start_time: 0, end_time: 1000 }],
            }),
          },
        }),
      );

    const provider = createBcutAsrProvider({ fetchImpl, now: () => 42 });
    const doc = await provider.transcribe(new Blob(['x'], { type: 'audio/wav' }), { videoId: 'v1' });

    expect(doc.provider).toBe('bcut');
    expect(doc.language).toBe('zh');
    expect(doc.videoId).toBe('v1');
    expect(doc.fullText).toBe('你好');
    expect(doc.segments).toEqual([{ text: '你好', startMs: 0, endMs: 1000 }]);
    expect(doc.srtText).toContain('00:00:00,000 --> 00:00:01,000');
    expect(doc.createdAt).toBe(42);

    const initBody = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(initBody).toMatchObject({ name: 'audio.wav', size: 1, ResourceFileType: 'wav', model_id: '8' });
    expect(fetchImpl.mock.calls[1][0]).toBe('https://boss.hdslb.com/part0');
  });

  it('upgrades bcut pre-signed upload URLs to HTTPS', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson({
        data: {
          in_boss_key: 'boss', resource_id: 'res', upload_id: 'up',
          upload_urls: ['http://jssz-boss.biliapi.net/part0'], per_size: 1024,
        },
      }))
      .mockResolvedValueOnce(okJson({}, { Etag: 'etag-0' }))
      .mockResolvedValueOnce(okJson({ data: { download_url: 'https://dl' } }))
      .mockResolvedValueOnce(okJson({ data: { task_id: 'task-1' } }))
      .mockResolvedValueOnce(okJson({
        data: {
          state: 4,
          result: '{"utterances":[{"transcript":"测试","start_time":0,"end_time":500}]}',
        },
      }));

    const provider = createBcutAsrProvider({ fetchImpl });
    await provider.transcribe(new Blob(['x'], { type: 'audio/wav' }), { videoId: 'v1' });

    expect(fetchImpl.mock.calls[1][0]).toBe('https://jssz-boss.biliapi.net/part0');
  });

  it('throws ASR_FAILED when polling never completes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          data: {
            in_boss_key: 'b',
            resource_id: 'r',
            upload_id: 'u',
            upload_urls: ['https://boss/part0'],
            per_size: 1024,
          },
        }),
      )
      .mockResolvedValueOnce(okJson({}, { Etag: 'e0' }))
      .mockResolvedValueOnce(okJson({ data: { download_url: 'https://dl' } }))
      .mockResolvedValueOnce(okJson({ data: { task_id: 't' } }))
      .mockResolvedValue(okJson({ data: { state: 1 } }));

    const provider = createBcutAsrProvider({ fetchImpl, sleep: async () => {}, pollLimit: 3 });
    await expect(provider.transcribe(new Blob(['x']), { videoId: 'v1' })).rejects.toMatchObject({
      error: { code: 'ASR_FAILED' },
    });
  });

  it('fails immediately when bcut marks the task as failed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson({
        data: {
          in_boss_key: 'b', resource_id: 'r', upload_id: 'u',
          upload_urls: ['https://boss/part0'], per_size: 1024,
        },
      }))
      .mockResolvedValueOnce(okJson({}, { Etag: 'e0' }))
      .mockResolvedValueOnce(okJson({ data: { download_url: 'https://dl' } }))
      .mockResolvedValueOnce(okJson({ data: { task_id: 't' } }))
      .mockResolvedValueOnce(okJson({ data: { state: 3 } }));
    const provider = createBcutAsrProvider({ fetchImpl, sleep: async () => {} });

    await expect(provider.transcribe(new Blob(['x']), { videoId: 'v1' })).rejects.toMatchObject({
      error: { code: 'ASR_FAILED', message: 'Bcut 转录任务失败' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('rejects a completed task with no usable subtitles', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson({
        data: {
          in_boss_key: 'b', resource_id: 'r', upload_id: 'u',
          upload_urls: ['https://boss/part0'], per_size: 1024,
        },
      }))
      .mockResolvedValueOnce(okJson({}, { Etag: 'e0' }))
      .mockResolvedValueOnce(okJson({ data: { download_url: 'https://dl' } }))
      .mockResolvedValueOnce(okJson({ data: { task_id: 't' } }))
      .mockResolvedValueOnce(okJson({ data: { state: 4, result: '{"utterances":[]}' } }));
    const provider = createBcutAsrProvider({ fetchImpl });

    await expect(provider.transcribe(new Blob(['x']), { videoId: 'v1' })).rejects.toMatchObject({
      error: { code: 'ASR_FAILED', message: 'Bcut 未返回有效字幕' },
    });
  });

  it('wraps upload failures as ASR_UPLOAD_FAILED', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const provider = createBcutAsrProvider({ fetchImpl });
    await expect(provider.transcribe(new Blob(['x']), { videoId: 'v1' }))
      .rejects.toBeInstanceOf(SonarException);
  });
});

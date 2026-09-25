import { describe, it, expect, vi } from 'vitest';
import { createOpenAiAsrProvider, filenameForBlob } from '@/processing/asr-provider';
import { SonarException } from '@/domain/errors';

describe('filenameForBlob', () => {
  it('derives an extension from the blob mime type', () => {
    expect(filenameForBlob(new Blob([], { type: 'video/mp4' }))).toBe('media.mp4');
    expect(filenameForBlob(new Blob([], { type: 'audio/mpeg' }))).toBe('media.mp3');
    expect(filenameForBlob(new Blob([], { type: 'audio/wav' }))).toBe('media.wav');
  });

  it('falls back to mp4 for unknown types', () => {
    expect(filenameForBlob(new Blob([], { type: '' }))).toBe('media.mp4');
  });
});

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('createOpenAiAsrProvider', () => {
  it('posts audio to /audio/transcriptions and maps the response', async () => {
    const fetchImpl = vi.fn(async () =>
      okJson({ text: '全文', language: 'zh', segments: [{ start: 0, end: 1, text: '片段' }] }),
    );
    const provider = createOpenAiAsrProvider(
      { baseUrl: 'https://asr.example/v1/', apiKey: 'sk-1', model: 'whisper-1', language: 'zh' },
      { fetchImpl, now: () => 7 },
    );
    const doc = await provider.transcribe(new Blob(['x']), { videoId: 'v1' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://asr.example/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-1' });
    expect(doc.videoId).toBe('v1');
    expect(doc.fullText).toBe('全文');
    expect(doc.segments).toHaveLength(1);
    expect(doc.createdAt).toBe(7);
  });

  it('throws ASR_FAILED on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response);
    const provider = createOpenAiAsrProvider(
      { baseUrl: 'https://asr.example', apiKey: 'x', model: 'm' },
      { fetchImpl },
    );
    await expect(provider.transcribe(new Blob(['x']), { videoId: 'v1' })).rejects.toMatchObject({
      error: { code: 'ASR_FAILED' },
    });
  });

  it('throws ASR_UPLOAD_FAILED when the request itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const provider = createOpenAiAsrProvider(
      { baseUrl: 'https://asr.example', apiKey: 'x', model: 'm' },
      { fetchImpl },
    );
    await expect(provider.transcribe(new Blob(['x']), { videoId: 'v1' })).rejects.toBeInstanceOf(
      SonarException,
    );
  });
});

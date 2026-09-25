import { describe, expect, it, vi } from 'vitest';
import { createOffscreenAudioExtractor } from '@/processing/offscreen-audio-extractor';

describe('createOffscreenAudioExtractor', () => {
  it('round-trips media through offscreen storage and returns a WAV blob', async () => {
    const files = new Map<string, Blob>();
    const wav = new Blob(['wav'], { type: 'audio/wav' });
    const readWav = vi.spyOn(wav, 'arrayBuffer');
    const store = {
      write: vi.fn(async (name: string, blob: Blob) => { files.set(name, blob); }),
      read: vi.fn(async (name: string) => files.get(name) ?? new Blob()),
      remove: vi.fn(async (name: string) => { files.delete(name); }),
    };
    const request = vi.fn(async (inputName: string, outputName: string) => {
      expect(files.get(inputName)?.type).toBe('video/mp4');
      files.set(outputName, wav);
    });
    const extractor = createOffscreenAudioExtractor({
      store,
      request,
      newId: () => 'fixed',
    });

    const result = await extractor.extract(new Blob(['video'], { type: 'video/mp4' }));

    expect(result.type).toBe('audio/wav');
    expect(readWav).toHaveBeenCalledOnce();
    expect(await result.text()).toBe('wav');
    expect(request).toHaveBeenCalledWith('input-fixed.mp4', 'output-fixed.wav');
    expect(store.remove).toHaveBeenCalledWith('input-fixed.mp4');
    expect(store.remove).toHaveBeenCalledWith('output-fixed.wav');
  });

  it('cleans temporary media when offscreen extraction fails', async () => {
    const store = {
      write: vi.fn(async () => {}),
      read: vi.fn(async () => new Blob()),
      remove: vi.fn(async () => {}),
    };
    const extractor = createOffscreenAudioExtractor({
      store,
      request: async () => { throw new Error('decode failed'); },
      newId: () => 'failed',
    });

    await expect(extractor.extract(new Blob(['video']))).rejects.toMatchObject({
      error: { code: 'AUDIO_EXTRACTION_FAILED' },
    });
    expect(store.remove).toHaveBeenCalledTimes(2);
  });
});

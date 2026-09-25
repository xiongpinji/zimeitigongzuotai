import { SonarException, makeError } from '@/domain/errors';
import {
  OFFSCREEN_EXTRACT_AUDIO,
  type OffscreenExtractAudioResponse,
} from '@/offscreen/protocol';
import type { AudioExtractor } from './audio-extractor';
import { ensureOffscreenDocument } from '@/offscreen/client';

export interface AudioTempStore {
  write(name: string, blob: Blob): Promise<void>;
  read(name: string): Promise<Blob>;
  remove(name: string): Promise<void>;
}

export interface OffscreenAudioExtractorDeps {
  store: AudioTempStore;
  request: (inputName: string, outputName: string) => Promise<void>;
  newId: () => string;
}

export function createOffscreenAudioExtractor(deps: OffscreenAudioExtractorDeps): AudioExtractor {
  return {
    async extract(video: Blob): Promise<Blob> {
      const id = deps.newId();
      const inputName = `input-${id}.mp4`;
      const outputName = `output-${id}.wav`;
      try {
        await deps.store.write(inputName, video);
        await deps.request(inputName, outputName);
        const output = await deps.store.read(outputName);
        // OPFS File 的 Blob 可能懒读取底层文件；清理临时项前必须先物化字节，
        // 否则稍后的 bcut PUT 会因文件已删除而报 net::ERR_FILE_NOT_FOUND。
        return new Blob([await output.arrayBuffer()], { type: 'audio/wav' });
      } catch (error) {
        throw new SonarException(makeError('AUDIO_EXTRACTION_FAILED', '浏览器音频提取失败', {
          retryable: true,
          detail: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        await Promise.allSettled([
          deps.store.remove(inputName),
          deps.store.remove(outputName),
        ]);
      }
    },
  };
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

export function createOpfsAudioTempStore(): AudioTempStore {
  return {
    async write(name, blob) {
      const root = await getOpfsRoot();
      const handle = await root.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    async read(name) {
      const root = await getOpfsRoot();
      return (await root.getFileHandle(name)).getFile();
    },
    async remove(name) {
      const root = await getOpfsRoot();
      await root.removeEntry(name).catch(() => {});
    },
  };
}

async function requestOffscreenExtraction(inputName: string, outputName: string): Promise<void> {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    kind: OFFSCREEN_EXTRACT_AUDIO,
    inputName,
    outputName,
  }) as OffscreenExtractAudioResponse | undefined;
  if (!response?.ok) throw new Error(response?.error || 'Offscreen Document 未响应');
}

export function createChromeOffscreenAudioExtractor(): AudioExtractor {
  return createOffscreenAudioExtractor({
    store: createOpfsAudioTempStore(),
    request: requestOffscreenExtraction,
    newId: () => crypto.randomUUID(),
  });
}

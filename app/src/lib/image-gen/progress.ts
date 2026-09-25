import type { ImageGenerationContext, ImageGenerationImage } from './types';

/** 创建一个无副作用的 ImageGenerationContext，用于无法接入 task-progress 的环境（如 Electron 主进程当前阶段） */
export function createNoopContext(taskId = 'noop', signal?: AbortSignal): ImageGenerationContext {
  return {
    taskId,
    signal: signal ?? new AbortController().signal,
    onProgress: () => {
      /* noop */
    },
  };
}

/** base64 → data URL；用于 cover-generation 在 provider 只返回 base64 时统一对外 url */
export function toDataUrl(img: ImageGenerationImage | undefined): string {
  if (!img) return '';
  if (img.url) return img.url;
  if (!img.base64) return '';
  const mime = img.mimeType ?? 'image/png';
  return `data:${mime};base64,${img.base64}`;
}

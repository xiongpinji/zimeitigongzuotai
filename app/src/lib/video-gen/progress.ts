import type { VideoGenerationContext } from './types';

/** 创建一个无副作用的 VideoGenerationContext，用于无法接入 task-progress 的环境（如脚本调用） */
export function createNoopVideoContext(
  taskId = 'noop',
  signal?: AbortSignal,
): VideoGenerationContext {
  return {
    taskId,
    signal: signal ?? new AbortController().signal,
    onProgress: () => {
      /* noop */
    },
  };
}

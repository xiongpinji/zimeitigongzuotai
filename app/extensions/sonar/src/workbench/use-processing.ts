/** 会话级处理任务跟踪：入队转录/摘要后轮询阶段，供「处理中 / 失败」筛选与状态展示。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DouyinClient } from '@/client';
import type { ProcessingStage, ProcessingTask } from '@/domain/models';
import type { SonarError } from '@/domain/errors';

export type ProcessingMap = Record<
  string,
  { taskId: string; stage: ProcessingStage; error?: SonarError }
>;

const ACTIVE: ProcessingStage[] = [
  'queued',
  'resolving',
  'fetching_media',
  'extracting_audio',
  'transcribing',
  'summarizing',
];

export const STAGE_LABEL: Record<ProcessingStage, string> = {
  queued: '排队中',
  resolving: '解析中',
  fetching_media: '获取媒体',
  extracting_audio: '提取音频',
  transcribing: '转录中',
  summarizing: '生成摘要',
  completed: '已完成',
  failed: '处理失败',
  cancelled: '已取消',
};

export function isProcessingActive(stage?: ProcessingStage): boolean {
  return !!stage && ACTIVE.includes(stage);
}

export interface ProcessingApi {
  map: ProcessingMap;
  track: (videoId: string, task: ProcessingTask) => void;
}

export function useProcessing(client: DouyinClient): ProcessingApi {
  const [map, setMap] = useState<ProcessingMap>({});
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const stop = useCallback((videoId: string) => {
    const t = timers.current[videoId];
    if (t) {
      clearInterval(t);
      delete timers.current[videoId];
    }
  }, []);

  const track = useCallback(
    (videoId: string, task: ProcessingTask) => {
      setMap((m) => ({
        ...m,
        [videoId]: { taskId: task.id, stage: task.stage, ...(task.error ? { error: task.error } : {}) },
      }));
      stop(videoId);
      timers.current[videoId] = setInterval(async () => {
        try {
          const t = await client.getProcessingTask(task.id);
          setMap((m) => ({
            ...m,
            [videoId]: { taskId: t.id, stage: t.stage, ...(t.error ? { error: t.error } : {}) },
          }));
          if (!isProcessingActive(t.stage)) stop(videoId);
        } catch {
          /* 任务尚不可查 */
        }
      }, 900);
    },
    [client, stop],
  );

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of Object.keys(t)) clearInterval(t[id]);
    };
  }, []);

  return { map, track };
}

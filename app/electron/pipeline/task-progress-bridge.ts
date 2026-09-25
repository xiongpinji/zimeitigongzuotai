import type { PipelineTask } from './types';

export type BridgeSender = ((channel: string, payload: unknown) => void) | null;

export interface TaskProgressBridge {
  notify(task: PipelineTask): void;
}

const TASK_UPDATE_CHANNEL = 'pipeline:task-update';

export function createTaskProgressBridge(opts: { send: BridgeSender }): TaskProgressBridge {
  return {
    notify(task) {
      if (!opts.send) return;
      try {
        opts.send(TASK_UPDATE_CHANNEL, {
          ...task,
          bridgeId: `pipeline:${task.taskId}`,
        });
      } catch {
        // 渲染窗口可能已关闭
      }
    },
  };
}

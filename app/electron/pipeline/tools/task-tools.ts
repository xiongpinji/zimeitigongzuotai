import type { PipelineService } from '..';
import { PIPELINE_ERROR_CODES, type PipelineTask } from '../types';

class PipelineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function buildTaskTools(svc: PipelineService) {
  return {
    async getTaskStatus(input: { taskId: string }): Promise<PipelineTask> {
      const t = svc.getTask(input.taskId);
      if (!t) {
        throw new PipelineError(
          PIPELINE_ERROR_CODES.UNKNOWN_TASK,
          `未知任务: ${input.taskId}`,
        );
      }
      return t;
    },

    async cancelTask(input: { taskId: string }): Promise<{ ok: true }> {
      await svc.cancelTask(input.taskId);
      return { ok: true };
    },

    async listTasks(input: { projectPath?: string } = {}): Promise<PipelineTask[]> {
      return svc.listTasks(input.projectPath);
    },
  };
}

import { describe, it, expect } from 'vitest';
import { createTaskProgressBridge } from '../electron/pipeline/task-progress-bridge';
import type { PipelineTask } from '../electron/pipeline/types';

function makeTask(over: Partial<PipelineTask> = {}): PipelineTask {
  return {
    taskId: 'a',
    kind: 'tts',
    projectPath: '/p',
    status: 'running',
    progress: { phase: 'init', percent: 0 },
    startedAt: 0,
    logs: [],
    ...over,
  };
}

describe('task-progress bridge', () => {
  it('forwards task updates as IPC payload with prefixed bridgeId', () => {
    const sent: Array<[string, unknown]> = [];
    const bridge = createTaskProgressBridge({
      send: (channel, payload) => sent.push([channel, payload]),
    });
    bridge.notify(makeTask({ status: 'running', progress: { phase: 'a', percent: 30 } }));
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe('pipeline:task-update');
    expect((sent[0][1] as { bridgeId: string }).bridgeId).toBe('pipeline:a');
    expect((sent[0][1] as { status: string }).status).toBe('running');
  });

  it('does not throw when sender is null', () => {
    const bridge = createTaskProgressBridge({ send: null });
    expect(() => bridge.notify(makeTask())).not.toThrow();
  });

  it('swallows sender exceptions gracefully', () => {
    const bridge = createTaskProgressBridge({
      send: () => { throw new Error('window closed'); },
    });
    expect(() => bridge.notify(makeTask())).not.toThrow();
  });
});

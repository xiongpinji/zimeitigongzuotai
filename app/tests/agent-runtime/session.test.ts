import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSession, type PiDriverLike } from '../../electron/agent-runtime/session';
import type { PiInProcessStartInput } from '../../electron/agent-runtime/pi-inprocess';
import type { RuntimeAgentDef } from '../../electron/agent-runtime/types';
import type { AgentStreamEvent } from '../../electron/agent-runtime/event-model';
import { piAgentDef } from '../../electron/agent-runtime/agent-defs/pi';

// ─── Fake in-process driver ──────────────────────────────────────────────────
//
// pi 现以进程内 SDK 运行（见 pi-inprocess.ts）；AgentSession 仅做委派 + 终态去重。
// 测试用 fake driver 捕获 start 入参，并暴露其收到的 onEvent 以便驱动事件流。

class FakeDriver implements PiDriverLike {
  startInput: PiInProcessStartInput | null = null;
  emit: (ev: AgentStreamEvent) => void = () => {};
  abort = vi.fn();
  dispose = vi.fn();
  respondPermission = vi.fn();
  throwOnStart: Error | null = null;

  start = vi.fn(async (input: PiInProcessStartInput): Promise<void> => {
    this.startInput = input;
    this.emit = input.onEvent;
    if (this.throwOnStart) throw this.throwOnStart;
  });
}

function makeSession(driver: FakeDriver): AgentSession {
  return new AgentSession({ createDriver: () => driver });
}

describe('AgentSession (in-process delegation)', () => {
  let events: AgentStreamEvent[];
  let onEvent: (ev: AgentStreamEvent) => void;

  beforeEach(() => {
    events = [];
    onEvent = (ev) => events.push(ev);
  });

  it('委派 driver.start：透传 prompt/cwd 并从 env 解析 agentDir', async () => {
    const driver = new FakeDriver();
    const session = makeSession(driver);

    await session.start({
      def: piAgentDef as RuntimeAgentDef,
      prompt: 'pi prompt',
      cwd: '/tmp/p',
      env: { PI_CODING_AGENT_DIR: '/home/u/.lingji/pi-agent' },
      onEvent,
    });

    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(driver.startInput?.prompt).toBe('pi prompt');
    expect(driver.startInput?.cwd).toBe('/tmp/p');
    expect(driver.startInput?.agentDir).toBe('/home/u/.lingji/pi-agent');
  });

  it('model/reasoning 缺省回落到 def 默认值', async () => {
    const driver = new FakeDriver();
    const session = makeSession(driver);

    await session.start({
      def: piAgentDef as RuntimeAgentDef,
      prompt: 'hi',
      onEvent,
    });

    expect(driver.startInput?.model).toBe(piAgentDef.defaultModel);
    expect(driver.startInput?.reasoning).toBe(piAgentDef.defaultReasoning);
  });

  it('透传 resumeSessionId / skills / getPermissionPolicy', async () => {
    const driver = new FakeDriver();
    const session = makeSession(driver);
    const getPolicy = () => 'tiered';
    const skills = [
      { id: 's1', enabled: true, status: 'available', rootPath: '/skills/s1' },
    ] as unknown as PiInProcessStartInput['skills'];

    await session.start({
      def: piAgentDef as RuntimeAgentDef,
      prompt: 'hi',
      resumeSessionId: 'sess-123',
      skills,
      getPermissionPolicy: getPolicy,
      onEvent,
    });

    expect(driver.startInput?.resumeSessionId).toBe('sess-123');
    expect(driver.startInput?.skills).toBe(skills);
    expect(driver.startInput?.getPermissionPolicy).toBe(getPolicy);
  });

  it('driver 事件经 onEvent 透传', async () => {
    const driver = new FakeDriver();
    const session = makeSession(driver);

    await session.start({ def: piAgentDef as RuntimeAgentDef, prompt: 'hi', onEvent });

    driver.emit({ type: 'text_delta', delta: 'yo' });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'yo' });
  });

  it('终态去重：turn_end 后重复终态被抑制', async () => {
    const driver = new FakeDriver();
    const session = makeSession(driver);

    await session.start({ def: piAgentDef as RuntimeAgentDef, prompt: 'hi', onEvent });

    driver.emit({ type: 'turn_end' });
    driver.emit({ type: 'turn_end' });
    driver.emit({ type: 'error', message: 'late' });

    const terminal = events.filter((e) => e.type === 'turn_end' || e.type === 'error');
    expect(terminal).toHaveLength(1);
    expect(terminal[0].type).toBe('turn_end');
  });

  it('cancel(): abort + dispose driver，并抑制后续事件', async () => {
    const driver = new FakeDriver();
    const session = makeSession(driver);

    await session.start({ def: piAgentDef as RuntimeAgentDef, prompt: 'hi', onEvent });

    session.cancel();
    expect(driver.abort).toHaveBeenCalled();
    expect(driver.dispose).toHaveBeenCalled();

    driver.emit({ type: 'text_delta', delta: 'after cancel' });
    expect(events).toHaveLength(0);
  });

  it('respondPermission 委派给 driver', async () => {
    const driver = new FakeDriver();
    const session = makeSession(driver);

    await session.start({ def: piAgentDef as RuntimeAgentDef, prompt: 'hi', onEvent });

    session.respondPermission('perm-1', 'allow_once');
    expect(driver.respondPermission).toHaveBeenCalledWith('perm-1', 'allow_once');
  });

  it('driver.start 抛错 → 归一化为 error 终态', async () => {
    const driver = new FakeDriver();
    driver.throwOnStart = new Error('boom');
    const session = makeSession(driver);

    await session.start({ def: piAgentDef as RuntimeAgentDef, prompt: 'hi', onEvent });

    const errEv = events.find((e) => e.type === 'error') as { type: 'error'; message: string } | undefined;
    expect(errEv).toBeDefined();
    expect(errEv?.message).toContain('boom');
  });
});

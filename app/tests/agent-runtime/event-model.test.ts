/**
 * tests/agent-runtime/event-model.test.ts
 *
 * 测试 AgentStreamEvent → RuntimeEventOut 的归一化映射。
 * 断言输出字段与 applyRuntimeEvent() 实际消费字段完全一致
 * （调研来源：src/contexts/acp-connections-context.tsx）。
 */

import { describe, it, expect } from 'vitest';
import { toRuntimeEvent } from '../../electron/agent-runtime/event-model';
import type { AgentStreamEvent, RuntimeEventOut } from '../../electron/agent-runtime/event-model';

// ─── 辅助 ─────────────────────────────────────────────────────────────────────

function mapEvent(ev: AgentStreamEvent): RuntimeEventOut | null {
  return toRuntimeEvent(ev);
}

// ─── text_delta ───────────────────────────────────────────────────────────────

describe('text_delta', () => {
  it('maps to { type:"text", text } — consumed by case "text"|"content_delta"', () => {
    const result = mapEvent({ type: 'text_delta', delta: 'hello world' });
    expect(result).toEqual({ type: 'text', text: 'hello world' });
  });

  it('preserves empty delta', () => {
    const result = mapEvent({ type: 'text_delta', delta: '' });
    expect(result).toEqual({ type: 'text', text: '' });
  });
});

// ─── thinking_delta ───────────────────────────────────────────────────────────

describe('thinking_delta', () => {
  it('maps to { type:"thinking", text } — consumed by case "thinking"', () => {
    const result = mapEvent({ type: 'thinking_delta', delta: 'I am thinking...' });
    expect(result).toEqual({ type: 'thinking', text: 'I am thinking...' });
  });
});

// ─── tool_use ─────────────────────────────────────────────────────────────────

describe('tool_use', () => {
  it('maps to tool_call with correct top-level fields (toolCallId / title / kind / status / rawInput)', () => {
    const result = mapEvent({
      type: 'tool_use',
      id: 'call-123',
      name: 'bash',
      input: { command: 'ls -la' },
    });
    expect(result).toEqual({
      type: 'tool_call',
      toolCallId: 'call-123',
      title: 'bash',
      // 'bash' → 派生为 'execute'（不再硬编码 'other'）
      kind: 'execute',
      status: 'pending',
      rawInput: JSON.stringify({ command: 'ls -la' }),
    });
  });

  it('handles null input gracefully', () => {
    const result = mapEvent({ type: 'tool_use', id: 'call-0', name: 'noop', input: null });
    expect(result).toEqual({
      type: 'tool_call',
      toolCallId: 'call-0',
      title: 'noop',
      // 无法归类 → 空字符串（UI 不渲染标签）
      kind: '',
      status: 'pending',
      rawInput: 'null',
    });
  });

  it('handles undefined input (maps to null)', () => {
    const result = mapEvent({ type: 'tool_use', id: 'call-1', name: 'ping', input: undefined });
    expect(result).toEqual({
      type: 'tool_call',
      toolCallId: 'call-1',
      title: 'ping',
      kind: '',
      status: 'pending',
      rawInput: 'null',
    });
  });

  it('空工具名 → title 兜底 Tool，kind 空', () => {
    const result = mapEvent({ type: 'tool_use', id: 'call-2', name: '', input: null });
    expect(result).toMatchObject({ type: 'tool_call', title: 'Tool', kind: '' });
  });

  it('常见工具名派生 kind：Read→read / Write→edit / WebFetch→fetch', () => {
    const kindOf = (name: string) =>
      (mapEvent({ type: 'tool_use', id: 'x', name, input: null }) as { kind: string }).kind;
    expect(kindOf('Read')).toBe('read');
    expect(kindOf('Write')).toBe('edit');
    expect(kindOf('WebFetch')).toBe('fetch');
  });
});

// ─── tool_result ──────────────────────────────────────────────────────────────

describe('tool_result', () => {
  it('maps successful result to tool_call_update with status=completed', () => {
    const result = mapEvent({
      type: 'tool_result',
      toolUseId: 'call-123',
      content: 'file1.ts\nfile2.ts',
    });
    expect(result).toEqual({
      type: 'tool_call_update',
      toolCallId: 'call-123',
      title: undefined,
      status: 'completed',
      rawInput: undefined,
      rawOutput: 'file1.ts\nfile2.ts',
      rawOutputAppend: false,
    });
  });

  it('maps result name/input back to tool_call_update so UI can show command details', () => {
    const result = mapEvent({
      type: 'tool_result',
      toolUseId: 'call-cmd',
      name: 'bash',
      input: { command: 'wc -l original.md' },
      content: '110 original.md',
    });

    expect(result).toEqual({
      type: 'tool_call_update',
      toolCallId: 'call-cmd',
      title: 'bash',
      status: 'completed',
      rawInput: JSON.stringify({ command: 'wc -l original.md' }),
      rawOutput: '110 original.md',
      rawOutputAppend: false,
    });
  });

  it('maps error result to tool_call_update with status=error', () => {
    const result = mapEvent({
      type: 'tool_result',
      toolUseId: 'call-456',
      content: 'command not found',
      isError: true,
    });
    expect(result).toEqual({
      type: 'tool_call_update',
      toolCallId: 'call-456',
      title: undefined,
      status: 'error',
      rawInput: undefined,
      rawOutput: 'command not found',
      rawOutputAppend: false,
    });
  });

  it('defaults isError=false (status=completed) when not provided', () => {
    const result = mapEvent({
      type: 'tool_result',
      toolUseId: 'call-789',
      content: 'ok',
    });
    expect(result).toMatchObject({ status: 'completed' });
  });
});

// ─── tool_input_delta ────────────────────────────────────────────────────────

describe('tool_input_delta', () => {
  it('maps to tool_call_update with rawInput so streamed tool args stay visible', () => {
    const result = mapEvent({
      type: 'tool_input_delta',
      id: 'call-1',
      delta: '{"command":"npm test"}',
    });
    expect(result).toEqual({
      type: 'tool_call_update',
      toolCallId: 'call-1',
      rawInput: '{"command":"npm test"}',
      rawOutputAppend: false,
    });
  });
});

// ─── turn_end ─────────────────────────────────────────────────────────────────

describe('turn_end', () => {
  it('maps to turn_complete with stopReason', () => {
    const result = mapEvent({ type: 'turn_end', stopReason: 'end_turn' });
    expect(result).toEqual({ type: 'turn_complete', stopReason: 'end_turn' });
  });

  it('maps turn_end with no stopReason (undefined)', () => {
    const result = mapEvent({ type: 'turn_end' });
    expect(result).toEqual({ type: 'turn_complete', stopReason: undefined });
  });
});

// ─── error ────────────────────────────────────────────────────────────────────

describe('error', () => {
  it('maps to { type:"error", message } — consumed by case "error"', () => {
    const result = mapEvent({ type: 'error', message: 'Connection refused' });
    expect(result).toEqual({ type: 'error', message: 'Connection refused' });
  });

  it('raw field is not forwarded (not consumed by applyRuntimeEvent)', () => {
    const result = mapEvent({ type: 'error', message: 'oops', raw: '{"code":500}' });
    expect(result).toEqual({ type: 'error', message: 'oops' });
    // raw is not part of RuntimeEventOut
    expect((result as Record<string, unknown>)['raw']).toBeUndefined();
  });
});

// ─── status with sessionId → session_started ──────────────────────────────────

describe('status with sessionId', () => {
  it('maps to session_started carrying sessionId — consumed by case "session_started"', () => {
    const result = mapEvent({ type: 'status', label: 'init', sessionId: 'sess-xyz' });
    expect(result).toEqual({ type: 'session_started', sessionId: 'sess-xyz' });
  });

  it('maps to session_started even with other optional fields present', () => {
    const result = mapEvent({
      type: 'status',
      label: 'running',
      detail: 'ok',
      model: 'claude-3-5',
      sessionId: 's1',
    });
    expect(result).toEqual({ type: 'session_started', sessionId: 's1' });
  });

  it('treats empty-string sessionId as no session (returns null)', () => {
    expect(mapEvent({ type: 'status', label: 'x', sessionId: '' })).toBeNull();
  });
});

// ─── usage ────────────────────────────────────────────────────────────────────

describe('usage', () => {
  it('maps outputTokens to used; size defaults to 0 (no context-window info)', () => {
    const result = mapEvent({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 250,
      costUsd: 0.003,
    });
    // applyRuntimeEvent case 'usage': { used: number; size: number }
    expect(result).toEqual({ type: 'usage', used: 250, size: 0 });
  });

  it('used defaults to 0 when outputTokens is absent', () => {
    const result = mapEvent({ type: 'usage' });
    expect(result).toEqual({ type: 'usage', used: 0, size: 0 });
  });

  it('used defaults to 0 when outputTokens is explicitly undefined', () => {
    const result = mapEvent({ type: 'usage', outputTokens: undefined });
    expect(result).toEqual({ type: 'usage', used: 0, size: 0 });
  });
});

// ─── null 分支（首版不映射） ──────────────────────────────────────────────────

describe('null branches (unmapped in v1)', () => {
  it('status without sessionId → null', () => {
    expect(mapEvent({ type: 'status', label: 'connecting' })).toBeNull();
  });

  it('thinking_start → null', () => {
    expect(mapEvent({ type: 'thinking_start' })).toBeNull();
  });

  it('thinking_end → null', () => {
    expect(mapEvent({ type: 'thinking_end' })).toBeNull();
  });

  it('raw → null', () => {
    expect(mapEvent({ type: 'raw', line: 'data: {"type":"ping"}' })).toBeNull();
  });
});

// ─── 返回值类型完整性断言 ─────────────────────────────────────────────────────

describe('return type completeness', () => {
  it('all mapped events return non-null objects with a type field', () => {
    const mapped = [
      mapEvent({ type: 'text_delta', delta: 'x' }),
      mapEvent({ type: 'thinking_delta', delta: 'x' }),
      mapEvent({ type: 'tool_use', id: 'id', name: 'fn', input: {} }),
      mapEvent({ type: 'tool_result', toolUseId: 'id', content: 'out' }),
      mapEvent({ type: 'turn_end' }),
      mapEvent({ type: 'error', message: 'err' }),
      mapEvent({ type: 'usage', outputTokens: 10 }),
    ];
    for (const r of mapped) {
      expect(r).not.toBeNull();
      expect(typeof (r as RuntimeEventOut).type).toBe('string');
    }
  });
});

// ─── permission_request ───────────────────────────────────────────────────────

describe('permission_request', () => {
  it('透传 requestId / toolCall / options 到 Renderer 消费形状', () => {
    const ev = {
      type: 'permission_request',
      requestId: '42',
      toolCall: { title: 'edit src/index.ts', rawInput: '{"path":"src/index.ts"}', kind: 'edit' },
      options: [
        { optionId: 'allow_once', name: '仅此次允许', kind: 'allow_once' },
        { optionId: 'reject', name: '拒绝', kind: 'reject_always' },
      ],
    } as unknown as AgentStreamEvent;
    expect(mapEvent(ev)).toEqual({
      type: 'permission_request',
      requestId: '42',
      toolCall: { title: 'edit src/index.ts', rawInput: '{"path":"src/index.ts"}', kind: 'edit' },
      options: [
        { optionId: 'allow_once', name: '仅此次允许', kind: 'allow_once' },
        { optionId: 'reject', name: '拒绝', kind: 'reject_always' },
      ],
    });
  });
});

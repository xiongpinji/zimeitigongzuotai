/**
 * event-model.ts
 *
 * 统一事件模型 + 归一化映射
 *
 * AgentStreamEvent — 协议无关的归一化事件，由各 parser（claude / codex / pi）emit。
 * RuntimeEventOut   — applyRuntimeEvent() 实际消费的事件形状，直接对应
 *                     src/contexts/acp-connections-context.tsx 中的 switch-case。
 * toRuntimeEvent()  — 把前者映射到后者；无对应映射时返回 null。
 *
 * 真实消费字段来源（2025-06 调研）：
 *   acp-connections-context.tsx → applyRuntimeEvent() switch-case:
 *     'content_delta' | 'text'   → payload.text (string)
 *     'thinking'                 → payload.text (string)
 *     'tool_call'                → payload.toolCallId, .title, .kind, .status,
 *                                   .rawInput?, .rawOutput?
 *     'tool_call_update'         → payload.toolCallId, .title?, .status?,
 *                                   .rawInput?, .rawOutput?, .rawOutputAppend (bool)
 *     'permission_request'       → payload.requestId, .toolCall, .options
 *     'turn_complete'            → payload.stopReason, payload.usage (object→JSON)
 *     'error'                    → payload.message
 *     'usage'                    → payload.used (number), payload.size (number)
 *     'session_started'          → payload.sessionId
 *     'file_changed'             → payload.path, .before, .after
 *     'mode_update'              → payload.currentModeId
 *     'available_commands'       → payload.commands
 *     'config_update'            → payload.configOptions
 */

// ─── 归一化输入事件（parser 输出层） ──────────────────────────────────────────

export type AgentStreamEvent =
  | { type: 'status'; label: string; detail?: string; model?: string; sessionId?: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_input_delta'; id: string; delta: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean; name?: string; input?: unknown }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number }
  | { type: 'turn_end'; stopReason?: string }
  | { type: 'error'; message: string; raw?: string }
  | {
      type: 'permission_request';
      requestId: string;
      toolCall: unknown;
      options: PermissionRequestOption[];
    }
  | { type: 'raw'; line: string };

/** 权限卡片选项；字段与 Renderer 侧 PendingPermission.options 对齐。 */
export interface PermissionRequestOption {
  optionId: string;
  name: string;
  kind: string;
}

// ─── Renderer 消费事件（applyRuntimeEvent 入参层） ────────────────────────────

/**
 * RuntimeEventOut 对应 applyRuntimeEvent() 中每个 case 消费的实际字段。
 * 字段名与现有代码完全对齐，不做主观重命名。
 */
export type RuntimeEventOut =
  /** case 'text' / 'content_delta': payload.text */
  | { type: 'text'; text: string }
  /** case 'thinking': payload.text */
  | { type: 'thinking'; text: string }
  /**
   * case 'tool_call': 新建一条 LiveContentBlock { type:'tool_call', info: LiveToolCallInfo }
   * 字段对应 LiveToolCallInfo: toolCallId / title / kind / status / rawInput? / rawOutput?
   */
  | {
      type: 'tool_call';
      toolCallId: string;
      title: string;
      kind: string;
      status: string;
      rawInput?: string;
      rawOutput?: string;
    }
  /**
   * case 'tool_call_update': 更新已有 tool_call block
   * 字段: toolCallId / title? / status? / rawInput? / rawOutput? / rawOutputAppend
   */
  | {
      type: 'tool_call_update';
      toolCallId: string;
      title?: string;
      status?: string;
      rawInput?: string;
      rawOutput?: string;
      rawOutputAppend: boolean;
    }
  /** case 'turn_complete': payload.stopReason */
  | { type: 'turn_complete'; stopReason?: string }
  /** case 'error': payload.message */
  | { type: 'error'; message: string }
  /**
   * case 'usage': payload.used / payload.size
   * TODO: AgentStreamEvent.usage 没有 size（context window 上限）字段，
   *       此处用 outputTokens 映射 used，size 降级为 0。
   *       若后续 parser 能提供 contextWindowSize，在此更新。
   */
  | { type: 'usage'; used: number; size: number }
  /** case 'session_started': payload.sessionId（用于持久化 externalId） */
  | { type: 'session_started'; sessionId: string }
  /** case 'permission_request': payload.requestId, .toolCall, .options */
  | {
      type: 'permission_request';
      requestId: string;
      toolCall: unknown;
      options: PermissionRequestOption[];
    };

// ─── 工具分类 ─────────────────────────────────────────────────────────────────

/**
 * 按工具名推断一个粗粒度类别标签（仅用于 UI 右上角的小标签）。
 * 无法判断时返回 ''（UI 在 kind 为空时不渲染标签，避免显示无意义的 "other"）。
 * 主标题始终用工具名（title），类别只是辅助。
 */
export function classifyToolKind(name: string): string {
  const n = (name || '').toLowerCase();
  if (!n) return '';
  if (/(bash|shell|exec|run|command|terminal|process|kill)/.test(n)) return 'execute';
  if (/(write|edit|create|update|patch|apply|insert|append|replace|delete|remove|\brm\b|move|rename|mkdir)/.test(n))
    return 'edit';
  if (/(fetch|http|web|curl|browse|download|request)/.test(n)) return 'fetch';
  if (/(read|cat|view|open|glob|grep|search|find|\blist\b|\bls\b|get_|read_)/.test(n)) return 'read';
  if (/(think|todo|plan)/.test(n)) return 'think';
  return '';
}

// ─── 映射函数 ─────────────────────────────────────────────────────────────────

/**
 * 把协议无关的 AgentStreamEvent 映射到 Renderer 侧 applyRuntimeEvent 消费的形状。
 * status：带 sessionId → session_started；不带 sessionId → null。
 * 不映射的事件类型返回 null：
 *   thinking_start / thinking_end / raw
 */
export function toRuntimeEvent(ev: AgentStreamEvent): RuntimeEventOut | null {
  switch (ev.type) {
    case 'text_delta':
      // applyRuntimeEvent case 'text': payload.text
      return { type: 'text', text: ev.delta };

    case 'thinking_delta':
      // applyRuntimeEvent case 'thinking': payload.text
      return { type: 'thinking', text: ev.delta };

    case 'tool_use':
      // applyRuntimeEvent case 'tool_call': 使用顶层字段而非 info 包裹
      // 注意：applyRuntimeEvent 从 payload 顶层读取 toolCallId/title/kind/status 等，
      // 并在内部构造 LiveToolCallInfo，不要求事件本身含 info 对象。
      return {
        type: 'tool_call',
        toolCallId: ev.id,
        // 标题用工具名；缺省兜底 'Tool'（避免空标题）。
        title: ev.name || 'Tool',
        // 类别按工具名派生；无法判断时为空，UI 不渲染标签（不再显示 "other"）。
        kind: classifyToolKind(ev.name),
        status: 'pending',
        rawInput: JSON.stringify(ev.input ?? null),
      };

    case 'tool_result':
      // applyRuntimeEvent case 'tool_call_update'
      return {
        type: 'tool_call_update',
        toolCallId: ev.toolUseId,
        title: ev.name,
        status: ev.isError ? 'error' : 'completed',
        rawInput: ev.input !== undefined ? JSON.stringify(ev.input ?? null) : undefined,
        rawOutput: ev.content,
        rawOutputAppend: false,
      };

    case 'tool_input_delta':
      return {
        type: 'tool_call_update',
        toolCallId: ev.id,
        rawInput: ev.delta,
        rawOutputAppend: false,
      };

    case 'turn_end':
      // applyRuntimeEvent case 'turn_complete'
      return { type: 'turn_complete', stopReason: ev.stopReason };

    case 'error':
      // applyRuntimeEvent case 'error'
      return { type: 'error', message: ev.message };

    case 'permission_request':
      // applyRuntimeEvent case 'permission_request': payload.requestId/.toolCall/.options
      return {
        type: 'permission_request',
        requestId: ev.requestId,
        toolCall: ev.toolCall,
        options: ev.options,
      };

    case 'usage':
      // applyRuntimeEvent case 'usage': { used: number; size: number }
      // TODO: AgentStreamEvent.usage 无 size（context window）；映射 outputTokens→used, size=0
      return {
        type: 'usage',
        used: ev.outputTokens ?? 0,
        size: 0,
      };

    case 'status':
      // 带 sessionId 的 status → session_started，使 Renderer 持久化 externalId。
      // 不带 sessionId（或空串）的 status 仍不映射，返回 null（保持原行为）。
      if (ev.sessionId) {
        return { type: 'session_started', sessionId: ev.sessionId };
      }
      return null;

    // 首版不映射，返回 null
    case 'thinking_start':
    case 'thinking_end':
    case 'raw':
      return null;

    default: {
      // TypeScript 穷举检查
      const _exhaustive: never = ev;
      void _exhaustive;
      return null;
    }
  }
}

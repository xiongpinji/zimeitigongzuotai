/**
 * ChatComposer — 对话输入薄封装。
 *
 * 复用现有 `MessageInput` 的全部能力（文本输入、斜杠命令、@ 文件提及、
 * 附件/图片、模式/配置选择器、取消、发送），不做重写。
 *
 * 能力：
 *  - 「新建会话尚未绑定 agent」场景下，于输入框上方渲染 `<AgentPicker/>`。
 *  - 已绑定 agent 时，把「模型 + 思考程度」合并芯片（ModelReasoningPicker）
 *    注入 MessageInput 底栏右侧插槽（与 + / 审批 pill 同排，不再单列一行）。
 *    agent 框架名（pi 等）不在此重复展示——已由 AI 面板右上角 ChatHeader 呈现。
 */

import React from 'react';
import { MessageInput, type MessageInputProps } from './MessageInput';
import { AgentPicker } from './AgentPicker';
import { ModelReasoningPicker } from './ModelReasoningPicker';

export interface ChatComposerProps extends MessageInputProps {
  /** 是否在输入框上方显示 agent 选择器（仅新建会话/未绑定 agent 时为 true）。 */
  showAgentPicker?: boolean;
  /** 当前选中的 agent id，透传给 AgentPicker。 */
  selectedAgentId?: string;
  /** agent 选择变更回调。 */
  onAgentChange?: (agentId: string) => void;
  /**
   * 当前 agent id（用于在底栏渲染「模型+思考」合并芯片）。有值时显示 ModelReasoningPicker。
   * 与 selectedAgentId 区分语义：selectedAgentId 用于「新建会话选 agent」场景，
   * agentId 用于「已绑定会话切模型」的常驻芯片。
   */
  agentId?: string;
  /** 当前模型 id（受控）；缺省时用 presentation.defaultModel。 */
  modelId?: string;
  /** 模型切换回调。 */
  onModelChange?: (modelId: string) => void;
  /** 当前思考程度 id（受控）；缺省时用 presentation.defaultReasoning。 */
  reasoningId?: string;
  /** 思考程度切换回调。 */
  onReasoningChange?: (reasoningId: string) => void;
}

export function ChatComposer({
  showAgentPicker = false,
  selectedAgentId,
  onAgentChange,
  agentId,
  modelId,
  onModelChange,
  reasoningId,
  onReasoningChange,
  ...messageInputProps
}: ChatComposerProps): React.ReactElement {
  return (
    <div className="chat-composer flex flex-col gap-2">
      {showAgentPicker && (
        <div className="chat-composer__agent-picker">
          <AgentPicker
            value={selectedAgentId ?? ''}
            onChange={(id) => onAgentChange?.(id)}
          />
        </div>
      )}
      <MessageInput
        {...messageInputProps}
        bottomToolbarTrailing={
          agentId ? (
            <ModelReasoningPicker
              agentId={agentId}
              modelValue={modelId}
              onModelChange={(id) => onModelChange?.(id)}
              reasoningValue={reasoningId}
              onReasoningChange={(id) => onReasoningChange?.(id)}
              disabled={messageInputProps.disabled}
            />
          ) : undefined
        }
      />
    </div>
  );
}

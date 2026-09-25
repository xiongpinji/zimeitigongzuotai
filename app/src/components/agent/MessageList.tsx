/**
 * MessageList — 会话消息区，组合 UserMessage + AssistantMessage（B4）。
 *
 * 职责：
 *  - 遍历 turns：role === 'user' → UserMessage；其它（assistant / tool / system）→ AssistantMessage。
 *  - 自动置底：用户在底部时新 turn / 流式更新自动滚到底；用户上滚后不强拉。
 *  - 复用 ConversationDetailPane 的 framer-motion 列表动画（m.div + AnimatePresence）。
 *
 * 抽取自 ConversationDetailPane 的消息滚动区，作为 B8 ChatPane 的消息区。
 * 权限卡归属：pendingPermission 挂在最后一个 assistant turn 上（与旧 pane 行为对齐）；
 * 若没有 assistant turn，则在列表末尾单独渲染一次，避免授权请求丢失。
 *
 * TODO: 会话很长时再引入虚拟化（当前为正确优先，全量渲染）。
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { springs, durations, easings } from '../../ui/lib/motion';
import { EmptyState } from '../../ui';
import { UserMessage } from './UserMessage';
import { AssistantMessage, PermissionPrompt } from './AssistantMessage';
import { SessionFileSummaryPanel } from './SessionFileSummaryPanel';
import type { ConversationTurn, PendingPermission } from '../../types/conversation';

const enterTransition = { transition: springs.smooth };
const exitTransition = {
  opacity: 0,
  y: -4,
  transition: { duration: durations.fast, ease: easings.apple },
};

export interface MessageListProps {
  turns: ConversationTurn[];
  pendingPermission?: PendingPermission | null;
  onRespondPermission?: (requestId: string, optionId: string) => void;
  /** 当某 assistant turn 自身无 agentId 时使用的会话级 agentType 回退 */
  fallbackAgentId?: string;
  /** 是否处于流式输出中（用于自动置底判定，可选） */
  isStreaming?: boolean;
  /** 用于把相对文件路径解析为绝对路径（会话结束文件结果集）。 */
  projectDir?: string | null;
}

/** 从 user turn 的 blocks 中拼出可读文本（与 ConversationDetailPane 一致）。 */
function userTurnText(turn: ConversationTurn): string {
  return turn.blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

export function MessageList({
  turns,
  pendingPermission,
  onRespondPermission,
  fallbackAgentId,
  isStreaming,
  projectDir,
}: MessageListProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 用户是否“贴底”。初始为 true，用户上滚后置 false，回到底部再置 true。
  const pinnedToBottomRef = useRef(true);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 容差：距离底部 24px 内仍视为贴底（避免抖动）。
    pinnedToBottomRef.current = distanceFromBottom <= 24;
  };

  // turns / 流式 / 权限卡变化后，若用户仍贴底则滚到底。
  useLayoutEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, isStreaming, pendingPermission]);

  // 首次挂载滚到底（确保初始进入会话即贴底）。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 找到最后一个 assistant turn，用于挂权限卡。
  let lastAssistantIndex = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }
  const hasAssistantTurn = lastAssistantIndex >= 0;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3"
    >
      {turns.length === 0 ? (
        <EmptyState
          title="暂无消息"
          description="这个会话还没有消息。可以直接在下方输入，或点击左侧其他会话查看。"
        />
      ) : null}

      <AnimatePresence initial={false}>
        {turns.map((turn, index) => {
          if (turn.role === 'user') {
            return (
              <m.div
                key={String(turn.id)}
                layout="position"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, ...enterTransition }}
                exit={exitTransition}
              >
                <UserMessage content={userTurnText(turn)} />
              </m.div>
            );
          }

          const attachPermission = index === lastAssistantIndex;
          return (
            <m.div
              key={String(turn.id)}
              layout="position"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, ...enterTransition }}
              exit={exitTransition}
            >
              <AssistantMessage
                turn={turn}
                fallbackAgentId={fallbackAgentId}
                pendingPermission={attachPermission ? pendingPermission : null}
                onRespondPermission={onRespondPermission}
                isLastAssistant={index === lastAssistantIndex}
                isStreaming={index === lastAssistantIndex && Boolean(isStreaming)}
              />
            </m.div>
          );
        })}
      </AnimatePresence>

      {/* 会话结束（非 streaming）后，在末尾汇总本次改动的全部文件（无文件时组件自身返回 null）。 */}
      {!isStreaming ? (
        <SessionFileSummaryPanel turns={turns} projectDir={projectDir} />
      ) : null}

      {/* 没有 assistant turn 可挂载时，在列表末尾单独渲染权限卡，避免授权请求丢失。 */}
      {pendingPermission && !hasAssistantTurn ? (
        <PermissionPrompt
          pending={pendingPermission}
          onRespond={(optionId) =>
            onRespondPermission?.(pendingPermission.requestId, optionId)
          }
        />
      ) : null}
    </div>
  );
}

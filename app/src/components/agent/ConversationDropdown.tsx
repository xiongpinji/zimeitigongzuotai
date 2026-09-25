/**
 * ConversationDropdown — 顶部会话切换/新建入口（替换左侧 SessionListPane + ConversationToolbar）。
 *
 * 触发：一个 icon 按钮（历史/列表）。点击展开自包含轻量 popover（参考 ModelPicker 做法，
 * 不引 framer-motion portal，jsdom 友好），内含：
 *  - 顶部「+ 新建会话」项（用全局默认 agent，不再选 agent）。
 *  - 搜索框（按标题过滤）。
 *  - 会话列表（每项 AgentIcon + 标题 + 选中态；双击重命名；删除按钮；点击切换）。
 *
 * 数据复用 useConversationList（conversations / activeConversationId / setActiveConversation /
 * createConversation / deleteConversation / renameConversation）。
 * 新建会话 agentType 取 getPreferredAgentType()（= 全局 activeAgentId）。
 *
 * 视觉遵循 DESIGN：系统蓝 accent，无第二 accent，无新弹窗系统。
 */

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { History, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useConversationList } from '../../hooks/use-conversation-list';
import { getPreferredAgentType } from '../../lib/agent-api';
import { DEFAULT_AGENT_ID } from '../../lib/agent-presentation';
import { AgentIcon } from './AgentIcon';
import type { ConversationSummary } from '../../types/conversation';

interface ConversationDropdownProps {
  /** 当前显式进入的会话 id（用于标记「已进入」并触发连接）。 */
  explicitConversationId: number | null;
  /** 选择会话回调（切换 active + 标记 explicit）。 */
  onSelectConversation: (conversationId: number) => void;
  /** 新建会话回调（创建后切到新会话）。 */
  onCreateConversation: (conversationId: number) => void;
  /** 删除会话回调。 */
  onDeleteConversation: (conversationId: number) => void;
}

/** 按标题过滤会话列表（大小写不敏感 includes）。空查询返回原列表。 */
export function filterConversations<T extends { title: string }>(
  conversations: T[],
  query: string,
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return conversations;
  return conversations.filter((conversation) =>
    (conversation.title ?? '').toLowerCase().includes(trimmed),
  );
}

export function ConversationDropdown({
  explicitConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
}: ConversationDropdownProps) {
  const {
    conversations,
    activeConversationId,
    loading,
    createConversation,
    renameConversation,
  } = useConversationList();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function beginRename(conversation: Pick<ConversationSummary, 'id' | 'title'>) {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  function commitRename(conversationId: number) {
    const next = renameDraft.trim();
    const original = conversations.find((c) => c.id === conversationId)?.title ?? '';
    if (next && next !== original) {
      void renameConversation?.(conversationId, next);
    }
    cancelRename();
  }

  async function handleCreate() {
    const agentType = (await getPreferredAgentType()) || DEFAULT_AGENT_ID;
    const created = await createConversation({ agentType });
    setOpen(false);
    setQuery('');
    onCreateConversation(created.id);
  }

  function handleSelect(conversationId: number) {
    setOpen(false);
    onSelectConversation(conversationId);
  }

  const activeConversation = useMemo(
    () =>
      conversations.find(
        (c) => c.id === (explicitConversationId ?? activeConversationId),
      ) ?? null,
    [conversations, explicitConversationId, activeConversationId],
  );

  const visibleConversations = filterConversations(conversations, deferredQuery);

  return (
    <div ref={rootRef} className="conversation-dropdown relative inline-flex">
      <button
        type="button"
        data-testid="conversation-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="切换会话"
        title={activeConversation?.title ?? '切换会话'}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg border border-white/[0.06] bg-white/[0.03] text-mac-text-muted/80 hover:text-white hover:bg-white/[0.06] outline-none focus:border-mac-blue/50"
      >
        <History size={14} />
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          className="conversation-dropdown__menu"
          role="menu"
          aria-label="会话列表"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: 280,
            maxHeight: 420,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 12,
            border: '1px solid var(--color-separator, rgba(255,255,255,0.12))',
            background: 'var(--color-bg-elevated, #2c2c2e)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {/* 新建会话 */}
          <button
            type="button"
            data-testid="conversation-dropdown-create"
            onClick={() => void handleCreate()}
            className="flex items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-mac-blue hover:bg-white/[0.05] border-none bg-transparent cursor-pointer"
          >
            <Plus size={15} />
            新建会话
          </button>

          <div className="px-2 pb-1.5 border-t border-white/[0.06] pt-2">
            <label className="relative flex items-center">
              <span
                className="pointer-events-none absolute left-2.5 text-mac-text-muted/50"
                aria-hidden="true"
              >
                <Search size={13} />
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索会话"
                aria-label="搜索会话"
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] py-1.5 pl-7 pr-2 text-[12px] text-white placeholder:text-mac-text-muted/40 outline-none focus:border-mac-blue/50"
              />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
            {loading ? (
              <div className="px-2 py-3 text-[12px] text-mac-text-muted/60">
                正在加载会话列表...
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-2 py-4 text-center text-[12px] text-mac-text-muted/50">
                当前项目还没有会话
              </div>
            ) : visibleConversations.length === 0 ? (
              <div className="px-2 py-4 text-center text-[11px] text-mac-text-muted/50">
                没有匹配「{deferredQuery}」的会话
              </div>
            ) : (
              visibleConversations.map((conversation) => {
                const isActive = activeConversationId === conversation.id;
                const isExplicit = explicitConversationId === conversation.id;
                const isRenaming = renamingId === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    role="menuitem"
                    data-conversation-id={conversation.id}
                    className={`w-full rounded-lg px-2 py-2 border transition-colors ${
                      isActive
                        ? 'bg-mac-blue/10 border-mac-blue/40'
                        : 'bg-transparent border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-mac-text-muted/70">
                        <AgentIcon agentId={conversation.agentType} size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <input
                            type="text"
                            autoFocus
                            value={renameDraft}
                            aria-label="重命名会话"
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onBlur={() => commitRename(conversation.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitRename(conversation.id);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelRename();
                              }
                            }}
                            className="w-full rounded-md border border-mac-blue/50 bg-white/[0.04] px-1.5 py-0.5 text-[13px] font-medium text-white outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelect(conversation.id)}
                            onDoubleClick={() => beginRename(conversation)}
                            title="双击重命名"
                            className="block w-full text-left bg-transparent border-none p-0 cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-medium text-white truncate">
                                {conversation.title}
                              </span>
                              {conversation.externalId ? (
                                <span
                                  className="shrink-0 text-mac-text-muted/50"
                                  title="可恢复历史会话"
                                  aria-label="可恢复"
                                >
                                  <RotateCcw size={10} />
                                </span>
                              ) : null}
                              {isExplicit ? (
                                <span className="shrink-0 text-[10px] text-mac-blue/90">
                                  已进入
                                </span>
                              ) : null}
                            </div>
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-md p-1 text-mac-text-muted/50 hover:text-mac-red/80 hover:bg-white/[0.04]"
                        title="删除会话"
                        aria-label={`删除${conversation.title}`}
                        onClick={() => onDeleteConversation(conversation.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

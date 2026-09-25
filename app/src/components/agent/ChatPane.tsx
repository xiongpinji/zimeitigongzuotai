/**
 * ChatPane — 对话容器（T6 重做）。
 *
 * 职责拆分：
 *  - 数据/连接：复用 useConversationDetail + useConnectionLifecycle（不改数据流）。
 *  - ChatHeader：左侧 ConversationDropdown（会话切换/新建）+ 会话标题；
 *    右侧连接状态 + 上下文用量 + agent 只读标记（点击进设置）。
 *  - 消息区：MessageList，承接 turns + PermissionPrompt。
 *  - 底部：ChatComposer，接 T5 的 agentId/modelId/onModelChange/onOpenAgentSettings。
 *
 * 模型：会话级受控 state，默认取该 agent 的 presentation.defaultModel；
 * 发送时经 connection.send(blocks, { model }) → sendPrompt 透传。
 *
 * 会话的切换/新建已收敛到 header 的 ConversationDropdown（替换旧的左侧 SessionListPane）。
 * 新建/选择/删除回调由上层 SidebarWorkspaceShell 提供（维护 explicitConversationId + 连接）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../ui';
import { useConversationDetail } from '../../hooks/use-conversation-detail';
import { useConnectionLifecycle } from '../../hooks/use-connection-lifecycle';
import type { PromptInputBlock } from '../../../electron/acp/types';
import { parseSkillTokens } from '../../../electron/agent-skills/inject';
import { getAgentPresentation } from '../../lib/agent-presentation';
import { AgentIcon } from './AgentIcon';
import { MessageList } from './MessageList';
import { ChatComposer } from './ChatComposer';
import { ConversationDropdown } from './ConversationDropdown';

interface ChatPaneProps {
  projectDir: string | null;
  explicitActivated: boolean;
  /** 当前显式进入的会话 id（透传给 ConversationDropdown 标记「已进入」）。 */
  explicitConversationId: number | null;
  /** 选择会话回调。 */
  onSelectConversation: (conversationId: number) => void;
  /** 新建会话回调（创建后切到新会话）。 */
  onCreateConversation: (conversationId: number) => void;
  /** 删除会话回调。 */
  onDeleteConversation: (conversationId: number) => void;
  /** 打开设置中心并定位 Agent tab（点击 agent 只读标记触发）。 */
  onOpenAgentSettings?: () => void;
}

function formatConnectionStatus(status: string): string {
  switch (status) {
    case 'disconnected':
      return '未连接';
    case 'connecting':
      return '连接中...';
    case 'connected':
      return '已连接';
    case 'prompting':
      return '思考中...';
    case 'error':
      return '连接失败';
    default:
      return status;
  }
}

interface ChatHeaderProps {
  title: string;
  connectionStatus: string;
  resumable: boolean;
  usageLabel: string | null;
  agentType?: string;
  showConnectHint: boolean;
  explicitConversationId: number | null;
  onSelectConversation: (conversationId: number) => void;
  onCreateConversation: (conversationId: number) => void;
  onDeleteConversation: (conversationId: number) => void;
  onOpenAgentSettings?: () => void;
}

function ChatHeader({
  title,
  connectionStatus,
  resumable,
  usageLabel,
  agentType,
  showConnectHint,
  explicitConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onOpenAgentSettings,
}: ChatHeaderProps) {
  const agentPresentation = agentType ? getAgentPresentation(agentType) : null;
  return (
    <div className="px-3 py-2.5 border-b border-mac-separator shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <ConversationDropdown
          explicitConversationId={explicitConversationId}
          onSelectConversation={onSelectConversation}
          onCreateConversation={onCreateConversation}
          onDeleteConversation={onDeleteConversation}
        />
        <div className="text-sm font-semibold text-white truncate min-w-0 flex-1">
          {title}
        </div>
        {/* Agent 只读标记：展示当前 agent，点击进设置切换 */}
        {agentPresentation ? (
          <button
            type="button"
            data-testid="chat-header-agent"
            onClick={() => onOpenAgentSettings?.()}
            title={`${agentPresentation.displayName} — 在设置中切换 Agent`}
            className="shrink-0 inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-white/[0.06] bg-white/[0.03] text-[11px] text-mac-text-muted/80 hover:text-white hover:bg-white/[0.06] cursor-pointer"
          >
            <AgentIcon agentId={agentType!} size={13} />
            <span>{agentPresentation.displayName}</span>
          </button>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-mac-text-muted/60">
        <span>{formatConnectionStatus(connectionStatus)}</span>
        {resumable ? <span>可恢复历史会话</span> : <span>新会话</span>}
        {usageLabel ? <span>{usageLabel}</span> : null}
      </div>
      {showConnectHint ? (
        <div className="mt-2 text-[11px] text-mac-text-muted/50">
          当前仅展示会话内容。选择会话或发送消息后，才会建立 ACP 连接。
        </div>
      ) : null}
    </div>
  );
}

export function ChatPane({
  projectDir,
  explicitActivated,
  explicitConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onOpenAgentSettings,
}: ChatPaneProps) {
  const { conversationId, detail, runtime, loading, error } = useConversationDetail();
  const connection = useConnectionLifecycle({
    conversationId: conversationId ?? -1,
    projectDir: projectDir ?? undefined,
    sessionId: detail?.externalId ?? null,
    agentType: detail?.agentType,
    isActive: explicitActivated && conversationId !== null,
    autoConnectOnActive: explicitActivated && conversationId !== null,
  });

  const isPrompting = connection.status === 'prompting';
  const turns = runtime?.turns ?? [];
  const usageLabel = useMemo(() => {
    if (!runtime?.usage || runtime.usage.size <= 0) return null;
    const percent = (runtime.usage.used / runtime.usage.size) * 100;
    return `上下文 ${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
  }, [runtime?.usage]);

  // 会话级模型选择：默认取该 agent 的 defaultModel。会话切换时重置为新 agent 的默认。
  const agentType = detail?.agentType;

  // 当前 agent 启用且可用的内置 skills，作为 $ 补全候选。
  const [skillItems, setSkillItems] = useState<{ id: string; label: string; description?: string }[]>([]);
  useEffect(() => {
    if (!agentType || typeof window.agentAPI?.listSkills !== 'function') {
      setSkillItems([]);
      return;
    }
    let alive = true;
    void window.agentAPI.listSkills(agentType).then((list) => {
      if (!alive) return;
      setSkillItems(
        list
          .filter((s) => s.enabled && s.status === 'available')
          .map((s) => ({ id: s.id, label: `$${s.id}`, description: s.displayName })),
      );
    });
    return () => {
      alive = false;
    };
  }, [agentType]);

  // 全局审批模式（agent-config.permissionPolicy）。底栏 pill 读写，运行时即时同步。
  const [permissionPolicy, setPermissionPolicy] = useState<string>('tiered');
  useEffect(() => {
    if (typeof window.agentAPI?.getPermissionPolicy !== 'function') return;
    let alive = true;
    void window.agentAPI.getPermissionPolicy().then((p) => {
      if (alive && p) setPermissionPolicy(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  const handlePermissionPolicyChange = useCallback((policy: string) => {
    setPermissionPolicy(policy);
    void window.agentAPI?.setPermissionPolicy?.(policy as never);
  }, []);

  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  // 会话级思考程度：默认取该 agent 的 defaultReasoning。会话/agent 切换时重置。
  const [selectedReasoning, setSelectedReasoning] = useState<string | undefined>(undefined);
  useEffect(() => {
    const presentation = agentType ? getAgentPresentation(agentType) : null;
    setSelectedModel(presentation?.defaultModel ?? presentation?.models?.[0]?.id);
    setSelectedReasoning(
      presentation?.defaultReasoning ?? presentation?.reasoningOptions?.[0]?.id,
    );
  }, [agentType, conversationId]);

  const ensureConnected = useCallback(async () => {
    if (!conversationId || !projectDir) return;
    if (connection.status === 'connected' || connection.status === 'prompting') return;
    await connection.connect({
      projectDir,
      sessionId: detail?.externalId ?? null,
      agentType: detail?.agentType,
    });
  }, [conversationId, projectDir, connection, detail]);

  const handleSend = useCallback(
    async (blocks: PromptInputBlock[]) => {
      if (!conversationId || !projectDir) return;
      const opts: { model?: string; reasoning?: string; skillIds?: string[] } = {};
      if (selectedModel) opts.model = selectedModel;
      if (selectedReasoning) opts.reasoning = selectedReasoning;
      // 解析用户消息里的 $skill-id（main 侧会二次校验启用态）
      const text = blocks
        .filter((b): b is PromptInputBlock & { type: 'text' } => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      const skillIds = parseSkillTokens(text);
      if (skillIds.length > 0) opts.skillIds = skillIds;
      // 连接 / 发送任一步失败（模型不可用、未连接、IPC 报错等）都在此统一兜底，
      // 把错误 surface 成会话流内的 error block，避免面板静默停止、用户无从判断。
      try {
        await ensureConnected();
        await connection.send(blocks, Object.keys(opts).length > 0 ? opts : undefined);
      } catch (error) {
        connection.reportError(error instanceof Error ? error.message : String(error));
      }
    },
    [conversationId, projectDir, ensureConnected, connection, selectedModel, selectedReasoning],
  );

  if (conversationId === null) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="px-3 py-2.5 border-b border-mac-separator shrink-0">
          <ConversationDropdown
            explicitConversationId={explicitConversationId}
            onSelectConversation={onSelectConversation}
            onCreateConversation={onCreateConversation}
            onDeleteConversation={onDeleteConversation}
          />
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <EmptyState
            title="尚未选择会话"
            description="点击上方会话切换按钮新建会话，或选择一个已有会话。"
          />
        </div>
      </div>
    );
  }

  if (loading && !detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-mac-text-muted/60">
        正在加载会话详情...
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-mac-red/70 px-6 text-center">
        会话详情加载失败：{error}
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <ChatHeader
        title={detail?.title ?? `会话 ${conversationId}`}
        connectionStatus={connection.status}
        resumable={Boolean(detail?.externalId)}
        usageLabel={usageLabel}
        agentType={detail?.agentType}
        showConnectHint={!explicitActivated}
        explicitConversationId={explicitConversationId}
        onSelectConversation={onSelectConversation}
        onCreateConversation={onCreateConversation}
        onDeleteConversation={onDeleteConversation}
        onOpenAgentSettings={onOpenAgentSettings}
      />

      <MessageList
        turns={turns}
        pendingPermission={connection.pendingPermission}
        onRespondPermission={(requestId, optionId) =>
          void connection.respondPermission(requestId, optionId)
        }
        fallbackAgentId={detail?.agentType}
        isStreaming={isPrompting}
        projectDir={projectDir}
      />

      <div className="px-3 py-3 border-t border-mac-separator shrink-0 flex flex-col gap-1.5">
        {connection.autoConnectError ? (
          <div className="text-[11px] text-mac-red/70 px-1">
            连接失败：{connection.autoConnectError}
          </div>
        ) : null}
        <ChatComposer
          onSend={(blocks) => void handleSend(blocks)}
          onCancel={isPrompting ? () => void connection.cancel() : undefined}
          disabled={conversationId === null || !projectDir}
          isPrompting={isPrompting}
          autoFocus={explicitActivated && conversationId !== null}
          placeholder={
            isPrompting
              ? 'Agent 正在思考中，按 Enter 追加消息…'
              : '输入消息开始对话… 可粘贴或拖拽文件'
          }
          projectDir={projectDir}
          availableCommands={connection.availableCommands}
          configOptions={connection.configOptions}
          onConfigOptionChange={(configId, valueId) =>
            void connection.setConfigOption(configId, valueId)
          }
          availableModes={connection.availableModes}
          currentModeId={connection.currentModeId}
          onModeChange={(modeId) => void connection.setMode(modeId)}
          agentId={agentType}
          modelId={selectedModel}
          onModelChange={setSelectedModel}
          reasoningId={selectedReasoning}
          onReasoningChange={setSelectedReasoning}
          skillItems={skillItems}
          permissionPolicy={permissionPolicy}
          onPermissionPolicyChange={handlePermissionPolicyChange}
        />
        {!explicitActivated ? (
          <div className="text-[10px] text-mac-text-muted/40 px-1">
            发送消息后自动建立 ACP 连接
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { create } from 'zustand';
import type { ConnectionStatus } from '../../electron/acp/types';

// ─── Store ────────────────────────────────────────────────
//
// 这个 store 在 ACP 多会话架构里只承担两件事：
//   1. AI 侧边栏的可见性（sidebarOpen / toggleSidebar），属于全局 UI 状态。
//   2. 作为 AppStatusBar / Toolbar / AgentHeader 等位于 AcpConnectionsProvider
//      之外的组件的"active 会话状态镜像"。状态由 AcpConnectionsProvider 内部
//      的 useEffect 主动同步进来（见 contexts/acp-connections-context.tsx），
//      外部组件只读不写。
//
// 历史上曾经承载过整条 ACP 会话（消息列表、配置、模式、命令等），那些字段在
// 迁移到 per-conversation 架构后已经没人用，已经在本次清理中移除。
//

interface AgentState {
  status: ConnectionStatus;
  sidebarOpen: boolean;
  contextUsage: { used: number; size: number } | null;
  autoConnectError: string | null;
}

interface AgentActions {
  setStatus: (status: ConnectionStatus) => void;
  toggleSidebar: () => void;
  setContextUsage: (usage: { used: number; size: number } | null) => void;
  setAutoConnectError: (error: string | null) => void;
}

const initialState: AgentState = {
  status: 'disconnected',
  sidebarOpen: false,
  contextUsage: null,
  autoConnectError: null,
};

export const useAgentStore = create<AgentState & AgentActions>((set) => ({
  ...initialState,

  setStatus: (status) => set({ status }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setContextUsage: (usage) => set({ contextUsage: usage }),
  setAutoConnectError: (error) => set({ autoConnectError: error }),
}));

const AGENT_SESSION_LIST_COLLAPSED_KEY = 'podcast-editor-agent-session-list-collapsed';

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function loadAgentSessionListCollapsed(): boolean {
  try {
    if (!canUseStorage()) {
      return false;
    }

    return localStorage.getItem(AGENT_SESSION_LIST_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveAgentSessionListCollapsed(collapsed: boolean): void {
  try {
    if (!canUseStorage()) {
      return;
    }

    localStorage.setItem(AGENT_SESSION_LIST_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch {
    // localStorage 不可用时忽略，保持界面可用。
  }
}

/**
 * 桥设置（设计文档第 7 节）。
 *
 * 与 AI 设置隔离，独立持久化于 chrome.storage.local 键 sonar:bridge-settings。
 * token 是本机 loopback 共享密钥（用户从桌面端复制），视图遮罩、不回读明文。
 * 这里是纯逻辑（默认值 / 应用更新 / 视图 / 内存实现）；chrome 实现见 background/chrome-bridge-store.ts。
 */

export interface BridgeSettings {
  enabled: boolean;
  endpoint: string;
  /** 明文存储；不回读到视图。 */
  token: string;
}

export interface BridgeSettingsView {
  enabled: boolean;
  endpoint: string;
  hasToken: boolean;
  tokenMasked?: string;
  /** 桥是否已配置（启用 + 有端点 + 有 token）。 */
  configured: boolean;
}

export interface UpdateBridgeSettingsInput {
  enabled?: boolean;
  endpoint?: string;
  /** 省略时保留既有 token（避免遮罩回写清空）。 */
  token?: string;
}

export interface BridgeSettingsStore {
  get(): Promise<BridgeSettings>;
  update(input: UpdateBridgeSettingsInput): Promise<void>;
}

export const DEFAULT_BRIDGE_ENDPOINT = 'http://127.0.0.1:19820';

export function defaultBridgeSettings(): BridgeSettings {
  return { enabled: false, endpoint: DEFAULT_BRIDGE_ENDPOINT, token: '' };
}

export function migrateBridgeSettings(stored: unknown): BridgeSettings {
  const base = defaultBridgeSettings();
  if (!stored || typeof stored !== 'object') return base;
  const r = stored as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    endpoint: typeof r.endpoint === 'string' && r.endpoint ? r.endpoint : base.endpoint,
    token: typeof r.token === 'string' ? r.token : '',
  };
}

export function applyBridgeSettingsUpdate(
  current: BridgeSettings,
  input: UpdateBridgeSettingsInput,
): BridgeSettings {
  return {
    enabled: input.enabled ?? current.enabled,
    endpoint: input.endpoint !== undefined && input.endpoint !== '' ? input.endpoint : current.endpoint,
    // token 省略 → 保留；显式传空串视为不变（遮罩视图回写保护）。
    token: input.token !== undefined && input.token !== '' ? input.token : current.token,
  };
}

export function maskToken(token: string): string | undefined {
  if (!token) return undefined;
  if (token.length <= 4) return '••••';
  return `••••${token.slice(-4)}`;
}

export function toBridgeSettingsView(s: BridgeSettings): BridgeSettingsView {
  return {
    enabled: s.enabled,
    endpoint: s.endpoint,
    hasToken: Boolean(s.token),
    configured: s.enabled && Boolean(s.endpoint) && Boolean(s.token),
    ...(maskToken(s.token) !== undefined ? { tokenMasked: maskToken(s.token) } : {}),
  };
}

export function createMemoryBridgeSettingsStore(initial?: Partial<BridgeSettings>): BridgeSettingsStore {
  let state: BridgeSettings = { ...defaultBridgeSettings(), ...initial };
  return {
    async get() {
      return state;
    },
    async update(input) {
      state = applyBridgeSettingsUpdate(state, input);
    },
  };
}

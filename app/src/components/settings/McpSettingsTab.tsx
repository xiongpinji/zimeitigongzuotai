import { useState, useEffect, useCallback } from 'react';
import { Server, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '../../ui';
import styles from './McpSettingsTab.module.css';

/** 支持注册的 AI 工具列表 */
const AI_TOOLS = [
  { app: 'claude_code', label: 'Claude Code' },
  { app: 'gemini', label: 'Gemini CLI' },
] as const;

type AppId = (typeof AI_TOOLS)[number]['app'];

interface ServiceStatus {
  running: boolean;
  port: number;
  url: string;
}

export function McpSettingsTab() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [registrations, setRegistrations] = useState<Record<AppId, boolean>>({
    claude_code: false,
    gemini: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [busyApp, setBusyApp] = useState<AppId | null>(null);

  /** 刷新服务状态和所有工具的注册状态 */
  const refresh = useCallback(async () => {
    if (!window.mcpAPI) return;
    setRefreshing(true);
    try {
      const [s, ...regs] = await Promise.all([
        window.mcpAPI.getStatus(),
        ...AI_TOOLS.map((t) => window.mcpAPI!.isRegistered(t.app)),
      ]);
      setStatus(s);
      const next = { ...registrations };
      AI_TOOLS.forEach((t, i) => {
        next[t.app] = regs[i];
      });
      setRegistrations(next);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** 注册 / 移除某个 AI 工具 */
  const toggleRegistration = useCallback(
    async (app: AppId, registered: boolean) => {
      if (!window.mcpAPI) return;
      setBusyApp(app);
      try {
        if (registered) {
          await window.mcpAPI.removeFromApp(app);
        } else {
          await window.mcpAPI.registerToApp(app);
        }
        await refresh();
      } finally {
        setBusyApp(null);
      }
    },
    [refresh],
  );

  // 桌面端不可用时显示提示
  if (typeof window === 'undefined' || !window.mcpAPI) {
    return (
      <div className={styles.unavailable}>
        <XCircle size={18} />
        <span>MCP 服务仅在桌面端可用</span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* ─── Section 1: 服务状态 ──────────────────────── */}
      <div>
        <div className={styles.sectionHeader}>
          <Server size={20} className={styles.sectionIcon} />
          <h2 className={styles.sectionTitle}>MCP 服务状态</h2>
        </div>

        <div className={styles.statusRow}>
          <span
            className={`${styles.indicator} ${
              status?.running ? styles.indicatorRunning : styles.indicatorStopped
            }`}
          />
          <span className={styles.statusText}>
            {status?.running ? '运行中' : '已停止'}
          </span>
          {status?.running && (
            <span className={styles.statusUrl}>{status.url}</span>
          )}
          <Button.Ghost
            type="button"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            title="刷新状态"
            leftIcon={
              <RefreshCw size={12} className={refreshing ? styles.spinning : ''} />
            }
          >
            刷新
          </Button.Ghost>
        </div>
      </div>

      <hr className={styles.divider} />

      {/* ─── Section 2: 注册到 AI 工具 ───────────────── */}
      <div>
        <div className={styles.sectionHeader}>
          <CheckCircle size={20} className={styles.sectionIcon} />
          <h2 className={styles.sectionTitle}>注册到 AI 工具</h2>
        </div>
        <p className={styles.sectionDesc}>
          将本应用的 MCP 服务注册到外部 AI 工具，使其可以直接调用编辑器能力。
        </p>

        <div className={styles.appList}>
          {AI_TOOLS.map(({ app, label }) => {
            const registered = registrations[app];
            const busy = busyApp === app;

            return (
              <div key={app} className={styles.appRow}>
                <span className={styles.appName}>{label}</span>
                <span
                  className={`${styles.statusBadge} ${
                    registered ? styles.statusRegistered : styles.statusUnregistered
                  }`}
                >
                  {registered ? '已注册' : '未注册'}
                </span>
                <Button
                  type="button"
                  variant={registered ? 'destructive' : 'primary'}
                  size="sm"
                  disabled={busy}
                  onClick={() => toggleRegistration(app, registered)}
                >
                  {busy ? '处理中...' : registered ? '移除' : '注册'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

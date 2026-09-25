// src/lib/config-backup-client.ts
export interface BackupPreviewData {
  filePath: string;
  exportedAt: string;
  appVersion: string;
  platform: string;
}

export interface ImportResultData {
  appliedFrom: string;
  settingsBackupPath: string;
  agentBackupPath?: string;
}

function ensureApi(): NonNullable<typeof window.electronAPI> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('配置备份仅在桌面端可用');
  }
  return window.electronAPI;
}

/** 触发导出；返回 filePath 或 null（用户取消） */
export async function exportConfig(): Promise<string | null> {
  const api = ensureApi();
  const result = await api.exportConfigBackup();
  if (result.canceled) return null;
  return result.filePath;
}

/** 弹文件选择器 → 读取并校验；返回元信息或 null（取消） */
export async function previewConfig(): Promise<BackupPreviewData | null> {
  const api = ensureApi();
  const result = await api.previewConfigBackup();
  if (result.canceled) return null;
  return {
    filePath: result.filePath,
    exportedAt: result.exportedAt,
    appVersion: result.appVersion,
    platform: result.platform,
  };
}

/** 应用导入（覆盖当前配置，会自动备份旧值） */
export async function applyImport(filePath: string): Promise<ImportResultData> {
  const api = ensureApi();
  return api.importConfigBackup({ filePath });
}

export function formatPlatform(p: string): string {
  switch (p) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return p;
  }
}

export function formatExportedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export type AppLogLevel = 'info' | 'warn' | 'error';

export interface AppLogEntry {
  id: string;
  timestamp: string;
  level: AppLogLevel;
  scope: string;
  message: string;
  details?: string;
}

export function formatLogLine(entry: AppLogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`;
  return entry.details ? `${base}\n${entry.details}` : base;
}

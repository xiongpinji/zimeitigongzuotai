import type { Event, WebContentsConsoleMessageEventParams } from 'electron';

type AppLogLevel = 'info' | 'warn' | 'error';

type RendererConsoleLog = {
  level: AppLogLevel;
  scope: 'renderer-console';
  message: string;
  details?: string;
};

const consoleLevelMap: Record<WebContentsConsoleMessageEventParams['level'], AppLogLevel> = {
  debug: 'info',
  info: 'info',
  warning: 'warn',
  error: 'error',
};

export function toRendererConsoleLog(
  details: Pick<Event<WebContentsConsoleMessageEventParams>, 'level' | 'message' | 'lineNumber' | 'sourceId'>,
): RendererConsoleLog {
  return {
    level: consoleLevelMap[details.level],
    scope: 'renderer-console',
    message: details.message,
    details: details.sourceId ? `${details.sourceId}:${details.lineNumber}` : undefined,
  };
}

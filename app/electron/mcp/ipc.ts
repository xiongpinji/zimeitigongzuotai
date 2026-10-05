/**
 * MCP IPC 处理器注册模块
 * 将 MCP 服务管理与配置管理能力暴露给渲染进程
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { McpConfigManager, type McpAppType } from './config-manager';
import { startMcpServer, stopMcpServer, getMcpServerStatus } from './server';
import type { ProductionReadService, ProductionRecordingImport } from './production-tools';
import type { AgentActionGateDecision } from '../production/agent-action-gate';
import type { ProductionAssetSearch } from '../production/asset-search';

const configManager = new McpConfigManager();

/**
 * 注册所有 MCP 相关的 IPC 处理器
 * @param getMainWindow 获取主窗口实例的回调
 */
export function registerMcpIpc(getMainWindow: () => BrowserWindow | null,
  getProductionReadService?: () => ProductionReadService | null,
  authorizeQualityCheck?: () => AgentActionGateDecision,
  getAssetSearch?: () => ProductionAssetSearch | null,
  authorizeAssetSearch?: () => AgentActionGateDecision,
  getRecordingImport?: () => ProductionRecordingImport | null,
  authorizeRecordingImport?: () => AgentActionGateDecision): void {
  // ─── 服务管理 ───────────────────────────────────────────
  ipcMain.handle('mcp:get-status', () => {
    return getMcpServerStatus();
  });

  ipcMain.handle('mcp:start', (_event, port: number) => {
    return startMcpServer(port, getMainWindow, getProductionReadService, authorizeQualityCheck,
      getAssetSearch, authorizeAssetSearch, getRecordingImport, authorizeRecordingImport);
  });

  ipcMain.handle('mcp:stop', () => {
    return stopMcpServer();
  });

  // ─── 配置管理 ───────────────────────────────────────────
  ipcMain.handle('mcp:scan-local', () => {
    return configManager.scanLocal();
  });

  ipcMain.handle('mcp:register-to-app', (_event, app: McpAppType) => {
    const status = getMcpServerStatus();
    return configManager.registerToApp(app, status.port);
  });

  ipcMain.handle('mcp:remove-from-app', (_event, app: McpAppType) => {
    return configManager.removeFromApp(app);
  });

  ipcMain.handle('mcp:is-registered', (_event, app: McpAppType) => {
    return configManager.isRegistered(app);
  });
}

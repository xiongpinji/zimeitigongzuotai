/**
 * MCP API 类型定义
 * 对应 preload.ts 中通过 contextBridge 暴露的 window.mcpAPI
 */

export interface McpAPI {
  // ─── 服务管理 ───────────────────────────────────────────
  getStatus(): Promise<{ running: boolean; port: number; url: string }>;
  start(port: number): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;

  // ─── 配置管理 ───────────────────────────────────────────
  scanLocal(): Promise<Array<{ id: string; spec: Record<string, unknown>; apps: string[] }>>;
  registerToApp(app: string): Promise<void>;
  removeFromApp(app: string): Promise<boolean>;
  isRegistered(app: string): Promise<boolean>;

  // ─── MCP Tool 事件监听（Main → Renderer） ──────────────
  onGetEditorState(handler: (payload: unknown) => void): () => void;
  onReadScript(handler: (payload: unknown) => void): () => void;
  onGenerateScript(handler: (payload: unknown) => void): () => void;
  onUpdateScript(handler: (payload: unknown) => void): () => void;
  onSubmitReview(handler: (payload: unknown) => void): () => void;
  onListProjectFiles(handler: (payload: unknown) => void): () => void;
  onGetProjectContext(handler: (payload: unknown) => void): () => void;

  // ─── MCP 日志监听（Main → Renderer） ──────────────────
  onLog(handler: (data: { level: string; message: string }) => void): () => void;

  // ─── 回复辅助 ──────────────────────────────────────────
  reply(replyChannel: string, data: unknown): Promise<void>;
}

declare global {
  interface Window {
    mcpAPI?: McpAPI;
  }
}

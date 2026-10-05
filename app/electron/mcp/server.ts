/**
 * MCP HTTP Server 管理模块
 * 提供 Streamable HTTP 传输层，允许外部 AI 工具通过标准 MCP 协议与编辑器交互
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools';
import { writeEndpointFile, removeEndpointFile } from './endpoint-file';
import { createSonarInboxStore, type SonarInboxStore } from '../sonar/inbox-store';
import { getOrCreateSonarToken } from '../sonar/token';
import { handleSonarHttp, isSonarPath } from '../sonar/routes';
import { authorizeProductionMcpRequest } from './production-auth';
import { registerProductionReadTools, type ProductionReadService,
  type ProductionRecordingImport, type ProductionRecordingList,
  type ProductionHighlightDetection, type ProductionCompositionBuild } from './production-tools';
import type { AgentActionGateDecision } from '../production/agent-action-gate';
import type { ProductionAssetSearch } from '../production/asset-search';

// ─── 模块状态 ─────────────────────────────────────────────
let httpServer: Server | null = null;
let currentPort = 19820;
let getMainWindowFn: (() => BrowserWindow | null) | null = null;
let getProductionReadServiceFn: (() => ProductionReadService | null) | null = null;
let authorizeQualityCheckFn: (() => AgentActionGateDecision) | null = null;
let getAssetSearchFn: (() => ProductionAssetSearch | null) | null = null;
let authorizeAssetSearchFn: (() => AgentActionGateDecision) | null = null;
let getRecordingImportFn: (() => ProductionRecordingImport | null) | null = null;
let authorizeRecordingImportFn: (() => AgentActionGateDecision) | null = null;
let getRecordingListFn: (() => ProductionRecordingList | null) | null = null;
let getHighlightDetectionFn: (() => ProductionHighlightDetection | null) | null = null;
let authorizeHighlightDetectionFn: (() => AgentActionGateDecision) | null = null;
let getCompositionBuildFn: (() => ProductionCompositionBuild | null) | null = null;
let authorizeCompositionBuildFn: (() => AgentActionGateDecision) | null = null;
let productionToken = '';
const PRODUCTION_TOKEN_FILE = join(homedir(), '.lingji', 'production-mcp-token');

// ─── 声呐桥状态 ───────────────────────────────────────────
let sonarStore: SonarInboxStore | null = null;
let sonarToken = '';

/** 暴露给主进程/IPC：待创作箱 store（启动后非空）。 */
export function getSonarInboxStore(): SonarInboxStore | null {
  return sonarStore;
}

/** 暴露给主进程/IPC：桥端点信息（端口 + token），供设置页展示让用户复制进扩展。 */
export function getSonarBridgeInfo(): { port: number; token: string } {
  return { port: currentPort, token: sonarToken };
}

/** sessionId → { transport, server } 映射 */
const sessions: Record<string, { transport: StreamableHTTPServerTransport; server: McpServer }> = Object.create(null);
const productionSessions: typeof sessions = Object.create(null);

/** 为每个新会话创建独立的 McpServer 实例 */
function createSessionServer(production: boolean): McpServer {
  const server = new McpServer(
    { name: 'lingji-editor', version: '1.0.0' },
    { capabilities: { logging: {} } },
  );
  if (production) registerProductionReadTools(server, () => getProductionReadServiceFn?.() ?? null,
    () => authorizeQualityCheckFn?.() ?? { allowed: false, reason: 'grant_missing' },
    () => getAssetSearchFn?.() ?? null,
    () => authorizeAssetSearchFn?.() ?? { allowed: false, reason: 'grant_missing' },
    () => getRecordingImportFn?.() ?? null,
    () => authorizeRecordingImportFn?.() ?? { allowed: false, reason: 'grant_missing' },
    () => getRecordingListFn?.() ?? null,
    () => getHighlightDetectionFn?.() ?? null,
    () => authorizeHighlightDetectionFn?.() ?? { allowed: false, reason: 'grant_missing' },
    () => getCompositionBuildFn?.() ?? null,
    () => authorizeCompositionBuildFn?.() ?? { allowed: false, reason: 'grant_missing' });
  else registerTools(server, getMainWindowFn!);
  return server;
}

// ─── CORS 辅助 ─────────────────────────────────────────────
function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Last-Event-ID, x-sonar-token');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}

// ─── 请求体解析 ──────────────────────────────────────────
class RequestTooLargeError extends Error {}

function parseRequestBody(req: IncomingMessage, maxBytes = Infinity): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { tooLarge = true; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) { reject(new RequestTooLargeError()); return; }
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ─── 公开 API ─────────────────────────────────────────────

/**
 * 启动 MCP HTTP Server
 * @param port 监听端口，默认 19820
 * @param getMainWindow 获取 Electron 主窗口的回调
 */
export async function startMcpServer(
  port = 19820,
  getMainWindow: () => BrowserWindow | null,
  getProductionReadService?: () => ProductionReadService | null,
  authorizeQualityCheck?: () => AgentActionGateDecision,
  getAssetSearch?: () => ProductionAssetSearch | null,
  authorizeAssetSearch?: () => AgentActionGateDecision,
  getRecordingImport?: () => ProductionRecordingImport | null,
  authorizeRecordingImport?: () => AgentActionGateDecision,
  getRecordingList?: () => ProductionRecordingList | null,
  getHighlightDetection?: () => ProductionHighlightDetection | null,
  authorizeHighlightDetection?: () => AgentActionGateDecision,
  getCompositionBuild?: () => ProductionCompositionBuild | null,
  authorizeCompositionBuild?: () => AgentActionGateDecision,
): Promise<void> {
  // 防止重复启动
  if (httpServer) {
    console.log('[MCP] 服务已在运行中，跳过重复启动');
    return;
  }

  currentPort = port;
  getMainWindowFn = getMainWindow;
  getProductionReadServiceFn = getProductionReadService ?? null;
  authorizeQualityCheckFn = authorizeQualityCheck ?? null;
  getAssetSearchFn = getAssetSearch ?? null;
  authorizeAssetSearchFn = authorizeAssetSearch ?? null;
  getRecordingImportFn = getRecordingImport ?? null;
  authorizeRecordingImportFn = authorizeRecordingImport ?? null;
  getRecordingListFn = getRecordingList ?? null;
  getHighlightDetectionFn = getHighlightDetection ?? null;
  authorizeHighlightDetectionFn = authorizeHighlightDetection ?? null;
  getCompositionBuildFn = getCompositionBuild ?? null;
  authorizeCompositionBuildFn = authorizeCompositionBuild ?? null;

  // 声呐桥：待创作箱 store + 共享 token（loopback + token 鉴权）
  sonarStore = createSonarInboxStore();
  sonarToken = await getOrCreateSonarToken();
  productionToken = '';
  if (getProductionReadServiceFn) {
    try { productionToken = await getOrCreateSonarToken(PRODUCTION_TOKEN_FILE); }
    catch { console.error('[MCP] production token unavailable'); }
  }

  // 创建 HTTP 服务
  httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // Production transport is separate from the legacy editor surface. Every
    // POST/GET/DELETE is authenticated before MCP sees the request or session.
    if (pathname === '/production-mcp') {
      if (!authorizeProductionMcpRequest({
        remoteAddress: req.socket.remoteAddress,
        origin: req.headers.origin,
        tokenHeader: req.headers['x-lingji-production-token'],
      }, productionToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try { await handleMcpRequest(req, res, true); }
      catch (error) {
        if (!res.headersSent) {
          const tooLarge = error instanceof RequestTooLargeError;
          res.writeHead(tooLarge ? 413 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: tooLarge ? 'Request too large' : 'Internal server error' }));
        }
      }
      return;
    }

    // 所有响应都带 CORS 头
    setCorsHeaders(res);

    // ── OPTIONS 预检 ──
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── 健康检查 ──
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', name: 'lingji-editor' }));
      return;
    }

    // ── MCP 协议端点 ──
    if (pathname === '/mcp') {
      try {
        await handleMcpRequest(req, res);
      } catch (err) {
        console.error('[MCP] 处理请求出错:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }));
        }
      }
      return;
    }

    // ── 声呐桥端点（仅 loopback + token）──
    if (isSonarPath(pathname)) {
      try {
        await handleSonarHttp(req, res, {
          store: sonarStore!,
          expectedToken: sonarToken,
          version: '1.0.0',
          endpoint: `http://127.0.0.1:${currentPort}`,
          // 收件箱有新增/刷新 → 通知渲染端待创作箱实时刷新（无需手动点刷新）。
          onInboxChanged: () => {
            try {
              getMainWindowFn?.()?.webContents.send('sonar-inbox-updated');
            } catch (e) {
              console.warn('[Sonar] 通知渲染端刷新失败', e);
            }
          },
        });
      } catch (err) {
        console.error('[Sonar] 处理请求出错:', err);
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Request' }));
        }
      }
      return;
    }

    // ── 未知路由 ──
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return new Promise<void>((resolve, reject) => {
    httpServer!.listen(port, '127.0.0.1', () => {
      console.log(`[MCP] HTTP Server 已启动: http://127.0.0.1:${port}/mcp`);
      void writeEndpointFile(port, undefined, sonarToken).catch((err) =>
        console.error('[MCP] 写端点文件失败:', err),
      );
      resolve();
    });
    httpServer!.on('error', (err) => {
      console.error('[MCP] HTTP Server 启动失败:', err);
      httpServer = null;
      reject(err);
    });
  });
}

/**
 * 停止 MCP HTTP Server
 */
export async function stopMcpServer(): Promise<void> {
  // 关闭所有活跃的 session
  for (const bucket of [sessions, productionSessions]) {
    for (const sessionId of Object.keys(bucket)) {
      try {
        await bucket[sessionId].transport.close();
        await bucket[sessionId].server.close();
      } catch {
        // 忽略关闭错误
      }
      delete bucket[sessionId];
    }
  }

  // 关闭 HTTP 服务
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
    void removeEndpointFile().catch(() => {});
  }

  console.log('[MCP] Server 已停止');
  productionToken = '';
  getProductionReadServiceFn = null;
  authorizeQualityCheckFn = null;
  getAssetSearchFn = null;
  authorizeAssetSearchFn = null;
  getRecordingImportFn = null;
  authorizeRecordingImportFn = null;
  getRecordingListFn = null;
  getHighlightDetectionFn = null;
  authorizeHighlightDetectionFn = null;
  getCompositionBuildFn = null;
  authorizeCompositionBuildFn = null;
}

/**
 * 获取 MCP Server 当前状态
 */
export function getMcpServerStatus(): { running: boolean; port: number; url: string } {
  return {
    running: httpServer !== null,
    port: currentPort,
    url: `http://127.0.0.1:${currentPort}/mcp`,
  };
}

// ─── 内部：MCP 请求分发 ───────────────────────────────────

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse,
  production = false): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const bucket = production ? productionSessions : sessions;

  // ── POST：消息请求 ──
  if (req.method === 'POST') {
    const body = await parseRequestBody(req, production ? 1024 * 1024 : Infinity);

    // 已有会话 → 复用 transport
    if (sessionId && bucket[sessionId]) {
      await bucket[sessionId].transport.handleRequest(req, res, body);
      return;
    }

    // 新初始化请求 → 创建独立的 McpServer + transport
    if (!sessionId && isInitializeRequest(body)) {
      const server = createSessionServer(production);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          console.log(`[MCP] 新会话已建立: ${sid}`);
          bucket[sid] = { transport, server };
        },
      });

      // 注意：不在 onclose 中删除 session
      // StreamableHTTPServerTransport 会在每次 HTTP 响应结束时触发 close
      // 但 session 应跨多个 HTTP 请求保持存活
      // session 仅在 DELETE 请求或 server 关闭时清理

      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // session ID 存在但 session 已过期 → 提示重新初始化
    if (sessionId && !bucket[sessionId]) {
      console.warn(`[MCP] 会话已过期: ${sessionId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session expired. Please reconnect.' },
        id: null,
      }));
      return;
    }

    // 无效请求
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null,
    }));
    return;
  }

  // ── GET：SSE 流 ──
  if (req.method === 'GET') {
    if (!sessionId || !bucket[sessionId]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
      return;
    }
    await bucket[sessionId].transport.handleRequest(req, res);
    return;
  }

  // ── DELETE：会话终止 ──
  if (req.method === 'DELETE') {
    if (!sessionId || !bucket[sessionId]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
      return;
    }
    const session = bucket[sessionId];
    await session.transport.handleRequest(req, res);
    // DELETE 请求后清理 session
    session.server.close().catch(() => {});
    delete bucket[sessionId];
    console.log(`[MCP] 会话已终止: ${sessionId}`);
    return;
  }

  // ── 不支持的方法 ──
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
}

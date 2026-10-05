/** Read-only production inspection tools; no staging, arming or platform submission. */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ProductPublishDraftError, type createProductPublishDraftService } from
  '../publish/product-publish-drafts';

export type ProductionReadService = Pick<ReturnType<typeof createProductPublishDraftService>,
  'listDrafts' | 'preview'>;
const metadata = z.object({ title: z.string(), description: z.string(),
  tags: z.array(z.string()), coverRefs: z.array(z.string()),
  scheduleAt: z.number().finite().nonnegative().nullable() }).strict();
const assignment = z.object({ accountId: z.string(), batchId: z.string(), planId: z.string(),
  metadata, commerceRequest: z.null() }).strict();

function result(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError };
}
function errorResult(error: unknown) {
  return result({ code: error instanceof ProductPublishDraftError ? error.code : 'internal_error' }, true);
}

export function registerProductionReadTools(server: McpServer,
  getService: () => ProductionReadService | null): void {
  server.registerTool('lingji_production_list_drafts', {
    title: '查看当前工程的安全发布草稿',
    description: '只返回账号与混剪版本的安全投影；不会提交平台，也不返回视频路径或会话。',
  }, async () => {
    const service = getService();
    if (!service) return result({ code: 'service_unavailable' }, true);
    try { return result({ drafts: await service.listDrafts() }); }
    catch (error) { return errorResult(error); }
  });

  server.registerTool('lingji_production_preview_publish', {
    title: '预检账号与审核版视频配对',
    description: '只读核对账号、平台、审核证据与重复版本风险；不会创建草稿或提交平台。',
    inputSchema: { assignments: z.array(assignment).min(1).max(1000) },
  }, async ({ assignments }) => {
    const service = getService();
    if (!service) return result({ code: 'service_unavailable' }, true);
    try { return result(await service.preview(assignments)); }
    catch (error) { return errorResult(error); }
  });
}

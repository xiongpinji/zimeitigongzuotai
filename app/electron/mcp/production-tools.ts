/** Production inspection and explicitly authorized recording import; no platform submission. */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ProductPublishDraftError, type createProductPublishDraftService } from
  '../publish/product-publish-drafts';
import type { AgentActionGateDecision } from '../production/agent-action-gate';
import type { ProductionAssetSearch } from '../production/asset-search';
import { PRODUCTION_PLATFORMS } from '../../src/types/production-contracts';
import { LocalAssetLibraryError } from '../assets/local-asset-library';

export type ProductionReadService = Pick<ReturnType<typeof createProductPublishDraftService>,
  'listDrafts' | 'preview'>;
export type ProductionRecordingImport = (maxClips: number) => Promise<
  | { ok: true; recordings: Array<{ id: string; sourceSha256: string; state: string }> }
  | { ok: false; code: string }>;
export type ProductionRecordingList = () =>
  | { ok: true; recordings: Array<{ id: string; sourceSha256: string; state: string;
    candidateCount: number; highlightCount: number; lastErrorCode: string | null }> }
  | { ok: false; code: string };
const metadata = z.object({ title: z.string(), description: z.string(),
  tags: z.array(z.string()), coverRefs: z.array(z.string()),
  scheduleAt: z.number().finite().nonnegative().nullable() }).strict();
const assignment = z.object({ accountId: z.string(), batchId: z.string(), planId: z.string(),
  metadata, commerceRequest: z.null() }).strict();

function result(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError };
}
function errorResult(error: unknown) {
  return result({ code: error instanceof ProductPublishDraftError || error instanceof LocalAssetLibraryError
    ? error.code : 'internal_error' }, true);
}

export function registerProductionReadTools(server: McpServer,
  getService: () => ProductionReadService | null,
  authorizeQualityCheck: () => AgentActionGateDecision,
  getAssetSearch: () => ProductionAssetSearch | null,
  authorizeAssetSearch: () => AgentActionGateDecision,
  getRecordingImport?: () => ProductionRecordingImport | null,
  authorizeRecordingImport?: () => AgentActionGateDecision,
  getRecordingList?: () => ProductionRecordingList | null): void {
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
    try {
      const decision = authorizeQualityCheck();
      if (!decision.allowed) return result({ code: decision.reason }, true);
      return result(await service.preview(assignments));
    }
    catch (error) { return errorResult(error); }
  });

  server.registerTool('lingji_production_search_authorized_assets', {
    title: '检索当前用途已授权的素材',
    description: '按平台、地区和商业用途检索素材，只返回已复核的素材 ID、类型和匹配分数。需要当前工程的限时分析授权。',
    inputSchema: {
      text: z.string().trim().min(1).max(4096),
      platform: z.enum(PRODUCTION_PLATFORMS),
      region: z.string().trim().min(1).max(80),
      commercialShortVideo: z.boolean(),
      maxResults: z.number().int().min(1).max(10),
    },
  }, async (input) => {
    const search = getAssetSearch();
    if (!search) return result({ code: 'service_unavailable' }, true);
    try {
      const first = authorizeAssetSearch();
      if (!first.allowed) return result({ code: first.reason }, true);
      const found = await search(input);
      const final = authorizeAssetSearch();
      if (!final.allowed) return result({ code: final.reason }, true);
      return result(found);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('lingji_production_import_recordings', {
    title: '导入当前工程已选择的录屏',
    description: '仅消费桌面文件选择器为当前工程选中的录屏，写入可恢复高光队列；不接受路径、不启动高光模型或平台发布。需要限时录屏导入授权。',
    inputSchema: { maxClips: z.number().int().min(1).max(12) },
  }, async ({ maxClips }) => {
    const first = authorizeRecordingImport?.() ?? { allowed: false as const, reason: 'grant_missing' as const };
    if (!first.allowed) return result({ code: first.reason }, true);
    const importer = getRecordingImport?.();
    if (!importer) return result({ code: 'service_unavailable' }, true);
    try {
      const imported = await importer(maxClips);
      const final = authorizeRecordingImport?.() ?? { allowed: false as const, reason: 'grant_missing' as const };
      if (!final.allowed) return result({ code: final.reason }, true);
      return imported.ok ? result({ recordings: imported.recordings }) : result({ code: imported.code }, true);
    } catch { return result({ code: 'internal_error' }, true); }
  });

  server.registerTool('lingji_production_list_recordings', {
    title: '查看当前工程已导入录屏任务',
    description: '只返回当前工程已绑定任务的安全状态和候选数量；不返回录屏路径或候选内容，不启动模型或发布。需要限时录屏导入授权。',
  }, async () => {
    const first = authorizeRecordingImport?.() ?? { allowed: false as const, reason: 'grant_missing' as const };
    if (!first.allowed) return result({ code: first.reason }, true);
    const list = getRecordingList?.();
    if (!list) return result({ code: 'service_unavailable' }, true);
    try {
      const listed = list();
      const final = authorizeRecordingImport?.() ?? { allowed: false as const, reason: 'grant_missing' as const };
      if (!final.allowed) return result({ code: final.reason }, true);
      return listed.ok ? result({ recordings: listed.recordings }) : result({ code: listed.code }, true);
    } catch { return result({ code: 'internal_error' }, true); }
  });
}

/**
 * R4 叙事候选端口。模型只能看到调用方显式批准的匿名描述与时间码；
 * 原始录屏路径、哈希、账号和素材授权记录留在主进程的生产文档中。
 */
import { randomUUID } from 'node:crypto';
import { parseProductionDocument } from '../../src/lib/production-document';
import { PRODUCTION_ASPECT_RATIOS } from '../../src/types/production-contracts';
import type {
  CompositionEditorialV1,
  CompositionPlanV1,
  CompositionSegmentEditorialV1,
  CompositionSegmentSourceV1,
  CompositionVisualLayerV1,
  CompositionVoiceoverKind,
  ProductionAspectRatio,
  ProductionDocumentV1,
} from '../../src/types/production-contracts';

export interface CompositionDraftSegment {
  description: string;
  source: CompositionSegmentSourceV1;
  editorial: CompositionSegmentEditorialV1;
  visualLayer?: CompositionVisualLayerV1;
}

export interface CompositionDraft {
  narrativeSummary: string;
  voiceoverKind: CompositionVoiceoverKind;
  aspectRatio: ProductionAspectRatio;
  editorial: CompositionEditorialV1;
  segments: CompositionDraftSegment[];
}

export interface CompositionProposalBrief {
  aspectRatio: ProductionAspectRatio;
  highlights: Array<{
    id: string;
    startMs: number;
    endMs: number;
    anonymousTopic: string;
    approvedTranscriptExcerpt: string | null;
  }>;
  assets: Array<{
    id: string;
    mediaType: 'video' | 'image';
    durationMs: number | null;
    anonymousDescription: string;
  }>;
}

export interface CompositionProposalInput {
  document: ProductionDocumentV1;
  approvedHighlights: Array<{
    id: string;
    anonymousTopic: string;
    approvedTranscriptExcerpt: string | null;
  }>;
  approvedAssets: Array<{ id: string; anonymousDescription: string }>;
  aspectRatio: ProductionAspectRatio;
  model: string;
  promptVersion: string;
  nowIso: string;
}

export interface CompositionProposalBatch {
  batchId: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  reviewRequired: true;
  plans: CompositionPlanV1[];
  reviewFlags: Array<{ planIds: [string, string]; reason: string }>;
}

export type CompositionProposalErrorCode =
  | 'invalid_input'
  | 'model_unavailable'
  | 'invalid_model_output'
  | 'insufficient_plans'
  | 'duplicate_plans';

export class CompositionProposalError extends Error {
  constructor(readonly code: CompositionProposalErrorCode, message: string) {
    super(message);
    this.name = 'CompositionProposalError';
  }
}

function fail(code: CompositionProposalErrorCode, message: string): never {
  throw new CompositionProposalError(code, message);
}

function approvedText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_000) {
    fail('invalid_input', `${field} 必须是 1–2000 字符的已审核文字`);
  }
  return value;
}

function makeBrief(input: CompositionProposalInput, doc: ProductionDocumentV1): CompositionProposalBrief {
  const highlights = new Map(doc.highlights.map((item) => [item.id, item]));
  const assets = new Map(doc.assets.map((item) => [item.id, item]));
  const seenHighlights = new Set<string>();
  const seenAssets = new Set<string>();
  const brief: CompositionProposalBrief = {
    aspectRatio: input.aspectRatio,
    highlights: input.approvedHighlights.map((approved) => {
      if (!approved || typeof approved !== 'object' || Array.isArray(approved)) {
        fail('invalid_input', '已审核高光卡片格式错误');
      }
      if (seenHighlights.has(approved.id)) fail('invalid_input', '已审核高光 ID 不能重复');
      seenHighlights.add(approved.id);
      const highlight = highlights.get(approved.id);
      if (!highlight) fail('invalid_input', '已审核高光不在生产文档内');
      const excerpt = approved.approvedTranscriptExcerpt;
      return {
        id: highlight.id,
        startMs: highlight.startMs,
        endMs: highlight.endMs,
        anonymousTopic: approvedText(approved.anonymousTopic, '匿名主题'),
        approvedTranscriptExcerpt: excerpt === null ? null : approvedText(excerpt, '批准的转写摘录'),
      };
    }),
    assets: input.approvedAssets.map((approved) => {
      if (!approved || typeof approved !== 'object' || Array.isArray(approved)) {
        fail('invalid_input', '已审核素材卡片格式错误');
      }
      if (seenAssets.has(approved.id)) fail('invalid_input', '已审核素材 ID 不能重复');
      seenAssets.add(approved.id);
      const asset = assets.get(approved.id);
      if (!asset || !asset.authorizedForAutoUse) fail('invalid_input', '素材不存在或未获自动使用授权');
      if (asset.mediaType !== 'video' && asset.mediaType !== 'image') {
        fail('invalid_input', '候选素材必须是视频或图片');
      }
      return {
        id: asset.id,
        mediaType: asset.mediaType,
        durationMs: asset.durationMs,
        anonymousDescription: approvedText(approved.anonymousDescription, '匿名素材描述'),
      };
    }),
  };
  if (brief.highlights.length === 0) fail('invalid_input', '至少需要一个已审核高光');
  return brief;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('invalid_model_output', '模型候选必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

function checkKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
    fail('invalid_model_output', '模型候选字段不符合计划契约');
  }
}

function hydrateDraft(value: unknown, batchId: string, index: number, nowIso: string): CompositionPlanV1 {
  const draft = asRecord(value);
  checkKeys(draft, ['narrativeSummary', 'voiceoverKind', 'aspectRatio', 'editorial', 'segments']);
  if (!Array.isArray(draft.segments)) fail('invalid_model_output', '模型分段必须是数组');
  const segments = draft.segments.map((value, segmentIndex) => {
    const segment = asRecord(value);
    checkKeys(segment, ['description', 'source', 'editorial'], ['visualLayer']);
    return {
      ...segment,
      id: `${batchId}-p${index + 1}-s${segmentIndex + 1}`,
      order: segmentIndex,
    };
  });
  return {
    ...draft,
    id: `${batchId}-p${index + 1}`,
    segments,
    timelineRef: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  } as CompositionPlanV1;
}

function normalizedClaim(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function evidenceKeys(plan: CompositionPlanV1): string[] {
  return plan.segments.map((segment) => `${segment.source.kind}:${segment.source.sourceId}`);
}

function reviewSimilarities(plans: CompositionPlanV1[]): CompositionProposalBatch['reviewFlags'] {
  const flags: CompositionProposalBatch['reviewFlags'] = [];
  for (let first = 0; first < plans.length; first++) {
    for (let second = first + 1; second < plans.length; second++) {
      const left = plans[first];
      const right = plans[second];
      const leftSources = evidenceKeys(left);
      const rightSources = evidenceKeys(right);
      const sameEvidence = JSON.stringify(leftSources.sort()) === JSON.stringify(rightSources.sort());
      if (!left.editorial || !right.editorial) {
        fail('invalid_model_output', '候选缺少中心问题');
      }
      const sameQuestion = normalizedClaim(left.editorial.centralQuestion)
        === normalizedClaim(right.editorial.centralQuestion);
      if (sameEvidence && sameQuestion) {
        fail('duplicate_plans', '候选只改外观或镜头顺序，缺少新的中心问题与证据路径');
      }
      if (sameEvidence) {
        flags.push({ planIds: [left.id, right.id], reason: 'same-source-evidence' });
      } else if (sameQuestion) {
        flags.push({ planIds: [left.id, right.id], reason: 'same-central-question' });
      }
    }
  }
  return flags;
}

/** 模型失败或无效候选一律停止；绝不随机改序补足三版。 */
export async function proposePlans(
  input: CompositionProposalInput,
  generate: (brief: CompositionProposalBrief) => Promise<unknown>,
): Promise<CompositionProposalBatch> {
  let doc: ProductionDocumentV1;
  try {
    doc = parseProductionDocument(input.document);
  } catch {
    fail('invalid_input', '生产文档未通过校验');
  }
  if (typeof input.nowIso !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.nowIso)
    || !Number.isFinite(Date.parse(input.nowIso))
    || !PRODUCTION_ASPECT_RATIOS.includes(input.aspectRatio)
    || !Array.isArray(input.approvedHighlights)
    || !Array.isArray(input.approvedAssets)) {
    fail('invalid_input', '候选批次元数据无效');
  }
  const model = approvedText(input.model, '模型标识');
  const promptVersion = approvedText(input.promptVersion, '提示词版本');
  const nowIso = input.nowIso;
  const aspectRatio = input.aspectRatio;
  const brief = makeBrief(input, doc);
  // 授权集合在外部生成器运行前固定；生成器可读取/改写传入对象，但不能扩大来源权限。
  const allowedHighlights = new Set(brief.highlights.map((item) => item.id));
  const allowedAssets = new Set(brief.assets.map((item) => item.id));
  let raw: unknown;
  try {
    raw = await generate(brief);
  } catch {
    fail('model_unavailable', '候选生成模型不可用');
  }
  if (!Array.isArray(raw)) fail('invalid_model_output', '模型必须返回候选数组');
  if (raw.length < 3) fail('insufficient_plans', '模型未生成至少三份候选');
  if (raw.length > 6) fail('invalid_model_output', '模型候选不能超过六份');
  const batchId = randomUUID();
  const plans = raw.map((value, index) => hydrateDraft(value, batchId, index, nowIso));
  let checked: ProductionDocumentV1;
  try {
    checked = parseProductionDocument({
      ...doc,
      compositionPlans: [...doc.compositionPlans, ...plans],
    });
  } catch {
    fail('invalid_model_output', '模型候选存在非法字段、引用或时间码');
  }
  const accepted = checked.compositionPlans.slice(doc.compositionPlans.length);
  for (const plan of accepted) {
    if (!plan.editorial || plan.aspectRatio !== aspectRatio
      || !plan.narrativeSummary.trim() || plan.narrativeSummary.length > 2_000) {
      fail('invalid_model_output', '模型候选叙事摘要、编辑意图或目标画幅无效');
    }
    for (const segment of plan.segments) {
      if (!segment.description.trim() || segment.description.length > 2_000
        || segment.source.kind !== 'highlight' || !allowedHighlights.has(segment.source.sourceId)
        || (segment.visualLayer && !allowedAssets.has(segment.visualLayer.assetId))) {
        fail('invalid_model_output', '模型分段描述或来源无效');
      }
    }
  }
  const reviewFlags = reviewSimilarities(accepted);
  return {
    batchId,
    model,
    promptVersion,
    generatedAt: nowIso,
    reviewRequired: true,
    plans: accepted,
    reviewFlags,
  };
}

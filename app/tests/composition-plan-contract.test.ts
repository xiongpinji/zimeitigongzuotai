import { describe, expect, it } from 'vitest';
import {
  createEmptyProductionDocument,
  parseProductionDocument,
  ProductionContractError,
} from '../src/lib/production-document';

const NOW = '2026-09-28T02:00:00.000Z';
const SHA = 'a'.repeat(64);

function makeDocument() {
  const doc = createEmptyProductionDocument('project-1', { nowIso: NOW });
  doc.recordings.push({
    id: 'recording-1', sourceRef: 'recordings/live.mp4', sourceSha256: SHA,
    capturedAt: null, durationMs: 120_000, mimeType: 'video/mp4',
    transcriptRef: null, importedAt: NOW,
  });
  doc.highlights.push({
    id: 'highlight-1', recordingId: 'recording-1', startMs: 30_000,
    endMs: 60_000, score: null, topic: '主张', context: null, evidence: [],
    boundaryOrigin: 'human-adjusted', adjustedAt: NOW, createdAt: NOW,
  });
  doc.assets.push({
    id: 'asset-1', sha256: SHA, mediaType: 'video', durationMs: 20_000,
    tags: ['细节'], transcript: null, embeddingRef: null, source: '自有拍摄',
    rightsHolder: '用户', license: 'proprietary', usageScope: '商业短视频',
    authorizedForAutoUse: true, importedAt: NOW,
  });
  doc.compositionPlans.push({
    id: 'plan-1', narrativeSummary: '解释一个产品细节',
    voiceoverKind: 'original-audio', aspectRatio: '9:16',
    segments: [{
      id: 'segment-1', order: 0, description: '直播证据',
      source: { kind: 'highlight', sourceId: 'highlight-1', inMs: 35_000, outMs: 45_000 },
    }],
    timelineRef: null, createdAt: NOW, updatedAt: NOW,
  });
  return JSON.parse(JSON.stringify(doc)) as Record<string, any>;
}

function makeStructuredDocument() {
  const structured = makeDocument();
  const plan = structured.compositionPlans[0];
  plan.editorial = {
    targetAudience: '刚接触此产品的人',
    centralQuestion: '实际使用时哪一点最有价值？',
    openingClaim: '先看实测结果，再解释细节',
    endingMessage: '展示适用场景和限制',
  };
  plan.segments[0].editorial = {
    narrativeRole: 'evidence',
    visualIntent: '先展示主播原始演示，再切入实物细节',
    audioIntent: '保留主播原声及上下文',
  };
  plan.segments[0].visualLayer = {
    assetId: 'asset-1', sourceInMs: 2_000, startAtMs: 1_000,
    durationMs: 4_000, purpose: '补充产品外观细节',
  };
  return structured;
}

function contractFailure(document: Record<string, any>): ProductionContractError {
  try {
    parseProductionDocument(document);
  } catch (error) {
    if (error instanceof ProductionContractError) return error;
    throw error;
  }
  throw new Error('Expected ProductionContractError');
}

describe('R4 composition plan contract', () => {
  it('retains old v1 plans and structured editorial plans without losing fields', () => {
    const oldDocument = makeDocument();
    expect(parseProductionDocument(oldDocument)).toEqual(oldDocument);

    const structured = makeStructuredDocument();
    expect(parseProductionDocument(structured)).toEqual(structured);
  });

  it('rejects a visual overlay that references an asset outside the document', () => {
    const document = makeStructuredDocument();
    document.compositionPlans[0].segments[0].visualLayer.assetId = 'missing-asset';
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('rejects automatic visual use when asset authorization is absent', () => {
    const document = makeStructuredDocument();
    document.assets[0].authorizedForAutoUse = false;
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('accepts only video or image assets in a visual overlay', () => {
    const document = makeStructuredDocument();
    document.assets[0].mediaType = 'audio';
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('rejects an overlay that outlasts its primary highlight segment', () => {
    const document = makeStructuredDocument();
    document.compositionPlans[0].segments[0].visualLayer.startAtMs = 7_000;
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('rejects an overlay whose source media ends before its requested out point', () => {
    const document = makeStructuredDocument();
    document.compositionPlans[0].segments[0].visualLayer.sourceInMs = 18_000;
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('requires every segment of a structured plan to carry editorial intent', () => {
    const document = makeStructuredDocument();
    delete document.compositionPlans[0].segments[0].editorial;
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('uses a zero media in-point for image overlays', () => {
    const document = makeStructuredDocument();
    document.assets[0].mediaType = 'image';
    document.assets[0].durationMs = null;
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
    document.compositionPlans[0].segments[0].visualLayer.sourceInMs = 0;
    expect(parseProductionDocument(document)).toEqual(document);
  });

  it('does not accept a structured plan with no evidence segments', () => {
    const document = makeStructuredDocument();
    document.compositionPlans[0].segments = [];
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('rejects excessive new editorial text instead of persisting an unbounded model response', () => {
    const document = makeStructuredDocument();
    document.compositionPlans[0].editorial.openingClaim = '长'.repeat(2_001);
    expect(() => parseProductionDocument(document)).toThrowError(ProductionContractError);
  });

  it('rejects unknown and credential-like fields inside the new structures', () => {
    const unknown = makeStructuredDocument();
    unknown.compositionPlans[0].editorial.unrecognized = 'extra';
    expect(contractFailure(unknown).code).toBe('invalid_field');

    const secret = makeStructuredDocument();
    secret.compositionPlans[0].segments[0].visualLayer.accessToken = 'must-not-persist';
    expect(contractFailure(secret).code).toBe('credential_material_forbidden');
  });
});

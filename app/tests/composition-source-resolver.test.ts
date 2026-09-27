import { createHash } from 'node:crypto';
import { dirname, join, resolve, basename } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { LocalAssetLibrary } from '../electron/assets/local-asset-library';
import { ProductHighlightController } from '../electron/highlights/product-highlight-controller';
import type { ProductHighlightRuntime } from '../electron/highlights/product-highlight-bootstrap';
import { ReviewedClipExporter } from '../electron/highlights/reviewed-clip-exporter';
import {
  buildReviewedClipReceipt, expectedReviewedClipId, outputPath, receiptPath,
  writeReviewedClipReceipt,
} from '../electron/highlights/reviewed-clip-receipts';
import { createEmptyProductionDocument } from '../src/lib/production-document';
import type { CompositionPlanV1 } from '../src/types/production-contracts';
import {
  resolveCompositionSources,
  type CompositionSourceServices,
} from '../electron/composition/source-resolver';

const NOW = '2026-09-28T04:00:00.000Z';
const RECORDING_ID = '00000000-0000-4000-8000-000000000001';
const HIGHLIGHT_ID = `hlcv1-${'b'.repeat(64)}`;
const TASK_ID = `hbatch_${'c'.repeat(64)}`;
const SOURCE_SHA = 'a'.repeat(64);
const OUTPUT_SHA = 'd'.repeat(64);
const ASSET_SHA = 'e'.repeat(64);

function fixture() {
  const document = createEmptyProductionDocument('project-1', { nowIso: NOW });
  const recording = {
    id: RECORDING_ID, sourceRef: 'private-live.mp4', sourceSha256: SOURCE_SHA,
    capturedAt: null, durationMs: 60_000, mimeType: 'video/mp4',
    transcriptRef: null, importedAt: NOW,
  };
  document.recordings.push(recording);
  const highlight = {
    id: HIGHLIGHT_ID, recordingId: RECORDING_ID, startMs: 1_000, endMs: 3_500,
    score: null, topic: '演示', context: null, evidence: [] as [],
    boundaryOrigin: 'auto' as const, adjustedAt: null, createdAt: NOW,
  };
  document.highlights.push(highlight);
  const asset = {
    id: 'asset-1', sha256: ASSET_SHA, mediaType: 'video' as const,
    durationMs: 3_000, tags: ['细节'], transcript: null, embeddingRef: null,
    source: '自有拍摄', rightsHolder: '用户', license: 'proprietary',
    usageScope: '商业短视频', authorizedForAutoUse: true, importedAt: NOW,
  };
  document.assets.push(asset);
  const plan: CompositionPlanV1 = {
    id: 'plan-1', narrativeSummary: '展示产品演示', voiceoverKind: 'original-audio',
    aspectRatio: '9:16', editorial: {
      targetAudience: '新用户', centralQuestion: '如何使用？',
      openingClaim: '先看演示', endingMessage: '总结使用限制',
    },
    segments: [{
      id: 'segment-1', order: 0, description: '原声演示',
      source: { kind: 'highlight', sourceId: HIGHLIGHT_ID, inMs: 1_500, outMs: 2_500 },
      editorial: { narrativeRole: 'evidence', visualIntent: '展示操作', audioIntent: '保留原声' },
      visualLayer: { assetId: 'asset-1', sourceInMs: 100, startAtMs: 200,
        durationMs: 500, purpose: '展示产品外观' },
    }],
    timelineRef: null, createdAt: NOW, updatedAt: NOW,
  };
  const receiptBody = {
    schemaVersion: 1 as const,
    taskId: TASK_ID, highlightId: HIGHLIGHT_ID, recordingId: RECORDING_ID,
    sourceSha256: SOURCE_SHA, startMs: 1_200, endMs: 3_200,
    reviewedBy: 'local-owner' as const, reviewedAt: NOW, renderedAt: NOW,
    outputSha256: OUTPUT_SHA, outputDurationMs: 2_000,
  };
  const { schemaVersion, ...receiptFields } = receiptBody;
  const receipt = buildReviewedClipReceipt({
    schemaVersion, id: expectedReviewedClipId(receiptBody), ...receiptFields,
  });
  const task = {
    id: TASK_ID, recording, sourceSha256: SOURCE_SHA, options: { maxClips: 2 },
    state: 'completed' as const, attempt: 1,
    candidateIds: [], highlightIds: [HIGHLIGHT_ID], lastErrorCode: null,
    createdAt: 1, updatedAt: 2,
  };
  const context = {
    platform: 'douyin' as const, region: 'cn', usedAt: NOW, commercialShortVideo: true,
  };
  const verifiedForUsage = vi.fn(async () => 'C:\\product-data\\asset.mp4');
  const artifactHighlight = { ...highlight };
  const services: CompositionSourceServices = {
    nowIso: () => NOW,
    controller: {
      list: () => [task],
      readArtifact: () => ({
        taskId: TASK_ID, attempt: 1, candidateIds: [],
        highlightIds: [HIGHLIGHT_ID], highlights: [{ ...artifactHighlight }], reviewRequired: true,
      }),
    },
    exporter: { verifiedOutput: async () => ({ path: 'C:\\product-data\\reviewed.mp4', receipt }) },
    library: {
      get: () => ({ entry: { asset, mediaRef: 'media/asset.mp4', rightsGrant: {
        platforms: ['douyin'], regions: ['cn'], commercialShortVideoUse: 'allowed',
        validFrom: null, validUntil: null,
        evidence: [{ kind: 'written-approval', ref: 'grant-1', collectedAt: NOW, note: null }],
      } }, semanticText: '产品细节' }),
      verifiedForUsage,
    },
  };
  return { document, plan, receipt, context, services, verifiedForUsage };
}

describe('R4 composition source resolver', () => {
  it('maps approved absolute recording timecodes into verified clip-relative timecodes and checks B-roll rights', async () => {
    const { document, plan, receipt, context, services, verifiedForUsage } = fixture();
    const result = await resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services);
    expect(result.segments[0].clip).toMatchObject({
      path: 'C:\\product-data\\reviewed.mp4', receiptId: receipt.id,
      recordingId: RECORDING_ID, sourceSha256: SOURCE_SHA,
      outputSha256: OUTPUT_SHA, sourceInMs: 300, sourceOutMs: 1_300,
    });
    expect(result.segments[0].visualLayer).toMatchObject({
      path: 'C:\\product-data\\asset.mp4', assetId: 'asset-1',
      sha256: ASSET_SHA, evidenceRefs: ['grant-1'],
    });
    expect(verifiedForUsage).toHaveBeenCalledWith('asset-1', context);
  });

  it('rejects rights revoked between media verification and the metadata snapshot', async () => {
    const { document, plan, receipt, context, services } = fixture();
    const record = services.library.get('asset-1');
    if (!record) throw new Error('Fixture asset missing');
    services.library.get = () => ({ ...record, entry: { ...record.entry, rightsGrant: null } });
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'rights_blocked' });
  });

  it('re-checks rights on a later render preflight call', async () => {
    const { document, plan, receipt, context, services } = fixture();
    const input = { document, plan,
      clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }], context };
    await expect(resolveCompositionSources(input, services)).resolves.toMatchObject({ planId: plan.id });
    const record = services.library.get('asset-1');
    if (!record) throw new Error('Fixture asset missing');
    services.library.get = () => ({ ...record, entry: { ...record.entry, rightsGrant: null } });
    await expect(resolveCompositionSources(input, services))
      .rejects.toMatchObject({ code: 'rights_blocked' });
  });

  it('rejects a candidate artifact bound to a different highlight task', async () => {
    const { document, plan, receipt, context, services } = fixture();
    const artifact = services.controller.readArtifact(TASK_ID);
    if (!artifact) throw new Error('Fixture artifact missing');
    services.controller.readArtifact = () => ({ ...artifact, taskId: `hbatch_${'f'.repeat(64)}` });
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'source_mismatch' });
  });

  it('rejects edited highlight bounds that no longer match the task artifact', async () => {
    const { document, plan, receipt, context, services } = fixture();
    document.highlights[0].startMs = 1_100;
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'source_mismatch' });
  });

  it('rejects source timecodes outside the reviewed receipt even when the candidate range allows them', async () => {
    const { document, plan, receipt, context, services } = fixture();
    plan.segments[0].source.inMs = 1_100;
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'invalid_timecode' });
  });

  it('stops when the reviewed output cannot pass its own byte-hash verification', async () => {
    const { document, plan, receipt, context, services } = fixture();
    services.exporter.verifiedOutput = async () => { throw { code: 'output_conflict' }; };
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'clip_unavailable' });
  });

  it('maps a failed artifact lookup to a fixed error without leaking internal paths', async () => {
    const { document, plan, receipt, context, services } = fixture();
    services.controller.readArtifact = () => { throw new Error('private-artifact-path'); };
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'source_mismatch' });
  });

  it('rejects a rights grant that expires after byte verification', async () => {
    const { document, plan, receipt, context, services } = fixture();
    const record = services.library.get('asset-1');
    if (!record?.entry.rightsGrant) throw new Error('Fixture grant missing');
    services.library.get = () => ({ ...record, entry: {
      ...record.entry,
      rightsGrant: { ...record.entry.rightsGrant!, validUntil: '2026-01-01T00:00:00.000Z' },
    } });
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'rights_blocked' });
  });

  it('uses main-process time so a caller cannot revive expired rights with a past date', async () => {
    const { document, plan, receipt, context, services } = fixture();
    const record = services.library.get('asset-1');
    if (!record?.entry.rightsGrant) throw new Error('Fixture grant missing');
    services.library.get = () => ({ ...record, entry: {
      ...record.entry,
      rightsGrant: { ...record.entry.rightsGrant!, validUntil: '2026-01-01T00:00:00.000Z' },
    } });
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context: { ...context, usedAt: '2025-01-01T00:00:00.000Z' },
    }, services)).rejects.toMatchObject({ code: 'rights_blocked' });
  });

  it('rejects a changed asset file through the library verification boundary', async () => {
    const { document, plan, receipt, context, services } = fixture();
    services.library.verifiedForUsage = async () => { throw { code: 'media_changed' }; };
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'media_changed' });
  });

  it('reports a deleted catalog asset as unavailable', async () => {
    const { document, plan, receipt, context, services } = fixture();
    services.library.verifiedForUsage = async () => { throw { code: 'asset_not_found' }; };
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'asset_unavailable' });
  });

  it('maps a failed asset metadata read to a fixed error', async () => {
    const { document, plan, receipt, context, services } = fixture();
    services.library.get = () => { throw new Error('private-asset-catalog-path'); };
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'asset_unavailable' });
  });

  it('does not let a verifier mutate the target platform to satisfy different rights', async () => {
    const { document, plan, receipt, context, services } = fixture();
    const record = services.library.get('asset-1');
    if (!record?.entry.rightsGrant) throw new Error('Fixture grant missing');
    services.library.get = () => ({ ...record, entry: {
      ...record.entry,
      rightsGrant: { ...record.entry.rightsGrant!, platforms: ['kuaishou'] },
    } });
    services.library.verifiedForUsage = async (_id, mutableContext) => {
      mutableContext.platform = 'kuaishou';
      return 'C:\\product-data\\asset.mp4';
    };
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'rights_blocked' });
  });

  it('re-reads task state after asynchronous clip verification', async () => {
    const { document, plan, receipt, context, services } = fixture();
    const originalTask = services.controller.list()[0];
    const originalVerified = services.exporter.verifiedOutput;
    let currentTask = originalTask;
    services.controller.list = () => [currentTask];
    services.exporter.verifiedOutput = async (id) => {
      currentTask = { ...originalTask, state: 'cancelled' };
      return originalVerified(id);
    };
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context,
    }, services)).rejects.toMatchObject({ code: 'source_mismatch' });
  });

  it('rejects duplicate segment orders before resolving any media', async () => {
    const { document, plan, receipt, context, services } = fixture();
    plan.segments.push({ ...plan.segments[0], id: 'segment-2' });
    const verifiedOutput = vi.spyOn(services.exporter, 'verifiedOutput');
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [
        { segmentId: 'segment-1', receiptId: receipt.id },
        { segmentId: 'segment-2', receiptId: receipt.id },
      ], context,
    }, services)).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(verifiedOutput).not.toHaveBeenCalled();
  });

  it('rejects an invalid target platform even without a B-roll layer', async () => {
    const { document, plan, receipt, context, services } = fixture();
    delete plan.segments[0].visualLayer;
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }],
      context: { ...context, platform: 'unsupported' } as typeof context,
    }, services)).rejects.toMatchObject({ code: 'invalid_context' });
  });

  it('rejects an unsupported B-roll type and an out-of-bounds source timecode', async () => {
    const { document, plan, receipt, context, services } = fixture();
    document.assets[0].mediaType = 'audio';
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }], context,
    }, services)).rejects.toMatchObject({ code: 'invalid_plan' });

    document.assets[0].mediaType = 'video';
    plan.segments[0].visualLayer!.sourceInMs = 2_900;
    await expect(resolveCompositionSources({
      document, plan, clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }], context,
    }, services)).rejects.toMatchObject({ code: 'invalid_plan' });
  });

  it('uses real receipt/output byte checks and a real rights-gated asset store', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zmt-composition-source-'));
    const library = new LocalAssetLibrary({ rootDir: join(root, 'assets-v1') });
    try {
      const { document, plan, receipt, context, services } = fixture();
      const mediaPath = join(root, 'selected.png');
      writeFileSync(mediaPath, Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
        'base64',
      ));
      const record = await library.importFile(mediaPath, {
        semanticText: '产品展示图', tags: ['产品'], transcript: null,
        source: '用户自有', rightsHolder: '用户', license: 'proprietary',
        usageScope: '商业短视频', authorizedForAutoUse: true,
        rightsGrant: { platforms: ['douyin'], regions: ['cn'], commercialShortVideoUse: 'allowed',
          validFrom: null, validUntil: null,
          evidence: [{ kind: 'written-approval', ref: 'local-grant-1', collectedAt: NOW, note: null }],
        },
      });
      document.assets[0] = record.entry.asset;
      plan.segments[0].visualLayer!.assetId = record.entry.asset.id;
      plan.segments[0].visualLayer!.sourceInMs = 0;

      const clipRoot = join(root, 'highlights-v1', 'reviewed-clips');
      mkdirSync(clipRoot, { recursive: true });
      const clipBytes = Buffer.from('synthetic reviewed clip bytes');
      const outputSha256 = createHash('sha256').update(clipBytes).digest('hex');
      const { contentSha256: _contentSha256, ...receiptBody } = receipt;
      const persistedReceipt = buildReviewedClipReceipt({ ...receiptBody, outputSha256 });
      writeFileSync(outputPath(clipRoot, receipt.id), clipBytes);
      writeReviewedClipReceipt(receiptPath(clipRoot, receipt.id), persistedReceipt);
      const exporter = new ReviewedClipExporter({
        controller: new ProductHighlightController({
          runtime: {} as ProductHighlightRuntime, userDataPath: root,
        }), userDataPath: root, ffmpegPath: null, ffprobePath: null,
      });
      expect(await exporter.verifiedOutput(receipt.id)).toMatchObject({
        receipt: { outputSha256 },
      });
      services.exporter = exporter;
      services.library = library;
      const input = { document, plan,
        clipSelections: [{ segmentId: 'segment-1', receiptId: receipt.id }], context };
      const resolved = await resolveCompositionSources(input, services);
      expect(resolved.segments[0].clip.outputSha256).toBe(outputSha256);
      expect(resolved.segments[0].visualLayer).toMatchObject({
        sha256: record.entry.asset.sha256, evidenceRefs: ['local-grant-1'],
      });

      writeFileSync(outputPath(clipRoot, receipt.id), 'tampered output');
      await expect(resolveCompositionSources(input, services))
        .rejects.toMatchObject({ code: 'clip_unavailable' });
      writeFileSync(outputPath(clipRoot, receipt.id), clipBytes);
      writeFileSync(receiptPath(clipRoot, receipt.id), JSON.stringify({
        ...persistedReceipt, contentSha256: '0'.repeat(64),
      }));
      await expect(resolveCompositionSources(input, services))
        .rejects.toMatchObject({ code: 'clip_unavailable' });
      writeFileSync(receiptPath(clipRoot, receipt.id), JSON.stringify(persistedReceipt));
      writeFileSync(await library.verifiedForUsage(record.entry.asset.id, context), 'tampered asset');
      await expect(resolveCompositionSources(input, services))
        .rejects.toMatchObject({ code: 'media_changed' });
    } finally {
      library.close();
      const checked = resolve(root);
      if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('zmt-composition-source-')) {
        throw new Error('Unsafe source resolver test cleanup');
      }
      rmSync(checked, { recursive: true, force: true });
    }
  });
});

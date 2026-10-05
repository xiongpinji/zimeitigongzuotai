/** Local-only R4 model contract probe with synthetic, approved descriptions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { configuredCompositionModel } from '../electron/composition/model-generator';
import { proposePlans, type CompositionProposalBrief } from '../electron/composition/plan-proposals';
import { createEmptyProductionDocument } from '../src/lib/production-document';
import type { AISettings } from '../src/types/ai';

if (process.platform !== 'win32') throw new Error('Windows local probe only');
const repo = resolve(__dirname, '..', '..');
const runDir = join(repo, 'data', 'runtime', 'validation', `r4-local-model-${Date.now()}`);
const endpoint = 'http://127.0.0.1:11435/v1';
const model = 'qwen3:4b-instruct';
const nowIso = new Date().toISOString();

async function main(): Promise<void> {
  const tags = await fetch('http://127.0.0.1:11435/api/tags', {
    signal: AbortSignal.timeout(5_000),
  }).then((response) => response.json()) as { models: Array<{ name: string }> };
  assert.ok(tags.models.some((item) => item.name === model), 'Local model is unavailable');
  mkdirSync(runDir, { recursive: true });

  const document = createEmptyProductionDocument('synthetic-r4-probe', { nowIso });
  const sha256 = createHash('sha256').update('synthetic-only').digest('hex');
  document.recordings.push({
    id: 'recording-1', sourceRef: 'synthetic-recording.mp4', sourceSha256: sha256,
    capturedAt: null, durationMs: 60_000, mimeType: 'video/mp4',
    transcriptRef: null, importedAt: nowIso,
  });
  for (let index = 0; index < 3; index++) {
    document.highlights.push({
      id: `highlight-${index + 1}`, recordingId: 'recording-1',
      startMs: index * 20_000, endMs: index * 20_000 + 10_000,
      score: null, topic: `合成主题 ${index + 1}`, context: '合成场景', evidence: [],
      boundaryOrigin: 'auto', adjustedAt: null, createdAt: nowIso,
    });
  }
  document.assets.push({
    id: 'asset-1', sha256, mediaType: 'video', durationMs: 15_000,
    tags: ['synthetic'], transcript: null, embeddingRef: null,
    source: 'synthetic-asset.mp4', rightsHolder: 'probe', license: 'proprietary',
    usageScope: '商业短视频', authorizedForAutoUse: true, importedAt: nowIso,
  });
  const settings = {
    llmProviders: [{ id: 'local-probe', name: 'Local probe', type: 'openai_compatible',
      baseUrl: endpoint, apiKey: 'ollama', models: [model], defaultModel: model,
      enableThinking: false }],
    defaultProviderId: 'local-probe', defaultModel: model,
  } as unknown as AISettings;
  const selected = configuredCompositionModel(settings);
  let briefSeen: CompositionProposalBrief | null = null;
  let modelOutput: unknown;
  const started = Date.now();
  try {
    const batch = await proposePlans({
      document,
      approvedHighlights: [
        { id: 'highlight-1', anonymousTopic: '直播中检查素材授权', approvedTranscriptExcerpt: '先确认来源和使用范围。' },
        { id: 'highlight-2', anonymousTopic: '直播中复核字幕时间', approvedTranscriptExcerpt: '字幕时间有误差时应由人调整。' },
        { id: 'highlight-3', anonymousTopic: '直播中设计三种叙事', approvedTranscriptExcerpt: '不同问题需要不同的证据组织。' },
      ],
      approvedAssets: [{ id: 'asset-1', anonymousDescription: '自有产品外观特写' }],
      aspectRatio: '9:16', model, promptVersion: 'r4-proposal-v1', nowIso,
    }, async (brief) => {
      briefSeen = brief;
      modelOutput = await selected.generate(brief);
      return modelOutput;
    });
    const report = {
      kind: 'synthetic_r4_model_contract', model, elapsedMs: Date.now() - started,
      state: 'accepted', planCount: batch.plans.length,
      centralQuestions: batch.plans.map((plan) => plan.editorial?.centralQuestion ?? null),
      reviewFlags: batch.reviewFlags,
      realAssetsTested: false, humanReviewTested: false, platformActionAttempted: false,
    };
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ evidenceDir: runDir, ...report }) + '\n');
  } catch (error) {
    const report = {
      kind: 'synthetic_r4_model_contract', model, elapsedMs: Date.now() - started,
      state: 'rejected', code: error && typeof error === 'object' && 'code' in error
        ? String(error.code) : 'probe_failed',
      realAssetsTested: false, humanReviewTested: false, platformActionAttempted: false,
    };
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ evidenceDir: runDir, ...report }) + '\n');
    process.exitCode = 1;
  } finally {
    if (modelOutput !== undefined) writeFileSync(join(runDir, 'model-output.json'), JSON.stringify(modelOutput, null, 2));
    if (briefSeen) writeFileSync(join(runDir, 'brief.json'), JSON.stringify(briefSeen, null, 2));
  }
}

main().catch((error: unknown) => {
  if (existsSync(runDir)) writeFileSync(join(runDir, 'failure.json'), JSON.stringify({
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'probe_failed',
  }));
  process.stderr.write('r4_local_model_probe_failed\n');
  process.exitCode = 1;
});

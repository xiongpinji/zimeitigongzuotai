// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompositionWorkbench } from '../src/components/composition/CompositionWorkbench';
import type { CompositionV1API } from '../src/lib/electron-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function mount(api: CompositionV1API, returnProjectDir: string | null = null) {
  (window as unknown as { compositionV1API: CompositionV1API }).compositionV1API = api;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const onOpenVersion = vi.fn(async () => undefined);
  const onReturnProject = vi.fn(async () => undefined);
  await act(async () => { root!.render(<CompositionWorkbench active projectDir="C:\\project"
    returnProjectDir={returnProjectDir} onOpenVersion={onOpenVersion} onReturnProject={onReturnProject} />); });
  return { onOpenVersion, onReturnProject };
}
async function click(label: string) {
  const button = [...(host?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); root = null; host = null;
});

describe('R4 composition workbench', () => {
  it('shows the empty state without pretending that version creation is ready', async () => {
    const api = { list: vi.fn(async () => ({ ok: true, batches: [] })),
      resources: vi.fn(async () => ({ ok: true, receipts: [], assets: [] })) } as unknown as CompositionV1API;
    await mount(api);
    expect(host?.textContent).toContain('还没有混剪版本');
    expect(host?.textContent).toContain('还没有已审核并导出的切片');
  });

  it('renders existing versions, analyzes them and keeps review and platform status pending', async () => {
    const versions = [1, 2, 3].map((number) => ({ planId: `plan-${number}`,
      narrativeSummary: `独立叙事 ${number}`, createdAt: '2026-10-05T00:00:00.000Z',
      timelineModified: false, renderState: null, renderError: null, outputSha256: null }));
    const report = { schemaVersion: 1, batchId: 'batch-1', generatedAt: '2026-10-05T00:00:00.000Z',
      versions: versions.map((version) => ({ planId: version.planId, outputSha256: 'a'.repeat(64),
        planSha256: 'b'.repeat(64), sourcesSha256: 'c'.repeat(64) })),
      pairs: [{ planIds: ['plan-1', 'plan-2'], textSimilarity: 0.9, sourceOverlap: 1,
        visualSimilarity: 0.95, audioSimilarity: null, flags: ['similar_visuals'] }],
      evidenceSha256: 'd'.repeat(64), reviewRequired: true, platformOriginality: 'unverified' };
    const api = {
      resources: vi.fn(async () => ({ ok: true as const, receipts: [], assets: [] })),
      list: vi.fn(async () => ({ ok: true as const, batches: [{ batchId: 'batch-1', versions,
        context: { platform: 'douyin', region: 'cn', commercialShortVideo: true }, contextMismatch: false }] })),
      open: vi.fn(async () => ({ ok: true as const, projectDir: 'C:\\project\\compositions\\batch-1\\plan-1',
        timelineModified: false })),
      render: vi.fn(async () => ({ ok: true as const, batchId: 'batch-1',
        versions: versions.map((version) => ({ planId: version.planId, state: 'completed',
          reviewRequired: true, errorCode: null })) })),
      prepareAgentRender: vi.fn(async () => ({ ok: true as const, prepared: true as const })),
      cancel: vi.fn(async () => ({ ok: true as const, cancelled: false })),
      analyze: vi.fn(async () => ({ ok: true as const, report })),
      review: vi.fn(async () => ({ ok: true as const, result: { planId: 'plan-1',
        distinctReviewerIds: 1, reviewStatus: 'awaiting_second_reviewer',
        reviewRequired: true, platformOriginality: 'unverified' } })),
    } as unknown as CompositionV1API;
    const callbacks = await mount(api);
    expect(host?.textContent).toContain('独立叙事 1');
    await click('批量渲染');
    expect(api.render).toHaveBeenCalledWith({ batchId: 'batch-1', planIds: ['plan-1', 'plan-2', 'plan-3'],
      platform: 'douyin', region: 'cn', commercialShortVideo: true, resolution: '480p', quality: 'speed' });
    await click('准备供智能体渲染一次');
    expect(api.prepareAgentRender).toHaveBeenCalledWith({ batchId: 'batch-1',
      planIds: ['plan-1', 'plan-2', 'plan-3'], platform: 'douyin', region: 'cn',
      commercialShortVideo: true, resolution: '480p', quality: 'speed', approvedForRender: true });
    await click('分析相似度');
    expect(host?.textContent).toContain('相似度证据');
    expect(host?.textContent).toContain('不能推断平台原创认定');
    await click('记录人工复核');
    expect(api.review).not.toHaveBeenCalled();
    await click('打开独立时间线');
    expect(callbacks.onOpenVersion).toHaveBeenCalledWith('C:\\project\\compositions\\batch-1\\plan-1');
  });

  it('requires an explicit anonymous brief check before requesting AI versions', async () => {
    const receiptId = `hclip_${'a'.repeat(64)}`;
    const assetId = `asset_${'c'.repeat(64)}`;
    const api = {
      list: vi.fn(async () => ({ ok: true as const, batches: [] })),
      resources: vi.fn(async () => ({ ok: true as const,
        receipts: [{ id: receiptId, highlightId: `hlcv1-${'b'.repeat(64)}`,
          startMs: 1000, endMs: 3000, topic: '本地演示' }],
        assets: [{ id: assetId, description: '无人物的产品特写', mediaType: 'video' }] })),
      recommend: vi.fn(async () => ({ ok: true as const, status: 'ok' as const,
        recommendations: [{ assetId, similarity: 0.91, reasons: ['内容匹配'] }] })),
      create: vi.fn(async () => ({ ok: true as const, batchId: 'batch-1', plans: [],
        reviewFlags: [], reviewRequired: true as const })),
      prepareAgentBuild: vi.fn(async () => ({ ok: true as const, prepared: true as const })),
    } as unknown as CompositionV1API;
    await mount(api);
    const createButton = [...host!.querySelectorAll('button')].find((entry) =>
      entry.textContent?.includes('用当前 AI 生成至少三版'))!;
    expect(createButton.disabled).toBe(true);
    const receiptBox = [...host!.querySelectorAll('input[type="checkbox"]')].find((entry) =>
      entry.parentElement?.textContent?.includes('高光 1')) as HTMLInputElement;
    await act(async () => { receiptBox.click(); });
    const topic = host!.querySelector(`input[aria-label="匿名摘要 ${receiptId}"]`) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(topic, '匿名的功能讲解');
      topic.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(createButton.disabled).toBe(true);
    await click('按匿名摘要智能推荐素材');
    expect(api.recommend).toHaveBeenCalledWith({ query: '匿名的功能讲解',
      platform: 'douyin', region: 'cn', commercialShortVideo: false });
    const consent = [...host!.querySelectorAll('input[type="checkbox"]')].find((entry) =>
      entry.parentElement?.textContent?.includes('我已检查上述摘要')) as HTMLInputElement;
    await act(async () => { consent.click(); });
    expect(createButton.disabled).toBe(false);
    await click('用当前 AI 生成至少三版');
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      selectedReceipts: [{ receiptId, anonymousTopic: '匿名的功能讲解', approvedTranscriptExcerpt: null }],
      selectedAssets: [{ assetId, anonymousDescription: '无人物的产品特写' }],
      platform: 'douyin', region: 'cn', commercialShortVideo: false,
    }));
    await act(async () => { consent.click(); });
    await click('准备供智能体生成一次');
    expect(api.prepareAgentBuild).toHaveBeenCalledWith(expect.objectContaining({
      approvedForModel: true,
      selectedReceipts: [{ receiptId, anonymousTopic: '匿名的功能讲解', approvedTranscriptExcerpt: null }],
      selectedAssets: [{ assetId, anonymousDescription: '无人物的产品特写' }],
    }));
  });
});

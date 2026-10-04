// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafePublishDraftPanel } from '../src/components/publish/SafePublishDraftPanel';
import type { AccountV2Dto, AccountV2API, CompositionV1API,
  ProductPublishDraftAPI } from '../src/lib/electron-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove(); host = null; root = null;
});

const account = (id: string): AccountV2Dto => ({ id, platform: 'douyin',
  displayName: id, owner: '', status: 'valid', hasSession: true,
  lastCheckedAt: null, createdAt: 0 });
const version = (planId: string) => ({ planId, narrativeSummary: `版本 ${planId}`,
  createdAt: '', timelineModified: false, renderState: 'completed' as const,
  renderError: null, outputSha256: 'a'.repeat(64) });

async function mount() {
  const accountApi = { list: vi.fn(async () => ({ ok: true as const,
    accounts: [account('account-a'), account('account-b')] })) };
  const compositionApi = { list: vi.fn(async () => ({ ok: true as const, batches: [{
    batchId: 'batch-1', versions: [version('plan-a'), version('plan-b')],
    context: { platform: 'douyin', region: 'cn', commercialShortVideo: true },
    contextMismatch: false,
  }] })) };
  let staged = false;
  let cancelled = false;
  const draftApi = { preview: vi.fn(async () => ({ ok: true as const,
    entries: [{ accountId: 'account-a', platform: 'douyin', batchId: 'batch-1',
      planId: 'plan-a', videoVariantId: 'v', outputSha256: 'a'.repeat(64),
      commerceBlocked: false }],
    duplicateVersionRisks: [{ batchId: 'batch-1', planId: 'plan-a',
      accountIds: ['account-a', 'account-b'] }],
  })), stage: vi.fn(async () => { staged = true; return { ok: true as const,
    created: 2, existing: 0, preview: { entries: [], duplicateVersionRisks: [] } }; }),
    listDrafts: vi.fn(async () => ({ ok: true as const, drafts: staged && !cancelled
      ? [{ taskId: 'pubjob_aaaaaaaaaaaaaaaaaaaaaaaa', accountId: 'account-a',
        platform: 'douyin', batchId: 'batch-1', planId: 'plan-a',
        title: '账号 A 标题', createdAt: 1 }] : [] })),
    cancelDraft: vi.fn(async () => { cancelled = true; return { ok: true as const, cancelled: true }; }) };
  (window as unknown as { accountV2API: AccountV2API }).accountV2API = accountApi as unknown as AccountV2API;
  (window as unknown as { compositionV1API: CompositionV1API }).compositionV1API = compositionApi as unknown as CompositionV1API;
  (window as unknown as { publishV2DraftAPI: ProductPublishDraftAPI }).publishV2DraftAPI = draftApi as unknown as ProductPublishDraftAPI;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<SafePublishDraftPanel projectDir="C:\\project" />); });
  return draftApi;
}
async function choose(accountId: string, plan: string) {
  const element = host!.querySelector<HTMLSelectElement>(`select[aria-label="${accountId} 的视频版本"]`)!;
  await act(async () => { element.value = `batch-1:${plan}`;
    element.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function title(accountId: string, value: string) {
  const element = host!.querySelector<HTMLInputElement>(`input[aria-label="${accountId} 的标题"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...host!.querySelectorAll('button')].find((item) => item.textContent === label)!;
  await act(async () => { button.click(); await Promise.resolve(); });
}

describe('安全账号草稿页面', () => {
  it('逐账号配对后先预览重复风险，再保存为草稿', async () => {
    const api = await mount();
    expect(host!.textContent).toContain('不会自动发布');
    expect(api.stage).not.toHaveBeenCalled();
    await choose('account-a', 'plan-a');
    await choose('account-b', 'plan-a');
    await title('account-a', '账号 A 标题');
    await title('account-b', '账号 B 标题');
    await click('预览配对');
    expect(api.preview).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: 'account-a', batchId: 'batch-1',
        planId: 'plan-a', commerceRequest: null }),
      expect.objectContaining({ accountId: 'account-b', batchId: 'batch-1',
        planId: 'plan-a', commerceRequest: null }),
    ]);
    expect(host!.textContent).toContain('重复版本提醒');
    await click('保存草稿');
    expect(api.stage).toHaveBeenCalledTimes(1);
    expect(host!.textContent).toContain('尚未向平台发布');
    expect(host!.textContent).toContain('当前工程草稿（1）');
    await click('取消草稿');
    expect(api.cancelDraft).toHaveBeenCalledWith('pubjob_aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(host!.textContent).toContain('当前工程草稿（0）');
    await act(async () => { root!.render(<SafePublishDraftPanel projectDir={null} />); });
    expect(host!.textContent).not.toContain('account-a');
  });
});

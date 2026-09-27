// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighlightWorkbench } from '../src/components/highlights/HighlightWorkbench';
import type { HighlightV1API } from '../src/lib/electron-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function mount(api: HighlightV1API) {
  (window as unknown as { highlightV1API: HighlightV1API }).highlightV1API = api;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<HighlightWorkbench active />); });
}

async function click(label: string) {
  const button = [...(host?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

describe('highlight workbench', () => {
  it('requires local selections and consent, then displays review-only candidate timecodes', async () => {
    const task = {
      id: `hbatch_${'a'.repeat(64)}`, name: 'live.mp4', sourceSha256: 'b'.repeat(64),
      state: 'queued' as const, attempt: 0, candidateCount: 0, lastErrorCode: null,
      createdAt: 1, updatedAt: 1,
    };
    let tasks = [task];
    const api = {
      chooseRoot: vi.fn(async () => ({ ok: true as const, label: 'media' })),
      chooseRecordings: vi.fn(async () => ({ ok: true as const, names: ['live.mp4'] })),
      chooseNode: vi.fn(async () => ({ ok: true as const, label: 'node.exe' })),
      chooseHotClip: vi.fn(async () => ({ ok: true as const, label: 'hotclip' })),
      importRecordings: vi.fn(async () => ({ ok: true as const, tasks })),
      list: vi.fn(async () => ({ ok: true as const, busy: false, tasks })),
      run: vi.fn(async () => {
        tasks = [{ ...task, state: 'completed' as const, candidateCount: 1 }];
        return { ok: true as const, tasks };
      }),
      read: vi.fn(async () => ({ ok: true as const, artifact: {
        taskId: task.id, attempt: 1, candidateIds: ['c'], highlightIds: ['h'],
        reviewRequired: true as const,
        highlights: [{ id: 'h', recordingId: 'r', startMs: 1000, endMs: 3000,
          score: 0.8, topic: '重点', context: null, evidence: [],
          boundaryOrigin: 'auto' as const, adjustedAt: null, createdAt: '2026-01-01T00:00:00Z' }],
      } })),
      cancel: vi.fn(), retry: vi.fn(),
    } as unknown as HighlightV1API;
    await mount(api);
    expect(host?.textContent).toContain('待人工审核');
    await click('选择录屏目录');
    await click('选择录屏文件');
    await click('导入录屏');
    expect(api.importRecordings).toHaveBeenCalledWith({ maxClips: 3 });
    await click('选择 Node.js');
    await click('选择 HotClip');
    expect((host?.querySelector('[data-testid="run-highlights"]') as HTMLButtonElement).disabled).toBe(true);
    const model = host?.querySelector('[aria-label="模型名称"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(model, 'qwen3:8b');
      model.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const consent = host?.querySelector('[aria-label="允许本次运行下载本地模型"]') as HTMLInputElement;
    await act(async () => { consent.click(); });
    expect((host?.querySelector('[data-testid="run-highlights"]') as HTMLButtonElement).disabled).toBe(false);
    await click('运行排队任务');
    expect(api.run).toHaveBeenCalledOnce();
    await click('查看候选');
    expect(host?.textContent).toContain('00:01');
    expect(host?.textContent).toContain('00:03');
    expect(host?.textContent).toContain('候选仅供审核');
  });
});

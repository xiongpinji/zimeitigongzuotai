// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighlightWorkbench } from '../src/components/highlights/HighlightWorkbench';
import type { HighlightV1API } from '../src/lib/electron-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function mount(api: HighlightV1API, onImportClip?: (path: string, durationMs: number) => void) {
  (window as unknown as { highlightV1API: HighlightV1API }).highlightV1API = api;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<HighlightWorkbench active onImportClip={onImportClip} />); });
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
    let exported = false;
    const clipId = `hclip_${'c'.repeat(64)}`;
    const onImportClip = vi.fn();
    const api = {
      chooseRoot: vi.fn(async () => ({ ok: true as const, label: 'media' })),
      chooseRecordings: vi.fn(async () => ({ ok: true as const, names: ['live.mp4'] })),
      chooseSubtitles: vi.fn(async () => ({ ok: true as const, names: ['live.srt'] })),
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
      listReviewed: vi.fn(async () => ({ ok: true as const, busy: false,
        clips: exported ? [{ id: clipId, startMs: 1100, endMs: 3000,
          highlightId: 'h', outputSha256: 'd'.repeat(64) }] : [] })),
      exportReviewed: vi.fn(async () => {
        exported = true;
        return { ok: true as const, results: [{
        status: 'completed' as const, id: clipId,
        taskId: task.id, highlightId: 'h', outputSha256: 'd'.repeat(64),
        outputDurationMs: 1800, reused: false,
      }] };
      }),
      verifiedOutput: vi.fn(async () => ({ ok: true as const, path: 'C:\\synthetic\\clip.mp4', durationMs: 1800 })),
      cancelExport: vi.fn(),
    } as unknown as HighlightV1API;
    await mount(api, onImportClip);
    expect(host?.textContent).toContain('待人工审核');
    await click('选择录屏目录');
    await click('选择录屏文件');
    await click('选择已有 SRT 字幕');
    expect(api.chooseSubtitles).toHaveBeenCalledOnce();
    expect(host?.textContent).toContain('live.srt');
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
    expect(api.exportReviewed).not.toHaveBeenCalled();
    expect((host?.querySelector('[data-testid="export-reviewed"]') as HTMLButtonElement).disabled).toBe(true);
    const selected = host?.querySelector('[aria-label="选择高光片段 1"]') as HTMLInputElement;
    await act(async () => { selected.click(); });
    expect((host?.querySelector('[data-testid="export-reviewed"]') as HTMLButtonElement).disabled).toBe(true);
    const start = host?.querySelector('[aria-label="片段 1 开始毫秒"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(start, '1100');
      start.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const approved = host?.querySelector('[aria-label="确认已人工审核所选片段"]') as HTMLInputElement;
    await act(async () => { approved.click(); });
    expect((host?.querySelector('[data-testid="export-reviewed"]') as HTMLButtonElement).disabled).toBe(false);
    await click('生成所选切片');
    expect(api.exportReviewed).toHaveBeenCalledWith({ reviewConfirmed: true, concurrency: 2,
      selections: [{ taskId: task.id, highlightId: 'h', startMs: 1100, endMs: 3000 }] });
    expect(onImportClip).not.toHaveBeenCalled();
    await click('加入剪辑台');
    expect(api.verifiedOutput).toHaveBeenCalledWith(clipId);
    expect(onImportClip).toHaveBeenCalledWith('C:\\synthetic\\clip.mp4', 1800);
  });

  it('collects reviewed selections across completed recordings into one bounded batch', async () => {
    const ids = [`hbatch_${'a'.repeat(64)}`, `hbatch_${'b'.repeat(64)}`];
    const highlights = [`hlcv1-${'1'.repeat(64)}`, `hlcv1-${'2'.repeat(64)}`];
    const tasks = ids.map((id, index) => ({ id, name: `live-${index + 1}.mp4`,
      sourceSha256: 'c'.repeat(64), state: 'completed' as const,
      attempt: 1, candidateCount: 1, lastErrorCode: null, createdAt: 1, updatedAt: 1 }));
    const api = {
      chooseRoot: vi.fn(async () => ({ ok: true as const, label: 'media' })),
      list: vi.fn(async () => ({ ok: true as const, busy: false, tasks })),
      listReviewed: vi.fn(async () => ({ ok: true as const, busy: false, clips: [] })),
      read: vi.fn(async (id: string) => {
        const index = ids.indexOf(id);
        return { ok: true as const, artifact: { taskId: id, attempt: 1,
          candidateIds: [], highlightIds: [highlights[index]], reviewRequired: true as const,
          highlights: [{ id: highlights[index], recordingId: `r-${index}`, startMs: 1000,
            endMs: 3000, score: 0.8, topic: `重点 ${index + 1}`, context: null, evidence: [],
            boundaryOrigin: 'auto' as const, adjustedAt: null, createdAt: '2026-01-01T00:00:00Z' }] } };
      }),
      exportReviewed: vi.fn(async () => ({ ok: true as const, results: [] })),
    } as unknown as HighlightV1API;
    await mount(api);
    await click('选择录屏目录');
    await click('汇总已完成候选');
    expect(api.read).toHaveBeenCalledTimes(2);
    const checkboxes = [...(host?.querySelectorAll('[aria-label^="选择高光片段 "]') ?? [])] as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    await act(async () => { checkboxes.forEach((input) => input.click()); });
    const approved = host?.querySelector('[aria-label="确认已人工审核所选片段"]') as HTMLInputElement;
    await act(async () => { approved.click(); });
    await click('生成所选切片');
    expect(api.exportReviewed).toHaveBeenCalledWith({ reviewConfirmed: true, concurrency: 2,
      selections: ids.map((taskId, index) => ({ taskId, highlightId: highlights[index],
        startMs: 1000, endMs: 3000 })) });
  });
});

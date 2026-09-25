// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useTimelineStore,
  setProjectDir,
  clearCurrentProject,
} from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

/**
 * 回归：外部/AI 改动 project.json 后，应用重载 timeline（applyExternalTimeline）
 * 不得再触发 autosave 回写 project.json，否则会形成 watch ⇄ autosave 死循环
 * （表现为 UI 一直卡在"保存中…"）。
 */
describe('外部反射不触发 autosave 回写（断 watch⇄autosave 回环）', () => {
  let saveSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    saveSpy = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      saveProjectSection: saveSpy,
    };
    setProjectDir('/tmp/proj-reflect');
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    clearCurrentProject();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('applyExternalTimeline 不写回 project.json', () => {
    useTimelineStore.getState().applyExternalTimeline(createDefaultTimeline());
    vi.advanceTimersByTime(1000);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('普通编辑仍会触发 autosave（未误伤正常保存）', () => {
    // 先放一个干净基线，避免初始引用相等导致订阅不触发
    useTimelineStore.setState({ timeline: createDefaultTimeline() });
    saveSpy.mockClear();

    useTimelineStore.getState().toggleTrackLocked('visual-1');
    vi.advanceTimersByTime(1000);
    expect(saveSpy).toHaveBeenCalledWith('/tmp/proj-reflect', 'timeline', expect.any(String));
  });
});

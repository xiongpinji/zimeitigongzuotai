import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleExternalEdit, type ExternalEditDeps } from '../src/lib/external-edit-sync';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';
import type { TimelineData } from '../src/types';

function makeDeps(overrides: Partial<ExternalEditDeps> = {}): ExternalEditDeps {
  return {
    loadProject: vi.fn(async () => ({ timeline: null as TimelineData | null })),
    projectDir: '/tmp/proj',
    applyCardSource: vi.fn(),
    onScriptChanged: vi.fn(),
    ...overrides,
  };
}

describe('handleExternalEdit', () => {
  beforeEach(() => {
    // 重置 timeline store 到一个干净的默认时间线
    useTimelineStore.getState().setTimeline(createDefaultTimeline());
  });

  it('project 路由：调用 loadProject 并把返回 timeline 喂给 applyExternalTimeline', async () => {
    const incoming = createDefaultTimeline();
    incoming.fps = 48; // 标记，便于断言被替换
    const loadProject = vi.fn(async () => ({ timeline: incoming }));
    const applySpy = vi.spyOn(useTimelineStore.getState(), 'applyExternalTimeline');

    const deps = makeDeps({ loadProject });
    await handleExternalEdit({ file: 'project.json', content: '{}' }, deps);

    expect(loadProject).toHaveBeenCalledWith('/tmp/proj');
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(useTimelineStore.getState().timeline.fps).toBe(48);
    applySpy.mockRestore();
  });

  it('project 路由：loadProject 返回 null timeline 时不调用 applyExternalTimeline', async () => {
    const loadProject = vi.fn(async () => ({ timeline: null as TimelineData | null }));
    const applySpy = vi.spyOn(useTimelineStore.getState(), 'applyExternalTimeline');

    const deps = makeDeps({ loadProject });
    await handleExternalEdit({ file: 'project.json', content: '{}' }, deps);

    expect(loadProject).toHaveBeenCalledTimes(1);
    expect(applySpy).not.toHaveBeenCalled();
    applySpy.mockRestore();
  });

  it('motion-card 路由：调用 applyCardSource(overlayId, content)', async () => {
    const deps = makeDeps();
    await handleExternalEdit(
      { file: 'ai-cards/overlay-123/motionCard.tsx', content: 'export default () => null;' },
      deps,
    );
    expect(deps.applyCardSource).toHaveBeenCalledWith('overlay-123', 'export default () => null;');
    expect(deps.onScriptChanged).not.toHaveBeenCalled();
  });

  it('script 路由：调用 onScriptChanged("script", content)', async () => {
    const deps = makeDeps();
    await handleExternalEdit({ file: 'script.md', content: '# hello' }, deps);
    expect(deps.onScriptChanged).toHaveBeenCalledWith('script', '# hello');
  });

  it('original 路由：调用 onScriptChanged("original", content)', async () => {
    const deps = makeDeps();
    await handleExternalEdit({ file: 'original.md', content: '原始素材' }, deps);
    expect(deps.onScriptChanged).toHaveBeenCalledWith('original', '原始素材');
  });

  it('other 路由：不触发任何 deps', async () => {
    const deps = makeDeps();
    await handleExternalEdit({ file: 'covers/cover.png', content: '' }, deps);
    expect(deps.loadProject).not.toHaveBeenCalled();
    expect(deps.applyCardSource).not.toHaveBeenCalled();
    expect(deps.onScriptChanged).not.toHaveBeenCalled();
  });
});

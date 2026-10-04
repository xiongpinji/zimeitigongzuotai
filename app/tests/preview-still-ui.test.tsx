// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultTimeline } from '../src/types';
import { useTimelineStore } from '../src/store/timeline';
import { PreviewPanel } from '../src/components/PreviewPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/store/ai', () => ({
  useAIStore: (selector: (state: { currentProjectDir: string }) => unknown) =>
    selector({ currentProjectDir: 'C:\\synthetic-project' }),
}));
vi.mock('../src/components/RemotionPreviewPlayer', async () => {
  const React = await import('react');
  return { RemotionPreviewPlayer: React.forwardRef(() => React.createElement('div', { 'data-player': 'mock' })) };
});
vi.mock('../src/ui', async () => {
  const React = await import('react');
  return {
    Button: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('button', props, children),
    Card: React.forwardRef(({ children, ...props }: { children?: React.ReactNode }, ref) => React.createElement('div', { ...props, ref }, children)),
    Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    TooltipContent: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    TooltipTrigger: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});
vi.mock('../src/components/AppIcon', async () => {
  const React = await import('react');
  return { AppIcon: () => React.createElement('span') };
});

async function until(predicate: () => boolean) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
  throw new Error('preview test condition not reached');
}

describe('exact paused frame in the editor', () => {
  let host: HTMLDivElement;
  let root: Root;
  let originalApi: typeof window.electronAPI;
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;
  let originalDecode: typeof Image.prototype.decode;

  beforeEach(() => {
    const timeline = createDefaultTimeline();
    timeline.podcast.durationMs = 90_000;
    useTimelineStore.setState({ timeline, srtEntries: [], assets: [] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    originalApi = window.electronAPI;
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    originalDecode = Image.prototype.decode;
    URL.createObjectURL = vi.fn(() => 'blob:synthetic-preview');
    URL.revokeObjectURL = vi.fn();
    Image.prototype.decode = vi.fn(async () => undefined);
    class Observer { observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', Observer);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    window.electronAPI = originalApi;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    Image.prototype.decode = originalDecode;
    vi.unstubAllGlobals();
  });

  it('late frame 42 cannot replace current frame 43 and playback clears the image immediately', async () => {
    const pending = new Map<number, (value: { sessionId: string; frame: number; png: Uint8Array }) => void>();
    const renderFrame = vi.fn((args: { sessionId: string; frame: number }) =>
      new Promise<{ sessionId: string; frame: number; png: Uint8Array }>((resolve) => pending.set(args.frame, resolve)));
    const release = vi.fn(async () => undefined);
    window.electronAPI = {
      prepareExactPreview: vi.fn(async () => ({ sessionId: 'session-one', durationInFrames: 100, fps: 30 })),
      renderExactPreviewFrame: renderFrame,
      releaseExactPreview: release,
    } as unknown as typeof window.electronAPI;
    const view = (time: number, playing: boolean) => <PreviewPanel
      playerRef={{ current: null }} isPlaying={playing} onTogglePlay={() => undefined}
      onExport={() => undefined} currentTimeMs={time} durationMs={90_000} compact={false}
      onPreviewTimeUpdate={() => undefined} onPreviewPlay={() => undefined}
      onPreviewPause={() => undefined} onPreviewEnded={() => undefined}
    />;
    await act(async () => root.render(view(1400, false)));
    await until(() => pending.has(42));
    await act(async () => root.render(view(1433, false)));
    await until(() => pending.has(43));
    await act(async () => pending.get(43)!({ sessionId: 'session-one', frame: 43, png: new Uint8Array([1]) }));
    await until(() => host.querySelector('[data-exact-preview-frame="43"]') !== null);
    await act(async () => pending.get(42)!({ sessionId: 'session-one', frame: 42, png: new Uint8Array([2]) }));
    expect(host.querySelector('[data-exact-preview-frame="43"]')).not.toBeNull();
    expect(host.querySelectorAll('img[alt="当前精确预览帧"]')).toHaveLength(1);
    await act(async () => root.render(view(1433, true)));
    expect(host.querySelector('[data-exact-preview-status="playing"]')).not.toBeNull();
    expect(host.querySelector('img[alt="当前精确预览帧"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('render failure exposes an error instead of claiming the native frame is exact', async () => {
    window.electronAPI = {
      prepareExactPreview: vi.fn(async () => ({ sessionId: 'session-error', durationInFrames: 100, fps: 30 })),
      renderExactPreviewFrame: vi.fn(async () => { throw new Error('synthetic render failure'); }),
      releaseExactPreview: vi.fn(async () => undefined),
    } as unknown as typeof window.electronAPI;
    await act(async () => root.render(<PreviewPanel
      playerRef={{ current: null }} isPlaying={false} onTogglePlay={() => undefined}
      onExport={() => undefined} currentTimeMs={1400} durationMs={90_000} compact={false}
      onPreviewTimeUpdate={() => undefined} onPreviewPlay={() => undefined}
      onPreviewPause={() => undefined} onPreviewEnded={() => undefined}
    />));
    await until(() => host.querySelector('[data-exact-preview-status="error"]') !== null);
    expect(host.querySelector('img[alt="当前精确预览帧"]')).toBeNull();
    expect(host.textContent).toContain('精确预览暂不可用');
  });
});

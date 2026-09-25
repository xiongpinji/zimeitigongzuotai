import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReviewPlaybackController } from '../src/lib/review-playback';
import type { ReviewPayload } from '../src/lib/script-review-payload';

// Mock virtual-cursor
vi.mock('../src/lib/virtual-cursor', () => ({
  setVirtualCursor: { of: (v: any) => ({ type: 'setVirtualCursor', value: v }) },
  clearVirtualCursor: { of: (v: any) => ({ type: 'clearVirtualCursor', value: v }) },
}));

function createMockView(doc = 'Hello World test content here') {
  return {
    state: { doc: { length: doc.length } },
    dispatch: vi.fn(),
  };
}

function createPayload(findings: ReviewPayload['findings'] = []): ReviewPayload {
  return {
    version: 1,
    filePath: 'script.md',
    docVersion: 1,
    summary: {
      total: findings.length,
      error: findings.filter(f => f.severity === 'error').length,
      warning: findings.filter(f => f.severity === 'warning').length,
      info: findings.filter(f => f.severity === 'info').length,
    },
    findings,
  };
}

describe('ReviewPlaybackController', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('plays findings in startOffset order and calls onComplete', async () => {
    const mockView = createMockView();
    const applyFinding = vi.fn();
    const onComplete = vi.fn();
    const onProgress = vi.fn();

    const controller = new ReviewPlaybackController(
      mockView as any,
      applyFinding,
      { onComplete, onProgress },
    );

    const payload = createPayload([
      { id: 'f2', startOffset: 20, endOffset: 25, quotedText: 'here', issue: 'Issue 2', suggestion: 'Fix 2', severity: 'info' },
      { id: 'f1', startOffset: 5, endOffset: 10, quotedText: 'World', issue: 'Issue 1', suggestion: 'Fix 1', severity: 'warning' },
    ]);

    controller.start(payload);

    // First finding (sorted by startOffset, so f1 first)
    await vi.advanceTimersByTimeAsync(300);
    expect(applyFinding).toHaveBeenCalledTimes(1);
    expect(applyFinding.mock.calls[0][0].id).toBe('f1');

    // Second finding
    await vi.advanceTimersByTimeAsync(300);
    expect(applyFinding).toHaveBeenCalledTimes(2);
    expect(applyFinding.mock.calls[1][0].id).toBe('f2');
    expect(onComplete).toHaveBeenCalled();
  });

  it('stop() halts playback', async () => {
    const mockView = createMockView();
    const applyFinding = vi.fn();
    const controller = new ReviewPlaybackController(mockView as any, applyFinding);

    const payload = createPayload([
      { id: 'f1', startOffset: 5, endOffset: 10, quotedText: 'World', issue: 'Issue', suggestion: 'Fix', severity: 'error' },
      { id: 'f2', startOffset: 20, endOffset: 25, quotedText: 'here', issue: 'Issue', suggestion: 'Fix', severity: 'info' },
    ]);

    controller.start(payload);
    controller.stop();

    await vi.advanceTimersByTimeAsync(1000);
    // stop 后不应再执行任何 finding
    expect(applyFinding).toHaveBeenCalledTimes(0);
  });

  it('empty findings triggers onComplete immediately', async () => {
    const mockView = createMockView();
    const applyFinding = vi.fn();
    const onComplete = vi.fn();
    const controller = new ReviewPlaybackController(mockView as any, applyFinding, { onComplete });

    controller.start(createPayload([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(onComplete).toHaveBeenCalled();
    expect(applyFinding).not.toHaveBeenCalled();
  });

  it('reports progress correctly', async () => {
    const mockView = createMockView();
    const applyFinding = vi.fn();
    const onProgress = vi.fn();

    const controller = new ReviewPlaybackController(
      mockView as any,
      applyFinding,
      { onProgress },
    );

    const payload = createPayload([
      { id: 'f1', startOffset: 0, endOffset: 5, quotedText: 'Hello', issue: 'A', suggestion: 'B', severity: 'error' },
      { id: 'f2', startOffset: 10, endOffset: 15, quotedText: 'test', issue: 'C', suggestion: 'D', severity: 'warning' },
      { id: 'f3', startOffset: 20, endOffset: 25, quotedText: 'here', issue: 'E', suggestion: 'F', severity: 'info' },
    ]);

    controller.start(payload);

    await vi.advanceTimersByTimeAsync(300);
    expect(onProgress).toHaveBeenCalledWith(33, 1);

    await vi.advanceTimersByTimeAsync(300);
    expect(onProgress).toHaveBeenCalledWith(67, 2);

    await vi.advanceTimersByTimeAsync(300);
    expect(onProgress).toHaveBeenCalledWith(100, 3);
  });

  it('calls onFinding with correct ids', async () => {
    const mockView = createMockView();
    const applyFinding = vi.fn();
    const onFinding = vi.fn();

    const controller = new ReviewPlaybackController(
      mockView as any,
      applyFinding,
      { onFinding },
    );

    const payload = createPayload([
      { id: 'alpha', startOffset: 0, endOffset: 5, quotedText: 'Hello', issue: 'A', suggestion: 'B', severity: 'error' },
      { id: 'beta', startOffset: 10, endOffset: 15, quotedText: 'test', issue: 'C', suggestion: 'D', severity: 'info' },
    ]);

    controller.start(payload);

    await vi.advanceTimersByTimeAsync(300);
    expect(onFinding).toHaveBeenCalledWith('alpha');

    await vi.advanceTimersByTimeAsync(300);
    expect(onFinding).toHaveBeenCalledWith('beta');
  });

  it('isPlaying reflects controller state', async () => {
    const mockView = createMockView();
    const applyFinding = vi.fn();
    const controller = new ReviewPlaybackController(mockView as any, applyFinding);

    expect(controller.isPlaying).toBe(false);

    const payload = createPayload([
      { id: 'f1', startOffset: 0, endOffset: 5, quotedText: 'Hello', issue: 'A', suggestion: 'B', severity: 'error' },
    ]);

    controller.start(payload);
    expect(controller.isPlaying).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(controller.isPlaying).toBe(false);
  });

  it('moves virtual cursor before each finding', async () => {
    const mockView = createMockView();
    const applyFinding = vi.fn();

    const controller = new ReviewPlaybackController(mockView as any, applyFinding);

    const payload = createPayload([
      { id: 'f1', startOffset: 5, endOffset: 10, quotedText: 'World', issue: 'A', suggestion: 'B', severity: 'warning' },
    ]);

    controller.start(payload);

    // 在 start 后、timer 触发前，应已调用 dispatch 移动虚拟光标
    expect(mockView.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        effects: { type: 'setVirtualCursor', value: 5 },
        scrollIntoView: true,
      }),
    );
  });
});

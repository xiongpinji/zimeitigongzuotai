// 审查结果本地回放控制器：将 AI 审查发现以动画形式逐条展示
import type { EditorView } from '@codemirror/view';
import { setVirtualCursor, clearVirtualCursor } from './virtual-cursor';
import type { ReviewPayload, ReviewFinding } from './script-review-payload';

export interface ReviewPlaybackOptions {
  /** 每条 finding 之间的延迟(ms)，默认 300 */
  findingDelayMs?: number;
  /** 扫描进度 + 已发现问题数 */
  onProgress?: (percent: number, found: number) => void;
  /** 每条 finding 回放时触发 */
  onFinding?: (findingId: string) => void;
  /** 全部回放完成 */
  onComplete?: () => void;
}

export class ReviewPlaybackController {
  private view: EditorView;
  private applyFinding: (finding: ReviewFinding) => void;
  private options: Required<ReviewPlaybackOptions>;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private sortedFindings: ReviewFinding[] = [];
  private currentIndex = 0;
  private _isPlaying = false;
  /** 用户是否手动滚动过 */
  private userScrolled = false;
  private lastProgrammaticScrollTime = 0;
  private scrollHandler: (() => void) | null = null;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  constructor(
    view: EditorView,
    applyFinding: (finding: ReviewFinding) => void,
    options: ReviewPlaybackOptions = {},
  ) {
    this.view = view;
    this.applyFinding = applyFinding;
    this.options = {
      findingDelayMs: options.findingDelayMs ?? 300,
      onProgress: options.onProgress ?? (() => {}),
      onFinding: options.onFinding ?? (() => {}),
      onComplete: options.onComplete ?? (() => {}),
    };
  }

  private getScrollDom():
    | {
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      }
    | null {
    const maybeScrollDom = (this.view as EditorView & {
      scrollDOM?: {
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      };
    }).scrollDOM;

    if (
      !maybeScrollDom ||
      typeof maybeScrollDom.addEventListener !== 'function' ||
      typeof maybeScrollDom.removeEventListener !== 'function'
    ) {
      return null;
    }

    return maybeScrollDom;
  }

  private startScrollTracking(): void {
    this.userScrolled = false;
    this.scrollHandler = () => {
      if (Date.now() - this.lastProgrammaticScrollTime < 100) return;
      this.userScrolled = true;
    };
    this.getScrollDom()?.addEventListener('scroll', this.scrollHandler);
  }

  private stopScrollTracking(): void {
    if (this.scrollHandler) {
      this.getScrollDom()?.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
  }

  start(payload: ReviewPayload): void {
    this.stop();
    this.sortedFindings = [...payload.findings].sort(
      (a, b) => a.startOffset - b.startOffset,
    );
    this.currentIndex = 0;
    this._isPlaying = true;
    this.startScrollTracking();
    this.scheduleNext();
  }

  stop(): void {
    this.cancelTimer();
    this.stopScrollTracking();
    if (this._isPlaying) {
      this._isPlaying = false;
      this.view.dispatch({ effects: clearVirtualCursor.of(null) });
    }
  }

  private scheduleNext(): void {
    if (this.currentIndex >= this.sortedFindings.length) {
      this._isPlaying = false;
      this.stopScrollTracking();
      this.view.dispatch({ effects: clearVirtualCursor.of(null) });
      this.options.onComplete();
      return;
    }

    const finding = this.sortedFindings[this.currentIndex];

    // 将虚拟光标移到当前 finding 位置
    const shouldScroll = !this.userScrolled;
    if (shouldScroll) this.lastProgrammaticScrollTime = Date.now();
    this.view.dispatch({
      effects: setVirtualCursor.of(finding.startOffset),
      scrollIntoView: shouldScroll,
    });

    this.timerId = setTimeout(() => {
      this.applyFinding(finding);
      this.options.onFinding(finding.id);
      this.currentIndex++;
      this.options.onProgress(
        Math.round(
          (this.currentIndex / this.sortedFindings.length) * 100,
        ),
        this.currentIndex,
      );
      this.scheduleNext();
    }, this.options.findingDelayMs);
  }

  private cancelTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

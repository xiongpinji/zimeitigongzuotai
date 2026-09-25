export const PLAYBACK_UI_UPDATE_MS = 250;

export function shouldUpdatePlaybackTime(
  previousMs: number,
  nextMs: number,
  thresholdMs = PLAYBACK_UI_UPDATE_MS,
): boolean {
  if (nextMs <= previousMs) {
    return true;
  }

  return nextMs - previousMs >= thresholdMs;
}

/**
 * 预览播放器是否应当根据外部时间（currentTimeMs）把播放头 seek 到目标帧。
 *
 * 背景：预览 Player 既向外上报自己的时间（frameupdate → currentTimeMs），又把
 * currentTimeMs 当作 seek 目标回灌。播放期间 currentTimeMs 是「被 250ms 节流过、
 * 滞后于真实播放头」的回声；一旦某次渲染卡顿使回声滞后超过容差，旧逻辑会把 Player
 * 往回 seek，导致每隔几秒重放约 0.25s 音频。
 *
 * 因此：**播放中一律不依据回声 seek**（外部跳转走命令式 seekToMs）；只有暂停态
 * （外部跳转 / 换音频后 remount 重新对齐）且漂移超过容差时才 seek。
 */
export function shouldResyncPreviewSeek(params: {
  /** Player 实例的瞬时播放状态。 */
  isPlaying: boolean;
  /** 父级 UI/用户意图中的播放状态；未传时回退到 Player 瞬时状态。 */
  playbackIntentPlaying?: boolean;
  currentFrame: number;
  targetFrame: number;
  thresholdFrames: number;
}): boolean {
  if (params.playbackIntentPlaying ?? params.isPlaying) {
    return false;
  }
  return Math.abs(params.currentFrame - params.targetFrame) > params.thresholdFrames;
}

/**
 * 外部 currentTimeMs 变化是否需要刷新 RemotionPreviewPlayer。
 *
 * 播放中 currentTimeMs 是 Player 自己通过 frameupdate 上报后的 UI 回声，
 * 它只用于时间标签 / 时间线播放头，不应该反过来刷新 Player 子树。
 */
export function shouldRefreshPreviewForExternalTime(params: {
  previousIsPlaying: boolean;
  nextIsPlaying: boolean;
  previousTimeMs: number;
  nextTimeMs: number;
}): boolean {
  if (params.previousIsPlaying !== params.nextIsPlaying) {
    return true;
  }

  if (params.previousTimeMs === params.nextTimeMs) {
    return false;
  }

  return !params.previousIsPlaying && !params.nextIsPlaying;
}

/**
 * 拖动播放头时的播放状态机。
 *
 * 背景：`@hyperframes/player` 的 `seek()` 会把内部时钟停掉并置 `_paused = true`，
 * 但不会派发 `pause` 事件。因此「播放中拖动时间轴」会出现两个问题：
 * 1. 播放被静默打断（实际暂停）；
 * 2. Renderer 的 `isPlaying` 仍是 `true`（只有 `pause` 事件才会翻转），按钮显示在播放中。
 *
 * 这里用一个纯状态机描述标准非线性编辑器的「拖动时暂停、松手后续播」行为：
 * - 拖动开始：若在播放则记下并暂停，拖动期间播放头只跟随光标，不会自行前进；
 * - 拖动结束：若开始时在播放则续播，从拖到的位置继续；
 * - 一次性 seek（点击轨道、字幕/AI 跳转，不带 start/end）：若在播放则 seek 后立即续播，
 *   避免停在「实际暂停但 isPlaying=true」的错位状态。
 */
export interface ScrubPlaybackState {
  /** 是否正处于一次连续拖动会话中。 */
  scrubbing: boolean;
  /** 拖动开始时播放器是否在播放（决定松手后是否续播）。 */
  wasPlaying: boolean;
}

export type PlayerAction = 'play' | 'pause' | 'none';

export const IDLE_SCRUB_STATE: ScrubPlaybackState = { scrubbing: false, wasPlaying: false };

export function beginScrub(isPlaying: boolean): {
  state: ScrubPlaybackState;
  action: PlayerAction;
} {
  return {
    state: { scrubbing: true, wasPlaying: isPlaying },
    action: isPlaying ? 'pause' : 'none',
  };
}

export function endScrub(state: ScrubPlaybackState): {
  state: ScrubPlaybackState;
  action: PlayerAction;
} {
  return {
    state: IDLE_SCRUB_STATE,
    action: state.wasPlaying ? 'play' : 'none',
  };
}

export function resolveSeekResume(
  isPlaying: boolean,
  state: ScrubPlaybackState,
): PlayerAction {
  // 拖动会话中由 begin/endScrub 统一管理播放，这里不再插手，保证播放头只跟随光标。
  if (state.scrubbing) {
    return 'none';
  }
  return isPlaying ? 'play' : 'none';
}

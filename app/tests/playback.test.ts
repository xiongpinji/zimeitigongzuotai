import { describe, expect, it } from 'vitest';
import {
  IDLE_SCRUB_STATE,
  beginScrub,
  endScrub,
  resolveSeekResume,
  shouldRefreshPreviewForExternalTime,
  shouldResyncPreviewSeek,
  shouldUpdatePlaybackTime,
} from '../src/lib/playback';

describe('shouldUpdatePlaybackTime', () => {
  it('skips tiny forward frame updates to avoid thrashing the preview', () => {
    expect(shouldUpdatePlaybackTime(1000, 1033)).toBe(false);
    expect(shouldUpdatePlaybackTime(1000, 1199)).toBe(false);
  });

  it('publishes meaningful forward progress updates', () => {
    expect(shouldUpdatePlaybackTime(1000, 1250)).toBe(true);
    expect(shouldUpdatePlaybackTime(1000, 1350)).toBe(true);
  });

  it('always updates when playback jumps backwards', () => {
    expect(shouldUpdatePlaybackTime(1000, 950)).toBe(true);
    expect(shouldUpdatePlaybackTime(1000, 0)).toBe(true);
  });
});

describe('shouldResyncPreviewSeek', () => {
  // Regression: the preview Player both reports its own time (frameupdate → currentTimeMs)
  // and receives currentTimeMs back as a seek target. During playback that echo is a stale,
  // throttled value; a render hitch made it lag past the tolerance and the Player seeked
  // itself backwards, replaying ~0.25s of audio every few seconds. While playing we must
  // never resync from the echoed time — external jumps go through the imperative seek path.
  it('never resyncs while playing, even when the echoed time lags past the threshold', () => {
    expect(
      shouldResyncPreviewSeek({
        isPlaying: true,
        currentFrame: 120,
        targetFrame: 100, // 20 frames behind, well past an 8-frame tolerance
        thresholdFrames: 8,
      }),
    ).toBe(false);
  });

  it('trusts the parent playback intent when the player reports a transient non-playing state', () => {
    expect(
      shouldResyncPreviewSeek({
        isPlaying: false,
        playbackIntentPlaying: true,
        currentFrame: 150,
        targetFrame: 120,
        thresholdFrames: 8,
      }),
    ).toBe(false);
  });

  it('resyncs while paused when the playhead drifted past the tolerance', () => {
    expect(
      shouldResyncPreviewSeek({
        isPlaying: false,
        currentFrame: 0,
        targetFrame: 100,
        thresholdFrames: 8,
      }),
    ).toBe(true);
  });

  it('stays put while paused when the playhead is already within the tolerance', () => {
    expect(
      shouldResyncPreviewSeek({
        isPlaying: false,
        currentFrame: 100,
        targetFrame: 103,
        thresholdFrames: 8,
      }),
    ).toBe(false);
  });
});

describe('shouldRefreshPreviewForExternalTime', () => {
  it('does not refresh the preview player for throttled time echoes while playback continues', () => {
    expect(
      shouldRefreshPreviewForExternalTime({
        previousIsPlaying: true,
        nextIsPlaying: true,
        previousTimeMs: 1_000,
        nextTimeMs: 1_250,
      }),
    ).toBe(false);
  });

  it('refreshes when paused so external seeks can still resync the player', () => {
    expect(
      shouldRefreshPreviewForExternalTime({
        previousIsPlaying: false,
        nextIsPlaying: false,
        previousTimeMs: 1_000,
        nextTimeMs: 1_250,
      }),
    ).toBe(true);
  });

  it('refreshes when playback state changes', () => {
    expect(
      shouldRefreshPreviewForExternalTime({
        previousIsPlaying: true,
        nextIsPlaying: false,
        previousTimeMs: 1_000,
        nextTimeMs: 1_000,
      }),
    ).toBe(true);
  });
});

describe('scrub playback state machine', () => {
  it('pauses an active scrub when playback was running, remembering to resume', () => {
    const { state, action } = beginScrub(true);
    expect(action).toBe('pause');
    expect(state).toEqual({ scrubbing: true, wasPlaying: true });
  });

  it('does nothing on scrub start when already paused', () => {
    const { state, action } = beginScrub(false);
    expect(action).toBe('none');
    expect(state).toEqual({ scrubbing: true, wasPlaying: false });
  });

  it('resumes playback at the end of a scrub that interrupted playback', () => {
    const begun = beginScrub(true).state;
    const { state, action } = endScrub(begun);
    expect(action).toBe('play');
    expect(state).toEqual(IDLE_SCRUB_STATE);
  });

  it('stays paused at the end of a scrub that started paused', () => {
    const begun = beginScrub(false).state;
    const { state, action } = endScrub(begun);
    expect(action).toBe('none');
    expect(state).toEqual(IDLE_SCRUB_STATE);
  });

  it('resumes a one-shot seek (no active scrub) when playback was running', () => {
    // Regression: player.seek() silently pauses without firing a pause event,
    // so a click-to-seek while playing must explicitly resume.
    expect(resolveSeekResume(true, IDLE_SCRUB_STATE)).toBe('play');
  });

  it('leaves a one-shot seek paused when playback was not running', () => {
    expect(resolveSeekResume(false, IDLE_SCRUB_STATE)).toBe('none');
  });

  it('never resumes mid-scrub, so the playhead only follows the cursor', () => {
    const scrubbing = beginScrub(true).state;
    expect(resolveSeekResume(false, scrubbing)).toBe('none');
    expect(resolveSeekResume(true, scrubbing)).toBe('none');
  });
});

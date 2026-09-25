import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';
import type { SrtEntry } from '../src/types';

function resetStore() {
  // Reset to a fresh default timeline — setTimeline flushes history and state
  useTimelineStore.getState().setTimeline(createDefaultTimeline());
  // Manually clear srtEntries and originalSrtEntries which are not part of timeline
  useTimelineStore.setState({ srtEntries: [], originalSrtEntries: [] });
}

describe('setSrtEntries baseline behavior', () => {
  beforeEach(() => {
    resetStore();
  });

  it('stores entries as originalSrtEntries and auto-splits when too long', () => {
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      // 40 Chinese chars, well over the default 35 limit
      text: '这是一段特别长的字幕文本包含许多字符用于测试自动切分功能是否正常工作真的很长',
    };
    useTimelineStore.getState().setSrtEntries([longEntry]);

    const state = useTimelineStore.getState();
    expect(state.originalSrtEntries).toHaveLength(1);
    expect(state.originalSrtEntries[0].text).toBe(longEntry.text);
    expect(state.srtEntries.length).toBeGreaterThan(1);
    expect(state.srtEntries.every((e) => e.text.length <= 35)).toBe(true);
  });

  it('keeps srtEntries equal to baseline when every entry is under limit', () => {
    const shortEntry: SrtEntry = { index: 1, startMs: 0, endMs: 1_000, text: '短字幕' };
    useTimelineStore.getState().setSrtEntries([shortEntry]);
    const state = useTimelineStore.getState();
    expect(state.originalSrtEntries).toEqual([shortEntry]);
    expect(state.srtEntries).toEqual([shortEntry]);
  });

  it('overwrites previous baseline when called again', () => {
    useTimelineStore.getState().setSrtEntries([{ index: 1, startMs: 0, endMs: 1_000, text: '第一次' }]);
    useTimelineStore.getState().setSrtEntries([{ index: 1, startMs: 0, endMs: 2_000, text: '第二次' }]);
    const state = useTimelineStore.getState();
    expect(state.originalSrtEntries).toHaveLength(1);
    expect(state.originalSrtEntries[0].text).toBe('第二次');
    expect(state.srtEntries[0].text).toBe('第二次');
  });
});

describe('subtitle resegment actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('setSubtitleMaxChars updates setting and triggers resegment', () => {
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      text: '一二三四五六七八九十一二三四五六七八九十一二三四五',
    };
    useTimelineStore.getState().setSrtEntries([longEntry]);
    // 25 chars < default 35, so no split yet
    expect(useTimelineStore.getState().srtEntries).toHaveLength(1);

    useTimelineStore.getState().setSubtitleMaxChars(10);
    const state = useTimelineStore.getState();
    expect(state.timeline.subtitle.maxCharsPerEntry).toBe(10);
    expect(state.srtEntries.length).toBeGreaterThan(1);
    expect(state.srtEntries.every((e) => e.text.length <= 10)).toBe(true);
  });

  it('resegmentSubtitles re-runs algorithm from originalSrtEntries', () => {
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      text: '一二三四五六七八九十一二三四五六七八九十一二三四五',
    };
    useTimelineStore.getState().setSrtEntries([longEntry]);
    useTimelineStore.getState().updateSubtitleStyle({ maxCharsPerEntry: 8 });

    const result = useTimelineStore.getState().resegmentSubtitles();

    const state = useTimelineStore.getState();
    expect(state.srtEntries.every((e) => e.text.length <= 8)).toBe(true);
    expect(result.droppedHighlights).toBe(0);
  });

  it('restoreOriginalSubtitles restores srtEntries to baseline', () => {
    const longEntry: SrtEntry = {
      index: 1,
      startMs: 0,
      endMs: 4_000,
      text: '一二三四五六七八九十一二三四五六七八九十一二三四五',
    };
    useTimelineStore.getState().setSrtEntries([longEntry]);
    useTimelineStore.getState().setSubtitleMaxChars(8);
    expect(useTimelineStore.getState().srtEntries.length).toBeGreaterThan(1);

    useTimelineStore.getState().restoreOriginalSubtitles();
    const state = useTimelineStore.getState();
    expect(state.srtEntries).toEqual([longEntry]);
  });

  it('setAutoResegment toggles the flag', () => {
    useTimelineStore.getState().setAutoResegment(false);
    expect(useTimelineStore.getState().timeline.subtitle.autoResegment).toBe(false);
    useTimelineStore.getState().setAutoResegment(true);
    expect(useTimelineStore.getState().timeline.subtitle.autoResegment).toBe(true);
  });
});

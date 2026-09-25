import { describe, expect, it } from 'vitest';
import { initAudioClipsFromSubtitles } from '../src/lib/clip-init';
import type { SrtEntry } from '../src/types';

const sampleEntries: SrtEntry[] = [
  { index: 1, startMs: 0, endMs: 2000, text: '第一句' },
  { index: 2, startMs: 2000, endMs: 5000, text: '第二句' },
  { index: 3, startMs: 5500, endMs: 8000, text: '第三句（有间隙）' },
];

describe('initAudioClipsFromSubtitles', () => {
  it('每条字幕对应一个 Clip', () => {
    const clips = initAudioClipsFromSubtitles(sampleEntries, 8000);

    expect(clips).toHaveLength(sampleEntries.length);
  });

  it('clip.source 等于 origin + 字幕的 startMs/endMs', () => {
    const clips = initAudioClipsFromSubtitles(sampleEntries, 8000);

    sampleEntries.forEach((entry, i) => {
      expect(clips[i].source).toEqual({
        kind: 'origin',
        startMs: entry.startMs,
        endMs: entry.endMs,
      });
    });
  });

  it('timelineStartMs 等于字幕 startMs（1:1 映射）', () => {
    const clips = initAudioClipsFromSubtitles(sampleEntries, 8000);

    sampleEntries.forEach((entry, i) => {
      expect(clips[i].timelineStartMs).toBe(entry.startMs);
    });
  });

  it('durationMs 等于 endMs - startMs', () => {
    const clips = initAudioClipsFromSubtitles(sampleEntries, 8000);

    sampleEntries.forEach((entry, i) => {
      expect(clips[i].durationMs).toBe(entry.endMs - entry.startMs);
    });
  });

  it('linkedSubtitleIndexes 包含对应字幕 index', () => {
    const clips = initAudioClipsFromSubtitles(sampleEntries, 8000);

    sampleEntries.forEach((entry, i) => {
      expect(clips[i].linkedSubtitleIndexes).toEqual([entry.index]);
    });
  });

  it('Clip id 唯一', () => {
    const clips = initAudioClipsFromSubtitles(sampleEntries, 8000);
    const ids = clips.map((clip) => clip.id);

    expect(new Set(ids).size).toBe(clips.length);
  });

  it('空输入返回空数组', () => {
    const clips = initAudioClipsFromSubtitles([], 0);

    expect(clips).toEqual([]);
  });
});

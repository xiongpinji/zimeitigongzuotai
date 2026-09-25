import { describe, expect, it } from 'vitest';
import {
  isAudioFile,
  isImageFile,
  isMediaPreviewFile,
} from '../src/lib/workbench-file-kind';

describe('workbench-file-kind', () => {
  it('detects image files by extension (case-insensitive, nested paths)', () => {
    for (const p of ['covers/a.png', 'b.JPG', 'c.jpeg', 'd.webp', 'e.gif', 'f.svg', 'g.avif']) {
      expect(isImageFile(p)).toBe(true);
    }
    expect(isImageFile('script.md')).toBe(false);
    expect(isImageFile('audio.mp3')).toBe(false);
  });

  it('detects audio files by extension (case-insensitive, nested paths)', () => {
    for (const p of ['imports/x/podcast.mp3', 'b.WAV', 'c.ogg', 'd.m4a', 'e.aac', 'f.flac', 'g.opus']) {
      expect(isAudioFile(p)).toBe(true);
    }
    expect(isAudioFile('cover.png')).toBe(false);
    expect(isAudioFile('original.md')).toBe(false);
  });

  it('isMediaPreviewFile covers image and audio, not text or other binary', () => {
    expect(isMediaPreviewFile('a.png')).toBe(true);
    expect(isMediaPreviewFile('a.mp3')).toBe(true);
    expect(isMediaPreviewFile('a.md')).toBe(false);
    expect(isMediaPreviewFile('a.mp4')).toBe(false);
    expect(isMediaPreviewFile('a.zip')).toBe(false);
  });
});

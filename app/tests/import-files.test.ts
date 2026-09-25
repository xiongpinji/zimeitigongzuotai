import { describe, expect, it, vi } from 'vitest';
import {
  getDroppedFilePath,
  getHtmlImportFileError,
  getImportFileError,
  isAcceptedHtmlImportPath,
  isAcceptedImportPath,
  type ImportKind,
} from '../src/lib/import-files';

function createMockFile(name: string, legacyPath?: string) {
  return {
    name,
    path: legacyPath,
  } as File & { path?: string };
}

describe('isAcceptedImportPath', () => {
  it('accepts mp3 files for audio import', () => {
    expect(isAcceptedImportPath('/tmp/voice.mp3', 'audio')).toBe(true);
    expect(isAcceptedImportPath('/tmp/VOICE.MP3', 'audio')).toBe(true);
  });

  it('accepts srt files for subtitle import', () => {
    expect(isAcceptedImportPath('/tmp/subtitles.srt', 'srt')).toBe(true);
    expect(isAcceptedImportPath('/tmp/SUBTITLES.SRT', 'srt')).toBe(true);
  });

  it('rejects mismatched file extensions', () => {
    expect(isAcceptedImportPath('/tmp/voice.wav', 'audio')).toBe(false);
    expect(isAcceptedImportPath('/tmp/subtitles.txt', 'srt')).toBe(false);
  });
});

describe('isAcceptedHtmlImportPath', () => {
  it('accepts html files for ai card import', () => {
    expect(isAcceptedHtmlImportPath('/tmp/card.html')).toBe(true);
    expect(isAcceptedHtmlImportPath('/tmp/CARD.HTM')).toBe(true);
  });

  it('rejects non-html files for ai card import', () => {
    expect(isAcceptedHtmlImportPath('/tmp/card.md')).toBe(false);
    expect(isAcceptedHtmlImportPath('/tmp/card.txt')).toBe(false);
  });
});

describe('getDroppedFilePath', () => {
  it('uses the legacy file.path when available', () => {
    const file = createMockFile('voice.mp3', '/tmp/voice.mp3');
    const getPathForFile = vi.fn(() => '/tmp/other.mp3');

    expect(getDroppedFilePath(file, getPathForFile)).toBe('/tmp/voice.mp3');
    expect(getPathForFile).not.toHaveBeenCalled();
  });

  it('falls back to electron getPathForFile when legacy path is unavailable', () => {
    const file = createMockFile('voice.mp3');
    const getPathForFile = vi.fn(() => '/tmp/voice.mp3');

    expect(getDroppedFilePath(file, getPathForFile)).toBe('/tmp/voice.mp3');
    expect(getPathForFile).toHaveBeenCalledOnce();
  });

  it('returns an empty string when no native path can be resolved', () => {
    const file = createMockFile('voice.mp3');

    expect(getDroppedFilePath(file, () => '')).toBe('');
  });
});

describe('getImportFileError', () => {
  it.each<{
    kind: ImportKind;
    filePath: string;
    expected: string | null;
  }>([
    {
      kind: 'audio',
      filePath: '/tmp/voice.mp3',
      expected: null,
    },
    {
      kind: 'srt',
      filePath: '/tmp/subtitles.srt',
      expected: null,
    },
    {
      kind: 'audio',
      filePath: '/tmp/subtitles.srt',
      expected: '请导入 MP3 音频文件。',
    },
    {
      kind: 'srt',
      filePath: '/tmp/voice.mp3',
      expected: '请导入 SRT 字幕文件。',
    },
  ])('returns the expected validation result for $filePath', ({ kind, filePath, expected }) => {
    expect(getImportFileError(filePath, kind)).toBe(expected);
  });
});

describe('getHtmlImportFileError', () => {
  it('returns null for supported html files', () => {
    expect(getHtmlImportFileError('/tmp/card.html')).toBeNull();
    expect(getHtmlImportFileError('/tmp/card.HTM')).toBeNull();
  });

  it('returns an explicit message for unsupported file types', () => {
    expect(getHtmlImportFileError('/tmp/card.txt')).toBe('请拖入 HTML 文件（.html 或 .htm）。');
  });
});

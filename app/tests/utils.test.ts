import { describe, expect, it } from 'vitest';
import { formatTime, frameToMs, msToFrame, toFileSrc } from '../src/lib/utils';

describe('msToFrame', () => {
  it('converts milliseconds to frames using floor semantics', () => {
    expect(msToFrame(1000, 30)).toBe(30);
    expect(msToFrame(500, 30)).toBe(15);
    expect(msToFrame(33, 30)).toBe(0);
    expect(msToFrame(34, 30)).toBe(1);
  });
});

describe('frameToMs', () => {
  it('converts frames back to milliseconds', () => {
    expect(frameToMs(30, 30)).toBe(1000);
    expect(frameToMs(15, 30)).toBe(500);
  });
});

describe('formatTime', () => {
  it('formats milliseconds as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(62000)).toBe('01:02');
  });
});

describe('toFileSrc', () => {
  it('encodes special characters in local POSIX paths', () => {
    expect(toFileSrc('/tmp/封面 #1?.png')).toBe(
      'file:///tmp/%E5%B0%81%E9%9D%A2%20%231%3F.png',
    );
  });

  it('keeps literal backslashes in macOS filenames', () => {
    expect(toFileSrc('/tmp/topic\\n#AI算力/video.mp4')).toBe(
      'file:///tmp/topic%5Cn%23AI%E7%AE%97%E5%8A%9B/video.mp4',
    );
  });

  it('encodes real line breaks in local POSIX paths', () => {
    expect(toFileSrc('/tmp/topic\n#AI算力/video.mp4')).toBe(
      'file:///tmp/topic%0A%23AI%E7%AE%97%E5%8A%9B/video.mp4',
    );
  });

  it('normalizes Windows drive paths', () => {
    expect(toFileSrc('C:\\Videos\\demo #1.mp4')).toBe(
      'file:///C:/Videos/demo%20%231.mp4',
    );
  });

  it('returns existing URL values unchanged', () => {
    expect(toFileSrc('https://example.com/video.mp4')).toBe('https://example.com/video.mp4');
    expect(toFileSrc('file:///tmp/video.mp4')).toBe('file:///tmp/video.mp4');
  });
});

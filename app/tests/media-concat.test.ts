import { describe, expect, it, vi } from 'vitest';
import { concatWavFiles } from '../electron/media-concat';

describe('concatWavFiles', () => {
  it('用 concat demuxer + -c copy 调 ffmpeg，输出到目标路径', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const execFile = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args });
      return { stdout: '', stderr: '' };
    });
    await concatWavFiles(['/tmp/a.wav', '/tmp/b.wav'], '/tmp/out.wav', {
      ffmpegPath: '/usr/bin/ffmpeg',
      execFile,
      writeListFile: vi.fn(async () => '/tmp/list.txt'),
    });
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(calls[0].file).toBe('/usr/bin/ffmpeg');
    expect(calls[0].args).toEqual(
      expect.arrayContaining(['-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt', '-c', 'copy', '/tmp/out.wav']),
    );
  });

  it('单文件直接走 ffmpeg copy（仍产出目标文件）', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    await concatWavFiles(['/tmp/only.wav'], '/tmp/out.wav', {
      ffmpegPath: 'ffmpeg', execFile, writeListFile: vi.fn(async () => '/tmp/list.txt'),
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});

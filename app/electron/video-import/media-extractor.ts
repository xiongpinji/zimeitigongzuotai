import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';

export interface MediaExtractorOptions {
  execFile?: (
    file: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

function defaultExecFile(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function extractAudioToMp3(
  videoPath: string,
  audioPath: string,
  options: MediaExtractorOptions = {},
): Promise<string> {
  await fs.mkdir(path.dirname(audioPath), { recursive: true });

  try {
    await (options.execFile ?? defaultExecFile)('ffmpeg', [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-ar',
      '44100',
      audioPath,
    ]);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error('未找到 ffmpeg，请先在系统中安装 ffmpeg');
    }
    throw new Error(`ffmpeg 提取音频失败: ${err.message}`);
  }

  return audioPath;
}

export async function convertAudioToMp3(
  sourceAudioPath: string,
  audioPath: string,
  options: MediaExtractorOptions = {},
): Promise<string> {
  await fs.mkdir(path.dirname(audioPath), { recursive: true });

  try {
    await (options.execFile ?? defaultExecFile)('ffmpeg', [
      '-y',
      '-i',
      sourceAudioPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-ar',
      '44100',
      audioPath,
    ]);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error('未找到 ffmpeg，请先在系统中安装 ffmpeg');
    }
    throw new Error(`ffmpeg 转换音频失败: ${err.message}`);
  }

  return audioPath;
}

import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);

export interface ReadMediaDurationOptions {
  binariesDirectory?: string | null;
  ffprobePath?: string | null;
  execFile?: (
    file: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

function getFfprobeExecutablePath(
  binariesDirectory: string | null,
  platform: NodeJS.Platform = process.platform,
): string {
  const executableName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  return binariesDirectory ? path.join(binariesDirectory, executableName) : executableName;
}

function resolveFfprobeExecutablePath(options: ReadMediaDurationOptions): string {
  if (options.ffprobePath) return options.ffprobePath;
  return getFfprobeExecutablePath(options.binariesDirectory ?? null);
}

function parseDurationMs(stdout: string): number {
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Unable to read media duration from ffprobe output: ${stdout.trim()}`);
  }

  return Math.max(500, Math.round(seconds * 1000));
}

export async function readAudioDurationMs(
  filePath: string,
  options: ReadMediaDurationOptions,
): Promise<number> {
  const execFile = options.execFile ?? execFileAsync;
  const { stdout } = await execFile(resolveFfprobeExecutablePath(options), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);

  return parseDurationMs(stdout);
}

export async function readVideoDurationMs(
  filePath: string,
  options: Pick<ReadMediaDurationOptions, 'binariesDirectory' | 'ffprobePath' | 'execFile'> = {},
): Promise<number> {
  const execFile = options.execFile ?? execFileAsync;
  const { stdout } = await execFile(resolveFfprobeExecutablePath(options), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);

  return parseDurationMs(stdout);
}

export function isAudioExtension(extension: string, audioExtensions: string[]): boolean {
  return audioExtensions.includes(extension.toLowerCase().replace(/^\./, ''));
}

export function isVideoExtension(extension: string, videoExtensions: string[]): boolean {
  return videoExtensions.includes(extension.toLowerCase().replace(/^\./, ''));
}

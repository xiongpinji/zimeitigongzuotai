import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);

export interface ConcatWavOptions {
  ffmpegPath: string;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  /** 写 concat 列表文件，返回其路径；默认写到系统临时目录。 */
  writeListFile?: (lines: string[]) => Promise<string>;
}

function escapeForConcatList(p: string): string {
  // ffmpeg concat 列表：单引号包裹，内部单引号转义
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

async function defaultWriteListFile(lines: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingji-concat-'));
  const listPath = path.join(dir, 'list.txt');
  await fs.writeFile(listPath, lines.join('\n') + '\n', 'utf-8');
  return listPath;
}

/** 用 ffmpeg concat demuxer 把同格式 WAV 无损拼接为单个文件。 */
export async function concatWavFiles(
  inputs: string[],
  output: string,
  options: ConcatWavOptions,
): Promise<void> {
  if (inputs.length === 0) throw new Error('concatWavFiles: 输入为空');
  const execFile = options.execFile ?? execFileAsync;
  const writeListFile = options.writeListFile ?? defaultWriteListFile;
  const listPath = await writeListFile(inputs.map(escapeForConcatList));
  await execFile(options.ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output,
  ]);
}

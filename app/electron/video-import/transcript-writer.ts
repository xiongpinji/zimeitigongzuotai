import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  VideoImportPreviewDocument,
  VideoImportResult,
} from '../../src/lib/video-import-types';
import type {
  DouyinImportPaths,
  DouyinSourceMetadata,
  LocalMediaSourceMetadata,
  VideoImportPaths,
} from './types';

export function buildDouyinImportPaths(projectDir: string, videoId: string): DouyinImportPaths {
  return buildVideoImportPaths(projectDir, 'douyin', videoId);
}

export function buildVideoImportPaths(
  projectDir: string,
  sourceType: string,
  videoId: string,
): VideoImportPaths {
  const importDir = path.join(projectDir, 'imports', sourceType, videoId);

  return {
    importDir,
    videoPath: path.join(importDir, 'video.mp4'),
    audioPath: path.join(importDir, 'audio.mp3'),
    transcriptPath: path.join(importDir, 'transcript.md'),
    transcriptSrtPath: path.join(importDir, 'transcript.srt'),
    sourceMetadataPath: path.join(importDir, 'source.json'),
    resultMetadataPath: path.join(importDir, 'import-result.json'),
    previewMetadataPath: path.join(importDir, 'preview.json'),
    originalPath: path.join(projectDir, 'original.md'),
  };
}

async function ensureImportDir(paths: DouyinImportPaths): Promise<void> {
  await fs.mkdir(paths.importDir, { recursive: true });
}

function normalizeTranscriptMarkdown(fullText: string): string {
  return fullText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n');
}

export async function writeSourceMetadata(
  paths: DouyinImportPaths,
  metadata: DouyinSourceMetadata | LocalMediaSourceMetadata,
): Promise<void> {
  await ensureImportDir(paths);
  await fs.writeFile(
    paths.sourceMetadataPath,
    JSON.stringify(metadata, null, 2),
    'utf8',
  );
}

export async function writeTranscriptMarkdown(
  paths: DouyinImportPaths,
  fullText: string,
  srtText: string,
): Promise<void> {
  await ensureImportDir(paths);
  await fs.writeFile(paths.transcriptSrtPath, `${srtText.trim()}\n`, 'utf8');
  await fs.writeFile(paths.transcriptPath, `${normalizeTranscriptMarkdown(fullText)}\n`, 'utf8');
}

export async function syncTranscriptToOriginal(paths: DouyinImportPaths): Promise<void> {
  const transcript = await fs.readFile(paths.transcriptPath, 'utf8');
  await fs.writeFile(paths.originalPath, transcript, 'utf8');
}

export async function writeImportResult(
  paths: DouyinImportPaths,
  result: VideoImportResult | Record<string, unknown>,
): Promise<void> {
  await ensureImportDir(paths);
  await fs.writeFile(
    paths.resultMetadataPath,
    JSON.stringify(result, null, 2),
    'utf8',
  );
}

export async function writePreviewMetadata(
  paths: DouyinImportPaths,
  preview: VideoImportPreviewDocument,
): Promise<void> {
  await ensureImportDir(paths);
  await fs.writeFile(
    paths.previewMetadataPath,
    JSON.stringify(preview, null, 2),
    'utf8',
  );
}

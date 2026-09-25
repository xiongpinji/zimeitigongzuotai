import type { VideoImportPreviewDocument } from './video-import-types';

export const VIDEO_IMPORT_PREVIEW_SCHEMA = 'video-import-preview';
export const VIDEO_IMPORT_PREVIEW_FILENAME = 'preview.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isVideoImportPreviewFile(filePath: string): boolean {
  return /(^|\/)preview\.json$/i.test(filePath);
}

export function isVideoImportPreviewDocument(
  value: unknown,
): value is VideoImportPreviewDocument {
  if (!isRecord(value)) return false;
  if (value.schema !== VIDEO_IMPORT_PREVIEW_SCHEMA || value.version !== 1) return false;
  if (typeof value.title !== 'string' || typeof value.videoId !== 'string') return false;
  if (!isRecord(value.media) || typeof value.media.videoPath !== 'string') return false;
  if (!isRecord(value.transcript) || typeof value.transcript.text !== 'string') return false;
  if (!Array.isArray(value.transcript.segments)) return false;
  if (!isRecord(value.metadata)) return false;
  if (
    typeof value.metadata.sourceUrl !== 'string' &&
    typeof value.metadata.sourcePath !== 'string'
  ) {
    return false;
  }
  return true;
}

export function parseVideoImportPreviewDocument(
  content: string,
): VideoImportPreviewDocument | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isVideoImportPreviewDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getProjectRelativePath(
  projectDir: string,
  absolutePath: string,
): string {
  const normalizedProjectDir = projectDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedAbsolutePath = absolutePath.replace(/\\/g, '/');

  if (!normalizedAbsolutePath.startsWith(`${normalizedProjectDir}/`)) {
    return absolutePath;
  }

  return normalizedAbsolutePath.slice(normalizedProjectDir.length + 1);
}

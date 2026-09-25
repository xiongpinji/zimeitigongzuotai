export type ImportKind = 'audio' | 'srt';

const ACCEPTED_EXTENSIONS: Record<ImportKind, string[]> = {
  audio: ['.mp3'],
  srt: ['.srt'],
};
const HTML_IMPORT_EXTENSIONS = ['.html', '.htm'];

function matchesExtensions(filePath: string, extensions: readonly string[]): boolean {
  const normalizedFilePath = filePath.toLowerCase();
  return extensions.some((extension) => normalizedFilePath.endsWith(extension));
}

export function isAcceptedImportPath(filePath: string, kind: ImportKind): boolean {
  return matchesExtensions(filePath, ACCEPTED_EXTENSIONS[kind]);
}

export function isAcceptedHtmlImportPath(filePath: string): boolean {
  return matchesExtensions(filePath, HTML_IMPORT_EXTENSIONS);
}

export function getImportFileError(filePath: string, kind: ImportKind): string | null {
  if (isAcceptedImportPath(filePath, kind)) {
    return null;
  }

  return kind === 'audio' ? '请导入 MP3 音频文件。' : '请导入 SRT 字幕文件。';
}

export function getHtmlImportFileError(filePath: string): string | null {
  if (isAcceptedHtmlImportPath(filePath)) {
    return null;
  }

  return '请拖入 HTML 文件（.html 或 .htm）。';
}

export function getDroppedFilePath(
  file: File & { path?: string },
  getPathForFile: (file: File) => string,
): string {
  if (file.path) {
    return file.path;
  }

  try {
    return getPathForFile(file) || '';
  } catch {
    return '';
  }
}

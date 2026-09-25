export const OFFSCREEN_EXTRACT_AUDIO = 'sonar/offscreen-extract-audio' as const;
export const OFFSCREEN_PREPARE_DOWNLOAD = 'sonar/offscreen-prepare-download' as const;
export const OFFSCREEN_START_DOWNLOAD = 'sonar/offscreen-start-download' as const;
export const OFFSCREEN_RELEASE_DOWNLOAD = 'sonar/offscreen-release-download' as const;

export interface OffscreenExtractAudioRequest {
  kind: typeof OFFSCREEN_EXTRACT_AUDIO;
  inputName: string;
  outputName: string;
}

export type OffscreenExtractAudioResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface OffscreenPrepareDownloadRequest {
  kind: typeof OFFSCREEN_PREPARE_DOWNLOAD;
  url: string;
}

export type OffscreenPrepareDownloadResponse =
  | { ok: true; blobUrl: string; token: string }
  | { ok: false; error: string };

export interface OffscreenReleaseDownloadRequest {
  kind: typeof OFFSCREEN_RELEASE_DOWNLOAD;
  token: string;
}

export interface OffscreenStartDownloadRequest {
  kind: typeof OFFSCREEN_START_DOWNLOAD;
  token: string;
  filename: string;
}

export function isOffscreenExtractAudioRequest(value: unknown): value is OffscreenExtractAudioRequest {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<OffscreenExtractAudioRequest>;
  return item.kind === OFFSCREEN_EXTRACT_AUDIO
    && typeof item.inputName === 'string'
    && typeof item.outputName === 'string';
}

export function isOffscreenPrepareDownloadRequest(value: unknown): value is OffscreenPrepareDownloadRequest {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<OffscreenPrepareDownloadRequest>;
  return item.kind === OFFSCREEN_PREPARE_DOWNLOAD && typeof item.url === 'string';
}

export function isOffscreenReleaseDownloadRequest(value: unknown): value is OffscreenReleaseDownloadRequest {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<OffscreenReleaseDownloadRequest>;
  return item.kind === OFFSCREEN_RELEASE_DOWNLOAD && typeof item.token === 'string';
}

export function isOffscreenStartDownloadRequest(value: unknown): value is OffscreenStartDownloadRequest {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<OffscreenStartDownloadRequest>;
  return item.kind === OFFSCREEN_START_DOWNLOAD
    && typeof item.token === 'string'
    && typeof item.filename === 'string';
}

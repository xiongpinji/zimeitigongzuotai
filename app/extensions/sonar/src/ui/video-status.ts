/**
 * 视频的本地 UI 状态：已读 / 重点 / 归档。
 *
 * 领域模型 `Video` 不含这些状态，且不属于抖音原始数据；它们是用户在本地的标记。
 * 为保证四个表面（Popup / Side Panel / 工作台 / 注入）看到一致状态，统一存
 * `chrome.storage.local`，并通过 storage 变更事件跨表面同步。不进 Chrome Sync、不导出。
 */
import { useEffect, useState } from 'react';

export interface VideoUiStatus {
  read: boolean;
  flagged: boolean;
  archived: boolean;
}

const KEY = 'sonar.videoStatus';
export type StatusMap = Record<string, Partial<VideoUiStatus>>;

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

let cache: StatusMap = {};
let loaded = false;
const listeners = new Set<(m: StatusMap) => void>();

async function ensureLoaded(): Promise<void> {
  if (loaded || !hasChromeStorage()) {
    loaded = true;
    return;
  }
  const got = await chrome.storage.local.get(KEY);
  cache = (got[KEY] as StatusMap) ?? {};
  loaded = true;
}

function emit(): void {
  for (const fn of listeners) fn(cache);
}

async function persist(): Promise<void> {
  if (hasChromeStorage()) await chrome.storage.local.set({ [KEY]: cache });
  emit();
}

export function statusOf(map: StatusMap, videoId: string): VideoUiStatus {
  const s = map[videoId] ?? {};
  return { read: !!s.read, flagged: !!s.flagged, archived: !!s.archived };
}

/** isNew = 未读且未归档（动态流 / 库 NEW 标记与计数依据）。 */
export function isNew(map: StatusMap, videoId: string): boolean {
  const s = statusOf(map, videoId);
  return !s.read && !s.archived;
}

export function patchStatuses(
  map: StatusMap,
  videoIds: readonly string[],
  patch: Partial<VideoUiStatus>,
): StatusMap {
  if (videoIds.length === 0) return map;
  const next = { ...map };
  for (const videoId of videoIds) next[videoId] = { ...next[videoId], ...patch };
  return next;
}

export async function patchStatus(videoId: string, patch: Partial<VideoUiStatus>): Promise<void> {
  await ensureLoaded();
  cache = patchStatuses(cache, [videoId], patch);
  await persist();
}

export const markRead = (videoId: string) => patchStatus(videoId, { read: true });

export async function toggleRead(videoId: string): Promise<void> {
  await ensureLoaded();
  cache = patchStatuses(cache, [videoId], { read: !statusOf(cache, videoId).read });
  await persist();
}

export async function markAllRead(videoIds: readonly string[]): Promise<void> {
  await ensureLoaded();
  cache = patchStatuses(cache, videoIds, { read: true });
  await persist();
}

export interface VideoStatusApi {
  map: StatusMap;
  markRead: (id: string) => void;
  toggleRead: (id: string) => void;
  markAllRead: (ids: readonly string[]) => void;
  toggleFlag: (id: string) => void;
  toggleArchive: (id: string) => void;
}

/** 订阅状态变化的 React hook（含跨表面 storage 同步）。 */
export function useVideoStatus(): VideoStatusApi {
  const [map, setMap] = useState<StatusMap>(cache);

  useEffect(() => {
    let alive = true;
    void ensureLoaded().then(() => alive && setMap({ ...cache }));
    const local = (m: StatusMap) => setMap({ ...m });
    listeners.add(local);

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes[KEY]) {
        cache = (changes[KEY].newValue as StatusMap) ?? {};
        setMap({ ...cache });
      }
    };
    if (hasChromeStorage()) chrome.storage.onChanged.addListener(onChanged);

    return () => {
      alive = false;
      listeners.delete(local);
      if (hasChromeStorage()) chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return {
    map,
    markRead: (id) => void markRead(id),
    toggleRead: (id) => void toggleRead(id),
    markAllRead: (ids) => void markAllRead(ids),
    toggleFlag: (id) => void patchStatus(id, { flagged: !statusOf(cache, id).flagged }),
    toggleArchive: (id) => void patchStatus(id, { archived: !statusOf(cache, id).archived }),
  };
}

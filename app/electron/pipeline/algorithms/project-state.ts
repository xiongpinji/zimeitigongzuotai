import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProjectStateSnapshot {
  has_original: boolean;
  has_script: boolean;
  has_audio: boolean;
  has_subtitles: boolean;
  has_analysis: boolean;
  has_covers: boolean;
  has_cards: boolean;
  has_timeline: boolean;
  last_export: string | null;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function fileNonEmpty(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirHasImage(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.some(
      (e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()),
    );
  } catch {
    return false;
  }
}

type ProjectJsonShape = {
  timeline?: { tracks?: unknown } | null;
  aiAnalysis?: {
    analysisResult?: { subtitleAnalysis?: unknown; cards?: unknown } | null;
  } | null;
};

async function readProjectJson(dir: string): Promise<ProjectJsonShape | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'project.json'), 'utf-8');
    return JSON.parse(raw) as ProjectJsonShape;
  } catch {
    return null;
  }
}

async function findLatestMp4(dir: string): Promise<string | null> {
  let entries: { name: string; isFile(): boolean }[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let bestPath: string | null = null;
  let bestMtime = -Infinity;
  for (const e of entries) {
    if (!e.isFile() || path.extname(e.name).toLowerCase() !== '.mp4') continue;
    const full = path.join(dir, e.name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        bestPath = full;
      }
    } catch {
      // 忽略
    }
  }
  return bestPath;
}

export async function computeProjectState(projectPath: string): Promise<ProjectStateSnapshot> {
  const [originalNon, scriptNon, audio, subtitles, covers, project, lastMp4] = await Promise.all([
    fileNonEmpty(path.join(projectPath, 'original.md')),
    fileNonEmpty(path.join(projectPath, 'script.md')),
    fileExists(path.join(projectPath, 'podcast-audio.mp3')),
    fileExists(path.join(projectPath, 'podcast-subtitles.srt')),
    dirHasImage(path.join(projectPath, 'covers')),
    readProjectJson(projectPath),
    findLatestMp4(projectPath),
  ]);

  const subtitleAnalysis =
    project?.aiAnalysis?.analysisResult?.subtitleAnalysis;
  const has_analysis =
    !!subtitleAnalysis &&
    typeof subtitleAnalysis === 'object' &&
    Object.keys(subtitleAnalysis).length > 0;

  const cards = project?.aiAnalysis?.analysisResult?.cards;
  const has_cards = Array.isArray(cards) && cards.length > 0;

  const tracks: unknown = project?.timeline?.tracks;
  const has_timeline =
    Array.isArray(tracks) &&
    tracks.some((t: unknown) => {
      const overlays = (t as { overlays?: unknown })?.overlays;
      return Array.isArray(overlays) && overlays.length > 0;
    });

  return {
    has_original: originalNon,
    has_script: scriptNon,
    has_audio: audio,
    has_subtitles: subtitles,
    has_analysis,
    has_covers: covers,
    has_cards,
    has_timeline,
    last_export: lastMp4,
  };
}

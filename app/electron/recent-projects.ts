import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ProjectData } from '../src/lib/project-persistence';
import { loadProjectFile } from './project-file';

export interface RecentProjectEntry {
  path: string;
  name: string;
  lastOpenedAt: number;
  createdAt?: string;
  updatedAt?: string;
  coverImageUrl?: string;
}

const RECENT_PROJECTS_FILE = 'recent-projects.json';
const MAX_RECENT_PROJECTS = 20;

export async function loadRecentProjects(
  userDataPath: string,
): Promise<RecentProjectEntry[]> {
  try {
    const raw = await fs.readFile(
      path.join(userDataPath, RECENT_PROJECTS_FILE),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as RecentProjectEntry[];
    // 过滤掉无效条目
    return parsed.filter((p) => Boolean(p?.path) && existsSync(p.path));
  } catch {
    return [];
  }
}

export async function saveRecentProjects(
  userDataPath: string,
  projects: RecentProjectEntry[],
): Promise<void> {
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(
    path.join(userDataPath, RECENT_PROJECTS_FILE),
    JSON.stringify(projects, null, 2),
    'utf-8',
  );
}

export async function addRecentProject(
  userDataPath: string,
  projectDir: string,
  projectName?: string,
): Promise<RecentProjectEntry[]> {
  const existing = await loadRecentProjects(userDataPath);
  const now = Date.now();

  // 加载项目数据获取封面和时间信息
  let projectData: ProjectData | null = null;
  try {
    projectData = await loadProjectFile(projectDir);
  } catch {
    // 忽略加载失败
  }

  // 查找选中的封面
  let coverImageUrl: string | undefined;
  if (projectData?.aiAnalysis?.coverCandidates) {
    const selectedCover = projectData.aiAnalysis.coverCandidates.find(
      (c) => c.selected && c.imageUrl,
    );
    coverImageUrl = selectedCover?.imageUrl;
  }

  const entry: RecentProjectEntry = {
    path: projectDir,
    name: projectName || path.basename(projectDir),
    lastOpenedAt: now,
    createdAt: projectData?.createdAt,
    updatedAt: projectData?.updatedAt,
    coverImageUrl,
  };

  // 移除已存在的同路径项目，添加到开头
  const filtered = existing.filter((p) => p.path !== projectDir);
  const nextProjects = [entry, ...filtered].slice(0, MAX_RECENT_PROJECTS);

  await saveRecentProjects(userDataPath, nextProjects);
  return nextProjects;
}

export async function removeRecentProject(
  userDataPath: string,
  projectDir: string,
): Promise<RecentProjectEntry[]> {
  const existing = await loadRecentProjects(userDataPath);
  const filtered = existing.filter((p) => p.path !== projectDir);
  await saveRecentProjects(userDataPath, filtered);
  return filtered;
}

export async function refreshRecentProjects(
  userDataPath: string,
): Promise<RecentProjectEntry[]> {
  const existing = await loadRecentProjects(userDataPath);
  const refreshed: RecentProjectEntry[] = [];

  for (const entry of existing) {
    if (!existsSync(entry.path)) {
      continue;
    }

    // 重新加载项目数据获取最新信息
    let projectData: ProjectData | null = null;
    try {
      projectData = await loadProjectFile(entry.path);
    } catch {
      // 忽略加载失败
    }

    let coverImageUrl: string | undefined;
    if (projectData?.aiAnalysis?.coverCandidates) {
      const selectedCover = projectData.aiAnalysis.coverCandidates.find(
        (c) => c.selected && c.imageUrl,
      );
      coverImageUrl = selectedCover?.imageUrl;
    }

    refreshed.push({
      ...entry,
      createdAt: projectData?.createdAt ?? entry.createdAt,
      updatedAt: projectData?.updatedAt ?? entry.updatedAt,
      coverImageUrl,
    });
  }

  await saveRecentProjects(userDataPath, refreshed);
  return refreshed;
}

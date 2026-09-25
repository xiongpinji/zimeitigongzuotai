import { useEffect, useMemo, useState } from 'react';
import type { FileEntry } from '../lib/electron-api';

export interface FlatFileEntry {
  /** 相对路径，如 src/components/App.tsx */
  relativePath: string;
  /** 文件名，如 App.tsx */
  name: string;
  /** 是否目录 */
  isDirectory: boolean;
  /** 搜索用小写路径 */
  lowerPath: string;
  /** 搜索用小写名称 */
  lowerName: string;
}

/** 递归扁平化 FileEntry 树 */
function flattenTree(entries: FileEntry[], prefix: string): FlatFileEntry[] {
  const result: FlatFileEntry[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    result.push({
      relativePath,
      name: entry.name,
      isDirectory: entry.type === 'directory',
      lowerPath: relativePath.toLowerCase(),
      lowerName: entry.name.toLowerCase(),
    });
    if (entry.children && entry.children.length > 0) {
      result.push(...flattenTree(entry.children, relativePath));
    }
  }
  return result;
}

/**
 * 加载项目目录下的文件树并扁平化，用于 @ 文件提及。
 * - enabled=false 时不加载（懒加载：只有用户触发 @ 时才开启）
 * - 加载完成后缓存，目录相同时不重复请求
 */
export function useProjectFiles(projectDir: string | null, enabled: boolean) {
  const [allFiles, setAllFiles] = useState<FlatFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectDir) return;

    const api = window.electronAPI;
    if (!api?.readDirectory) return;

    let cancelled = false;
    setLoading(true);

    api.readDirectory(projectDir).then((entries) => {
      if (cancelled) return;
      setAllFiles(flattenTree(entries, ''));
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      console.error('[useProjectFiles] 读取目录失败:', err);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [projectDir, enabled]);

  // 仅返回文件（非目录），@ 提及主要是引用文件
  const files = useMemo(
    () => allFiles.filter((f) => !f.isDirectory),
    [allFiles],
  );

  return { files, allFiles, loading };
}

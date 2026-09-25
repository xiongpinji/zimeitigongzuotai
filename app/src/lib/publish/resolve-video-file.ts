/**
 * 渲染端路径包含判断（兼容 / 与 \ 分隔符）。
 * 用于判断「最近导出成片」是否属于当前打开的项目目录——
 * 全局 store.lastExportPath 跨项目不清空，必须按当前 projectDir 过滤，避免串用上一个项目的视频。
 */
export function isInsideDir(filePath: string, dir: string): boolean {
  if (!filePath || !dir) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const f = norm(filePath);
  const d = norm(dir);
  return f === d || f.startsWith(d + '/');
}

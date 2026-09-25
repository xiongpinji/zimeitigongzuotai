import { staticFile } from 'remotion';
import { toFileSrc } from '../lib/utils';

/**
 * 解析素材路径为 Remotion 可加载的 src。
 * - 远程 / file:// 原样返回
 * - 绝对文件路径（预览：项目目录内素材）→ file://
 * - 相对路径（导出：materialize 到 bundle public 后的 assets/...）→ staticFile
 */
export function resolveAssetSrc(p: string): string {
  if (!p) return p;
  if (/^https?:\/\//.test(p) || p.startsWith('file://')) return p;
  const normalized = p.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return toFileSrc(p);
  }
  return staticFile(p);
}

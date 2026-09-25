/**
 * 计算用于"文稿是否偏离了口播"比对的稳定哈希。
 *
 * 归一化策略（避免微小空白差异造成误报）：
 *   - 统一换行为 "\n"
 *   - 折叠每行尾部空白并去除整体首尾空白
 *   - 折叠连续空行为单空行
 *
 * 哈希采用 32-bit djb2，并追加归一化长度，减少碰撞概率。
 * 输出形如 "len:hex"。
 */
export function hashScriptForPodcast(input: string | null | undefined): string {
  const text = normalizeScriptText(input ?? '');
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  const unsigned = hash >>> 0;
  return `${text.length}:${unsigned.toString(16)}`;
}

function normalizeScriptText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

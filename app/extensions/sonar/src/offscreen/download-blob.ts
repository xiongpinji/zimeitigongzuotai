/**
 * 抓取抖音视频 CDN 的媒体字节为 Blob，供下载与分析取流共用。
 *
 * 护栏（两条路径都需要）：
 * - Range: bytes=0- 拉取完整正文；credentials:'omit' 避免带 Cookie。
 * - 校验 res.ok。
 * - 拦截 text/html / application/json：CDN 签名过期或反爬时会返回 200 + HTML，
 *   若把 HTML 当媒体喂给解码器只会得到无意义的解码失败（历史上分析路径正栽于此）。
 */
export async function fetchMediaBlob(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Blob> {
  const response = await fetchImpl(url, {
    headers: { Range: 'bytes=0-' },
    redirect: 'follow',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`视频源不可用（HTTP ${response.status}）`);

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error('视频源返回的不是媒体文件');
  }
  return response.blob();
}

/** 下载路径沿用的别名（语义等同 fetchMediaBlob）。 */
export const fetchDownloadBlob = fetchMediaBlob;

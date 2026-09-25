import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DouyinSourceResolution, VideoImportDownloader } from './types';

const DOUYIN_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Referer: 'https://www.douyin.com/',
};

const DOUYIN_MOBILE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Referer: 'https://www.iesdouyin.com/',
};

function extractFirstUrl(input: string): string {
  const match = input.match(/https?:\/\/[^\s]+/);
  if (!match) {
    throw new Error('未找到有效的抖音链接');
  }
  return match[0].trim();
}

function extractVideoIdFromUrl(url: string): string | null {
  const match = url.match(/\/video\/(\d+)/) ?? url.match(/modal_id=(\d+)/);
  return match?.[1] ?? null;
}

function extractVideoIdFromHtml(html: string): string | null {
  const match =
    html.match(/"aweme_id":"(\d+)"/) ??
    html.match(/"awemeId":"(\d+)"/) ??
    html.match(/\/share\/video\/(\d+)/) ??
    html.match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/\\u002F/g, '/')
    .replace(/\\\\\//g, '/')
    .replace(/\\\//g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function normalizePlaybackUrl(url: string): string {
  const decoded = decodeHtmlEntities(url);
  return decoded.replace('/playwm/', '/play/');
}

function pickFirstUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.startsWith('http')) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(pickFirstUrl).find(Boolean);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      pickFirstUrl(record.url_list) ??
      pickFirstUrl(record.urlList) ??
      pickFirstUrl(record.src) ??
      pickFirstUrl(record.srcUrl) ??
      pickFirstUrl(record.play_addr) ??
      pickFirstUrl(record.playAddr) ??
      pickFirstUrl(record.download_addr) ??
      pickFirstUrl(record.downloadAddr)
    );
  }
  return undefined;
}

function findAwemeNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') {
    return null;
  }

  const record = node as Record<string, unknown>;
  const video = record.video as Record<string, unknown> | undefined;
  if ((record.aweme_id || record.awemeId || record.id) && video) {
    return record;
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findAwemeNode(item);
        if (found) return found;
      }
      continue;
    }

    const found = findAwemeNode(value);
    if (found) return found;
  }

  return null;
}

function extractRenderData(html: string): unknown | null {
  const renderMatch = html.match(
    /<script[^>]+id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!renderMatch?.[1]) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(renderMatch[1]));
  } catch {
    return null;
  }
}

function extractDouyinWafCookie(html: string): string | null {
  if (!html.includes('_wafchallengeid') && !html.includes('wafchallengeid')) {
    return null;
  }

  const challengeMatch = html.match(/\bcs\s*=\s*["']([^"']+)["']/);
  if (!challengeMatch?.[1]) {
    return null;
  }

  try {
    const challenge = JSON.parse(Buffer.from(challengeMatch[1], 'base64').toString('utf8')) as {
      v?: { a?: string; c?: string };
      d?: string;
    };
    const prefix = Buffer.from(challenge.v?.a ?? '', 'base64');
    const expected = Buffer.from(challenge.v?.c ?? '', 'base64').toString('hex');
    if (prefix.length === 0 || !expected) {
      return null;
    }

    for (let index = 0; index <= 1_000_000; index += 1) {
      const actual = createHash('sha256')
        .update(prefix)
        .update(String(index))
        .digest('hex');
      if (actual === expected) {
        challenge.d = Buffer.from(String(index)).toString('base64');
        return `_wafchallengeid=${Buffer.from(JSON.stringify(challenge)).toString('base64')}`;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function extractFromHtml(html: string, finalUrl: string): DouyinSourceResolution {
  const renderData = extractRenderData(html);
  const aweme = renderData ? findAwemeNode(renderData) : null;

  const title =
    (aweme?.desc as string | undefined) ??
    (html.match(/"desc":"([^"]+)"/)?.[1] ? decodeHtmlEntities(html.match(/"desc":"([^"]+)"/)![1]) : '') ??
    '抖音视频';

  const videoId =
    (aweme?.aweme_id as string | undefined) ??
    (aweme?.awemeId as string | undefined) ??
    extractVideoIdFromUrl(finalUrl);

  if (!videoId) {
    throw new Error('无法解析抖音视频 ID');
  }

  const downloadUrl =
    pickFirstUrl(aweme?.video && (aweme.video as Record<string, unknown>).download_addr) ??
    pickFirstUrl(aweme?.video && (aweme.video as Record<string, unknown>).downloadAddr) ??
    pickFirstUrl(aweme?.video && (aweme.video as Record<string, unknown>).play_addr) ??
    pickFirstUrl(aweme?.video && (aweme.video as Record<string, unknown>).playAddr) ??
    html.match(/"download_addr":\{[\s\S]*?"url_list":\["([^"]+)"/)?.[1] ??
    html.match(/"play_addr":\{[\s\S]*?"url_list":\["([^"]+)"/)?.[1] ??
    html.match(/"downloadAddr":"([^"]+)"/)?.[1] ??
    html.match(/"playAddr":"([^"]+)"/)?.[1];

  if (!downloadUrl) {
    throw new Error('无法解析抖音视频下载地址');
  }

  return {
    videoId,
    title,
    resolvedPageUrl: finalUrl,
    downloadUrl: normalizePlaybackUrl(downloadUrl),
    coverUrl:
      pickFirstUrl(aweme?.video && (aweme.video as Record<string, unknown>).cover) ??
      (html.match(/"cover":\{[\s\S]*?"url_list":\["([^"]+)"/)?.[1]
        ? decodeHtmlEntities(html.match(/"cover":\{[\s\S]*?"url_list":\["([^"]+)"/)![1])
        : undefined) ??
      undefined,
  };
}

function extractFromMobileShareHtml(html: string, videoId: string): DouyinSourceResolution | null {
  const titleMatch = html.match(/"desc":"([^"]+)"/);
  const playAddrMatch = html.match(/"play_addr":\{[\s\S]*?"url_list":\["([^"]+)"/);
  const downloadAddrMatch = html.match(/"download_addr":\{[\s\S]*?"url_list":\["([^"]+)"/);
  const canonicalMatch = html.match(/rel="canonical"\s+href="([^"]+)"/);
  const coverMatch = html.match(/"cover":\{[\s\S]*?"url_list":\["([^"]+)"/);

  const resolvedUrl = downloadAddrMatch?.[1] ?? playAddrMatch?.[1];
  if (!resolvedUrl) {
    return null;
  }

  return {
    videoId,
    title: titleMatch ? decodeHtmlEntities(titleMatch[1]) : '抖音视频',
    resolvedPageUrl: canonicalMatch?.[1] ?? `https://www.douyin.com/video/${videoId}`,
    downloadUrl: normalizePlaybackUrl(resolvedUrl),
    coverUrl: coverMatch ? decodeHtmlEntities(coverMatch[1]) : undefined,
  };
}

async function fetchMobileSharePage(videoId: string): Promise<DouyinSourceResolution | null> {
  const mobileUrl = `https://www.iesdouyin.com/share/video/${videoId}/`;
  const response = await fetch(mobileUrl, {
    headers: DOUYIN_MOBILE_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  return extractFromMobileShareHtml(html, videoId);
}

async function fetchMobileFallbackFromSource(
  sourceUrl: string,
): Promise<DouyinSourceResolution | null> {
  const response = await fetch(sourceUrl, {
    headers: DOUYIN_MOBILE_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    return null;
  }

  const finalUrl = response.url || sourceUrl;
  const html = await response.text();
  const videoId = extractVideoIdFromUrl(finalUrl) ?? extractVideoIdFromHtml(html);
  if (!videoId) {
    return null;
  }

  return extractFromMobileShareHtml(html, videoId);
}

export async function resolveDouyinVideoSource(url: string): Promise<DouyinSourceResolution> {
  const sourceUrl = extractFirstUrl(url);
  const response = await fetch(sourceUrl, {
    headers: DOUYIN_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`抖音页面请求失败: ${response.status}`);
  }

  const html = await response.text();
  const finalUrl = response.url || sourceUrl;
  try {
    return extractFromHtml(html, finalUrl);
  } catch (error) {
    const wafCookie = extractDouyinWafCookie(html);
    if (wafCookie) {
      const retryResponse = await fetch(finalUrl, {
        headers: {
          ...DOUYIN_MOBILE_HEADERS,
          Cookie: wafCookie,
        },
        redirect: 'follow',
      });
      if (retryResponse.ok) {
        const retryHtml = await retryResponse.text();
        const retryUrl = retryResponse.url || finalUrl;
        try {
          return extractFromHtml(retryHtml, retryUrl);
        } catch {
          const retryVideoId = extractVideoIdFromUrl(retryUrl) ?? extractVideoIdFromHtml(retryHtml);
          if (retryVideoId) {
            const retryMobileResult = extractFromMobileShareHtml(retryHtml, retryVideoId);
            if (retryMobileResult) {
              return retryMobileResult;
            }
          }
        }
      }
    }

    const videoId = extractVideoIdFromUrl(finalUrl);
    if (videoId) {
      const mobileResult = await fetchMobileSharePage(videoId);
      if (mobileResult) {
        return mobileResult;
      }
    } else {
      const mobileResult = await fetchMobileFallbackFromSource(sourceUrl);
      if (mobileResult) {
        return mobileResult;
      }
    }

    throw error;
  }
}

export async function downloadDouyinVideoToPath(
  downloadUrl: string,
  targetPath: string,
): Promise<void> {
  const response = await fetch(downloadUrl, {
    headers: DOUYIN_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`抖音视频下载失败: ${response.status}`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, fileBuffer);
}

export const douyinDownloader: VideoImportDownloader = {
  resolveSource: resolveDouyinVideoSource,
  downloadToPath: downloadDouyinVideoToPath,
};

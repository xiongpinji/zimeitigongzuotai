/**
 * @deprecated 即梦相关实现已迁移至 src/lib/image-gen/providers/jimeng.ts。
 * 本文件作为兼容层保留：现有测试与少量旧调用方仍 import 这里的函数。
 * 新代码请直接使用 image-gen registry。
 */
import type { CoverCandidate, ImageProvider } from '../types/ai';
import {
  buildJimengImageRequest as buildJimengImageRequestNew,
  extractJimengImageUrls,
  jimengProvider,
  type JimengImageRequest,
} from './image-gen/providers/jimeng';
import { createNoopContext } from './image-gen/progress';

export { extractJimengImageUrls, type JimengImageRequest };

/** 兼容旧 4 参签名（prompt, provider, model, n?） */
export function buildJimengImageRequest(
  prompt: string,
  provider: ImageProvider,
  model: string,
  n = 4,
): JimengImageRequest {
  return buildJimengImageRequestNew(
    { prompt, model, aspectRatio: '16:9', n },
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extras: provider.extras },
  );
}

export function extractJimengImageUrl(payload: { data?: Array<{ url?: string | null } | null> | null }): string | null {
  return extractJimengImageUrls(payload)[0] ?? null;
}

export async function generateImage(
  prompt: string,
  provider: ImageProvider,
  model: string,
): Promise<string> {
  const result = await jimengProvider.generate(
    { prompt, model, aspectRatio: '16:9', n: 1 },
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extras: provider.extras },
    createNoopContext(),
  );
  const url = result.images[0]?.url;
  if (!url) throw new Error('即梦 API 未返回图片 URL');
  return url;
}

export async function downloadImage(imageUrl: string, outputPath: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`下载图片失败: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
}

/** @deprecated 使用 src/lib/cover-generation.ts 的 generateCoverCandidates */
export { generateCoverCandidates } from './cover-generation';

// 类型重导出，便于消费方
export type { CoverCandidate };

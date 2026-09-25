import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import type { TimelineData } from '../../src/types';
import type { HyperframesAssetDescriptor } from '../../src/hyperframes/assets';

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
// 匹配运行时资源解析器调用：cardAsset('assets/x.png')。
const CARD_ASSET_PATTERN = /cardAsset\(\s*(['"])([^'"]+)\1\s*\)/g;

function isMaterializableReference(value: string | undefined): value is string {
  return !!value && !/^(?:data:|https?:|file:|\/)/i.test(value);
}

export function extractMotionCardAssetReferences(tsx: string): string[] {
  const references = new Set<string>();
  const add = (raw: string | undefined) => {
    const value = raw?.trim();
    if (!isMaterializableReference(value)) return;
    references.add(value.replace(/\\/g, '/').replace(/^\.\//, ''));
  };
  for (const match of tsx.matchAll(CSS_URL_PATTERN)) add(match[2]);
  for (const match of tsx.matchAll(CARD_ASSET_PATTERN)) add(match[2]);
  return [...references];
}

export function rewriteMotionCardAssetReferences(tsx: string): string {
  return tsx.replace(CSS_URL_PATTERN, (match, quote: string, rawValue: string) => {
    const value = rawValue.trim();
    if (!value || /^(?:data:|https?:|file:|\/)/i.test(value)) return match;
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    return `url(${quote}/public/${normalized}${quote})`;
  });
}

// 匹配「以引号包裹、且不在 CSS url() 内」的 base64 data URI 字符串字面量。
// 负向后查 (?<!url\() 排除 backgroundImage: 'url(data:...)' 这类需要保持原样的写法。
const DATA_URI_LITERAL_PATTERN =
  /(?<!url\()(['"])data:([a-z]+)\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]*?)\1/gi;

const MIME_SUBTYPE_EXT: Record<string, string> = {
  jpeg: 'jpg',
  'svg+xml': 'svg',
};

function mimeSubtypeToExt(subtype: string): string {
  const normalized = subtype.toLowerCase();
  return MIME_SUBTYPE_EXT[normalized] ?? normalized.split('+')[0];
}

/**
 * 把卡片 TSX 里内联的大体积 base64 data URI 外置成文件，字面量替换为
 * `cardAsset('<ref>')`（运行时由 CardHost 解析：导出→staticFile，预览→file://）。
 * 仅在导出链路对内存中的 tsx 拷贝调用，避免 65MB+ 的 inputProps 撑爆无头 Chrome。
 *
 * `write` 注入实际落盘逻辑（返回卡片应引用的相对路径），保持本函数纯净可测。
 * 小于 `minBytes`（默认 8KB）的 data URI 保持内联，避免把小图标/SVG 拆成碎文件。
 */
export function externalizeMotionCardDataUris(
  tsx: string,
  opts: { minBytes?: number; write: (bytes: Buffer, ext: string) => string },
): string {
  const minBytes = opts.minBytes ?? 8192;
  return tsx.replace(
    DATA_URI_LITERAL_PATTERN,
    (match, quote: string, _type: string, subtype: string, base64: string) => {
      const cleaned = base64.replace(/\s+/g, '');
      let bytes: Buffer;
      try {
        bytes = Buffer.from(cleaned, 'base64');
      } catch {
        return match;
      }
      if (bytes.length < minBytes) return match;
      const ref = opts.write(bytes, mimeSubtypeToExt(subtype));
      return `cardAsset(${quote}${ref}${quote})`;
    },
  );
}

/**
 * 预览侧专用：把超大的内联 base64 图片落到项目隐藏目录，再把 TSX 改写为
 * `cardAsset('.lingji/preview-card-assets/...')`。
 *
 * 这样预览编译/序列化不再携带几十 MB 的长字符串；导出链路仍走它自己的
 * publicDir 物化逻辑，不受这里影响。
 */
export async function materializePreviewMotionCardDataUris(
  tsx: string,
  opts: { projectDir: string; overlayId: string; minBytes?: number },
): Promise<string> {
  const emitted = new Map<string, Buffer>();
  const rewritten = externalizeMotionCardDataUris(tsx, {
    minBytes: opts.minBytes,
    write: (bytes, ext) => {
      const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16);
      const rel = path.posix.join(
        '.lingji',
        'preview-card-assets',
        opts.overlayId,
        `${hash}.${ext}`,
      );
      if (!emitted.has(rel)) {
        emitted.set(rel, bytes);
      }
      return rel;
    },
  });
  await Promise.all(
    [...emitted.entries()].map(async ([rel, bytes]) => {
      const abs = path.join(opts.projectDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, bytes);
    }),
  );
  return rewritten;
}

export async function collectMotionCardAssets(
  timeline: TimelineData,
  projectDir: string | null,
): Promise<HyperframesAssetDescriptor[]> {
  if (!projectDir) return [];

  const root = path.resolve(projectDir);
  const assets = new Map<string, HyperframesAssetDescriptor>();
  for (const overlay of timeline.overlays) {
    const tsxPath = overlay.aiCardData?.motionCard?.tsxPath;
    if (!tsxPath) continue;

    let tsx: string;
    try {
      tsx = await fs.readFile(path.join(root, tsxPath), 'utf8');
    } catch {
      continue;
    }

    for (const publicPath of extractMotionCardAssetReferences(tsx)) {
      const sourcePath = path.resolve(root, publicPath);
      if (!sourcePath.startsWith(`${root}${path.sep}`)) continue;
      try {
        await fs.access(sourcePath);
        assets.set(publicPath, { sourcePath, publicPath });
      } catch {
        // Missing optional card artwork should not block the whole export.
      }
    }
  }
  return [...assets.values()];
}

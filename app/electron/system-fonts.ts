import type { ListSystemFontsResult, SystemFont } from '../src/lib/cover-editor/contracts';

let cache: { fonts: SystemFont[]; expireAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

const FALLBACK_FONTS: SystemFont[] = [
  { family: 'PingFang SC' },
  { family: 'Hiragino Sans GB' },
  { family: 'Songti SC' },
  { family: 'Helvetica Neue' },
  { family: 'Arial' },
  { family: 'Menlo' },
];

export async function listSystemFonts(): Promise<ListSystemFontsResult> {
  const now = Date.now();
  if (cache && cache.expireAt > now) {
    return { fonts: cache.fonts };
  }
  try {
    const mod = (await import('font-list')) as { getFonts: () => Promise<string[]> };
    const raw = await mod.getFonts();
    const fonts = Array.from(
      new Set(raw.map((f) => f.replace(/^"(.*)"$/, '$1').trim()).filter(Boolean)),
    )
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({ family }));
    cache = { fonts, expireAt: now + CACHE_TTL_MS };
    return { fonts };
  } catch {
    cache = { fonts: FALLBACK_FONTS, expireAt: now + CACHE_TTL_MS };
    return { fonts: FALLBACK_FONTS };
  }
}

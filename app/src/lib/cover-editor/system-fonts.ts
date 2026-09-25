import type { SystemFont } from './contracts';

const FALLBACKS: SystemFont[] = [
  { family: 'PingFang SC' },
  { family: 'Hiragino Sans GB' },
  { family: 'Helvetica Neue' },
  { family: 'Arial' },
];

let cache: { fonts: SystemFont[]; expireAt: number } | null = null;
const TTL_MS = 60_000;

export async function loadSystemFonts(): Promise<SystemFont[]> {
  const now = Date.now();
  if (cache && cache.expireAt > now) return cache.fonts;
  try {
    const api = (window as unknown as {
      electronAPI?: { listSystemFonts?: () => Promise<{ fonts: SystemFont[] }> };
    }).electronAPI;
    if (!api?.listSystemFonts) {
      cache = { fonts: FALLBACKS, expireAt: now + TTL_MS };
      return FALLBACKS;
    }
    const result = await api.listSystemFonts();
    cache = { fonts: result.fonts, expireAt: now + TTL_MS };
    return result.fonts;
  } catch {
    cache = { fonts: FALLBACKS, expireAt: now + TTL_MS };
    return FALLBACKS;
  }
}

const injected = new Set<string>();
export function ensureFontLoaded(family: string) {
  if (injected.has(family)) return;
  injected.add(family);
  // 通过构造一个隐藏 span 触发 CSS 字体匹配；若系统无该字体则 fallback 自动生效
  const probe = document.createElement('span');
  probe.style.fontFamily = `"${family}"`;
  probe.style.position = 'absolute';
  probe.style.left = '-9999px';
  probe.textContent = 'Aa字';
  document.body.appendChild(probe);
  window.setTimeout(() => probe.remove(), 1000);
}

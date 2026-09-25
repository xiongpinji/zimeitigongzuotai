/**
 * 容忍 snake_case / camelCase 字段差异的取值辅助。
 *
 * 适配器用这些函数把抖音原始响应里不稳定的字段名收敛为稳定取值，
 * 领域模型不随原始字段变化。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 按多个候选键名取第一个非空值。 */
export function pick(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** 从形如 { url_list: [...] } / { urlList: [...] } 的地址对象取首个 URL。 */
export function firstUrl(addr: unknown): string | undefined {
  const list = pick(addr, ['url_list', 'urlList']);
  if (Array.isArray(list)) {
    for (const item of list) {
      const s = asString(item);
      if (s) return s;
    }
  }
  return undefined;
}

/** 从地址对象取全部 URL（保序、去空）。 */
export function urlList(addr: unknown): string[] {
  const list = pick(addr, ['url_list', 'urlList']);
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const s = asString(item);
    if (s) out.push(s);
  }
  return out;
}

// cli/src/format.ts
export function output(data: unknown, json: boolean): string {
  if (json) return JSON.stringify(data, null, 2);
  return humanize(data);
}

function humanize(data: unknown): string {
  if (data === null || data === undefined) return '(空)';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    if (data.length === 0) return '(空列表)';
    return data.map(humanizeItem).join('\n');
  }
  return humanizeItem(data);
}

function humanizeItem(item: unknown): string {
  if (item && typeof item === 'object') {
    return Object.entries(item as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatVal(v)}`)
      .join('  ');
  }
  return String(item);
}

function formatVal(v: unknown): string {
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

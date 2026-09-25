// ReviewPayload 协议：Agent 审查结果的结构化载荷与 fenced block 解析器

/** 单条审查发现 */
export interface ReviewFinding {
  id: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  issue: string;
  suggestion: string;
  severity: 'error' | 'warning' | 'info';
}

/** Agent 审查结果载荷 */
export interface ReviewPayload {
  version: 1;
  filePath: 'script.md';
  docVersion: number;
  summary: {
    total: number;
    error: number;
    warning: number;
    info: number;
  };
  findings: ReviewFinding[];
}

const FENCED_RE = /```script-review\s*\n([\s\S]*?)```/;

const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);

function isValidSummary(s: unknown): s is ReviewPayload['summary'] {
  if (typeof s !== 'object' || s === null) return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj.total === 'number' &&
    typeof obj.error === 'number' &&
    typeof obj.warning === 'number' &&
    typeof obj.info === 'number'
  );
}

function isValidFinding(f: unknown): f is ReviewFinding {
  if (typeof f !== 'object' || f === null) return false;
  const obj = f as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.startOffset === 'number' &&
    typeof obj.endOffset === 'number' &&
    typeof obj.quotedText === 'string' &&
    typeof obj.issue === 'string' &&
    typeof obj.suggestion === 'string' &&
    typeof obj.severity === 'string' &&
    VALID_SEVERITIES.has(obj.severity as string)
  );
}

/**
 * 从文本中提取第一个 `script-review` fenced block 并解析为 ReviewPayload。
 * 校验不通过或不存在时返回 null。
 */
export function parseReviewPayload(text: string): ReviewPayload | null {
  const match = FENCED_RE.exec(text);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  // 校验协议版本
  if (obj.version !== 1) return null;

  // 校验文件路径
  if (obj.filePath !== 'script.md') return null;

  // 校验 docVersion
  if (typeof obj.docVersion !== 'number') return null;

  // 校验 summary
  if (!isValidSummary(obj.summary)) return null;

  // 校验 findings
  if (!Array.isArray(obj.findings)) return null;
  for (const f of obj.findings) {
    if (!isValidFinding(f)) return null;
  }

  return parsed as ReviewPayload;
}

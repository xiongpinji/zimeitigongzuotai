/**
 * 声呐「待创作箱」渲染侧类型与纯helper（设计文档第 6 节）。
 *
 * 收件项由扩展经 /sonar/enqueue 推入桌面端，欢迎页「待创作箱」消费。
 * 「生成初稿」复用现有 autoMode 流水线：转录稿 → original.md → AI 二创 script.md → … 。
 * 这里只放纯逻辑（派生项目名 / 组装 original.md），便于单测。
 */

export type SonarInboxStatus = 'pending' | 'creating' | 'drafted' | 'failed';

export interface SonarInboxTranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

/** 爆款拆解报告（工作流流水线产出，可选）。 */
export interface SonarInboxInsight {
  angle: string;
  hook: string;
  structure: string[];
  highlights: string[];
  dataPoints: string[];
  remixSuggestions: string[];
}

export interface SonarInboxItem {
  id: string;
  source: string;
  awemeId: string;
  creatorId: string;
  creatorName: string;
  title: string;
  url: string;
  coverUrl?: string;
  publishedAt: number;
  durationMs?: number;
  transcript: {
    fullText: string;
    srtText: string;
    segments: SonarInboxTranscriptSegment[];
  };
  insight?: SonarInboxInsight;
  status: SonarInboxStatus;
  projectPath?: string;
  error?: string;
  receivedAt: number;
  updatedAt: number;
}

const MAX_NAME_LEN = 60;
// 文件系统非法字符（保留连字符作分隔）。
const ILLEGAL_FS_CHARS = /[\\/:*?"<>|]/g;

/** 清理文件系统非法字符，折叠空白，限长。 */
export function sanitizeProjectName(raw: string): string {
  const cleaned = (raw ?? '')
    .replace(ILLEGAL_FS_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = cleaned || '未命名';
  return name.length > MAX_NAME_LEN ? name.slice(0, MAX_NAME_LEN).trim() : name;
}

/** 由收件项派生项目目录名：`{博主}-{标题}`，清理并限长。 */
export function deriveProjectName(item: Pick<SonarInboxItem, 'creatorName' | 'title'>): string {
  const creator = (item.creatorName ?? '').trim();
  const title = (item.title ?? '').trim();
  const combined = creator && title ? `${creator}-${title}` : creator || title || '未命名作品';
  return sanitizeProjectName(combined);
}

/** 把爆款拆解报告渲染为「创作参考」Markdown 段（无有效内容则返回空串）。 */
export function insightToReferenceMarkdown(insight?: SonarInboxInsight): string {
  if (!insight || (!insight.angle && !insight.hook)) return '';
  const lines: string[] = ['# 创作参考（爆款拆解）', ''];
  if (insight.angle) lines.push(`- 选题角度：${insight.angle}`);
  if (insight.hook) lines.push(`- 开头钩子：${insight.hook}`);
  const block = (label: string, items: string[], ordered = false) => {
    if (!items?.length) return;
    lines.push(`- ${label}：`);
    items.forEach((t, i) => lines.push(`  ${ordered ? `${i + 1}.` : '-'} ${t}`));
  };
  block('内容骨架', insight.structure, true);
  block('记忆点 / 金句', insight.highlights);
  block('数据 / 论据', insight.dataPoints);
  block('二创建议', insight.remixSuggestions);
  return lines.join('\n').trim();
}

/**
 * 组装 original.md 内容：二创素材就是转录稿全文。
 * 有爆款拆解时在前面加一段清晰标记的「创作参考」，供 AI 二创模板（{{rawText}}）吸收选题角度/结构/改造方向；
 * 无拆解则保持纯转录（向后兼容）。
 */
export function inboxItemToOriginalMarkdown(item: SonarInboxItem): string {
  const transcript = (item.transcript?.fullText ?? '').trim();
  const reference = insightToReferenceMarkdown(item.insight);
  return reference ? `${reference}\n\n---\n\n${transcript}` : transcript;
}

/** 收件项是否可生成初稿（有非空转录）。 */
export function canDraftInboxItem(item: SonarInboxItem): boolean {
  return Boolean(item.transcript?.fullText?.trim());
}

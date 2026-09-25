/**
 * 博主主页 DOM / SSR 提取（capture fallback）。
 *
 * 抖音个人主页已迁移到 RSC 流式 SSR 框架（`__pace_f` / `SSR_RENDER_DATA`），
 * 网页端不再发起 `/aweme/v1/web/aweme/post/`、`/aweme/v1/web/user/profile/other/`
 * 的 fetch/XHR——PageBridge 的被动拦截因此对主页失效（作品列表与博主资料都拿不到）。
 *
 * 这里改为「主动提取」：博主资料读页面头部 + SSR，作品列表读渲染后的
 * `[data-e2e="user-post-list"]` DOM。Content Script（ISOLATED world）与页面共享 DOM，
 * 无需 MAIN world 注入。
 *
 * 设计：
 * - 纯解析（计数、awemeId、描述清洗、装配、排序）不依赖 DOM，可在 node 下单测。
 * - 仅 `read*FromDom` / `extractCreatorPageFromDom` 触碰 `Document`，由 Content Script 调用。
 *
 * 身份：主页 URL 只给 secUid，新框架下博主内部 uid 不在可靠位置；统一用 secUid 作为
 * Creator.id（Repository 的 getCreatorBySecUid 本就按 secUid 反查，关注链路一致）。
 */
import type { Creator, Video, VideoStatistics } from '@/domain/models';

/** DOM 读出的博主头部原始字段（字符串态，未规整）。 */
export interface RawCreatorHeader {
  secUid: string;
  nickname: string;
  fansText?: string;
  signature?: string;
  avatarUrl?: string;
}

/** DOM 读出的单个作品原始字段（字符串态，未规整）。 */
export interface RawPostItem {
  awemeId: string;
  /** 作品页类型：图文/动态走 /note/，其余 /video/。 */
  isNote?: boolean;
  /** article 是抖音主页作品网格中的长图文形态，需保留真实详情路径。 */
  pathType?: 'article';
  descText?: string;
  coverUrl?: string;
  likeText?: string;
  /** 是否「置顶」作品（置顶会排在最前，但不一定最新）。 */
  pinned?: boolean;
}

export interface CreatorPageExtract {
  creator: Creator;
  videos: Video[];
}

export interface CaptureStabilityState {
  lastCount: number;
  stableRounds: number;
}

/**
 * 主页首屏会从 1–2 张卡片渐进渲染到完整首批；不能在“发现任意 li”时停止轮询。
 * 非空计数连续三轮不再增长才视为首屏稳定。
 */
export function advanceCaptureStability(
  state: CaptureStabilityState,
  itemCount: number,
): { state: CaptureStabilityState; settled: boolean } {
  const stableRounds = itemCount > 0 && itemCount === state.lastCount ? state.stableRounds + 1 : 0;
  const next = { lastCount: itemCount, stableRounds };
  return { state: next, settled: stableRounds >= 3 };
}

/**
 * 解析抖音计数文本：'粉丝1.3万' / '获赞1.3万' / '关注23' / '186' / '1.2亿' / '10万+'。
 * 取首个数字 + 可选单位（万 / 亿），返回整数；解析不出返回 undefined。
 */
export function parseCountText(text: string | undefined | null): number | undefined {
  if (typeof text !== 'string') return undefined;
  const cleaned = text.replace(/,/g, '');
  const m = cleaned.match(/([\d.]+)\s*(亿|万|w|W)?/);
  if (!m) return undefined;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return undefined;
  const unit = m[2];
  let value = base;
  if (unit === '万' || unit === 'w' || unit === 'W') value = base * 1e4;
  else if (unit === '亿') value = base * 1e8;
  return Math.round(value);
}

/** 从作品链接解析 awemeId 与是否图文。命中 /video/ /note/ /slides/，否则 null。 */
export function parseAwemeHref(
  href: string | undefined | null,
): { id: string; isNote: boolean; pathType?: 'article' } | null {
  if (typeof href !== 'string') return null;
  const m = href.match(/\/(video|note|slides|article)\/(\d+)/);
  if (!m) return null;
  return {
    id: m[2],
    isNote: m[1] !== 'video',
    ...(m[1] === 'article' ? { pathType: 'article' as const } : {}),
  };
}

/**
 * 清洗作品描述：抖音封面 alt 形如 '{昵称}：{描述}'，去掉昵称前缀与「置顶」字样。
 */
export function cleanDescription(descText: string | undefined | null, nickname?: string): string {
  let s = typeof descText === 'string' ? descText.trim() : '';
  if (!s) return '';
  if (nickname) {
    // 全角「：」与半角「:」两种分隔都处理。
    for (const sep of ['：', ':']) {
      const prefix = `${nickname}${sep}`;
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length).trim();
        break;
      }
    }
  }
  s = s.replace(/^置顶\s*/, '').trim();
  return s;
}

/**
 * 从 awemeId 解码发布时间（ms）。抖音 awemeId 是 snowflake：高 32 位为 unix 秒。
 * DOM 提取拿不到 create_time，用它补出近似发布时间，否则 publishedAt 全为 0，
 * 仓库按 publishedAt 排序失效 → 列表退化为主键序（最旧在前），最新作品被埋在末页。
 * 解析失败或落在合理区间（2010..2100）外返回 0。
 */
export function awemeIdToPublishedAtMs(id: string): number {
  try {
    const seconds = Number(BigInt(id) >> 32n);
    if (!Number.isFinite(seconds) || seconds < 1_262_304_000 || seconds > 4_102_444_800) return 0;
    return seconds * 1000;
  } catch {
    return 0;
  }
}

/** 按 awemeId 数值降序（snowflake 近似时间序，最新在前；纠正置顶造成的乱序）。 */
function compareAwemeIdDesc(a: string, b: string): number {
  try {
    const ba = BigInt(a);
    const bb = BigInt(b);
    if (ba === bb) return 0;
    return ba > bb ? -1 : 1;
  } catch {
    // 退化为字符串：长度优先再字典序。
    if (a.length !== b.length) return b.length - a.length;
    return a < b ? 1 : a > b ? -1 : 0;
  }
}

/**
 * 装配为稳定 Creator + Video[]（纯函数）。
 * - 缺昵称或 secUid 返回 null。
 * - 作品按 awemeId 去重、数值降序（最新在前，供 diffNewVideos 使用）。
 */
export function assembleCreatorPage(
  header: RawCreatorHeader,
  items: RawPostItem[],
  now: number,
): CreatorPageExtract | null {
  const secUid = header.secUid?.trim();
  const nickname = header.nickname?.trim();
  if (!secUid || !nickname) return null;

  const followerCount = parseCountText(header.fansText);
  const avatarUrl = header.avatarUrl?.trim() || undefined;
  const signature = header.signature?.trim() || undefined;

  const creator: Creator = {
    id: secUid,
    secUid,
    nickname,
    profileUrl: `https://www.douyin.com/user/${secUid}`,
    updatedAt: now,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(signature ? { signature } : {}),
    ...(followerCount !== undefined ? { followerCount } : {}),
  };

  const seen = new Set<string>();
  const videos: Video[] = [];
  for (const item of items) {
    const id = item.awemeId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const likeCount = parseCountText(item.likeText);
    const statistics: VideoStatistics | undefined =
      likeCount !== undefined ? { likeCount } : undefined;
    const coverUrl = item.coverUrl?.trim() || undefined;
    videos.push({
      id,
      creatorId: secUid,
      description: cleanDescription(item.descText, nickname),
      publishedAt: awemeIdToPublishedAtMs(id),
      sourcePageUrl: item.pathType === 'article'
        ? `https://www.douyin.com/article/${id}`
        : item.isNote
          ? `https://www.douyin.com/note/${id}`
          : `https://www.douyin.com/video/${id}`,
      ...(coverUrl ? { coverUrl } : {}),
      ...(statistics ? { statistics } : {}),
    });
  }
  videos.sort((a, b) => compareAwemeIdDesc(a.id, b.id));

  return { creator, videos };
}

// —— 以下为 DOM 读取层：仅在 Content Script（浏览器）中调用，不在 node 单测内覆盖 ——

function textOf(root: ParentNode, selector: string): string | undefined {
  const el = root.querySelector(selector);
  const t = el?.textContent?.trim();
  return t || undefined;
}

/** 从渲染后的博主头部读取原始字段。找不到昵称返回 null。 */
export function readCreatorHeader(doc: Document, secUid: string): RawCreatorHeader | null {
  const nickname =
    textOf(doc, '[data-e2e="user-detail"] h1') ??
    textOf(doc, '[data-e2e="user-info"] h1') ??
    textOf(doc, 'h1');
  if (!nickname) return null;

  const fansText = textOf(doc, '[data-e2e="user-info-fans"]');

  // 个性签名（best-effort）：用户信息区里 data-e2e 标注的简介。
  const signature =
    textOf(doc, '[data-e2e="user-info"] [data-e2e="user-bio"]') ??
    textOf(doc, '[data-e2e="user-bio"]');

  // 头像：用户信息区里第一张非 emoji 的图片。
  let avatarUrl: string | undefined;
  const infoRoot = doc.querySelector('[data-e2e="user-info"]') ?? doc.querySelector('[data-e2e="user-detail"]');
  if (infoRoot) {
    const imgs = infoRoot.querySelectorAll('img');
    for (const img of Array.from(imgs)) {
      const src = (img as HTMLImageElement).src;
      if (src && /douyinpic\.com|byteimg\.com|aweme-avatar/.test(src) && !/twemoji|emoji/.test(src)) {
        avatarUrl = src.split('?')[0];
        break;
      }
    }
  }

  return {
    secUid,
    nickname,
    ...(fansText ? { fansText } : {}),
    ...(signature ? { signature } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/** 从某个作品节点读取数字态的点赞文本（跳过「置顶」字样）。 */
function readLikeText(li: Element): string | undefined {
  const candidates: string[] = [];
  const walker = li.ownerDocument?.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  if (walker) {
    let node = walker.nextNode();
    while (node) {
      const t = node.textContent?.trim() ?? '';
      if (/^[\d.]+[万亿wW]?\+?$/.test(t)) candidates.push(t);
      node = walker.nextNode();
    }
  }
  // 点赞通常是作品卡片上唯一/最后出现的计数。
  return candidates.length > 0 ? candidates[candidates.length - 1] : undefined;
}

/** 读取作品列表（`[data-e2e="user-post-list"]` 下的卡片）。 */
export function readPostItems(doc: Document): RawPostItem[] {
  const list = doc.querySelector('[data-e2e="user-post-list"]');
  if (!list) return [];
  const lis = list.querySelectorAll('li');
  const items: RawPostItem[] = [];
  for (const li of Array.from(lis)) {
    const a = li.querySelector('a[href*="/video/"], a[href*="/note/"], a[href*="/slides/"], a[href*="/article/"]');
    const href = a?.getAttribute('href') ?? undefined;
    const parsed = parseAwemeHref(href);
    if (!parsed) continue;
    const img = li.querySelector('img');
    const coverUrl = (img as HTMLImageElement | null)?.src?.split('?')[0] || undefined;
    const descText = img?.getAttribute('alt') || undefined;
    const pinned = (li.textContent ?? '').includes('置顶');
    const likeText = readLikeText(li);
    items.push({
      awemeId: parsed.id,
      isNote: parsed.isNote,
      ...(parsed.pathType ? { pathType: parsed.pathType } : {}),
      ...(descText ? { descText } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(likeText ? { likeText } : {}),
      ...(pinned ? { pinned } : {}),
    });
  }
  return items;
}

/** 从博主主页 Document 提取 Creator + Video[]。无法识别返回 null。 */
export function extractCreatorPageFromDom(
  doc: Document,
  secUid: string,
  now: number,
): CreatorPageExtract | null {
  const header = readCreatorHeader(doc, secUid);
  if (!header) return null;
  const items = readPostItems(doc);
  return assembleCreatorPage(header, items, now);
}

import { describe, it, expect } from 'vitest';
import {
  extractAwemeId,
  toNoWatermark,
  parseRouterData,
  extractSharePayload,
  buildFromSharePayload,
  resolveFromSharePage,
  shareVideoUrl,
} from '@/resolver/share-resolver';

const AWEME_ID = '7400000000000000001';

const ITEM = {
  aweme_id: AWEME_ID,
  desc: '英伟达 Q1 财报拆解',
  create_time: 1_717_000_000,
  author: { uid: '111', sec_uid: 'MS4wAAAAtest', nickname: '硬核老王' },
  statistics: { digg_count: 128000, comment_count: 3421, collect_count: 21000, share_count: 891 },
  video: {
    duration: 1_122_000,
    cover: { url_list: ['https://p.douyinpic.com/cover.jpg'] },
    play_addr: {
      url_list: ['https://www.iesdouyin.com/aweme/v1/playwm/?video_id=v123&ratio=720p'],
      width: 720,
      height: 1280,
    },
    bit_rate: [
      {
        bit_rate: 1_600_000,
        format: 'mp4',
        gear_name: 'normal_720',
        is_bytevc1: 0,
        play_addr: { url_list: ['https://v3.douyinvod.com/play/abc?br=1600'], width: 720, height: 1280 },
      },
    ],
  },
};

function sharePageHtml(item: unknown): string {
  const routerData = { loaderData: { 'video_(id)/page': { videoInfoRes: { item_list: [item] } } } };
  return `<!doctype html><html><body><script>window._ROUTER_DATA = ${JSON.stringify(routerData)}</script></body></html>`;
}

describe('extractAwemeId', () => {
  it('从视频页 / 分享页 / note / modal_id 提取 id', () => {
    expect(extractAwemeId(`https://www.douyin.com/video/${AWEME_ID}`)).toBe(AWEME_ID);
    expect(extractAwemeId(`https://www.iesdouyin.com/share/video/${AWEME_ID}/`)).toBe(AWEME_ID);
    expect(extractAwemeId(`https://www.douyin.com/note/${AWEME_ID}`)).toBe(AWEME_ID);
    expect(extractAwemeId(`https://www.douyin.com/?modal_id=${AWEME_ID}`)).toBe(AWEME_ID);
    expect(extractAwemeId('https://www.douyin.com/discover')).toBeNull();
  });
});

describe('toNoWatermark', () => {
  it('把 playwm 替换成 play', () => {
    expect(toNoWatermark('https://x/aweme/v1/playwm/?id=1')).toBe('https://x/aweme/v1/play/?id=1');
    expect(toNoWatermark('https://x/play/abc')).toBe('https://x/play/abc');
  });
});

describe('parse + build', () => {
  it('从分享页 HTML 解析出无水印源与作品信息', () => {
    const payload = extractSharePayload(parseRouterData(sharePageHtml(ITEM)));
    expect(payload).not.toBeNull();

    const result = buildFromSharePayload(payload!, 1_717_000_000_000);
    expect(result).not.toBeNull();
    expect(result!.video.id).toBe(AWEME_ID);
    expect(result!.video.creatorId).toBe('111');
    expect(result!.creator.nickname).toBe('硬核老王');
    expect(result!.video.description).toBe('英伟达 Q1 财报拆解');
    expect(result!.video.statistics?.likeCount).toBe(128000);

    // 至少一个无水印源，且 URL 不再含 playwm
    expect(result!.sources.length).toBeGreaterThan(0);
    const best = result!.sources[0];
    expect(best.url).not.toContain('playwm');
    expect(best.watermark).toBe('none');
    expect(best.watermarkConfidence).toBe('high');
    expect(result!.sources.every((s) => !s.url.includes('playwm'))).toBe(true);
  });

  it('页面结构异常时返回 null，不抛出', () => {
    expect(parseRouterData('<html>no router data</html>')).toBeNull();
    expect(extractSharePayload({ loaderData: {} })).toBeNull();
  });
});

describe('resolveFromSharePage', () => {
  it('已知 awemeId：抓分享页解析无水印源', async () => {
    const calls: string[] = [];
    const fetchText = async (url: string) => {
      calls.push(url);
      return { text: sharePageHtml(ITEM), finalUrl: url };
    };
    const result = await resolveFromSharePage({ awemeId: AWEME_ID, fetchText, now: 1_717_000_000_000 });
    expect(result?.video.id).toBe(AWEME_ID);
    expect(calls).toContain(shareVideoUrl(AWEME_ID));
  });

  it('短链：跟随跳转得到 awemeId 再解析', async () => {
    const fetchText = async (url: string) => {
      if (url === 'https://v.douyin.com/abcd/') {
        return { text: '', finalUrl: `https://www.iesdouyin.com/share/video/${AWEME_ID}/?x=1` };
      }
      return { text: sharePageHtml(ITEM), finalUrl: url };
    };
    const result = await resolveFromSharePage({ shareUrl: 'https://v.douyin.com/abcd/', fetchText, now: 1 });
    expect(result?.video.id).toBe(AWEME_ID);
  });

  it('无法确定 id 时返回 null', async () => {
    const fetchText = async (url: string) => ({ text: '', finalUrl: url });
    expect(await resolveFromSharePage({ shareUrl: 'https://example.com/x', fetchText, now: 1 })).toBeNull();
  });
});

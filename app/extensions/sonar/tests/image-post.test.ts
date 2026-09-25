/**
 * 图文/动态作品（aweme_type 图文）支持：images[] 资产提取、页面识别、下载命名。
 *
 * 覆盖两类 image item：静态图（url_list）与「实况/动态图」（自带 video.play_addr，本质短视频）。
 * 注意：合成夹具按抖音公开的稳定结构构造，真实链路仍建议用真实图文链接回归一次。
 */
import { describe, it, expect } from 'vitest';
import { extractImageSources } from '@/adapter/source-extractor';
import { adaptAweme } from '@/adapter/video-adapter';
import { buildSharePageSources } from '@/resolver/share-resolver';
import { pickDownloadCandidates } from '@/resolver/source-ranker';
import { detectPageFromUrl } from '@/adapter/page-detection';
import { extensionFromSource } from '@/background/download/plan';

const STATIC_IMG = 'https://p3.douyinpic.com/img/a.webp';
const LIVE_MP4 = 'https://aweme.snssdk.com/aweme/v1/play/?video_id=LIVE&ratio=1080p';

const IMAGE_POST = {
  aweme_id: '7400000000000000002',
  desc: '图文测试',
  aweme_type: 68,
  create_time: 1718000000,
  author: { uid: '100000002', sec_uid: 'MS4wimg', nickname: '图文博主' },
  images: [
    { url_list: [STATIC_IMG], width: 1080, height: 1440 },
    {
      url_list: ['https://p3.douyinpic.com/img/b.webp'],
      width: 1080,
      height: 1440,
      video: { play_addr: { url_list: [LIVE_MP4], width: 1080, height: 1920 } },
    },
  ],
};

describe('图文/动态作品 — 提取与识别', () => {
  it('extractImageSources 取出静态图与实况短视频，且都标记 fromImageSet', () => {
    const sources = extractImageSources(IMAGE_POST);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ url: STATIC_IMG, sourceField: 'image', fromImageSet: true });
    // 第二张是实况图：自带 video.play_addr，作为视频源
    expect(sources[1]).toMatchObject({ url: LIVE_MP4, sourceField: 'play_addr', fromImageSet: true });
  });

  it('adaptAweme 把图文作品的页面地址指向 /note/，封面回退到首图', () => {
    const adapted = adaptAweme(IMAGE_POST, 1_700_000_000_000);
    expect(adapted?.video.sourcePageUrl).toBe('https://www.douyin.com/note/7400000000000000002');
    expect(adapted?.video.coverUrl).toBe(STATIC_IMG);
  });

  it('buildSharePageSources 并入 images 资产，且每张图都作为独立候选（不被清晰度折叠）', () => {
    const sources = buildSharePageSources(undefined, IMAGE_POST);
    const candidates = pickDownloadCandidates(sources);
    expect(candidates).toHaveLength(2);
    const urls = candidates.map((s) => s.url);
    expect(urls).toContain(STATIC_IMG);
    expect(urls).toContain(LIVE_MP4);
  });

  it('静态图按图片 MIME 命名扩展名（webp），不会错存成 mp4', () => {
    const [staticSrc] = buildSharePageSources(undefined, IMAGE_POST).filter((s) => s.url === STATIC_IMG);
    expect(staticSrc.mimeType).toBe('image/webp');
    expect(extensionFromSource(staticSrc)).toBe('webp');
  });

  it('detectPageFromUrl 识别 /note/ 与 /slides/ 作品页', () => {
    expect(detectPageFromUrl('https://www.douyin.com/note/7400000000000000002')).toMatchObject({
      type: 'video',
      awemeId: '7400000000000000002',
    });
    expect(detectPageFromUrl('https://www.douyin.com/slides/7400000000000000002')).toMatchObject({
      type: 'video',
      awemeId: '7400000000000000002',
    });
  });
});

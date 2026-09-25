import { it, expect, vi } from 'vitest';

// 让 tencent.uploadVideo 用一个可观察的假 ctx（不真起浏览器），以验证落盘时的行为
const hoisted = vi.hoisted(() => ({ ctx: null as any }));
vi.mock('../../electron/publish/engine', () => ({
  withContext: async (_opts: any, run: (ctx: any) => Promise<unknown>) => run(hoisted.ctx),
}));

import { tencent, uploadTencentVideo } from '../../electron/publish/platforms/tencent';

/**
 * 通用 locator：所有未特殊路由的 page.locator()/getByRole()/getByText()/getByLabel()
 * 都返回它，让上传流程里各个等待循环都能立即终止：
 *   count()       → 1   （locator "存在"）
 *   isVisible()   → false（登录标记/内容声明等不可见）
 *   isDisabled()  → true （跳过声明原创复选框分支）
 *   getAttribute()→ 'weui-desktop-btn'（无 _disabled → 上传完成循环 break）
 */
function makeSharedLocator() {
  const loc: any = {
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    isVisible: vi.fn().mockResolvedValue(false),
    isDisabled: vi.fn().mockResolvedValue(true),
    getAttribute: vi.fn().mockResolvedValue('weui-desktop-btn'),
    check: vi.fn().mockResolvedValue(undefined),
    innerText: vi.fn().mockResolvedValue(''),
    evaluate: vi.fn().mockResolvedValue(''),
    all: vi.fn().mockResolvedValue([]),
  };
  loc.first = () => loc;
  loc.nth = () => loc;
  loc.locator = vi.fn().mockReturnValue(loc);
  loc.getByText = vi.fn().mockReturnValue(loc);
  loc.getByRole = vi.fn().mockReturnValue(loc);
  loc.getByLabel = vi.fn().mockReturnValue(loc);
  loc.filter = vi.fn().mockReturnValue(loc);
  return loc;
}

/**
 * 文件上传框「一上来就在」的乐观 mock：frames() = [page]，所有 locator → sharedLocator。
 */
function makeMockPage() {
  const sharedLocator = makeSharedLocator();
  const page: any = {
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(sharedLocator),
    getByRole: vi.fn().mockReturnValue(sharedLocator),
    getByText: vi.fn().mockReturnValue(sharedLocator),
    getByLabel: vi.fn().mockReturnValue(sharedLocator),
    getByPlaceholder: vi.fn().mockReturnValue(sharedLocator),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    url: vi.fn().mockReturnValue('https://channels.weixin.qq.com/platform/post/create'),
    _sharedLocator: sharedLocator,
  };
  page.frames = vi.fn().mockReturnValue([page]);
  return page;
}

it('uploadTencentVideo 先打开首页而非深链 /post/create，并把视频文件设置到 input[type="file"] 上', async () => {
  const page = makeMockPage();

  await uploadTencentVideo(page as any, {
    storageStatePath: '/c.json',
    filePath: '/tmp/v.mp4',
    title: '标题',
    desc: '描述',
    tags: ['a', 'b'],
    headless: true,
  });

  // 入口改为首页 /platform（深链 /post/create 会被重定向回首页）
  expect(page.goto).toHaveBeenCalledWith(
    'https://channels.weixin.qq.com/platform',
    expect.anything(),
  );
  // 不应再深链直达 create 页
  expect(page.goto).not.toHaveBeenCalledWith(
    'https://channels.weixin.qq.com/platform/post/create',
    expect.anything(),
  );

  const { _sharedLocator: loc } = page;
  expect(loc.setInputFiles).toHaveBeenCalledWith('/tmp/v.mp4');
});

/**
 * 还原真实回归：直达首页时上传框尚未渲染，必须点「发表视频」后才出现 input[type="file"]。
 * file 输入的 count 在点击发表按钮前为 0、点击后变 1。
 */
function makeFlowMockPage() {
  let publishClicked = false;
  const generic = makeSharedLocator();

  const fileLoc: any = {
    first: () => fileLoc,
    count: vi.fn(async () => (publishClicked ? 1 : 0)),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
  };
  const publishBtn: any = {
    first: () => publishBtn,
    count: vi.fn().mockResolvedValue(1),
    click: vi.fn(async () => {
      publishClicked = true;
    }),
  };

  const page: any = {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://channels.weixin.qq.com/platform'),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    locator: vi.fn((sel: string) => (sel === 'input[type="file"]' ? fileLoc : generic)),
    getByText: vi.fn((t: string) => (t === '发表视频' ? publishBtn : generic)),
    getByRole: vi.fn().mockReturnValue(generic),
    getByLabel: vi.fn().mockReturnValue(generic),
    getByPlaceholder: vi.fn().mockReturnValue(generic),
  };
  page.frames = vi.fn().mockReturnValue([page]);
  return { page, fileLoc, publishBtn };
}

it('上传框未直接就绪时，点「发表视频」唤出后再上传文件', async () => {
  const { page, fileLoc, publishBtn } = makeFlowMockPage();

  await uploadTencentVideo(page as any, {
    storageStatePath: '/c.json',
    filePath: '/tmp/v.mp4',
    title: '标题',
    desc: '描述',
    tags: ['a'],
    headless: true,
  });

  // 必须点过「发表视频」入口
  expect(publishBtn.click).toHaveBeenCalled();
  // 点击后才出现的上传框被正确赋值
  expect(fileLoc.setInputFiles).toHaveBeenCalledWith('/tmp/v.mp4');
});

/**
 * 登录态失效回归：视频号 session 被服务端吊销后，/platform 与 /post/create
 * 都会 302 到 login.html（渲染扫码 iframe）。此时既找不到「发表视频」也找不到
 * input[type="file"]，旧实现会抛出误导性的「未找到视频号文件上传框」。
 * 期望：识别登录重定向并抛出明确可操作的重新登录错误。
 */
function makeLoginRedirectPage() {
  const generic = makeSharedLocator();
  const noFile: any = {
    first: () => noFile,
    count: vi.fn().mockResolvedValue(0),
  };
  const publishBtn: any = {
    first: () => publishBtn,
    count: vi.fn().mockResolvedValue(0), // 登录页没有「发表视频」入口
    click: vi.fn().mockResolvedValue(undefined),
  };
  const page: any = {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://channels.weixin.qq.com/login.html'),
    locator: vi.fn((sel: string) => (sel === 'input[type="file"]' ? noFile : generic)),
    getByText: vi.fn((t: string) => (t === '发表视频' ? publishBtn : generic)),
    getByRole: vi.fn().mockReturnValue(generic),
    getByLabel: vi.fn().mockReturnValue(generic),
    getByPlaceholder: vi.fn().mockReturnValue(generic),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn(), type: vi.fn() },
  };
  page.frames = vi.fn().mockReturnValue([page]);
  return { page, publishBtn };
}

it('登录态失效（重定向到 login.html）时抛出明确的重新登录错误，而非「未找到上传框」', async () => {
  const { page } = makeLoginRedirectPage();

  await expect(
    uploadTencentVideo(page as any, {
      storageStatePath: '/c.json',
      filePath: '/tmp/v.mp4',
      title: '标题',
      desc: '描述',
      tags: [],
      headless: true,
    }),
  ).rejects.toThrow(/登录态已失效|重新登录/);
});

it('uploadVideo 发布后只在 channels 域落盘，不再访问 qq.com / 公众号平台暖场', async () => {
  const page = makeMockPage();
  // 落盘前的 cookie 体检需满足：含 sessionid/wxuin 且数量 ≥ 阈值 → 立即返回，不空等
  const cookies = [
    { name: 'sessionid' },
    { name: 'wxuin' },
    { name: 'a' },
    { name: 'b' },
    { name: 'c' },
    { name: 'd' },
  ];
  const ctx = {
    newPage: vi.fn().mockResolvedValue(page),
    cookies: vi.fn().mockResolvedValue(cookies),
    storageState: vi.fn().mockResolvedValue(undefined),
  };
  hoisted.ctx = ctx;

  await tencent.uploadVideo({
    storageStatePath: '/c.json',
    filePath: '/tmp/v.mp4',
    title: '标题',
    desc: '描述',
    tags: ['a'],
    headless: true,
  });

  // 只开了主发布页这一个 page；不再为暖场父域 newPage
  expect(ctx.newPage).toHaveBeenCalledTimes(1);
  // 没有访问 www.qq.com / mp.weixin.qq.com
  for (const call of page.goto.mock.calls) {
    expect(call[0]).not.toContain('www.qq.com');
    expect(call[0]).not.toContain('mp.weixin.qq.com');
  }
  // cookie 仍正常落盘
  expect(ctx.storageState).toHaveBeenCalledWith({ path: '/c.json' });
});

it('uploadTencentVideo 传入 covers 时分别上传 4:3 横版 + 3:4 竖版封面', async () => {
  const page = makeMockPage();

  await uploadTencentVideo(page as any, {
    storageStatePath: '/c.json',
    filePath: '/tmp/v.mp4',
    title: 't',
    desc: 'd',
    tags: [],
    covers: { '4:3': '/land.png', '3:4': '/port.png' },
    headless: true,
  });

  const { _sharedLocator: loc } = page;
  expect(loc.setInputFiles).toHaveBeenCalledWith('/land.png'); // 4:3 横版动态封面
  expect(loc.setInputFiles).toHaveBeenCalledWith('/port.png'); // 3:4 竖版个人主页卡片
});

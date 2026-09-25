export type PublishPlatform = 'douyin' | 'tencent' | 'xiaohongshu' | 'kuaishou' | 'bilibili';

export interface PublishAccount {
  id: string;
  platform: PublishPlatform;
  accountName: string;
  storageStatePath: string;
  status: 'valid' | 'expired' | 'unknown';
  lastCheckedAt?: number;
}

export interface PublishTarget {
  accountId: string;
  overrides?: { title?: string; desc?: string; tags?: string[] };
  bilibili?: { tid: number };
}

/** 封面比例键。封面工作台按真实像素归类到这三种比例。 */
export type CoverRatio = '16:9' | '4:3' | '3:4';

/** 按比例提供的多张封面。各平台按自身需求取用：
 *  - 视频号：4:3（动态横版）+ 3:4（个人主页卡片）
 *  - 抖音：3:4（竖封面）+ 16:9（横封面）
 *  - 快手 / 小红书：单封面（优先 3:4）
 */
export type PublishCovers = Partial<Record<CoverRatio, string>>;

export interface PublishShared {
  title: string;
  desc: string;
  tags: string[];
  /** 单封面兜底（旧字段 / 仅取一张的平台）。 */
  thumbnail?: string;
  /** 多比例封面，优先于 thumbnail。 */
  covers?: PublishCovers;
  scheduleAt?: number;
}

export interface PublishResult {
  state: 'pending' | 'running' | 'success' | 'failed';
  percent?: number;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface PublishJob {
  id: string;
  filePath: string;
  shared: PublishShared;
  targets: PublishTarget[];
  results: Record<string, PublishResult>;
}

// 单平台上传入参（engine → platform 模块）
export interface UploadVideoOptions {
  storageStatePath: string;
  filePath: string;
  title: string;
  desc: string;
  tags: string[];
  thumbnail?: string;
  /** 多比例封面，优先于 thumbnail。 */
  covers?: PublishCovers;
  scheduleAt?: number;
  headless: boolean;
  tid?: number;               // B 站专属：分区 id（runner 从 target.bilibili.tid 透传）
  onProgress?: (percent: number, message?: string) => void;
}

export interface LoginOptions {
  storageStatePath: string;
  /** 浏览器无头模式。默认无头，可在发布设置中切换有头（兜底反爬登录）。 */
  headless: boolean;
  onQrcode?: (pngPath: string) => void;
}

/** 发布全局设置，持久化于 userData/publish/settings.json。 */
export interface PublishSettings {
  /** 登录是否使用无头浏览器，默认 true。关闭则有头（设置页可切换）。 */
  headlessLogin: boolean;
}

export interface PlatformModule {
  platform: PublishPlatform;
  login(opts: LoginOptions): Promise<{ success: boolean; message: string }>;
  checkCookie(storageStatePath: string): Promise<boolean>;
  uploadVideo(opts: UploadVideoOptions): Promise<void>;
}

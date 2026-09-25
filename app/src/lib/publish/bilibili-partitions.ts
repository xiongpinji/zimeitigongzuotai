/**
 * B站投稿分区（tid）全量内置清单。
 *
 * 上传走 biliup-rs（已 pin v1.2.1），`--tid <n>` 直接透传给 B站投稿接口，
 * 因此这里的 tid 必须与该二进制使用的「经典分区体系」对齐——数据源为 biliup 官方
 * tid 参考表（https://biliup.github.io/tid-ref.html）。
 *
 * 不接 B站 live 新分区 API：那套新 tid 与 pin 的 biliup 对不上，会被投稿接口拒绝。
 * 番剧 / 电视剧 / 电影等 PGC 区不可普通投稿，故不收录（与 biliup tid-ref 一致）。
 *
 * biliup 升级换分区时，手动同步本文件即可（低频）。
 */

export interface BilibiliSubPartition {
  /** 分区 ID（投稿 --tid 实参） */
  id: number;
  name: string;
}

export interface BilibiliPartition {
  /** 主分区 ID（仅用于分组展示，投稿应选具体子分区的 id） */
  id: number;
  name: string;
  children: BilibiliSubPartition[];
}

/** 全量分区树，严格对齐 biliup tid-ref（经典分区，17 个可投稿主分区）。 */
export const BILIBILI_PARTITIONS: BilibiliPartition[] = [
  {
    id: 160,
    name: '生活',
    children: [
      { id: 138, name: '搞笑' },
      { id: 239, name: '家居房产' },
      { id: 161, name: '手工' },
      { id: 162, name: '绘画' },
      { id: 21, name: '日常' },
    ],
  },
  {
    id: 4,
    name: '游戏',
    children: [
      { id: 17, name: '单机游戏' },
      { id: 65, name: '网络游戏' },
      { id: 172, name: '手机游戏' },
      { id: 171, name: '电子竞技' },
      { id: 173, name: '桌游棋牌' },
      { id: 136, name: '音游' },
      { id: 121, name: 'GMV' },
      { id: 19, name: 'Mugen' },
    ],
  },
  {
    id: 5,
    name: '娱乐',
    children: [
      { id: 71, name: '综艺' },
      { id: 137, name: '明星' },
    ],
  },
  {
    id: 36,
    name: '知识',
    children: [
      { id: 201, name: '科学科普' },
      { id: 124, name: '社科·法律·心理' },
      { id: 228, name: '人文历史' },
      { id: 207, name: '财经商业' },
      { id: 208, name: '校园学习' },
      { id: 209, name: '职业职场' },
      { id: 229, name: '设计·创意' },
      { id: 122, name: '野生技能协会' },
    ],
  },
  {
    id: 181,
    name: '影视',
    children: [
      { id: 85, name: '短片' },
      { id: 182, name: '影视杂谈' },
      { id: 183, name: '影视剪辑' },
      { id: 184, name: '预告·资讯' },
    ],
  },
  {
    id: 3,
    name: '音乐',
    children: [
      { id: 130, name: '音乐综合' },
      { id: 29, name: '音乐现场' },
      { id: 59, name: '演奏' },
      { id: 31, name: '翻唱' },
      { id: 193, name: 'MV' },
      { id: 30, name: 'VOCALOID·UTAU' },
      { id: 194, name: '电音' },
      { id: 28, name: '原创音乐' },
    ],
  },
  {
    id: 1,
    name: '动画',
    children: [
      { id: 24, name: 'MAD·AMV' },
      { id: 25, name: 'MMD·3D' },
      { id: 27, name: '综合' },
      { id: 47, name: '短片·手书·配音' },
      { id: 210, name: '手办·模玩' },
      { id: 86, name: '特摄' },
    ],
  },
  {
    id: 155,
    name: '时尚',
    children: [
      { id: 157, name: '美妆护肤' },
      { id: 158, name: '穿搭' },
      { id: 159, name: '时尚潮流' },
    ],
  },
  {
    id: 211,
    name: '美食',
    children: [
      { id: 76, name: '美食制作' },
      { id: 212, name: '美食侦探' },
      { id: 213, name: '美食测评' },
      { id: 214, name: '田园美食' },
      { id: 215, name: '美食记录' },
    ],
  },
  {
    id: 223,
    name: '汽车',
    children: [
      { id: 176, name: '汽车生活' },
      { id: 224, name: '汽车文化' },
      { id: 225, name: '汽车极客' },
      { id: 240, name: '摩托车' },
      { id: 226, name: '智能出行' },
      { id: 227, name: '购车攻略' },
    ],
  },
  {
    id: 234,
    name: '运动',
    children: [
      { id: 235, name: '篮球·足球' },
      { id: 164, name: '健身' },
      { id: 236, name: '竞技体育' },
      { id: 237, name: '运动文化' },
      { id: 238, name: '运动综合' },
    ],
  },
  {
    id: 188,
    name: '科技',
    children: [
      { id: 95, name: '数码' },
      { id: 230, name: '软件应用' },
      { id: 231, name: '计算机技术' },
      { id: 232, name: '工业·工程·机械' },
      { id: 233, name: '极客DIY' },
    ],
  },
  {
    id: 217,
    name: '动物圈',
    children: [
      { id: 218, name: '喵星人' },
      { id: 219, name: '汪星人' },
      { id: 221, name: '野生动物' },
      { id: 222, name: '爬宠' },
      { id: 220, name: '大熊猫' },
      { id: 75, name: '动物综合' },
    ],
  },
  {
    id: 129,
    name: '舞蹈',
    children: [
      { id: 20, name: '宅舞' },
      { id: 154, name: '舞蹈综合' },
      { id: 156, name: '舞蹈教程' },
      { id: 198, name: '街舞' },
      { id: 199, name: '明星舞蹈' },
      { id: 200, name: '中国舞' },
    ],
  },
  {
    id: 167,
    name: '国创',
    children: [
      { id: 153, name: '国产动画' },
      { id: 168, name: '国产原创相关' },
      { id: 169, name: '布袋戏' },
      { id: 170, name: '资讯' },
      { id: 195, name: '动态漫·广播剧' },
    ],
  },
  {
    id: 119,
    name: '鬼畜',
    children: [
      { id: 22, name: '鬼畜调教' },
      { id: 26, name: '音MAD' },
      { id: 126, name: '人力VOCALOID' },
      { id: 216, name: '鬼畜剧场' },
      { id: 127, name: '教程演示' },
    ],
  },
  {
    id: 177,
    name: '纪录片',
    children: [
      { id: 37, name: '人文·历史' },
      { id: 178, name: '科学·探索·自然' },
      { id: 179, name: '军事' },
      { id: 180, name: '社会·美食·旅行' },
    ],
  },
];

/** 拍平后的单个子分区条目（含主分区上下文，便于展示 / 喂给 LLM）。 */
export interface FlatPartition {
  tid: number;
  /** 子分区名 */
  name: string;
  /** 主分区名 */
  parent: string;
  /** 展示用：`主分区 / 子分区` */
  label: string;
}

/** 拍平全部子分区为一维数组。 */
export function flattenPartitions(): FlatPartition[] {
  const flat: FlatPartition[] = [];
  for (const group of BILIBILI_PARTITIONS) {
    for (const sub of group.children) {
      flat.push({
        tid: sub.id,
        name: sub.name,
        parent: group.name,
        label: `${group.name} / ${sub.name}`,
      });
    }
  }
  return flat;
}

/** 反查某 tid 对应的主分区 / 子分区（picker 回填、展示用）；未命中返回 null。 */
export function findPartition(
  tid: number,
): { parent: BilibiliPartition; sub: BilibiliSubPartition } | null {
  for (const parent of BILIBILI_PARTITIONS) {
    const sub = parent.children.find((c) => c.id === tid);
    if (sub) return { parent, sub };
  }
  return null;
}

/** 校验 tid 是否为已知子分区（AI 推荐结果服务端二次校验用）。 */
export function isValidTid(tid: number): boolean {
  return Number.isInteger(tid) && findPartition(tid) !== null;
}

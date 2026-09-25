/**
 * declarativeNetRequest 规则：为抖音视频 CDN 的下载请求注入 Referer / Origin。
 *
 * 抖音视频 CDN（*.douyinvod.com 等）会校验 Referer，缺失时返回 403。用 DNR 的
 * modifyHeaders 为扩展内 fetch 补 Referer，使视频抓取和字幕处理可成功。
 * 只对抖音相关域名生效，不影响其它站点。
 */

const RULE_ID = 1001;
const SHARE_UA_RULE_ID = 1002;
const BCUT_UA_RULE_ID = 1004;

/** 抖音分享页（iesdouyin）按移动端 UA 才稳定返回 _ROUTER_DATA；SW fetch 无法设 UA，用 DNR 改写。 */
const SHARE_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1';
const BCUT_UA = 'Bilibili/1.0.0 (https://www.bilibili.com)';

export function buildDouyinDownloadHeaderRules(): chrome.declarativeNetRequest.Rule[] {
  const rules = [
    {
      id: RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: 'https://www.douyin.com/' },
          { header: 'Origin', operation: 'set', value: 'https://www.douyin.com' },
        ],
      },
      condition: {
        requestDomains: ['douyinvod.com', 'douyin.com', 'douyinpic.com', 'snssdk.com', 'amemv.com'],
        resourceTypes: ['media', 'other', 'xmlhttprequest', 'image'],
      },
    },
    {
      id: SHARE_UA_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: SHARE_MOBILE_UA },
          { header: 'Referer', operation: 'set', value: 'https://www.douyin.com/' },
        ],
      },
      condition: {
        requestDomains: ['iesdouyin.com', 'v.douyin.com'],
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'],
      },
    },
    {
      id: BCUT_UA_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: BCUT_UA },
          { header: 'Origin', operation: 'remove' },
        ],
      },
      condition: {
        requestDomains: ['member.bilibili.com'],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    },
  ];
  // 用字符串字面量构造后整体断言为 chrome 类型，避免在模块加载期引用 chrome 运行时枚举
  // （node 测试环境无 chrome 全局）。
  return rules as unknown as chrome.declarativeNetRequest.Rule[];
}

/** 在 Service Worker 启动时调用一次：以会话规则方式生效（不持久化到磁盘）。 */
export async function applyDouyinDownloadHeaderRules(): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID, SHARE_UA_RULE_ID, 1003, BCUT_UA_RULE_ID],
    addRules: buildDouyinDownloadHeaderRules(),
  });
}

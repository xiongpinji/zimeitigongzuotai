/**
 * 灵机采风 Service Worker 入口。
 *
 * 装配 HandlerContext，注册消息路由（UI 的类型化请求）与页面捕获入库（Content Script
 * 转发的抖音响应）。MV3 Service Worker 不长期驻留：模块级状态在被回收后会重建，持久化
 * 由 Repository（后续 IndexedDB 实现）与 chrome.storage 承担。
 */
import { createHandlers, type HandlerContext } from './handlers';
import { createRouter } from './router';
import { ingestCapture, ingestDomCreatorPage } from './ingest';
import { createIdbRepository } from './idb-repository';
import { createChromeSettingsStore } from './settings-chrome-store';
import { createChromeBridgeSettingsStore, createChromeBridgePendingStore } from './chrome-bridge-store';
import { buildServices } from './build-services';
import { createFetchPage } from './resolve-sources';
import { applyDouyinDownloadHeaderRules } from './download/referer-rule';
import type { ResponseCategory } from '@/content/page-capture';

async function getActivePageUrl(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url ?? null;
  } catch {
    return null;
  }
}

function makeIdGen(): () => string {
  let seq = 0;
  return () => {
    seq += 1;
    return `sonar-${Date.now().toString(36)}-${seq.toString(36)}`;
  };
}

const now = () => Date.now();
const newId = makeIdGen();
// 全部服务共享同一个 Repository / SettingsStore，进度与结果才能被 UI 读到。
// IndexedDB 持久化：Service Worker 被回收后数据仍在。
const repo = createIdbRepository({ now, newId });
const settings = createChromeSettingsStore();
const bridgeSettings = createChromeBridgeSettingsStore();
const bridgePending = createChromeBridgePendingStore();
const { services, downloadService, bridge, collectHub, flushBridgePending } = buildServices({
  repo,
  settings,
  now,
  newId,
  bridgeSettings,
  bridgePending,
});

const fetchPage = createFetchPage((...args) => fetch(...args));
const context: HandlerContext = { repo, settings, services, bridge, getActivePageUrl, fetchPage, now, newId };
downloadService.attachListeners();

// 注入抖音 CDN 下载所需的 Referer/Origin 头，规避 403。SW 每次启动都重设会话规则。
void applyDouyinDownloadHeaderRules().catch((e) =>
  console.warn('[Sonar] 注入下载 Referer 规则失败', e),
);

const router = createRouter(createHandlers(context));

interface CaptureMessage {
  kind: 'sonar/page-capture';
  category: ResponseCategory;
  url: string;
  payload: unknown;
  pageUrl: string;
}

function isCaptureMessage(message: unknown): message is CaptureMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { kind?: unknown }).kind === 'sonar/page-capture'
  );
}

interface DomCaptureMessage {
  kind: 'sonar/dom-capture';
  creator: unknown;
  videos: unknown;
  pageUrl: string;
}

function isDomCaptureMessage(message: unknown): message is DomCaptureMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { kind?: unknown }).kind === 'sonar/dom-capture'
  );
}

interface CollectProgressMessage {
  kind: 'sonar/collect-progress';
  secUid: string;
  collected: number;
  total?: number;
  round: number;
  done: boolean;
  pageUrl?: string;
}

function isCollectProgressMessage(message: unknown): message is CollectProgressMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { kind?: unknown }).kind === 'sonar/collect-progress' &&
    typeof (message as { secUid?: unknown }).secUid === 'string'
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Content Script 转发的页面捕获：入库，无需回包。
  if (isCaptureMessage(message)) {
    void ingestCapture(context.repo, message.category, message.payload, context.now)
      .then((result) => {
        // 联调诊断：真实抓到哪些类别、入库多少作品。打开「检查视图: Service Worker」可见。
        console.info(
          '[Sonar] 捕获',
          message.category,
          '→ 作品',
          result.videoIds.length,
          '博主',
          result.creatorId ?? '-',
        );
      })
      .catch((e) => console.warn('[Sonar] 捕获入库失败', message.category, e));
    return false;
  }
  // 博主主页「主动提取」（DOM/SSR fallback）：抖音新版主页不再发作品列表/资料接口，
  // PageBridge 拦不到，改由 Content Script 读渲染后的 DOM 提取并入库。
  if (isDomCaptureMessage(message)) {
    void ingestDomCreatorPage(context.repo, message.creator, message.videos)
      .then((result) => {
        console.info(
          '[Sonar] DOM 提取主页 →',
          '作品',
          result.videoIds.length,
          '博主',
          result.creatorId ?? '-',
        );
      })
      .catch((e) => console.warn('[Sonar] DOM 提取入库失败', e));
    return false;
  }
  // 全量采集进度：Content Script 滚动加载时上报，写入进度中枢（done 唤醒后台 runner 关标签页）。
  if (isCollectProgressMessage(message)) {
    collectHub.update({
      secUid: message.secUid,
      collected: message.collected,
      round: message.round,
      done: message.done,
      ...(message.total !== undefined ? { total: message.total } : {}),
    });
    if (message.done) {
      console.info('[Sonar] 全量采集完成', message.secUid, '→', message.collected, '/', message.total ?? '?');
    }
    return false;
  }
  // UI 的类型化协议请求：路由并异步回包（返回 true 保持通道开启）。
  void router.dispatch(message).then((response) => {
    if (!response.ok) {
      const method =
        typeof message === 'object' && message !== null
          ? (message as { method?: unknown }).method
          : undefined;
      console.warn('[Sonar] 请求失败', method, response.error);
    }
    sendResponse(response);
  });
  return true;
});

// 点击扩展图标的行为；部分 Chrome 版本不支持时静默降级，Popup 仍可用。
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

// —— 自动监控（chrome.alarms）——
// 基础 tick 取最小可选周期（15min）；每 tick 检查所有「到期」博主（按各自 intervalMinutes），
// 从而覆盖每个博主而非每轮只查一个。
const MONITOR_ALARM = 'sonar:monitor';
const MONITOR_TICK_MINUTES = 15;

function scheduleMonitor(periodInMinutes = MONITOR_TICK_MINUTES): void {
  void chrome.alarms?.create(MONITOR_ALARM, { periodInMinutes });
}
scheduleMonitor();
// Chrome 启动后补偿检查一批，并补推桥 pending（桌面端可能在上次离线时错过）。
chrome.runtime.onStartup?.addListener(() => {
  void services.monitor.runDueBatch().catch((e) => console.warn('[Sonar] 启动补偿监控失败', e));
  void flushBridgePending().catch((e) => console.warn('[Sonar] 启动补推桥 pending 失败', e));
});
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== MONITOR_ALARM) return;
  void services.monitor.runDueBatch().catch((e) => console.warn('[Sonar] 定时监控失败', e));
  // 每次定时监控顺带补推暂存负载（桌面端恢复在线即送达）。
  void flushBridgePending().catch((e) => console.warn('[Sonar] 定时补推桥 pending 失败', e));
});

// —— 通知交互：点击/按钮打开工作台或触发下载 ——
function openWorkbench(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/workbench/index.html') });
}
chrome.notifications?.onClicked.addListener(() => openWorkbench());
chrome.notifications?.onButtonClicked.addListener((notificationId, buttonIndex) => {
  const videoId = notificationId.startsWith('sonar:') ? notificationId.slice('sonar:'.length) : '';
  if (buttonIndex === 1 && videoId) {
    void router
      .dispatch({ protocolVersion: 1, requestId: `notif-${videoId}`, method: 'downloadVideo', params: { videoId } })
      .catch(() => {});
  } else {
    openWorkbench();
  }
});

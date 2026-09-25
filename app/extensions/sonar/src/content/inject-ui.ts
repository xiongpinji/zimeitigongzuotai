/**
 * 抖音页面注入 UI（设计文档第 6 节，视觉对齐原型 `Sonar 插件适配.dc.html`）。
 *
 * Shadow DOM 隔离样式，固定页面右下角的 Sonar 浮层（找不到稳定锚点时不强改抖音布局）：
 * - 博主主页：加入灵机采风监听 / 已监听 / 正在同步 / 登录失效。
 * - 视频页 / 作品弹层：下载原片 / 入库并分析 / 重点标记。
 * 通过 DouyinClient 与 Service Worker 通信，不触碰认证数据。
 */
import { createChromeRuntimeTransport, createDouyinClient } from '@/client';
import { SonarException, sonarErrorText } from '@/domain/errors';
import { detectPageFromUrl } from '@/adapter/page-detection';
import { runFullCollectInPage } from './collect-in-page';

const HOST_ID = 'sonar-inject-host';

const MARK = `<svg width="11" height="11" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="1.6" fill="#fff"/><circle cx="9" cy="9" r="4.2" stroke="#fff" stroke-opacity=".8" stroke-width="1.3"/></svg>`;

export function injectedUiErrorMessage(error: unknown): string {
  // 透出脱敏 detail（如 ffmpeg / 解码底层报错），否则用户只看到笼统提示、无法排查。
  if (error instanceof SonarException) return sonarErrorText(error.error) ?? error.error.message;
  if (error instanceof Error && error.message) return `扩展连接失败：${error.message}`;
  return '扩展连接失败，请刷新页面重试';
}

export function mountInjectedUi(): void {
  if (document.getElementById(HOST_ID)) return;
  const client = createDouyinClient(createChromeRuntimeTransport());

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'open' });

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <style>
      :host{all:initial}
      .panel{font:500 13px/1.4 -apple-system,"SF Pro Text","PingFang SC",system-ui;
        background:rgba(28,28,30,.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        border:.5px solid rgba(255,255,255,.12);border-radius:13px;padding:11px 12px;
        box-shadow:0 18px 50px -12px rgba(0,0,0,.5);min-width:188px;}
      .head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
      .logo{width:22px;height:22px;border-radius:7px;background:linear-gradient(160deg,#0a84ff,#0a5fd0);
        display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(10,132,255,.35);}
      .brand{font-size:12.5px;font-weight:700;color:#f5f5f7;flex:1;}
      .ctx{font-size:11px;color:#7c7c81;}
      .row{display:flex;gap:7px;}
      button{font:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;
        height:34px;padding:0 14px;border-radius:8px;border:none;white-space:nowrap;}
      .primary{background:rgba(10,132,255,.14);color:#3d9bff;border:1.5px solid #0a84ff;font-weight:600;}
      .primary .logo{width:16px;height:16px;border-radius:5px;box-shadow:none;}
      .solid{background:#0a84ff;color:#fff;font-weight:600;flex:1;}
      .ghost{background:rgba(255,255,255,.07);color:#cfcfd2;border:.5px solid rgba(255,255,255,.12);}
      .icon{width:34px;height:34px;padding:0;background:rgba(255,255,255,.07);color:#cfcfd2;border:.5px solid rgba(255,255,255,.12);font-size:14px;}
      button:disabled{opacity:.5;cursor:default;}
      button:hover:not(:disabled){filter:brightness(1.1);}
      .followed{display:flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-radius:8px;
        background:rgba(48,209,88,.12);border:.5px solid rgba(48,209,88,.35);color:#30d158;font-weight:600;}
      .dot{width:7px;height:7px;border-radius:50%;background:#30d158;}
      .msg{font-size:11px;color:#9aa0a6;margin-top:8px;line-height:1.5;}
      .err{color:#ff9f0a;}
      .spin{display:inline-block;animation:s .8s linear infinite}
      @keyframes s{to{transform:rotate(360deg)}}
      .hidden{display:none;}
    </style>
    <div class="panel">
      <div class="head"><span class="logo">${MARK}</span><span class="brand">灵机采风</span><span class="ctx" id="ctx"></span></div>
      <div class="row" id="actions"></div>
      <div class="msg hidden" id="msg"></div>
    </div>
  `;
  shadow.appendChild(wrap);
  (document.body || document.documentElement).appendChild(host);

  const actions = shadow.getElementById('actions') as HTMLDivElement;
  const ctx = shadow.getElementById('ctx') as HTMLSpanElement;
  const msgEl = shadow.getElementById('msg') as HTMLDivElement;
  const panel = shadow.querySelector('.panel') as HTMLDivElement;

  const setMsg = (t: string, err = false) => {
    msgEl.textContent = t;
    msgEl.classList.toggle('hidden', !t);
    msgEl.classList.toggle('err', err);
  };

  let secUid: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let creatorPollTimer: ReturnType<typeof setTimeout> | null = null;
  let collecting = false;

  // 全量采集：在当前可见页直接滚动加载全部作品（隐藏标签页被 Chrome 暂停渲染、懒加载不触发），
  // onProgress 即时更新浮层；同时把作品幂等入库。
  async function startFullCollect(targetSecUid: string, btn: HTMLButtonElement): Promise<void> {
    if (collecting) return;
    collecting = true;
    btn.disabled = true;
    const label = btn.querySelector('span:last-child') ?? btn;
    const prev = label.textContent;
    setMsg('正在采集，请保持本页在前台…');
    try {
      const r = await runFullCollectInPage(targetSecUid, (p) => {
        if (!p.done) setMsg(`采集中 ${p.collected}${p.total ? '/' + p.total : ''}…`);
      });
      const count = r.total ? `${r.collected}/${r.total}` : `${r.collected} 条`;
      setMsg(r.total && r.collected < r.total ? `已采集 ${count}（当前公开可见）` : `已采集 ${count}`);
    } catch (e) {
      setMsg(injectedUiErrorMessage(e), true);
    } finally {
      collecting = false;
      btn.disabled = false;
      label.textContent = prev;
    }
  }

  async function refresh(): Promise<void> {
    try {
      // 直接按本页 URL 判定（每个标签页显示自己的上下文）；不经 SW 反查「激活标签页」，
      // 后者受窗口焦点影响、在多窗口下会误判而隐藏浮层。
      const page = detectPageFromUrl(window.location.href);
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (creatorPollTimer) {
        clearTimeout(creatorPollTimer);
        creatorPollTimer = null;
      }
      actions.innerHTML = '';
      setMsg('');
      panel.classList.remove('hidden');

      if (page.type === 'video' || page.type === 'video_modal') {
        ctx.textContent = '作品';
        const dl = mkButton('solid', '下载原片');
        dl.onclick = () => run(dl, () => client.downloadVideo(page.awemeId!), '已开始下载');
        const an = mkButton('ghost', '入库并分析');
        an.onclick = () => run(an, () => client.processVideo(page.awemeId!), '已入队分析');
        const flag = mkButton('icon', '★');
        flag.title = '标记重点';
        flag.onclick = () => toggleFlag(page.awemeId!);
        actions.append(dl, an, flag);
      } else if (page.type === 'creator' && page.secUid) {
        secUid = page.secUid;
        ctx.textContent = '抖音主页';
        await renderCreator();
      } else {
        panel.classList.add('hidden');
      }
    } catch (error) {
      actions.innerHTML = '';
      ctx.textContent = '连接失败';
      panel.classList.remove('hidden');
      setMsg(injectedUiErrorMessage(error), true);
      retryTimer ??= setTimeout(() => {
        retryTimer = null;
        void refresh();
      }, 1500);
    }
  }

  async function renderCreator(): Promise<void> {
    if (creatorPollTimer) {
      clearTimeout(creatorPollTimer);
      creatorPollTimer = null;
    }
    actions.innerHTML = '';
    const creator = secUid ? await client.getCreatorBySecUid(secUid).catch(() => null) : null;
    if (!creator) {
      const btn = mkButton('primary', '加入灵机采风监听', true);
      btn.disabled = true;
      actions.append(btn);
      setMsg('正在采集主页资料，请稍候…');
      // 主页资料由 Content Script 读 DOM 提取后异步入库，轮询直到可用再启用按钮。
      creatorPollTimer = setTimeout(() => {
        creatorPollTimer = null;
        void renderCreator();
      }, 1500);
      return;
    }
    const subs = await client.listFollowedCreators().catch(() => []);
    const followed = subs.some((s) => s.creator.id === creator.id);
    if (followed) {
      const tag = document.createElement('div');
      tag.className = 'followed';
      tag.innerHTML = `<span class="dot"></span>已监听`;
      const sync = mkButton('ghost', '同步');
      sync.onclick = () =>
        run(sync, async () => {
          const r = await client.runMonitorOnce(creator.id);
          if (r.circuitBroken) throw new SonarException(r.error ?? { code: 'NOT_LOGGED_IN', message: '需重新登录抖音' });
          return r;
        }, '已同步');
      actions.append(tag, sync);
    } else {
      const btn = mkButton('primary', '加入灵机采风监听', true);
      btn.onclick = () => run(
        btn,
        async () => {
          await client.followCreator({ creator, intervalMinutes: 30 });
          await runFullCollectInPage(creator.secUid, (p) => {
            if (!p.done) setMsg(`采集中 ${p.collected}${p.total ? '/' + p.total : ''}…`);
          });
        },
        '已加入监听并完成主页采集',
        renderCreator,
      );
      actions.append(btn);
    }
    // 全量采集：滚动加载该博主全部作品（修复只采到首屏的问题），后台标签页 + 进度。
    const total = document.querySelector('[data-e2e="user-tab-count"]')?.textContent?.trim();
    const collectBtn = mkButton('ghost', total ? `采集全部 ${total}` : '采集全部作品');
    collectBtn.onclick = () => void startFullCollect(creator.secUid, collectBtn);
    actions.append(collectBtn);
  }

  async function toggleFlag(videoId: string): Promise<void> {
    // 重点标记与其它表面共享 chrome.storage.local（与 ui/video-status 同键）。
    try {
      const KEY = 'sonar.videoStatus';
      const got = await chrome.storage.local.get(KEY);
      const map = (got[KEY] as Record<string, { flagged?: boolean }>) ?? {};
      const next = !map[videoId]?.flagged;
      map[videoId] = { ...map[videoId], flagged: next };
      await chrome.storage.local.set({ [KEY]: map });
      setMsg(next ? '已标记重点' : '已取消标记');
    } catch (e) {
      setMsg(injectedUiErrorMessage(e), true);
    }
  }

  function mkButton(cls: string, label: string, withLogo = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = withLogo ? `<span class="logo">${MARK}</span><span>${label}</span>` : `<span>${label}</span>`;
    return b;
  }

  async function run(btn: HTMLButtonElement, fn: () => Promise<unknown>, ok: string, after?: () => void): Promise<void> {
    btn.disabled = true;
    const label = btn.querySelector('span:last-child') ?? btn;
    const prev = label.textContent;
    label.innerHTML = `<span class="spin">↻</span>`;
    setMsg('');
    try {
      await fn();
      setMsg(ok);
      if (after) after();
      else label.textContent = prev;
    } catch (e) {
      label.textContent = prev;
      setMsg(injectedUiErrorMessage(e), true);
    } finally {
      btn.disabled = false;
    }
  }

  void refresh();
  // 抖音是 SPA，URL 变化时刷新。
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      void refresh();
    }
  }, 1500);
}

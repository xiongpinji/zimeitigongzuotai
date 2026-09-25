import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

/**
 * 灵机采风 的 Manifest V3 定义。
 *
 * 权限与 host_permissions 对应设计文档第 11 节；音频提取使用 ffmpeg.wasm（单线程 core），
 * 在 offscreen document 主线程经经典 <script> 加载并实例化（不经 module worker）。
 * core js / wasm 随扩展本地打包（public/ffmpeg/，经 chrome.runtime.getURL 加载），
 * 不从 CDN 加载远程脚本或 WASM；扩展页 CSP 因 wasm 运行时编译需放开 'wasm-unsafe-eval'。
 *
 * 开发期请根据实际捕获到的 CDN 域名收敛 host_permissions，不使用 <all_urls>。
 */
export default defineManifest({
  manifest_version: 3,
  name: '灵机采风',
  description: '抖音博主监听：发现新作品、解析优先无水印源、下载与本地 AI 转录摘要。',
  version: pkg.version,

  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },

  // 内容脚本观察页面响应；UI 通过 DouyinClient → 消息协议 → Service Worker。
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  action: {
    default_title: '灵机采风',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },

  side_panel: {
    default_path: 'src/side-panel/index.html',
  },

  options_page: 'src/workbench/index.html',

  content_scripts: [
    {
      matches: ['https://www.douyin.com/*'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
  ],

  permissions: [
    'alarms',
    'downloads',
    'declarativeNetRequestWithHostAccess',
    'notifications',
    'offscreen',
    'sidePanel',
    'scripting',
    'storage',
    'tabs',
    'unlimitedStorage',
  ],

  host_permissions: [
    'https://www.douyin.com/*',
    'https://v.douyin.com/*',
    'https://*.iesdouyin.com/*',
    'https://*.snssdk.com/*',
    'https://*.amemv.com/*',
    'https://*.douyinvod.com/*',
    'https://*.douyinpic.com/*',
    // bcut（B 站必剪）零配置转录：主接口 + 分片上传 CDN（boss）。
    // 实测若上传 URL 命中其它域名，需在此补充。
    'https://member.bilibili.com/*',
    'https://*.bilibili.com/*',
    'https://*.hdslb.com/*',
    'https://*.biliapi.net/*',
    // LLM 摘要 / 分析 Provider：SW fetch 带 Authorization 头属非简单请求，会触发
    // CORS 预检；这些 API 不回 ACAO，故必须把各 Provider host 列入 host_permissions，
    // 让 MV3 SW 的跨源请求绕过 CORS（与 provider-presets.ts 的 baseUrl 一一对应）。
    'https://api.openai.com/*',
    'https://api.anthropic.com/*',
    'https://generativelanguage.googleapis.com/*',
    'https://api.deepseek.com/*',
    'https://api.minimaxi.com/*',
    'https://openrouter.ai/*',
    'https://api.x.ai/*',
    'https://api.z.ai/*',
    'https://open.bigmodel.cn/*',
    'https://api.moonshot.ai/*',
    'https://api.moonshot.cn/*',
    'https://api.kimi.com/*',
    'https://*.volces.com/*',
    // LM Studio 本地服务（任意端口）。
    'http://localhost/*',
    'http://127.0.0.1/*',
  ],

  // 扩展页 CSP：仅允许本地脚本，禁止远程脚本；'wasm-unsafe-eval' 供 ffmpeg.wasm 运行时编译。
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },

  // ffmpeg.wasm 本地资源：offscreen document 经 chrome.runtime.getURL（扩展自身源）加载。
  // worker 由 Vite 构建期自动打包并登记，无需在此手写。
  web_accessible_resources: [
    {
      resources: ['ffmpeg/ffmpeg-core.js', 'ffmpeg/ffmpeg-core.wasm'],
      matches: ['https://www.douyin.com/*'],
    },
  ],

  // 说明：PageBridge 通过 content-script 中的 `import '...?script&module'` 注入到页面
  // MAIN world，CRXJS 会自动把它登记进 web_accessible_resources，无需在此手写条目。

  minimum_chrome_version: '116',
});

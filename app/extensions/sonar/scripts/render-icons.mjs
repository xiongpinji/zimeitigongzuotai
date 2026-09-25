// 一次性脚本：把 public/icons/icon.svg 渲染成扩展所需的多尺寸 PNG。
// Chrome MV3 的 manifest icons / action.default_icon 不支持 SVG，必须用位图。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(here, '../public/icons');
const svg = readFileSync(resolve(iconsDir, 'icon.svg'), 'utf8');
const sizes = [16, 32, 48, 128];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  // 背景透明；把 SVG 缩放到目标尺寸，铺满视口。
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style>${svg}`,
    { waitUntil: 'networkidle' },
  );
  const el = await page.$('svg');
  const buf = await el.screenshot({ omitBackground: true, type: 'png' });
  const out = resolve(iconsDir, `icon-${size}.png`);
  writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
}
await browser.close();

/**
 * 把 ffmpeg.wasm 的本地资源复制进 public/ffmpeg/，供扩展通过 chrome.runtime.getURL 加载。
 *
 * 远程代码禁令：core js / wasm / worker 必须随扩展本地打包，不从 CDN 加载。
 * 单线程 core（@ffmpeg/core，非 -mt）——MV3 offscreen 非 cross-origin isolated，无 SharedArrayBuffer。
 * 该脚本在 predev / prebuild 运行，使资源始终与已安装的包版本一致；public/ffmpeg/ 不入库（由本脚本生成）。
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'public/ffmpeg');

// 只复制 core js / wasm；@ffmpeg/ffmpeg 的 worker 由 Vite 构建期打成自包含 chunk，
// 不复制 raw worker.js（其相对 import 在扩展自身源 / blob 下无法解析）。
const assets = [
  ['node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js', 'ffmpeg-core.js'],
  ['node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm', 'ffmpeg-core.wasm'],
];

mkdirSync(outDir, { recursive: true });
for (const [from, to] of assets) {
  copyFileSync(resolve(root, from), resolve(outDir, to));
  console.log(`[copy-ffmpeg-assets] ${to}`);
}

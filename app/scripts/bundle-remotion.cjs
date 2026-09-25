// 构建期预打包 Remotion 合成工程到 dist-remotion/。
// 打包态运行时 webpack 既无法 chdir 进 app.asar 也无法穿透 asar 解析模块，
// 故 bundle 必须在真实文件系统的构建期完成；运行时仅复用该静态产物并注入素材
// （见 electron/remotion/render-video-headless.ts 的 prepareServeUrlFromPrebuilt）。
// 卡片走 inputProps.compiledCards 运行时求值，故产物与具体素材/卡片无关，可复用。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bundle } = require('@remotion/bundler');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-remotion');
// 素材在导出时注入临时站点的 public/，预打包用空 publicDir，避免打进无关文件。
const emptyPublicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingji-remotion-public-'));

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log('开始预打包 Remotion 合成工程 → dist-remotion');
  await bundle({
    entryPoint: path.join(rootDir, 'src', 'remotion', 'index.ts'),
    publicDir: emptyPublicDir,
    outDir,
    webpackOverride: (config) => config,
  });
  console.log('Remotion 预打包完成');
}

main()
  .catch((error) => {
    console.error('Remotion 预打包失败');
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  })
  .finally(() => {
    fs.rmSync(emptyPublicDir, { recursive: true, force: true });
  });

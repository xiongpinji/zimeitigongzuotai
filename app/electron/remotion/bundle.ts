import { bundle } from '@remotion/bundler';

let cachedBundle: { key: string; serveUrl: string } | null = null;

/**
 * 运行时打包 Remotion 合成工程（src/remotion/index.ts），仅用于开发态。
 * 卡片在运行时由 CardHost 通过 inputProps.compiledCards 求值，bundle 结构是静态的；
 * 但素材会 materialize 到每次导出的临时 publicDir，故按 entryPoint + publicDir 作缓存键。
 *
 * 注意：打包态 entryPoint 落在 app.asar 内，webpack 既无法 chdir 进 asar（ENOTDIR），
 * 也无法穿透 asar 解析模块，故运行时 bundle 仅限开发态；打包态改用构建期预打包产物
 * （dist-remotion，见 scripts/bundle-remotion.cjs 与 render-video-headless 的复用逻辑）。
 */
export async function getRemotionBundle(entryPoint: string, publicDir?: string): Promise<string> {
  const key = `${entryPoint}::${publicDir ?? ''}`;
  if (cachedBundle && cachedBundle.key === key) {
    return cachedBundle.serveUrl;
  }
  const serveUrl = await bundle({
    entryPoint,
    publicDir,
    webpackOverride: (config) => config,
  });
  cachedBundle = { key, serveUrl };
  return serveUrl;
}

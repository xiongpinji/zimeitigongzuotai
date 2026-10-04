// 由 electron/main.ts 的 render-video IPC 处理体抽取；无行为变更。
// 唯一改动：三处 `mainWindow?.webContents.send('render-progress', X)` 替换为 `onProgress(X)`。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
import type { ExportConfig } from '../../src/lib/export-settings';
import { buildExportRenderConfig } from '../../src/lib/export-settings';
import type { SrtEntry, TimelineData } from '../../src/types';
import { parseSrt } from '../../src/lib/srt-parser';
import { compileCards, type CompiledCard } from './compile-card-node';
import { getRemotionBundle } from './bundle';
import { renderRemotionVideo } from './render';
import { planRemotionRenderDimensions } from './render-dimensions';
import { collectMotionCards } from '../../src/remotion/collect-cards';
import { hydrateTimelineCards } from '../../src/lib/motion-card-externalize';
import { prepareTimelineForHyperframes, type HyperframesAssetDescriptor } from '../../src/hyperframes/assets';
import {
  collectMotionCardAssets,
  externalizeMotionCardDataUris,
  rewriteMotionCardAssetReferences,
} from './motion-card-assets';

// 以下三个辅助函数由 electron/main.ts 原样迁入（仅 render-video 使用）。

async function materializeRenderAssets(
  publicDir: string,
  assets: HyperframesAssetDescriptor[],
): Promise<void> {
  await Promise.all(
    assets.map(async (asset) => {
      const targetPath = path.join(publicDir, asset.publicPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      try {
        await fs.link(asset.sourcePath, targetPath);
      } catch {
        await fs.copyFile(asset.sourcePath, targetPath);
      }
    }),
  );
}

/**
 * 从 timeline 反推项目目录：podcast-audio.mp3 / podcast-subtitles.srt 都
 * 位于 projectDir 根，用 audioPath 的 dirname 即得（项目硬约定）。
 * 用于把 ai-card MediaCardContent 的相对路径解析为绝对，再做 public 映射。
 */
function inferProjectDirFromTimeline(timeline: TimelineData): string | null {
  const audio = timeline.podcast?.audioPath;
  if (audio && path.isAbsolute(audio)) return path.dirname(audio);
  const srt = timeline.podcast?.srtPath;
  if (srt && path.isAbsolute(srt)) return path.dirname(srt);
  return null;
}

export async function createRenderPublicDir(
  timeline: TimelineData,
  explicitProjectDir?: string | null,
): Promise<{ timeline: TimelineData; publicDir: string }> {
  const projectDir = explicitProjectDir ?? inferProjectDirFromTimeline(timeline);
  const { timeline: renderTimeline, assets } = prepareTimelineForHyperframes(
    timeline,
    projectDir,
  );
  const motionCardAssets = await collectMotionCardAssets(timeline, projectDir);
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingjijianying-public-'));
  await materializeRenderAssets(publicDir, [...assets, ...motionCardAssets]);

  return {
    timeline: renderTimeline,
    publicDir,
  };
}

/** 导出与暂停静帧共用的卡片素材准备，避免两条渲染路径逐渐漂移。 */
export async function hydrateAndExternalizeRenderCards(
  renderTimeline: TimelineData,
  publicDir: string,
  projectDir: string | null,
): Promise<{ timeline: TimelineData; externalizedCount: number }> {
  const timeline = await hydrateTimelineCards(renderTimeline, {
    readFile: async (rel) => {
      if (!projectDir) return null;
      try {
        return await fs.readFile(path.join(projectDir, rel), 'utf-8');
      } catch {
        return null;
      }
    },
  });
  const externalized = new Map<string, Buffer>();
  for (const overlay of timeline.overlays) {
    const motionCard = overlay.aiCardData?.motionCard;
    if (!motionCard?.tsx) continue;
    const source = externalizeMotionCardDataUris(motionCard.tsx, {
      write: (bytes, ext) => {
        const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16);
        const rel = `card-assets/${hash}.${ext}`;
        if (!externalized.has(rel)) externalized.set(rel, bytes);
        return rel;
      },
    });
    motionCard.tsx = rewriteMotionCardAssetReferences(source);
  }
  await Promise.all([...externalized.entries()].map(async ([rel, bytes]) => {
    const target = path.join(publicDir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }));
  return { timeline, externalizedCount: externalized.size };
}

/**
 * 打包态复用构建期预打包的 Remotion 产物（dist-remotion）。
 * 运行时 webpack 既无法 chdir 进 app.asar 也无法穿透 asar 解析模块，故不再运行时 bundle；
 * 改为把只读的预打包站点 copy 到可写临时目录，再把本次导出 materialize 的素材注入其
 * public/（staticFile 解析根），返回该目录作为 Remotion serveUrl。调用方负责清理返回目录。
 *
 * dist-remotion 经 asar-unpack 落在 app.asar.unpacked（真实目录），这里用真实路径 copy：
 * Electron 的 asar 透明层不支持对目录做递归 copy，走 app.asar 虚拟路径会 ENOENT。
 */
export async function prepareServeUrlFromPrebuilt(publicDir: string): Promise<string> {
  const prebuiltDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-remotion');
  const serveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingjijianying-serve-'));
  await fs.cp(prebuiltDir, serveDir, { recursive: true });
  await fs.cp(publicDir, path.join(serveDir, 'public'), { recursive: true });
  return serveDir;
}

/**
 * 打包态 compositor 二进制包名（@remotion/compositor-<platform>-<arch>）。
 * 仅覆盖打包目标 macOS / Windows；其它平台返回 null，回退 Remotion 默认解析。
 */
function compositorPackageName(): string | null {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? '@remotion/compositor-darwin-arm64'
      : '@remotion/compositor-darwin-x64';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return '@remotion/compositor-win32-x64-msvc';
  }
  return null;
}

/**
 * 打包态把 Remotion 二进制目录指向 app.asar.unpacked 真实路径，绕过 asar 的 chmod ENOTDIR。
 * dev 态返回 undefined，沿用 Remotion 默认（真实 node_modules 内的 compositor 包）。
 */
export function resolveRemotionBinariesDirectory(): string | undefined {
  if (!app.isPackaged) return undefined;
  const pkg = compositorPackageName();
  if (!pkg) return undefined;
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', ...pkg.split('/'));
}

/**
 * 准备 Remotion 浏览器下载缓存目录，并返回 chdir 进入的工作目录。
 *
 * 背景：Remotion 内部 `getDownloadsCacheDir()` 会从 `process.cwd()` 向上查找
 * 第一个含 `package.json` 的目录，命中后用 `<dir>/node_modules/.remotion`；
 * 找不到（DMG 启动时 cwd 多为 `/`）则 fallback 到 `path.resolve(cwd, ".remotion")`
 * = `/.remotion`，随后 `mkdir` 因根目录不可写而抛 `ENOENT: no such file or
 * directory, mkdir '/.remotion'`（macOS 上 mkdir 在 `/` 下被禁，会以 ENOENT 报错）。
 *
 * dev 态 cwd 是工程根、有 package.json，所以没问题；打包态必须显式给一个可写根。
 *
 * 方案：在 `<userData>/remotion-cache` 下写一份最小 `package.json`，让 Remotion
 * 把缓存落到 `<userData>/remotion-cache/node_modules/.remotion`，整路径都可写。
 * 调用方在 finally 里 restore 原 cwd，避免长尾影响其他主进程逻辑。
 */
export async function prepareRemotionCwd(): Promise<{ cwd: string } | null> {
  if (!app.isPackaged) return null;
  const cacheRoot = path.join(app.getPath('userData'), 'remotion-cache');
  await fs.mkdir(cacheRoot, { recursive: true });
  const pkgPath = path.join(cacheRoot, 'package.json');
  try {
    await fs.access(pkgPath);
  } catch {
    await fs.writeFile(
      pkgPath,
      JSON.stringify({ name: 'lingjijianying-remotion-cache', private: true, version: '0.0.0' }, null, 2),
    );
  }
  // node_modules 目录也提前创建，Remotion 内部会直接拼 node_modules/.remotion/...，
  // 父目录不存在的话首次 mkdir 仍会 ENOENT（其内部用的不是 recursive）。
  await fs.mkdir(path.join(cacheRoot, 'node_modules'), { recursive: true });
  return { cwd: cacheRoot };
}

let packagedCwdTail: Promise<void> = Promise.resolve();

/** 打包态 Remotion 需要进程级可写 cwd；预览与导出共用同一串行门槛。 */
export async function withPackagedRemotionCwd<T>(work: () => Promise<T>): Promise<T> {
  if (!app.isPackaged) return work();
  const prior = packagedCwdTail;
  let unlock!: () => void;
  packagedCwdTail = new Promise<void>((resolve) => { unlock = resolve; });
  await prior;
  const originalCwd = process.cwd();
  try {
    const remotionCwd = await prepareRemotionCwd();
    if (remotionCwd) process.chdir(remotionCwd.cwd);
    return await work();
  } finally {
    try {
      process.chdir(originalCwd);
    } finally {
      unlock();
    }
  }
}

export interface RenderVideoArgs {
  timeline: string;
  outputPath: string;
  exportConfig: ExportConfig;
  // Renderer 侧 store 中切分后的字幕；若未提供则回退到磁盘原始 SRT。
  // 磁盘 .srt 文件始终保持 MiniMax 原始输出（不写回），所以若只靠主进程重解析
  // 就会忽略用户的字幕重切分结果，与预览播放器不一致。
  srtEntries?: SrtEntry[];
}

export async function renderVideoHeadless(
  args: RenderVideoArgs,
  opts: {
    onProgress?: (fraction: number) => void;
    onMotionCardCompileErrors?: (errors: CompiledCard[], total: number) => void;
    /**
     * 可选 telemetry 钩子，签名与 main.ts 的 makeMainTelemetry 产物兼容。
     * 缺省 no-op。发出 4 个 stage：export.assets / export.compile-cards / export.bundle / export.render。
     */
    telemetry?: { emit: (kind: string, extra?: Record<string, unknown>) => void };
  } = {},
): Promise<{ outputPath: string }> {
  const onProgress = opts.onProgress ?? (() => {});
  const tel = opts.telemetry ?? { emit: () => undefined };

  const isDev = !app.isPackaged;
  const renderLogPrefix = '[render-video]';
  const renderStartedAt = Date.now();
  const timestamp = () => `${((Date.now() - renderStartedAt) / 1000).toFixed(2)}s`;

  const timelineData = JSON.parse(args.timeline) as TimelineData;
  const srtEntries =
    args.srtEntries && args.srtEntries.length > 0
      ? args.srtEntries
      : timelineData.podcast.srtPath
        ? parseSrt(await fs.readFile(timelineData.podcast.srtPath, 'utf-8'))
        : [];

  const cpuCount = os.cpus().length;
  // 帧渲染是 Chromium 截图主导的 CPU 任务；cpu-2 给系统留一点喘息，避免输入卡顿。
  const explicitConcurrency = Math.max(1, cpuCount - 2);

  // 把 UI 档位（resolution + quality）展开成完整的渲染配置：
  // - x264Preset / videoBitrate / audioBitrate 直接落到 renderMedia；
  // - 三档统一走 videoBitrate + hardwareAcceleration:'if-possible'，能 GPU 编码就 GPU，
  //   不能则自动回退软编（Remotion crf.js:50 校验：videoBitrate 与 crf 互斥）。
  const renderConfig = buildExportRenderConfig({
    timelineWidth: timelineData.width,
    timelineHeight: timelineData.height,
    resolution: args.exportConfig.resolution,
    quality: args.exportConfig.quality,
  });
  // React 树仍按时间线原始尺寸排版；Remotion 先用偶数整数栅格截帧，
  // 不可整除的目标尺寸（例如 1920×1080 → 854×480）在 FFmpeg 拼帧时精确缩放。
  const renderPlan = planRemotionRenderDimensions(
    timelineData.width,
    timelineData.height,
    renderConfig.renderWidth,
    renderConfig.renderHeight,
  );

  if (isDev) {
    console.log(`${renderLogPrefix} 开始导出`, {
      outputPath: args.outputPath,
      resolution: args.exportConfig.resolution,
      quality: args.exportConfig.quality,
      timelineSize: `${timelineData.width}x${timelineData.height}`,
      exportSize: `${renderConfig.renderWidth}x${renderConfig.renderHeight}`,
      scale: renderPlan.scale,
      rasterSize: `${renderPlan.rasterWidth}x${renderPlan.rasterHeight}`,
      x264Preset: renderConfig.x264Preset,
      videoBitrate: renderConfig.videoBitrate,
      audioBitrate: renderConfig.audioBitrate,
      hardwareAcceleration: 'if-possible',
      cpuCount,
      explicitConcurrency,
      platform: process.platform,
      arch: process.arch,
    });
  }

  // ── stage: export.assets ──────────────────────────────────────────
  const assetsStart = Date.now();
  tel.emit('stage.start', {
    stage: 'export.assets',
    resolution: args.exportConfig.resolution,
    quality: args.exportConfig.quality,
    renderWidth: renderConfig.renderWidth,
    renderHeight: renderConfig.renderHeight,
    scale: renderPlan.scale,
    rasterWidth: renderPlan.rasterWidth,
    rasterHeight: renderPlan.rasterHeight,
  });
  const projectPrepStart = assetsStart;
  // materialize 资源到临时 publicDir，并把 timeline 内绝对素材路径改写为 assets/... 相对路径。
  const { timeline: renderTimeline, publicDir } = await createRenderPublicDir(timelineData);
  // 打包态复用预打包 Remotion 产物时会 copy 出可写临时站点目录，导出后在 finally 清理。
  let prebuiltServeDir: string | undefined;
  const projectDir = inferProjectDirFromTimeline(timelineData);
  const { timeline: hydratedTimeline, externalizedCount } = await hydrateAndExternalizeRenderCards(
    renderTimeline, publicDir, projectDir,
  );
  if (isDev && externalizedCount > 0) {
    console.log(
      `${renderLogPrefix} 外置卡片内联图片 ${externalizedCount} 个 → ${publicDir}/card-assets`,
    );
  }
  tel.emit('stage.end', {
    stage: 'export.assets',
    durationMs: Date.now() - assetsStart,
    ok: true,
    externalizedCardAssets: externalizedCount,
  });

  try {
    // ── stage: export.compile-cards ─────────────────────────────────
    const compileStart = Date.now();
    // 编译 motion 卡片 TSX → CJS，随 inputProps 传入 Remotion，由 CardHost 在无头 Chrome 内求值。
    const cardSources = collectMotionCards(hydratedTimeline);
    tel.emit('stage.start', { stage: 'export.compile-cards', total: cardSources.length });
    const compiledCards = await compileCards(cardSources, {
      onCompileErrors: opts.onMotionCardCompileErrors,
    });
    tel.emit('stage.end', {
      stage: 'export.compile-cards',
      durationMs: Date.now() - compileStart,
      ok: true,
      total: cardSources.length,
      compiled: Object.keys(compiledCards).length,
    });
    if (isDev) {
      console.log(
        `${renderLogPrefix} 资源准备完成 耗时=${(
          (Date.now() - projectPrepStart) / 1000
        ).toFixed(2)}s cards=${cardSources.length} @${timestamp()}`,
      );
    }

    // ── stage: export.bundle ────────────────────────────────────────
    const bundleStart = Date.now();
    tel.emit('stage.start', { stage: 'export.bundle' });
    let serveUrl: string;
    try {
      if (isDev) {
        // 开发态：源码在真实磁盘，运行时 bundle src/remotion。
        const remotionEntry = path.join(app.getAppPath(), 'src', 'remotion', 'index.ts');
        serveUrl = await getRemotionBundle(remotionEntry, publicDir);
      } else {
        // 打包态：复用构建期预打包产物，避开 app.asar 内运行时 webpack。
        prebuiltServeDir = await prepareServeUrlFromPrebuilt(publicDir);
        serveUrl = prebuiltServeDir;
      }
      tel.emit('stage.end', {
        stage: 'export.bundle',
        durationMs: Date.now() - bundleStart,
        ok: true,
      });
    } catch (err) {
      tel.emit('stage.end', {
        stage: 'export.bundle',
        durationMs: Date.now() - bundleStart,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // ── stage: export.render ────────────────────────────────────────
    const renderStart = Date.now();
    tel.emit('stage.start', {
      stage: 'export.render',
      concurrency: explicitConcurrency,
      hardwareAcceleration: 'if-possible',
    });
    onProgress(0.05);
    try {
      await withPackagedRemotionCwd(() => renderRemotionVideo({
        serveUrl,
        outputPath: args.outputPath,
        timeline: renderTimeline,
        srtEntries,
        compiledCards,
        renderPlan,
        x264Preset: renderConfig.x264Preset,
        videoBitrate: renderConfig.videoBitrate,
        audioBitrate: renderConfig.audioBitrate,
        concurrency: explicitConcurrency,
        hardwareAcceleration: 'if-possible',
        binariesDirectory: resolveRemotionBinariesDirectory(),
        onProgress: (ratio) => onProgress(Math.max(0.05, Math.min(0.98, ratio))),
      }));
      onProgress(1);
      tel.emit('stage.end', {
        stage: 'export.render',
        durationMs: Date.now() - renderStart,
        ok: true,
      });
    } catch (err) {
      tel.emit('stage.end', {
        stage: 'export.render',
        durationMs: Date.now() - renderStart,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (isDev) {
      console.log(
        `${renderLogPrefix} remotion render 完成 总耗时=${((Date.now() - renderStart) / 1000).toFixed(2)}s`,
      );
    }

    return { outputPath: args.outputPath };
  } catch (err) {
    if (isDev) {
      console.error(`${renderLogPrefix} 导出失败 @${timestamp()}`, err);
    }
    throw err;
  } finally {
    await fs.rm(publicDir, { recursive: true, force: true });
    if (prebuiltServeDir) {
      await fs.rm(prebuiltServeDir, { recursive: true, force: true });
    }
  }
}

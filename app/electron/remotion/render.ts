import { selectComposition, renderMedia } from '@remotion/renderer';
import type { SrtEntry, TimelineData } from '../../src/types';
import {
  insertOutputScaleFilter,
  type RemotionRenderDimensionPlan,
} from './render-dimensions';

export interface RemotionRenderParams {
  serveUrl: string;
  outputPath: string;
  timeline: TimelineData;
  srtEntries: SrtEntry[];
  compiledCards: Record<string, string>;
  /** 先以偶数整数栅格截帧，必要时在 FFmpeg 拼帧中缩至精确导出尺寸。 */
  renderPlan: RemotionRenderDimensionPlan;
  /** x264 编码 preset；硬件加速可用时 ffmpeg 会忽略，但软编回退仍受益。 */
  x264Preset: 'ultrafast' | 'veryfast' | 'medium';
  /** 视频码率，形如 '1800k' / '3000k' / '4500k'；与 crf 互斥，硬件加速路径下必填。 */
  videoBitrate: string;
  audioBitrate: string;
  concurrency: number;
  /**
   * 硬件加速策略：'if-possible' 表示能用就用、不能就软编回退，零失败风险；
   * 'disable' 强制软编；'required' 拿不到 GPU 时直接报错。
   */
  hardwareAcceleration: 'disable' | 'if-possible' | 'required';
  /**
   * 打包态：Remotion 的 compositor / ffmpeg / ffprobe 二进制经 asar-unpack 落在
   * app.asar.unpacked，但 Remotion 默认用 require('@remotion/compositor-*').dir 得到
   * app.asar 逻辑路径，启动时 chmod 该路径会 ENOTDIR（asar 是文件非目录、未被重定向）。
   * 显式指向 unpacked 真实目录绕过 asar；dev 态为 undefined，沿用 Remotion 默认。
   */
  binariesDirectory?: string;
  onProgress?: (ratio: number) => void;
}

const COMPOSITION_ID = 'lingji-composition';

export async function renderRemotionVideo(params: RemotionRenderParams): Promise<void> {
  const inputProps = {
    timeline: params.timeline,
    srtEntries: params.srtEntries,
    compiledCards: params.compiledCards,
  };

  const composition = await selectComposition({
    serveUrl: params.serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    binariesDirectory: params.binariesDirectory ?? null,
  });

  await renderMedia({
    composition,
    serveUrl: params.serveUrl,
    codec: 'h264',
    outputLocation: params.outputPath,
    inputProps,
    concurrency: Math.max(1, params.concurrency),
    scale: params.renderPlan.scale,
    // 需要 FFmpeg 缩放时，预编码路径会在 stitcher 使用 -c:v copy，无法再应用 -vf。
    disallowParallelEncoding: params.renderPlan.needsFinalScale,
    ffmpegOverride: ({ type, args }) =>
      type === 'stitcher' ? insertOutputScaleFilter(args, params.renderPlan) : args,
    x264Preset: params.x264Preset,
    // buildExportRenderConfig 产出的字符串始终满足 Remotion 的 Bitrate 模板类型（如 '1800k'），
    // 这里 as 收窄一下，TS 才不会因为返回值是普通 string 而拒绝。
    videoBitrate: params.videoBitrate as `${number}k`,
    audioBitrate: params.audioBitrate as `${number}k`,
    hardwareAcceleration: params.hardwareAcceleration,
    binariesDirectory: params.binariesDirectory ?? null,
    chromiumOptions: { ignoreCertificateErrors: false },
    onProgress: ({ progress }) => params.onProgress?.(progress),
  });
}

import path from 'node:path';
import { getImageProvider } from '../src/lib/image-gen/registry';
import { getVideoProvider } from '../src/lib/video-gen/registry';
import { resolvePromptBinding } from '../src/lib/llm/binding-resolver';
import {
  ensureCardAssetDir,
  writeCardImage,
  writeCardMeta,
  writeCardVideo,
  writeCardPoster,
} from './ai-card-assets';
import type {
  AISettings,
  MediaCardContent,
  PromptBindingMap,
  ImageAspectRatio,
  VideoAspectRatio,
} from '../src/types/ai';
import type {
  ImageGenerationContext,
  ImageGenerationProgressUpdate,
} from '../src/lib/image-gen/types';
import type {
  VideoGenerationContext,
  VideoGenerationProgressUpdate,
} from '../src/lib/video-gen/types';
import { resolveFfmpegPath } from './runtime-binaries';

export interface GenerateCardImageArgs {
  projectDir: string;
  cardId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: ImageAspectRatio;
  providerId?: string | null;
  model?: string | null;
  extraParams?: Record<string, unknown>;
}

export interface CardMediaHandlerCtx {
  settings: AISettings;
  projectBindings: PromptBindingMap | null;
  onProgress: (u: ImageGenerationProgressUpdate) => void;
  signal?: AbortSignal;
}

export async function handleGenerateCardImage(
  args: GenerateCardImageArgs,
  ctx: CardMediaHandlerCtx,
): Promise<MediaCardContent> {
  // 优先使用调用方显式指定的 providerId / model；否则走 card.image binding 回退
  let providerId = args.providerId ?? null;
  let model = args.model ?? null;

  if (!providerId || !model) {
    try {
      const binding = resolvePromptBinding('card.image', ctx.settings, ctx.projectBindings);
      if (!providerId) providerId = binding.imageProvider?.id ?? null;
      if (!model) model = binding.imageModel ?? null;
    } catch (err) {
      // resolvePromptBinding 在缺 LLM provider 时也会抛——card.image 实际只关心 image binding，
      // 因此只把 image binding missing 作为致命错误向上抛。
      throw err;
    }
  }

  const provider = providerId
    ? ctx.settings.imageProviders.find((p) => p.id === providerId) ?? null
    : null;
  if (!provider) {
    throw new Error('card.image 未绑定 ImageProvider');
  }
  if (!model) {
    throw new Error('card.image 未指定模型');
  }

  await ensureCardAssetDir(args.projectDir, args.cardId);

  const adapter = getImageProvider(provider.type);
  const signal = ctx.signal ?? new AbortController().signal;
  const igCtx: ImageGenerationContext = {
    taskId: `card-image-${args.cardId}`,
    signal,
    onProgress: ctx.onProgress,
  };
  const result = await adapter.generate(
    {
      prompt: args.prompt,
      model,
      aspectRatio: args.aspectRatio,
      n: 1,
      extraParams: args.extraParams,
    },
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extras: provider.extras },
    igCtx,
  );

  const img = result.images[0];
  if (!img) throw new Error('image provider 未返回图片');
  const buf = await imageToBuffer(img);
  ctx.onProgress({ percent: 95, phase: 'downloading', message: '保存图片…' });
  const assetPath = await writeCardImage(args.projectDir, args.cardId, buf);
  const generatedAt = Date.now();
  await writeCardMeta(args.projectDir, args.cardId, {
    cardId: args.cardId,
    mediaType: 'image',
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    aspectRatio: args.aspectRatio,
    generatedAt,
    extras: args.extraParams,
  });
  ctx.onProgress({ percent: 100, phase: 'rendering', message: '完成' });

  return {
    mediaType: 'image',
    assetPath,
    aspectRatio: args.aspectRatio,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    generationStatus: 'ready',
    generatedAt,
    extraParams: args.extraParams,
  };
}

async function imageToBuffer(img: {
  url?: string;
  base64?: string;
  mimeType?: string;
}): Promise<Buffer> {
  if (img.base64) return Buffer.from(img.base64, 'base64');
  if (img.url) {
    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('image 既没有 base64 也没有 url');
}

export interface GenerateCardVideoArgs {
  projectDir: string;
  cardId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  providerId?: string | null;
  model?: string | null;
  extraParams?: Record<string, unknown>;
}

export interface CardVideoHandlerCtx {
  settings: AISettings;
  projectBindings: PromptBindingMap | null;
  onProgress: (u: VideoGenerationProgressUpdate) => void;
  signal?: AbortSignal;
}

export async function handleGenerateCardVideo(
  args: GenerateCardVideoArgs,
  ctx: CardVideoHandlerCtx,
): Promise<MediaCardContent> {
  let providerId = args.providerId ?? null;
  let model = args.model ?? null;

  if (!providerId || !model) {
    const binding = resolvePromptBinding('card.video', ctx.settings, ctx.projectBindings);
    if (!providerId) providerId = binding.videoProvider?.id ?? null;
    if (!model) model = binding.videoModel ?? null;
  }

  const provider = providerId
    ? ctx.settings.videoProviders.find((p) => p.id === providerId) ?? null
    : null;
  if (!provider) {
    throw new Error('card.video 未绑定 VideoProvider');
  }
  if (!model) {
    throw new Error('card.video 未指定模型');
  }

  await ensureCardAssetDir(args.projectDir, args.cardId);

  const adapter = getVideoProvider(provider.type);
  const signal = ctx.signal ?? new AbortController().signal;
  const vgCtx: VideoGenerationContext = {
    taskId: `card-video-${args.cardId}`,
    signal,
    onProgress: ctx.onProgress,
  };
  const result = await adapter.generate(
    {
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      model,
      aspectRatio: args.aspectRatio,
      durationSeconds: args.durationSeconds,
      extraParams: args.extraParams,
    },
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extras: provider.extras },
    vgCtx,
  );

  ctx.onProgress({ percent: 92, phase: 'downloading', message: '下载视频…' });
  const videoRes = await fetch(result.videoUrl);
  if (!videoRes.ok) {
    throw new Error(`下载视频失败 HTTP ${videoRes.status}`);
  }
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());
  const assetPath = await writeCardVideo(args.projectDir, args.cardId, videoBuf);

  let posterPath: string | undefined;
  if (result.posterUrl) {
    try {
      const posterRes = await fetch(result.posterUrl);
      if (posterRes.ok) {
        const posterBuf = Buffer.from(await posterRes.arrayBuffer());
        posterPath = await writeCardPoster(args.projectDir, args.cardId, posterBuf);
      }
    } catch {
      // 海报下载失败不影响主流程，回退到 ffmpeg 抽帧
      posterPath = undefined;
    }
  }
  if (!posterPath) {
    ctx.onProgress({ percent: 96, phase: 'postprocessing', message: '抽取首帧…' });
    posterPath = await extractPosterWithFfmpeg(args.projectDir, args.cardId);
  }

  const generatedAt = Date.now();
  await writeCardMeta(args.projectDir, args.cardId, {
    cardId: args.cardId,
    mediaType: 'video',
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    aspectRatio: args.aspectRatio,
    durationSeconds: args.durationSeconds,
    mediaDurationMs: result.durationMs,
    width: result.width,
    height: result.height,
    generatedAt,
    extras: args.extraParams,
  });
  ctx.onProgress({ percent: 100, phase: 'rendering', message: '完成' });

  return {
    mediaType: 'video',
    assetPath,
    posterPath: posterPath ?? null,
    mediaDurationMs: result.durationMs,
    aspectRatio: args.aspectRatio,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    providerId: provider.id,
    model,
    generationStatus: 'ready',
    generatedAt,
    extraParams: args.extraParams,
  };
}

async function extractPosterWithFfmpeg(
  projectDir: string,
  cardId: string,
): Promise<string | undefined> {
  try {
    const { spawn } = await import('node:child_process');
    const ffmpegPath = resolveFfmpegPath({
      appPath: process.defaultApp ? process.cwd() : path.resolve(__dirname, '..'),
      resourcesPath: process.resourcesPath ?? '',
      cwd: process.cwd(),
      moduleDir: __dirname,
    }) ?? 'ffmpeg';
    const inFile = path.join(projectDir, 'ai-cards', cardId, 'video.mp4');
    const outFile = path.join(projectDir, 'ai-cards', cardId, 'poster.jpg');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        '-y',
        '-i',
        inFile,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        outFile,
      ]);
      proc.on('error', reject);
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    });
    return path.relative(projectDir, outFile);
  } catch {
    return undefined;
  }
}

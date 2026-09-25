import type { ImageProviderType } from '../../types/ai';
import { ImageGenerationError } from './errors';
import { apimartImageProvider } from './providers/apimart';
import { doubaoImageProvider } from './providers/doubao';
import { imagenImageProvider } from './providers/imagen';
import { jimengProvider } from './providers/jimeng';
import { minimaxImageProvider } from './providers/minimax';
import { openaiImageProvider } from './providers/openai';
import { wanxImageProvider } from './providers/wanx';
import type { ImageGenerationProvider } from './types';

const providers = new Map<ImageProviderType, ImageGenerationProvider>();

export function registerImageProvider(provider: ImageGenerationProvider): void {
  providers.set(provider.type, provider);
}

/** 内置 7 个 provider：jimeng + openai + minimax + doubao + imagen + wanx + apimart */
registerImageProvider(jimengProvider);
registerImageProvider(openaiImageProvider);
registerImageProvider(minimaxImageProvider);
registerImageProvider(doubaoImageProvider);
registerImageProvider(imagenImageProvider);
registerImageProvider(wanxImageProvider);
registerImageProvider(apimartImageProvider);

export function getImageProvider(type: ImageProviderType): ImageGenerationProvider {
  // custom 视为 OpenAI 兼容端点：复用 openai_image adapter
  if (type === 'custom') {
    const openai = providers.get('openai_image');
    if (openai) return openai;
    throw new ImageGenerationError(
      'invalid_request',
      type,
      'custom provider 需要 openai_image adapter，但尚未注册',
    );
  }
  const p = providers.get(type);
  if (!p) {
    throw new ImageGenerationError(
      'invalid_request',
      type,
      `未注册的 image provider type: ${type}`,
    );
  }
  return p;
}

export function listRegisteredImageProviderTypes(): ImageProviderType[] {
  return Array.from(providers.keys());
}

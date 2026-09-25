// 脚本工作台文件树可打开的媒体类型判定。
// 图片 / 音频文件不走文本编辑器，而是在主区域用 <img> / 音频播放器预览。

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|ico|webp|svg|avif)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXT.test(filePath);
}

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXT.test(filePath);
}

/** 图片或音频：可在工作台主区域以媒体预览方式打开（非文本编辑）。 */
export function isMediaPreviewFile(filePath: string): boolean {
  return isImageFile(filePath) || isAudioFile(filePath);
}

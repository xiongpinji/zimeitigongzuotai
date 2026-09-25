let offscreenCreation: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  offscreenCreation ??= chrome.offscreen.createDocument({
    url: 'src/offscreen/index.html',
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: '抓取抖音视频并提取 WAV 音频供下载与 bcut 字幕转录',
  }).finally(() => { offscreenCreation = null; });
  await offscreenCreation;
}

import { describe, expect, it } from 'vitest';
import { injectedUiErrorMessage } from '@/content/inject-ui';
import { SonarException, makeError } from '@/domain/errors';

describe('injectedUiErrorMessage', () => {
  it('shows the normalized Sonar error to the user', () => {
    expect(injectedUiErrorMessage(new SonarException(makeError('DOWNLOAD_FAILED', '视频源不可用'))))
      .toBe('视频源不可用');
  });

  it('appends the diagnostic detail so the real failure cause is visible', () => {
    const error = new SonarException(
      makeError('AUDIO_EXTRACTION_FAILED', '浏览器音频提取失败', { detail: 'ffmpeg 退出码 1' }),
    );
    expect(injectedUiErrorMessage(error)).toBe('浏览器音频提取失败（ffmpeg 退出码 1）');
  });

  it('keeps the browser runtime failure detail instead of silently hiding the panel', () => {
    expect(injectedUiErrorMessage(new Error('Could not establish connection')))
      .toBe('扩展连接失败：Could not establish connection');
  });
});

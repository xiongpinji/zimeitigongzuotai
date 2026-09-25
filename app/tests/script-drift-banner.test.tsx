import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptDriftBanner } from '../src/components/ScriptDriftBanner';

/**
 * 注意：测试环境为 vitest node，不带 jsdom，useEffect 不会执行。
 * SSR 只能断言"首帧未渲染"（初始 drifted=false 返回 null）。
 * 真实漂移检测逻辑由 script-hash 的纯函数测试覆盖；此文件仅断言
 * 组件的首帧契约：没有异步加载完成前，不会闪出横幅。
 */

function makeLoader(overrides: Partial<{
  loadScriptFile: (projectDir: string, filename: string) => Promise<string | null>;
  loadProject: (projectDir: string) => Promise<string>;
  getFileMtime: (filePath: string) => Promise<number | null>;
}> = {}) {
  return {
    loadScriptFile: overrides.loadScriptFile ?? vi.fn().mockResolvedValue(null),
    loadProject: overrides.loadProject ?? vi.fn().mockResolvedValue('{}'),
    getFileMtime: overrides.getFileMtime ?? vi.fn().mockResolvedValue(null),
  };
}

describe('ScriptDriftBanner', () => {
  it('首帧不渲染任何内容（等待 effect 检测后再显示）', () => {
    const html = renderToStaticMarkup(
      <ScriptDriftBanner
        projectDir="/proj"
        podcastAudioPath="/proj/podcast-audio.mp3"
        podcastSrtPath="/proj/podcast-subtitles.srt"
        workflowStep="idle"
        onRegenerate={() => {}}
        loader={makeLoader()}
      />,
    );
    expect(html).toBe('');
  });

  it('缺少 projectDir / 音频 / 字幕时不渲染', () => {
    const html = renderToStaticMarkup(
      <ScriptDriftBanner
        projectDir=""
        podcastAudioPath=""
        podcastSrtPath=""
        workflowStep="idle"
        onRegenerate={() => {}}
        loader={makeLoader()}
      />,
    );
    expect(html).toBe('');
  });

  it('workflow 运行中（tts_generating 等）也不渲染', () => {
    const html = renderToStaticMarkup(
      <ScriptDriftBanner
        projectDir="/proj"
        podcastAudioPath="/proj/podcast-audio.mp3"
        podcastSrtPath="/proj/podcast-subtitles.srt"
        workflowStep="tts_generating"
        onRegenerate={() => {}}
        loader={makeLoader()}
      />,
    );
    expect(html).toBe('');
  });
});

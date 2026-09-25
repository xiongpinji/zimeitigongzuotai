// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimelineAudioWaveform } from '../src/components/TimelineAudioWaveform';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 模拟 wavesurfer.js 动态 import：稳定返回一组峰值，避免真实音频解码。
vi.mock('wavesurfer.js', () => ({
  default: {
    create: () => ({
      load: async () => {},
      exportPeaks: () => [[0.2, 0.9, 0.5, 0.8, 0.3]],
      destroy: () => {},
    }),
  },
}));

describe('TimelineAudioWaveform', () => {
  it('renders a waveform shell while async peaks are not loaded yet', () => {
    const html = renderToStaticMarkup(
      <TimelineAudioWaveform
        audioPath="/tmp/podcast.mp3"
        durationMs={12_000}
        trackWidth={800}
        trackHeight={38}
      />,
    );

    expect(html).toContain('data-waveform-shell="true"');
  });

  describe('deferLoading 行为（播放中）', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    // 冲刷 scheduleWaveformLoad 的 setTimeout(0) 宏任务 + 动态 import/load 的微任务链。
    const flush = async () => {
      for (let i = 0; i < 6; i += 1) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    };

    afterEach(() => {
      act(() => root?.unmount());
      container?.remove();
      container = null;
      root = null;
    });

    it('保留已渲染的波形柱状图，播放开始（deferLoading 翻 true）时不清空', async () => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      // 1) 未播放：加载峰值并渲染柱状图。
      await act(async () => {
        root!.render(
          <TimelineAudioWaveform
            audioPath="/tmp/podcast.mp3"
            durationMs={12_000}
            trackWidth={800}
            trackHeight={38}
            deferLoading={false}
            loadDelayMs={0}
          />,
        );
      });
      // 等待动态 import + load + setPeaks 落地。
      await flush();

      const barsBefore = container.querySelectorAll('span').length;
      expect(barsBefore).toBeGreaterThan(0);

      // 2) 开始播放：deferLoading 翻 true，柱状图必须保留（回归点）。
      await act(async () => {
        root!.render(
          <TimelineAudioWaveform
            audioPath="/tmp/podcast.mp3"
            durationMs={12_000}
            trackWidth={800}
            trackHeight={38}
            deferLoading={true}
            loadDelayMs={0}
          />,
        );
      });

      const barsAfter = container.querySelectorAll('span').length;
      expect(barsAfter).toBe(barsBefore);
    });
  });
});

import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimelineAIOverlay } from '../src/components/TimelineAIOverlay';
import { DEFAULT_WORKFLOW, useAIStore } from '../src/store/ai';
import { useTimelineStore } from '../src/store/timeline';
import { createDefaultTimeline } from '../src/types';

describe('TimelineAIOverlay', () => {
  beforeEach(() => {
    useAIStore.setState({
      analysisResult: null,
      workflow: { ...DEFAULT_WORKFLOW },
    });
    useTimelineStore.setState((state) => ({
      ...state,
      timeline: createDefaultTimeline(),
    }));
  });

  it('renders only an interaction blocker during active workflow states', () => {
    const html = renderToStaticMarkup(
      <TimelineAIOverlay
        workflow={{
          step: 'arranging',
          progress: 72,
          stepLabel: '正在排布时间轴…',
          error: null,
          canCancel: false,
        }}
        timelineContainerRef={createRef<HTMLDivElement>()}
        compactTimeline={false}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain('data-editor-region="workflow-blocker"');
    expect(html).not.toContain('72%');
    expect(html).not.toContain('正在排布时间轴');
  });

  it('does not block the editor when workflow has failed', () => {
    const html = renderToStaticMarkup(
      <TimelineAIOverlay
        workflow={{
          step: 'error',
          progress: 0,
          stepLabel: '',
          error: '失败',
          canCancel: false,
        }}
        timelineContainerRef={createRef<HTMLDivElement>()}
        compactTimeline={false}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(html).toBe('');
  });
});

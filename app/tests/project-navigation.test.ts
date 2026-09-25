import { describe, expect, it } from 'vitest';
import { resolveProjectLandingPage } from '../src/lib/project-navigation';
import type { ProjectData } from '../src/lib/project-persistence';

function createProjectData(overrides?: Partial<ProjectData>): ProjectData {
  return {
    version: 1,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    timeline: null,
    aiAnalysis: {
      analysisResult: null,
      coverCandidates: [],
    },
    script: {
      templateId: 'news-broadcast',
      annotations: [],
      reviewState: 'idle',
      lastReviewedDocVersion: 0,
    },
    ...overrides,
  };
}

describe('resolveProjectLandingPage', () => {
  it('routes empty projects to the script workbench', () => {
    expect(resolveProjectLandingPage(createProjectData())).toBe('script-workbench');
  });

  it('routes projects with audio and subtitles to the script workbench', () => {
    expect(
      resolveProjectLandingPage(
        createProjectData({
          timeline: {
            width: 1920,
            height: 1080,
            background: '#000000',
            podcast: {
              audioPath: '/tmp/demo.mp3',
              srtPath: '/tmp/demo.srt',
              durationMs: 12_000,
            },
            tracks: [],
            overlays: [],
            subtitleStyle: {
              fontSize: 64,
              color: '#ffffff',
              activeColor: '#ffd54f',
              fontFamily: 'Inter',
              backgroundColor: 'rgba(0,0,0,0.35)',
            },
            subtitleHighlights: [],
          },
        }),
      ),
    ).toBe('script-workbench');
  });
});

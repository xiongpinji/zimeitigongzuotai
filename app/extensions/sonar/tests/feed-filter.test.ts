import { describe, expect, it } from 'vitest';
import { filterVideosByCreators } from '@/workbench/Feed';
import { video } from './_repository-contract';

describe('feed creator filter', () => {
  const videos = [
    video({ id: 'v1', creatorId: 'c1' }),
    video({ id: 'v2', creatorId: 'c2' }),
    video({ id: 'v3', creatorId: 'c3' }),
  ];

  it('shows all videos when no creator is selected', () => {
    expect(filterVideosByCreators(videos, []).map((item) => item.id)).toEqual(['v1', 'v2', 'v3']);
  });

  it('shows videos belonging to any selected creator', () => {
    expect(filterVideosByCreators(videos, ['c1', 'c3']).map((item) => item.id)).toEqual(['v1', 'v3']);
  });
});

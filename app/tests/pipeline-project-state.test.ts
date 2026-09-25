import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeProjectState } from '../electron/pipeline/algorithms/project-state';

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'lingji-pstate-'));
}

describe('computeProjectState', () => {
  let dir: string;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns all-false when project is empty', async () => {
    const s = await computeProjectState(dir);
    expect(s).toEqual({
      has_original: false,
      has_script: false,
      has_audio: false,
      has_subtitles: false,
      has_analysis: false,
      has_covers: false,
      has_cards: false,
      has_timeline: false,
      last_export: null,
    });
  });

  it('detects original.md only when non-empty', async () => {
    writeFileSync(path.join(dir, 'original.md'), '');
    expect((await computeProjectState(dir)).has_original).toBe(false);
    writeFileSync(path.join(dir, 'original.md'), 'content');
    expect((await computeProjectState(dir)).has_original).toBe(true);
  });

  it('detects audio / subtitles by file existence', async () => {
    writeFileSync(path.join(dir, 'podcast-audio.mp3'), '');
    writeFileSync(path.join(dir, 'podcast-subtitles.srt'), 'x');
    const s = await computeProjectState(dir);
    expect(s.has_audio).toBe(true);
    expect(s.has_subtitles).toBe(true);
  });

  it('reads has_analysis / has_cards / has_timeline from project.json', async () => {
    writeFileSync(
      path.join(dir, 'project.json'),
      JSON.stringify({
        version: 1,
        timeline: { tracks: [{ overlays: [{ id: 'o' }] }] },
        aiAnalysis: {
          analysisResult: { subtitleAnalysis: { segments: [] }, cards: [{ id: 'c' }] },
        },
        script: {},
      }),
    );
    const s = await computeProjectState(dir);
    expect(s.has_analysis).toBe(true);
    expect(s.has_cards).toBe(true);
    expect(s.has_timeline).toBe(true);
  });

  it('detects covers/ when image files exist', async () => {
    mkdirSync(path.join(dir, 'covers'));
    writeFileSync(path.join(dir, 'covers/a.png'), '');
    expect((await computeProjectState(dir)).has_covers).toBe(true);
  });

  it('returns the most recent .mp4 path as last_export', async () => {
    const oldMp4 = path.join(dir, 'old.mp4');
    const newMp4 = path.join(dir, 'new.mp4');
    writeFileSync(oldMp4, '');
    writeFileSync(newMp4, '');
    const past = new Date('2025-01-01T00:00:00Z');
    const future = new Date('2026-01-01T00:00:00Z');
    utimesSync(oldMp4, past, past);
    utimesSync(newMp4, future, future);
    expect((await computeProjectState(dir)).last_export).toBe(newMp4);
  });
});

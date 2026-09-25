import { describe, expect, it } from 'vitest';
import {
  isReusablePodcastMedia,
  readStoredExistingMediaDecision,
  resolveWorkflowStartStep,
  writeStoredExistingMediaDecision,
  type ExistingMediaDecision,
} from '../src/lib/ai-clip-reuse';

function createMemoryStorage(initialValue?: ExistingMediaDecision) {
  const store = new Map<string, string>();

  if (initialValue) {
    store.set('podcast-editor-ai-clip-existing-media-decision', initialValue);
  }

  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

describe('ai clip reuse helpers', () => {
  it('only treats paired audio and subtitle files as reusable media', () => {
    expect(isReusablePodcastMedia('/tmp/podcast.mp3', '/tmp/podcast.srt')).toBe(true);
    expect(isReusablePodcastMedia('/tmp/podcast.mp3', '')).toBe(false);
    expect(isReusablePodcastMedia('', '/tmp/podcast.srt')).toBe(false);
  });

  it('maps reuse decisions to the correct workflow start step', () => {
    expect(resolveWorkflowStartStep('skip-existing')).toBe('ai_analyzing');
    expect(resolveWorkflowStartStep('regenerate')).toBe('tts_generating');
  });

  it('persists and restores remembered existing-media decisions', () => {
    const storage = createMemoryStorage();

    expect(readStoredExistingMediaDecision(storage)).toBeNull();

    writeStoredExistingMediaDecision('skip-existing', storage);
    expect(readStoredExistingMediaDecision(storage)).toBe('skip-existing');

    writeStoredExistingMediaDecision('regenerate', storage);
    expect(readStoredExistingMediaDecision(storage)).toBe('regenerate');
  });

  it('ignores invalid remembered values', () => {
    const storage = createMemoryStorage() as ReturnType<typeof createMemoryStorage> & {
      setItem: (key: string, value: string) => void;
    };

    storage.setItem('podcast-editor-ai-clip-existing-media-decision', 'invalid');

    expect(readStoredExistingMediaDecision(storage)).toBeNull();
  });
});

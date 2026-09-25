import type { WorkflowStep } from '../store/ai';

export type ExistingMediaDecision = 'skip-existing' | 'regenerate';

type BrowserStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const AI_CLIP_EXISTING_MEDIA_DECISION_KEY =
  'podcast-editor-ai-clip-existing-media-decision';

export function isReusablePodcastMedia(audioPath: string, srtPath: string): boolean {
  return Boolean(audioPath.trim() && srtPath.trim());
}

export function resolveWorkflowStartStep(
  decision: ExistingMediaDecision,
): Extract<WorkflowStep, 'tts_generating' | 'ai_analyzing'> {
  return decision === 'skip-existing' ? 'ai_analyzing' : 'tts_generating';
}

function getBrowserStorage(): BrowserStorageLike | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }

  return window.localStorage;
}

export function readStoredExistingMediaDecision(
  storage: BrowserStorageLike | null = getBrowserStorage(),
): ExistingMediaDecision | null {
  const rawValue = storage?.getItem(AI_CLIP_EXISTING_MEDIA_DECISION_KEY);

  if (rawValue === 'skip-existing' || rawValue === 'regenerate') {
    return rawValue;
  }

  return null;
}

export function writeStoredExistingMediaDecision(
  decision: ExistingMediaDecision,
  storage: BrowserStorageLike | null = getBrowserStorage(),
): void {
  storage?.setItem(AI_CLIP_EXISTING_MEDIA_DECISION_KEY, decision);
}

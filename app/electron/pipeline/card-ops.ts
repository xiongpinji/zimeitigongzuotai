import { loadProjectFile } from '../project-file';
import { HeadlessProjectContext } from './context';
import { updateCardInResult, removeCardInResult } from '../../src/lib/ai-persistence';
import { deleteCardAssets } from '../ai-card-assets';
import { GenerationError } from './generation-error';
import type { AICard } from '../../src/types/ai';

const UPDATABLE: ReadonlyArray<keyof AICard> = [
  'title', 'enabled', 'displayMode', 'startMs', 'endMs', 'displayDurationMs', 'template', 'stylePresetId', 'cardPrompt',
];

export interface CardSummary {
  id: string; segmentId: string; type: string; title: string;
  enabled: boolean; startMs: number; endMs: number; renderMode?: string;
}

async function readCards(projectPath: string) {
  const data = await loadProjectFile(projectPath);
  const analysisResult = data.aiAnalysis?.analysisResult ?? null;
  return { data, analysisResult, cards: analysisResult?.cards ?? [] };
}

export async function listCards(projectPath: string): Promise<CardSummary[]> {
  const { cards } = await readCards(projectPath);
  return cards.map((c) => ({
    id: c.id, segmentId: c.segmentId, type: c.type, title: c.title,
    enabled: c.enabled, startMs: c.startMs, endMs: c.endMs, renderMode: c.renderMode,
  }));
}

export async function getCard(projectPath: string, cardId: string): Promise<AICard> {
  const { cards } = await readCards(projectPath);
  const card = cards.find((c) => c.id === cardId);
  if (!card) throw new GenerationError('card_not_found', `卡片不存在: ${cardId}`);
  return card;
}

export async function updateCard(
  projectPath: string,
  cardId: string,
  updates: Partial<AICard>,
): Promise<AICard> {
  const { data, analysisResult, cards } = await readCards(projectPath);
  if (!cards.some((c) => c.id === cardId)) {
    throw new GenerationError('card_not_found', `卡片不存在: ${cardId}`);
  }
  const clean: Partial<AICard> = {};
  for (const k of UPDATABLE) {
    if (Object.prototype.hasOwnProperty.call(updates, k)) {
      (clean as Record<string, unknown>)[k] = (updates as Record<string, unknown>)[k];
    }
  }
  const next = updateCardInResult(analysisResult, cardId, clean);
  await new HeadlessProjectContext(projectPath).saveSection('aiAnalysis', {
    analysisResult: next,
    coverCandidates: data.aiAnalysis?.coverCandidates ?? [],
  });
  return next!.cards.find((c) => c.id === cardId)!;
}

export async function deleteCard(projectPath: string, cardId: string): Promise<{ ok: true }> {
  const { data, analysisResult, cards } = await readCards(projectPath);
  if (!cards.some((c) => c.id === cardId)) {
    throw new GenerationError('card_not_found', `卡片不存在: ${cardId}`);
  }
  const next = removeCardInResult(analysisResult, cardId);
  await deleteCardAssets(projectPath, cardId).catch(() => {});
  await new HeadlessProjectContext(projectPath).saveSection('aiAnalysis', {
    analysisResult: next,
    coverCandidates: data.aiAnalysis?.coverCandidates ?? [],
  });
  return { ok: true };
}

import type { AICard } from '../types/ai';

export function getOrderedAICards(cards: AICard[]): AICard[] {
  return [...cards].sort((left, right) => {
    if (left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }

    if (left.endMs !== right.endMs) {
      return left.endMs - right.endMs;
    }

    return left.id.localeCompare(right.id);
  });
}

export function getAICardSequenceLabel(
  cards: AICard[] | null | undefined,
  cardId: string | null,
): string | null {
  if (!cards?.length || !cardId) {
    return null;
  }

  const index = getOrderedAICards(cards).findIndex((card) => card.id === cardId);
  if (index < 0) {
    return null;
  }

  return `第 ${index + 1} 段`;
}

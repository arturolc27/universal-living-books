import type { SrsCardStateRecord } from '../../db/dexieDb';
import type { BookCartridge, FlashcardBlock } from '../../types/cartridge.types';

export type Sm2Grade = 0 | 3 | 4 | 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function createInitialSrsState(
  bookId: string,
  cardId: string,
  now = Date.now()
): SrsCardStateRecord {
  return {
    bookId,
    cardId,
    repetitions: 0,
    interval: 0,
    easeFactor: 2.5,
    nextReviewTimestamp: now,
    failedInPcLab: false,
    updatedAt: now,
  };
}

/**
 * Classic SuperMemo-2 (SM-2) spacing step.
 * Grades supported in the UI:
 * - 0: Olvidado (complete lapse -> reset repetitions to 0, interval = 1 day)
 * - 3: Difícil  (recalled with high effort)
 * - 4: Bien     (recalled after hesitation)
 * - 5: Fácil    (instant recall)
 */
export function computeNextSm2State(
  prev: SrsCardStateRecord,
  grade: Sm2Grade,
  now = Date.now()
): SrsCardStateRecord {
  let { repetitions, interval, easeFactor } = prev;

  if (grade < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.max(1, Math.round(interval * easeFactor));
    }
    repetitions += 1;
  }

  const delta = 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02);
  easeFactor = Math.max(1.3, Number((easeFactor + delta).toFixed(2)));

  // If forgotten (grade 0), schedule due in 5 minutes for same-session reinforcement;
  // otherwise schedule `interval` days forward and clear failedInPcLab flag once >= 4.
  const nextReviewTimestamp =
    grade < 3 ? now + 5 * 60 * 1000 : now + interval * DAY_MS;

  return {
    ...prev,
    repetitions,
    interval,
    easeFactor,
    nextReviewTimestamp,
    failedInPcLab: grade >= 4 ? false : prev.failedInPcLab,
    updatedAt: now,
  };
}

export function injectPcLabFailure(
  existing: SrsCardStateRecord | undefined,
  bookId: string,
  cardId: string,
  now = Date.now()
): SrsCardStateRecord {
  const base = existing ?? createInitialSrsState(bookId, cardId, now);
  return {
    ...base,
    repetitions: 0,
    interval: 0,
    nextReviewTimestamp: now,
    failedInPcLab: true,
    updatedAt: now,
  };
}

export function extractFlashcardsFromCartridge(cartridge: BookCartridge): FlashcardBlock[] {
  const seen = new Set<string>();
  const cards: FlashcardBlock[] = [];
  for (const chapter of cartridge.chapters) {
    for (const lesson of chapter.microLessons) {
      for (const block of lesson.blocks) {
        if (block.type === 'FLASHCARD' && !seen.has(block.cardId)) {
          seen.add(block.cardId);
          cards.push(block);
        }
      }
    }
  }
  return cards;
}

export interface EnrichedFlashcardQueueItem {
  card: FlashcardBlock;
  state: SrsCardStateRecord;
  isDue: boolean;
}

export function buildPrioritizedReviewQueue(
  cartridge: BookCartridge,
  statesByCardId: Record<string, SrsCardStateRecord>,
  now = Date.now()
): EnrichedFlashcardQueueItem[] {
  const cards = extractFlashcardsFromCartridge(cartridge);

  const enriched: EnrichedFlashcardQueueItem[] = cards.map((card) => {
    const state = statesByCardId[card.cardId] ?? createInitialSrsState(cartridge.bookId, card.cardId, now);
    const isDue = state.failedInPcLab || state.nextReviewTimestamp <= now;
    return { card, state, isDue };
  });

  return enriched.sort((a, b) => {
    if (a.state.failedInPcLab !== b.state.failedInPcLab) {
      return a.state.failedInPcLab ? -1 : 1;
    }
    if (a.isDue !== b.isDue) {
      return a.isDue ? -1 : 1;
    }
    return a.state.nextReviewTimestamp - b.state.nextReviewTimestamp;
  });
}

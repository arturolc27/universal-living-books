import type { SrsCardStateRecord } from '../../db/dexieDb';
import type { BookCartridge, FlashcardBlock } from '../../types/cartridge.types';

export type Sm2Grade = 0 | 3 | 4 | 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function createInitialSrsState(
  bookId: string,
  cardId: string,
  now = Date.now(),
  enrolled = false
): SrsCardStateRecord {
  return {
    bookId,
    cardId,
    repetitions: 0,
    interval: 0,
    easeFactor: 2.5,
    nextReviewTimestamp: now,
    failedInPcLab: false,
    enrolled,
    enrolledAt: enrolled ? now : undefined,
    updatedAt: now,
  };
}

/**
 * Calcula objetivamente el grado SM-2 en items verificables (Active SRS)
 * evitando el sesgo metacognitivo de autoevaluacion.
 */
export function gradeFromObjectiveOutcome(
  correct: boolean,
  latencyMs: number,
  usedHint = false
): Sm2Grade {
  if (!correct) return 0;
  if (usedHint || latencyMs > 45_000) return 3;
  if (latencyMs <= 15_000) return 5;
  return 4;
}

/**
 * Classic SuperMemo-2 (SM-2) spacing step.
 * Grades supported in the UI:
 * - 0: Olvidado (complete lapse -> reset repetitions to 0, interval = 1 day)
 * - 3: Dificil  (recalled with high effort)
 * - 4: Bien     (recalled after hesitation)
 * - 5: Facil    (instant recall)
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
    enrolled: true,
    enrolledAt: prev.enrolledAt ?? now,
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
  const base = existing ?? createInitialSrsState(bookId, cardId, now, true);
  return {
    ...base,
    repetitions: 0,
    interval: 0,
    nextReviewTimestamp: now,
    failedInPcLab: true,
    enrolled: true,
    enrolledAt: base.enrolledAt ?? now,
    updatedAt: now,
  };
}

export interface FlashcardWithChapter {
  card: FlashcardBlock;
  chapterNumber: number;
  lessonId: string;
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
  chapterNumber?: number;
  lessonId?: string;
}

/**
 * Construye una cola de repaso espaciado e intercalado:
 * - Solo incluye tarjetas enroladas (lecciones completadas o fallos en PC Lab)
 *   cuando `enrolledOnly` esta activo (por defecto `true` si hay estados previos,
 *   o si existen lecciones completadas).
 * - Intercala tarjetas entre distintos capitulos (Bjork Interleaving).
 */
export function buildPrioritizedReviewQueue(
  cartridge: BookCartridge,
  statesByCardId: Record<string, SrsCardStateRecord>,
  now = Date.now(),
  options?: { includeUnenrolledFallback?: boolean; maxItems?: number }
): EnrichedFlashcardQueueItem[] {
  const withChapter: FlashcardWithChapter[] = [];
  const seen = new Set<string>();
  for (const chapter of cartridge.chapters) {
    for (const lesson of chapter.microLessons) {
      for (const block of lesson.blocks) {
        if (block.type === 'FLASHCARD' && !seen.has(block.cardId)) {
          seen.add(block.cardId);
          withChapter.push({ card: block, chapterNumber: chapter.number, lessonId: lesson.lessonId });
        }
      }
    }
  }

  const enrolledItems: EnrichedFlashcardQueueItem[] = [];
  for (const { card, chapterNumber, lessonId } of withChapter) {
    const existing = statesByCardId[card.cardId];
    const isEnrolled = Boolean(
      existing &&
        (existing.enrolled || existing.failedInPcLab || existing.repetitions > 0 || existing.interval > 0)
    );
    if (!isEnrolled && !options?.includeUnenrolledFallback) continue;
    const state = existing ?? createInitialSrsState(cartridge.bookId, card.cardId, now, false);
    const isDue = state.failedInPcLab || state.nextReviewTimestamp <= now;
    enrolledItems.push({ card, state, isDue, chapterNumber, lessonId });
  }

  // Priorizar fallos PC Lab y vencidas, luego intercalar por capitulo (round-robin)
  const prioritized = enrolledItems.sort((a, b) => {
    if (a.state.failedInPcLab !== b.state.failedInPcLab) {
      return a.state.failedInPcLab ? -1 : 1;
    }
    if (a.isDue !== b.isDue) {
      return a.isDue ? -1 : 1;
    }
    return a.state.nextReviewTimestamp - b.state.nextReviewTimestamp;
  });

  // Interleaving: evitar >2 tarjetas seguidas del mismo capitulo cuando hay varios capitulos
  const byChapter = new Map<number, EnrichedFlashcardQueueItem[]>();
  for (const item of prioritized) {
    const ch = item.chapterNumber ?? 0;
    const list = byChapter.get(ch) ?? [];
    list.push(item);
    byChapter.set(ch, list);
  }
  const interleaved: EnrichedFlashcardQueueItem[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of byChapter.values()) {
      const next = list.shift();
      if (next) {
        interleaved.push(next);
        added = true;
      }
    }
  }

  const limit = options?.maxItems ?? 20;
  return interleaved.slice(0, limit);
}

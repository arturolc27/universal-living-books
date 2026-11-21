import type { FsrsCardState, SrsCardStateRecord } from '../../db/dexieDb';
import type { BookCartridge, FlashcardBlock, LessonBlock } from '../../types/cartridge.types';
import { PYTHON_COMPETENCY_BY_ID, type PythonDomainId } from '../../data/pythonTaxonomy';
import type { Sm2Grade } from './sm2Scheduler';

/**
 * Motor FSRS (Free Spaced Repetition Scheduler v4.5 simplificado y determinista).
 * Ratings estándar:
 * - 1: Again (Olvidado)
 * - 2: Hard  (Difícil)
 * - 3: Good  (Bien)
 * - 4: Easy  (Fácil)
 */
export type FsrsRating = 1 | 2 | 3 | 4;

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_RETENTION = 0.9;

// Parámetros FSRS-4.5 estándar (pesos w0..w16)
const W = [
  0.4, 0.6, 2.4, 5.8, // w0..w3: initial stability for Again, Hard, Good, Easy
  4.93, 0.94, 0.86, 0.01, // w4..w7: difficulty params
  1.49, 0.14, 0.94, // w8..w10: recall stability growth
  2.18, 0.05, 0.34, 1.26, // w11..w14: forget stability
  0.29, 2.61, // w15: hard penalty, w16: easy bonus
] as const;

export function sm2GradeToFsrsRating(grade: Sm2Grade): FsrsRating {
  if (grade < 3) return 1;
  if (grade === 3) return 2;
  if (grade === 4) return 3;
  return 4;
}

export function fsrsRatingToSm2Grade(rating: FsrsRating): Sm2Grade {
  if (rating === 1) return 0;
  if (rating === 2) return 3;
  if (rating === 3) return 4;
  return 5;
}

export function computeFsrsRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  if (elapsedDays <= 0) return 1;
  return Math.pow(1 + elapsedDays / (9 * stability), -1);
}

function clampDifficulty(d: number): number {
  return Number(Math.max(1, Math.min(10, d)).toFixed(2));
}

function initialStability(rating: FsrsRating): number {
  return W[rating - 1];
}

function initialDifficulty(rating: FsrsRating): number {
  return clampDifficulty(W[4] - Math.exp(W[5] * (rating - 1)) + 1);
}

function nextDifficulty(d: number, rating: FsrsRating): number {
  const delta = -W[6] * (rating - 3);
  const meanReversion = W[7] * (initialDifficulty(3) - d);
  return clampDifficulty(d + delta + meanReversion);
}

function nextRecallStability(d: number, s: number, r: number, rating: FsrsRating): number {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  const growth =
    Math.exp(W[8]) *
    (11 - d) *
    Math.pow(Math.max(0.1, s), -W[9]) *
    (Math.exp((1 - r) * W[10]) - 1) *
    hardPenalty *
    easyBonus;
  return Number(Math.max(0.1, s * (1 + growth)).toFixed(2));
}

function nextForgetStability(d: number, s: number, r: number): number {
  const val =
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(Math.max(0.1, s) + 1, W[13]) - 1) *
    Math.exp((1 - r) * W[14]);
  return Number(Math.max(0.1, Math.min(s, val)).toFixed(2));
}

function stabilityToIntervalDays(stability: number, desiredRetention = REQUEST_RETENTION): number {
  const raw = 9 * stability * (1 / desiredRetention - 1);
  return Math.max(1, Math.min(365, Math.round(raw)));
}

/**
 * Migra de forma transparente un registro SM-2 antiguo a campos FSRS inicializados.
 */
export function ensureFsrsFields(record: SrsCardStateRecord): SrsCardStateRecord {
  if (typeof record.stability === 'number' && typeof record.difficulty === 'number' && record.fsrsState) {
    return record;
  }
  const hasHistory = record.repetitions > 0 || record.interval > 0;
  const inferredStability = hasHistory ? Math.max(1, record.interval || 1) : 0;
  const inferredDifficulty = clampDifficulty(
    5 + (2.5 - (record.easeFactor || 2.5)) * 2.5
  );
  const fsrsState: FsrsCardState = hasHistory ? 'REVIEW' : 'NEW';
  return {
    ...record,
    stability: inferredStability,
    difficulty: inferredDifficulty,
    elapsedDays: 0,
    scheduledDays: record.interval || 0,
    reps: record.repetitions || 0,
    lapses: record.failedInPcLab ? 1 : 0,
    fsrsState,
  };
}

export function computeNextFsrsState(
  prevRaw: SrsCardStateRecord,
  rating: FsrsRating,
  now = Date.now()
): SrsCardStateRecord {
  const prev = ensureFsrsFields(prevRaw);
  const lastAt = prev.lastReviewAt ?? prev.updatedAt ?? now;
  const elapsedDays =
    prev.fsrsState === 'NEW' ? 0 : Math.max(0, (now - lastAt) / DAY_MS);

  let stability: number;
  let difficulty: number;
  let fsrsState: FsrsCardState;
  let lapses = prev.lapses ?? 0;
  const reps = (prev.reps ?? prev.repetitions ?? 0) + 1;
  let scheduledDays: number;
  let nextReviewTimestamp: number;

  if (prev.fsrsState === 'NEW' || (prev.stability ?? 0) <= 0) {
    stability = initialStability(rating);
    difficulty = initialDifficulty(rating);
    if (rating === 1) {
      fsrsState = 'LEARNING';
      lapses += 1;
      scheduledDays = 0;
      nextReviewTimestamp = now + 5 * 60 * 1000;
    } else if (rating === 2) {
      fsrsState = 'LEARNING';
      scheduledDays = 1;
      nextReviewTimestamp = now + 12 * 60 * 60 * 1000;
    } else {
      fsrsState = 'REVIEW';
      scheduledDays = Math.max(1, stabilityToIntervalDays(stability));
      nextReviewTimestamp = now + scheduledDays * DAY_MS;
    }
  } else {
    const r = computeFsrsRetrievability(elapsedDays, prev.stability ?? 1);
    difficulty = nextDifficulty(prev.difficulty ?? 5, rating);
    if (rating === 1) {
      stability = nextForgetStability(difficulty, prev.stability ?? 1, r);
      fsrsState = 'RELEARNING';
      lapses += 1;
      scheduledDays = 0;
      nextReviewTimestamp = now + 10 * 60 * 1000;
    } else {
      stability = nextRecallStability(difficulty, prev.stability ?? 1, r, rating);
      fsrsState = 'REVIEW';
      scheduledDays = Math.max(1, stabilityToIntervalDays(stability));
      if (rating === 2) {
        scheduledDays = Math.max(1, Math.min(scheduledDays, Math.round((prev.scheduledDays ?? 1) * 1.2) || 1));
      } else if (rating === 4) {
        scheduledDays = Math.max(scheduledDays + 1, Math.round(scheduledDays * 1.3));
      }
      nextReviewTimestamp = now + scheduledDays * DAY_MS;
    }
  }

  return {
    ...prev,
    stability,
    difficulty,
    elapsedDays: Number(elapsedDays.toFixed(2)),
    scheduledDays,
    reps,
    lapses,
    fsrsState,
    lastReviewAt: now,
    // Mantener campos legacy sincronizados para compatibilidad con SM-2 / UI antigua
    repetitions: rating === 1 ? 0 : (prev.repetitions ?? 0) + 1,
    interval: Math.max(1, scheduledDays),
    easeFactor: Number(Math.max(1.3, 3.0 - (difficulty - 1) * 0.17).toFixed(2)),
    nextReviewTimestamp,
    enrolled: true,
    enrolledAt: prev.enrolledAt ?? now,
    failedInPcLab: rating >= 3 ? false : prev.failedInPcLab,
    updatedAt: now,
  };
}

export function formatIntervalLabel(prev: SrsCardStateRecord, rating: FsrsRating, now = Date.now()): string {
  const simulated = computeNextFsrsState(prev, rating, now);
  const diffMin = Math.round((simulated.nextReviewTimestamp - now) / 60_000);
  if (diffMin < 60) return `${Math.max(1, diffMin)} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} h`;
  const days = Math.max(1, Math.round(diffHours / 24));
  if (days < 30) return `${days} d`;
  const months = (days / 30).toFixed(1).replace(/\.0$/, '');
  return `${months} m`;
}

export interface GlobalFlashcardMeta {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  lessonId: string;
  lessonTitle: string;
  card: FlashcardBlock;
  linkedBlock?: LessonBlock;
}

export interface GlobalSrsQueueItem extends GlobalFlashcardMeta {
  state: SrsCardStateRecord;
  isDue: boolean;
  retrievability: number;
}

export interface GlobalSrsQueueOptions {
  bookId?: string | 'ALL';
  domainId?: PythonDomainId | 'ALL';
  weakOnly?: boolean;
  dueOnly?: boolean;
  maxItems?: number;
  now?: number;
}

/**
 * Extrae todas las flashcards de todos los cartuchos instalados junto a su reto
 * enlazado (para Active SRS) y metadatos de libro/capítulo/lección.
 */
export function extractGlobalFlashcardCatalog(
  cartridges: Record<string, BookCartridge>
): GlobalFlashcardMeta[] {
  const catalog: GlobalFlashcardMeta[] = [];

  for (const cartridge of Object.values(cartridges)) {
    const blockById: Record<string, LessonBlock> = {};
    for (const ch of cartridge.chapters) {
      for (const ml of ch.microLessons) {
        for (const blk of ml.blocks) {
          blockById[blk.blockId] = blk;
        }
        for (const extra of ml.exerciseBank ?? []) {
          blockById[extra.blockId] = extra;
        }
      }
    }

    const seenCards = new Set<string>();
    for (const ch of cartridge.chapters) {
      for (const ml of ch.microLessons) {
        for (const blk of ml.blocks) {
          if (blk.type === 'FLASHCARD' && !seenCards.has(blk.cardId)) {
            seenCards.add(blk.cardId);
            const candidate = blk.sourceBlockId ? blockById[blk.sourceBlockId] : undefined;
            const linkedBlock =
              candidate &&
              (candidate.type === 'OUTPUT_PREDICTION' ||
                candidate.type === 'BUG_AUTOPSY' ||
                candidate.type === 'SYNTAX_CLOZE')
                ? candidate
                : undefined;

            catalog.push({
              bookId: cartridge.bookId,
              bookTitle: cartridge.metadata.title,
              chapterId: ch.chapterId,
              chapterNumber: ch.number,
              chapterTitle: ch.title,
              lessonId: ml.lessonId,
              lessonTitle: ml.title,
              card: blk,
              linkedBlock,
            });
          }
        }
      }
    }
  }

  return catalog;
}

/**
 * Construye la cola global de repaso FSRS desacoplada de cualquier libro activo:
 * - Solo incluye tarjetas enroladas (lecciones completadas, capítulos marcados como estudiados o fallos PC Lab).
 * - Filtra por libro, dominio Python o conceptos débiles.
 * - Intercala entre distintos libros y capítulos (Bjork Interleaving).
 */
export function buildGlobalFsrsReviewQueue(
  cartridges: Record<string, BookCartridge>,
  srsStates: Record<string, SrsCardStateRecord>,
  options: GlobalSrsQueueOptions = {}
): GlobalSrsQueueItem[] {
  const now = options.now ?? Date.now();
  const catalog = extractGlobalFlashcardCatalog(cartridges);
  const items: GlobalSrsQueueItem[] = [];

  for (const meta of catalog) {
    if (options.bookId && options.bookId !== 'ALL' && meta.bookId !== options.bookId) {
      continue;
    }

    const key = `${meta.bookId}::${meta.card.cardId}`;
    const rawState = srsStates[key];
    const isEnrolled = Boolean(
      rawState &&
        (rawState.enrolled ||
          rawState.failedInPcLab ||
          rawState.repetitions > 0 ||
          (rawState.reps ?? 0) > 0 ||
          rawState.interval > 0)
    );
    if (!isEnrolled || !rawState) continue;

    const state = ensureFsrsFields(rawState);

    if (options.domainId && options.domainId !== 'ALL') {
      const compIds = [...(state.competencyIds ?? []), ...(meta.card.competencyIds ?? [])];
      const matchesDomain = compIds.some(
        (cid) => PYTHON_COMPETENCY_BY_ID[cid]?.domainId === options.domainId
      );
      if (!matchesDomain) continue;
    }

    const elapsedDays = state.lastReviewAt
      ? Math.max(0, (now - state.lastReviewAt) / DAY_MS)
      : 0;
    const retrievability =
      state.fsrsState === 'NEW'
        ? 0.5
        : computeFsrsRetrievability(elapsedDays, Math.max(0.4, state.stability ?? 0.4));

    const isDue = state.failedInPcLab || state.nextReviewTimestamp <= now;

    if (options.dueOnly && !isDue) continue;
    if (
      options.weakOnly &&
      !(state.failedInPcLab || (state.lapses ?? 0) > 0 || (state.difficulty ?? 5) >= 6.5 || retrievability < 0.85)
    ) {
      continue;
    }

    items.push({
      ...meta,
      state,
      isDue,
      retrievability,
    });
  }

  // Prioridad: fallos en PC Lab > tarjetas vencidas (menor retrievability primero) > próximas
  items.sort((a, b) => {
    if (a.state.failedInPcLab !== b.state.failedInPcLab) {
      return a.state.failedInPcLab ? -1 : 1;
    }
    if (a.isDue !== b.isDue) {
      return a.isDue ? -1 : 1;
    }
    if (a.isDue && b.isDue && Math.abs(a.retrievability - b.retrievability) > 0.05) {
      return a.retrievability - b.retrievability;
    }
    return a.state.nextReviewTimestamp - b.state.nextReviewTimestamp;
  });

  // Interleaving entre libros y capítulos (round-robin por bucket bookId::chapterId)
  const buckets = new Map<string, GlobalSrsQueueItem[]>();
  for (const item of items) {
    const bucketKey = `${item.bookId}::${item.chapterId}`;
    const list = buckets.get(bucketKey) ?? [];
    list.push(item);
    buckets.set(bucketKey, list);
  }

  const interleaved: GlobalSrsQueueItem[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of buckets.values()) {
      const next = list.shift();
      if (next) {
        interleaved.push(next);
        added = true;
      }
    }
  }

  const limit = options.maxItems ?? 30;
  return interleaved.slice(0, limit);
}

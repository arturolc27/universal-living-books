import Dexie, { type Table } from 'dexie';
import type {
  BookCartridge,
  Chapter,
  GlossaryEntry,
  MasteryTier,
  MemoryStep,
  PythonMisconceptionId,
} from '../types/cartridge.types';
import type { CompilationJob } from '../types/compiler.types';

export interface InstalledCartridgeRecord {
  bookId: string;
  cartridgeJson: BookCartridge;
  installedAt: number;
}

export interface LessonProgressRecord {
  bookId: string;
  lessonId: string;
  unlockedBlockIndex: number;
  isCompleted: boolean;
  masteryTier: MasteryTier;
  hadMistakes: boolean;
  updatedAt: number;
}

export interface SrsCardStateRecord {
  bookId: string;
  cardId: string;
  repetitions: number;
  interval: number;
  easeFactor: number;
  nextReviewTimestamp: number;
  failedInPcLab: boolean;
  enrolled?: boolean;
  enrolledAt?: number;
  sourceBlockId?: string;
  conceptTags?: string[];
  misconceptionId?: PythonMisconceptionId;
  updatedAt: number;
}

export type ConceptMasteryStatus = 'UNSEEN' | 'PRACTICING' | 'NEEDS_REVIEW' | 'MASTERED';

export interface ConceptMasteryRecord {
  bookId: string;
  conceptTag: string;
  status: ConceptMasteryStatus;
  predictionHits: number;
  predictionAttempts: number;
  transferPassed: boolean;
  delayedReviewPassed: boolean;
  misconceptionHits: Record<string, number>;
  misconceptionResolved: string[];
  updatedAt: number;
}

export type TelemetryEventType =
  | 'PREDICTION_ATTEMPT'
  | 'TRANSFER_LAB'
  | 'SRS_DELAYED_REVIEW'
  | 'MISCONCEPTION_TRIGGERED'
  | 'MISCONCEPTION_RESOLVED'
  | 'THRASHING_DETECTED';

export interface LearningTelemetryRecord {
  id?: number;
  bookId: string;
  lessonId?: string;
  blockId?: string;
  eventType: TelemetryEventType;
  conceptTag?: string;
  misconceptionId?: PythonMisconceptionId;
  passed?: boolean;
  latencyMs?: number;
  daysSinceLastPractice?: number;
  createdAt: number;
}

export interface SavedUserCodeRecord {
  bookId: string;
  blockId: string;
  code: string;
  passedTests: boolean;
  updatedAt: number;
}

export interface UnlockedAchievementRecord {
  bookId: string;
  achievementId: string;
  unlockedAt: number;
}

export interface UserStatsRecord {
  id: 'global';
  currentStreakDays: number;
  lastStudyDate: string;
  totalFirstTryHits: number;
  totalAttempts: number;
  currentFirstTryStreak: number;
  astMasteryCount: number;
  srsReviewsCount: number;
  updatedAt: number;
}

export interface VirtualFileSystemRecord {
  bookId: string;
  files: Record<string, string>;
  updatedAt: number;
}

/**
 * Cache de trazas de memoria deterministas, indexada por el hash SHA-256 del
 * codigo normalizado. Evita recalcular jamas una traza ya obtenida.
 */
export interface MemoryTraceRecord {
  hash: string;
  code: string;
  maxSteps: number;
  memorySteps: MemoryStep[];
  createdAt: number;
}

export interface DocumentPageRecord {
  jobId: string;
  pageNumber: number;
  text: string;
}

export interface BookAssetRecord {
  bookId: string;
  kind: 'icon' | 'card';
  blob: Blob;
  mimeType: string;
  updatedAt: number;
}

export interface LessonTranslationRecord {
  bookId: string;
  lessonId: string;
  lang: 'es' | 'en';
  translatedLesson: import('../types/cartridge.types').MicroLesson;
  updatedAt: number;
}

export class LivingBooksDB extends Dexie {
  installedCartridges!: Table<InstalledCartridgeRecord, string>;
  lessonProgress!: Table<LessonProgressRecord, [string, string]>;
  srsCardsState!: Table<SrsCardStateRecord, [string, string]>;
  savedUserCode!: Table<SavedUserCodeRecord, [string, string]>;
  unlockedAchievements!: Table<UnlockedAchievementRecord, [string, string]>;
  userStats!: Table<UserStatsRecord, string>;
  virtualFileSystems!: Table<VirtualFileSystemRecord, string>;
  compilationJobs!: Table<CompilationJob, string>;
  memoryTraces!: Table<MemoryTraceRecord, string>;
  documentPages!: Table<DocumentPageRecord, [string, number]>;
  bookAssets!: Table<BookAssetRecord, [string, string]>;
  lessonTranslations!: Table<LessonTranslationRecord, [string, string, string]>;
  conceptMastery!: Table<ConceptMasteryRecord, [string, string]>;
  learningTelemetry!: Table<LearningTelemetryRecord, number>;

  constructor() {
    super('LivingBooksDB_v2');
    this.version(1).stores({
      installedCartridges: 'bookId, installedAt',
      lessonProgress: '[bookId+lessonId], bookId, lessonId, updatedAt',
      srsCardsState: '[bookId+cardId], bookId, cardId, nextReviewTimestamp, failedInPcLab, updatedAt',
      savedUserCode: '[bookId+blockId], bookId, blockId, updatedAt',
      unlockedAchievements: '[bookId+achievementId], bookId, achievementId, unlockedAt',
      userStats: 'id, updatedAt',
      virtualFileSystems: 'bookId, updatedAt',
    });
    this.version(2).stores({
      compilationJobs: 'jobId, bookId, status, updatedAt',
    });
    this.version(3).stores({
      memoryTraces: 'hash, createdAt',
    });
    this.version(4).stores({
      documentPages: '[jobId+pageNumber], jobId, pageNumber',
      bookAssets: '[bookId+kind], bookId, kind, updatedAt',
    });
    this.version(5).stores({
      lessonTranslations: '[bookId+lessonId+lang], bookId, lessonId, lang, updatedAt',
    });
    this.version(6).stores({
      conceptMastery: '[bookId+conceptTag], bookId, conceptTag, status, updatedAt',
      learningTelemetry: '++id, bookId, eventType, conceptTag, createdAt',
    });

    // Diagnostico: evita cuelgues silenciosos por bloqueos de version.
    this.on('blocked', () => {
      // eslint-disable-next-line no-console
      console.warn(
        'LivingBooksDB esta bloqueada por otra pestana con una version distinta. Cierra las demas pestanas.'
      );
    });
    this.on('versionchange', () => {
      // eslint-disable-next-line no-console
      console.warn('LivingBooksDB cambio de version en otra pestana. Cerrando conexion local.');
      this.close();
    });
  }
}

export const livingBooksDb = new LivingBooksDB();

export async function getStorageUsageEstimate(): Promise<{
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
} | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const usageBytes = est.usage ?? 0;
    const quotaBytes = est.quota ?? 0;
    const percentUsed = quotaBytes > 0 ? Math.round((usageBytes / quotaBytes) * 100) : 0;
    return { usageBytes, quotaBytes, percentUsed };
  } catch {
    return null;
  }
}

export function createInitialUserStats(): UserStatsRecord {
  return {
    id: 'global',
    currentStreakDays: 1,
    lastStudyDate: new Date().toISOString().slice(0, 10),
    totalFirstTryHits: 0,
    totalAttempts: 0,
    currentFirstTryStreak: 0,
    astMasteryCount: 0,
    srsReviewsCount: 0,
    updatedAt: Date.now(),
  };
}

export interface UpsertChapterExtras {
  themeDNA?: BookCartridge['themeDNA'];
  runtimeRequirements?: BookCartridge['runtimeRequirements'];
  achievements?: BookCartridge['achievements'];
}

/**
 * Fusion incremental (Upsert ordenado) de un capitulo compilado dentro del
 * BookCartridge de un libro en IndexedDB.
 *
 * - Inserta o reemplaza el capitulo por su `number`.
 * - Mantiene el array `chapters` ordenado por `number`.
 * - Fusiona el glosario sin duplicar terminos ya existentes.
 * - Crea el cartucho base si el libro aun no existe en la base de datos.
 */
export async function upsertCompiledChapterToBook(
  bookId: string,
  metadata: BookCartridge['metadata'],
  chapter: Chapter,
  glossaryEntries: Record<string, GlossaryEntry>,
  extras: UpsertChapterExtras = {}
): Promise<BookCartridge> {
  return livingBooksDb.transaction('rw', livingBooksDb.installedCartridges, async () => {
    const existing = await livingBooksDb.installedCartridges.get(bookId);

    const base: BookCartridge = existing?.cartridgeJson ?? {
      schemaVersion: '2.0',
      bookId,
      metadata,
      themeDNA: extras.themeDNA ?? DEFAULT_THEME_DNA,
      runtimeRequirements: extras.runtimeRequirements ?? {
        pythonVersion: '3.14',
        packages: [],
        enableLiveMemoryTracer: true,
        virtualFileSystemSeed: {},
      },
      glossary: {},
      achievements: extras.achievements ?? [],
      chapters: [],
    };

    const chapters = base.chapters.filter((c) => c.number !== chapter.number);
    chapters.push(chapter);
    chapters.sort((a, b) => a.number - b.number);

    const glossary: Record<string, GlossaryEntry> = { ...base.glossary };
    for (const [key, entry] of Object.entries(glossaryEntries)) {
      if (!glossary[key]) glossary[key] = entry;
    }

    const merged: BookCartridge = {
      ...base,
      metadata,
      themeDNA: extras.themeDNA ?? base.themeDNA,
      runtimeRequirements: extras.runtimeRequirements ?? base.runtimeRequirements,
      achievements: extras.achievements ?? base.achievements,
      glossary,
      chapters,
    };

    await livingBooksDb.installedCartridges.put({
      bookId,
      cartridgeJson: merged,
      installedAt: Date.now(),
    });

    return merged;
  });
}

/**
 * Fusiona varios capitulos de una sola vez (usado al cerrar una sesion de
 * ingesta incremental con multiples capitulos seleccionados).
 */
export async function mergeChaptersIntoBookCartridge(
  bookId: string,
  metadata: BookCartridge['metadata'],
  newChapters: Chapter[],
  newGlossary: Record<string, GlossaryEntry>,
  extras: UpsertChapterExtras = {}
): Promise<BookCartridge> {
  let result: BookCartridge | null = null;
  for (const chapter of newChapters) {
    result = await upsertCompiledChapterToBook(bookId, metadata, chapter, newGlossary, extras);
  }
  if (!result) {
    const existing = await livingBooksDb.installedCartridges.get(bookId);
    if (existing) return existing.cartridgeJson;
    throw new Error('No hay capitulos para fusionar y el libro no existe en la base de datos.');
  }
  return result;
}

const DEFAULT_THEME_DNA: BookCartridge['themeDNA'] = {
  themeName: 'Compiled Slate',
  mode: 'dark',
  colors: {
    bgCanvas: '#0F1419',
    bgSurface: '#182026',
    bgElevated: '#222D36',
    borderSubtle: '#2E3C48',
    textPrimary: '#F1F5F9',
    textMuted: '#94A3B8',
    accentPrimary: '#38BDF8',
    accentSecondary: '#F59E0B',
    accentSuccess: '#10B981',
    accentDanger: '#F43F5E',
  },
  typography: { editorialFont: 'sans', codeFont: 'JetBrains Mono' },
};

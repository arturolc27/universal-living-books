import { create } from 'zustand';
import type {
  BookCartridge,
  GlossaryEntry,
  LessonBlock,
  MasteryTier,
  MemoryStep,
  MicroLesson,
  PythonExecutionResult,
} from '../types/cartridge.types';
import {
  createInitialUserStats,
  livingBooksDb,
  type GlobalCompetencyMasteryRecord,
  type GlobalConceptRecord,
  type LearningTelemetryRecord,
  type LessonProgressRecord,
  type SrsCardStateRecord,
  type UserStatsRecord,
} from '../db/dexieDb';
import { validateBookCartridge } from '../types/cartridge.schema';
import {
  createInitialSrsState,
  injectPcLabFailure,
  type Sm2Grade,
} from '../engine/srs/sm2Scheduler';
import {
  computeNextFsrsState,
  sm2GradeToFsrsRating,
  type FsrsRating,
} from '../engine/srs/fsrsScheduler';
import {
  indexCartridgeIntoKnowledgeGraph,
  recordCompetencyEvidence,
  type CompetencyEvidenceSignal,
} from '../engine/knowledge/knowledgeIndexer';
import { matchCompetenciesFromText } from '../data/pythonTaxonomy';
import { repairCartridgeForRuntime } from '../engine/compiler/lessonSanitizer';
import { translateMicroLessonOnDemand } from '../engine/compiler/llmCompiler';
import { sanitizeVirtualFileSystemSeed } from '../ui/utils/sanitize';

export type ViewMode = 'DESKTOP_STUDIO' | 'MOBILE_COMPANION';
export type StudioTab = 'MEMORY' | 'DATA' | 'GPU';
export type MobileTab = 'READ' | 'PRACTICE' | 'SRS' | 'MAP';
export type StudyLanguage = 'es' | 'en';
export type GlobalRoute = 'LIBRARY' | 'GLOBAL_SRS' | 'DICTIONARY' | 'PYTHON_ROADMAP';

export interface ToastMessage {
  id: string;
  title: string;
  description: string;
  iconKey: string;
}

export interface PcLabQueueItem {
  bookId: string;
  chapterId: string;
  lessonId: string;
  blockId: string;
  title: string;
  blockType: 'CODE_LAB' | 'AST_CHALLENGE';
  queuedAt: number;
}

interface PlatformSettings {
  llmProvider: 'openrouter' | 'gemini';
  openrouterApiKey: string;
  openrouterModel: string;
  geminiApiKey: string;
  geminiModel: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseSyncKey: string;
}

interface PlatformState {
  cartridges: Record<string, BookCartridge>;
  globalRoute: GlobalRoute;
  activeBookId: string | null;
  activeChapterId: string | null;
  activeLessonId: string | null;
  activeBlockIndex: number;
  unlockedBlockIndex: number;
  viewMode: ViewMode;
  studioTab: StudioTab;
  mobileTab: MobileTab;
  preferredLanguage: StudyLanguage;
  translatedLessons: Record<string, MicroLesson>;
  isTranslatingLesson: boolean;
  sandboxCodeRequest: string | null;
  virtualFiles: Record<string, string>;
  activeGlossaryTerm: GlossaryEntry | null;
  activeConceptModal: GlobalConceptRecord | null;
  globalConcepts: GlobalConceptRecord[];
  globalCompetencyMastery: Record<string, GlobalCompetencyMasteryRecord>;
  exerciseBankCount: number;
  lessonProgressMap: Record<string, LessonProgressRecord>;
  srsStates: Record<string, SrsCardStateRecord>;
  pcLabQueue: PcLabQueueItem[];
  fastTrackChapters: Record<string, boolean>;
  telemetryEvents: LearningTelemetryRecord[];
  userStats: UserStatsRecord;
  unlockedAchievementIds: string[];
  toasts: ToastMessage[];
  liveMemoryTrace: PythonExecutionResult | null;
  liveMemorySteps: MemoryStep[];
  liveMemoryOwnerBlockId: string | null;
  isHydrated: boolean;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  compilerOpen: boolean;
  settings: PlatformSettings;

  setGlobalRoute: (route: GlobalRoute) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCompilerOpen: (open: boolean) => void;
  setSettings: (partial: Partial<PlatformSettings>) => void;
  setSandboxCodeRequest: (code: string | null) => void;
  setChapterFastTrack: (chapterId: string, fastTrack: boolean) => void;
  hydrateFromDb: () => Promise<void>;
  refreshKnowledgeGraph: () => Promise<void>;
  registerCartridge: (cartridge: BookCartridge, persist?: boolean) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  openBook: (bookId: string) => Promise<void>;
  openBookAtLesson: (bookId: string, chapterId: string, lessonId: string, blockIndex?: number) => Promise<void>;
  closeBook: (targetRoute?: GlobalRoute) => void;
  selectLesson: (chapterId: string, lessonId: string, options?: { resume?: boolean }) => Promise<void>;
  markLessonAsStudied: (bookId: string, chapterId: string, lessonId: string) => Promise<number>;
  markChapterAsStudied: (bookId: string, chapterId: string) => Promise<number>;
  goToNextLesson: () => Promise<boolean>;
  setViewMode: (mode: ViewMode) => void;
  setStudioTab: (tab: StudioTab) => void;
  setMobileTab: (tab: MobileTab) => void;
  setActiveGlossaryTerm: (entry: GlossaryEntry | null) => void;
  setActiveConceptModal: (concept: GlobalConceptRecord | null) => void;
  setActiveBlockIndex: (index: number) => void;
  advanceUnlockedBlock: (nextIndex: number) => Promise<void>;
  setStudyLanguage: (lang: StudyLanguage) => Promise<void>;
  enqueuePcLab: (item: Omit<PcLabQueueItem, 'queuedAt'>) => void;
  resolvePcLab: (bookId: string, lessonId: string, blockId: string) => void;
  replacePcLabQueue: (items: PcLabQueueItem[]) => void;
  updateVirtualFile: (fileName: string, content: string) => Promise<void>;
  createVirtualFile: (fileName: string, content?: string) => Promise<void>;
  deleteVirtualFile: (fileName: string) => Promise<void>;
  syncVirtualFilesFromRuntime: (files: Record<string, string>) => Promise<void>;
  recordAttempt: (firstTryCorrect: boolean) => Promise<void>;
  recordAstMastery: () => Promise<void>;
  recordCompetencySignal: (signal: CompetencyEvidenceSignal) => Promise<void>;
  recordLearningTelemetry: (event: Omit<LearningTelemetryRecord, 'id' | 'createdAt'>) => Promise<void>;
  flagPcLabFailure: (cardId: string) => Promise<void>;
  gradeFlashcard: (cardId: string, grade: Sm2Grade, latencyMs?: number) => Promise<void>;
  gradeGlobalFlashcard: (
    bookId: string,
    cardId: string,
    rating: FsrsRating,
    latencyMs?: number,
    competencyIds?: string[]
  ) => Promise<void>;
  setLiveMemoryTrace: (result: PythonExecutionResult | null) => void;
  setLiveMemorySteps: (steps: MemoryStep[], ownerBlockId?: string | null) => void;
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  checkAchievements: () => Promise<void>;
}

const DEFAULT_STATS = createInitialUserStats();

function progressKey(bookId: string, lessonId: string): string {
  return `${bookId}::${lessonId}`;
}

function srsKey(bookId: string, cardId: string): string {
  return `${bookId}::${cardId}`;
}

function detectInitialViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'DESKTOP_STUDIO';
  return window.innerWidth < 1024 ? 'MOBILE_COMPANION' : 'DESKTOP_STUDIO';
}

const SETTINGS_STORAGE_KEY = 'living_books_settings_v2';

const DEFAULT_SETTINGS: PlatformSettings = {
  llmProvider: 'openrouter',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-2.0-flash-001',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  supabaseUrl: '',
  supabaseAnonKey: '',
  supabaseSyncKey: 'default-learner',
};

function loadStoredSettings(): PlatformSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PlatformSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: PlatformSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function loadPcLabQueue(): PcLabQueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('ulb_pc_lab_queue');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistPcLabQueue(queue: PcLabQueueItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('ulb_pc_lab_queue', JSON.stringify(queue));
  } catch {
    // ignore storage quota errors
  }
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  cartridges: {},
  globalRoute: 'LIBRARY',
  activeBookId: null,
  activeChapterId: null,
  activeLessonId: null,
  activeBlockIndex: 0,
  unlockedBlockIndex: 0,
  viewMode: detectInitialViewMode(),
  studioTab: 'MEMORY',
  mobileTab: 'READ',
  preferredLanguage: 'es',
  translatedLessons: {},
  isTranslatingLesson: false,
  sandboxCodeRequest: null,
  virtualFiles: {},
  activeGlossaryTerm: null,
  activeConceptModal: null,
  globalConcepts: [],
  globalCompetencyMastery: {},
  exerciseBankCount: 0,
  lessonProgressMap: {},
  srsStates: {},
  pcLabQueue: loadPcLabQueue(),
  fastTrackChapters: {},
  telemetryEvents: [],
  userStats: DEFAULT_STATS,
  unlockedAchievementIds: [],
  toasts: [],
  liveMemoryTrace: null,
  liveMemorySteps: [],
  liveMemoryOwnerBlockId: null,
  isHydrated: false,
  commandPaletteOpen: false,
  settingsOpen: false,
  compilerOpen: false,
  settings: loadStoredSettings(),

  setGlobalRoute: (route) =>
    set({
      globalRoute: route,
      activeBookId: null,
      activeChapterId: null,
      activeLessonId: null,
      activeBlockIndex: 0,
      unlockedBlockIndex: 0,
      activeGlossaryTerm: null,
      liveMemoryTrace: null,
      sandboxCodeRequest: null,
    }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setCompilerOpen: (open) => set({ compilerOpen: open }),
  setSandboxCodeRequest: (code) => set({ sandboxCodeRequest: code }),
  setChapterFastTrack: (chapterId, fastTrack) => {
    const bookId = get().activeBookId;
    if (!bookId) return;
    set((state) => ({
      fastTrackChapters: { ...state.fastTrackChapters, [`${bookId}::${chapterId}`]: fastTrack },
    }));
  },
  setSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    persistSettings(next);
    set({ settings: next });
  },
  enqueuePcLab: (item) => {
    const current = get().pcLabQueue;
    if (
      current.some(
        (q) => q.bookId === item.bookId && q.lessonId === item.lessonId && q.blockId === item.blockId
      )
    ) {
      return;
    }
    const next: PcLabQueueItem[] = [...current, { ...item, queuedAt: Date.now() }];
    persistPcLabQueue(next);
    set({ pcLabQueue: next });
  },
  resolvePcLab: (bookId, lessonId, blockId) => {
    const next = get().pcLabQueue.filter(
      (q) => !(q.bookId === bookId && q.lessonId === lessonId && q.blockId === blockId)
    );
    persistPcLabQueue(next);
    set({ pcLabQueue: next });
  },
  replacePcLabQueue: (items) => {
    persistPcLabQueue(items);
    set({ pcLabQueue: items });
  },

  refreshKnowledgeGraph: async () => {
    try {
      const [concepts, masteryArr, bankCount] = await Promise.all([
        livingBooksDb.concepts ? livingBooksDb.concepts.toArray().catch(() => []) : Promise.resolve([]),
        livingBooksDb.globalCompetencyMastery
          ? livingBooksDb.globalCompetencyMastery.toArray().catch(() => [])
          : Promise.resolve([]),
        livingBooksDb.exerciseBank ? livingBooksDb.exerciseBank.count().catch(() => 0) : Promise.resolve(0),
      ]);
      const masteryMap: Record<string, GlobalCompetencyMasteryRecord> = {};
      for (const m of masteryArr) {
        masteryMap[m.competencyId] = m;
      }
      concepts.sort((a, b) => a.term.localeCompare(b.term));
      set({
        globalConcepts: concepts,
        globalCompetencyMastery: masteryMap,
        exerciseBankCount: bankCount,
      });
    } catch {
      // ignore in restricted environments
    }
  },

  hydrateFromDb: async () => {
    const [installed, progress, srs, stats, achievements, translations, telemetry] = await Promise.all([
      livingBooksDb.installedCartridges.toArray(),
      livingBooksDb.lessonProgress.toArray(),
      livingBooksDb.srsCardsState.toArray(),
      livingBooksDb.userStats.get('global'),
      livingBooksDb.unlockedAchievements.toArray(),
      livingBooksDb.lessonTranslations.toArray().catch(() => []),
      livingBooksDb.learningTelemetry ? livingBooksDb.learningTelemetry.toArray().catch(() => []) : Promise.resolve([]),
    ]);

    const cartridges: Record<string, BookCartridge> = { ...get().cartridges };
    for (const record of installed) {
      const repaired = repairCartridgeForRuntime(record.cartridgeJson);
      if (repaired) {
        cartridges[record.bookId] = repaired;
      } else {
        const validation = validateBookCartridge(record.cartridgeJson);
        if (validation.success) {
          cartridges[record.bookId] = validation.cartridge;
        }
      }
    }

    const lessonProgressMap: Record<string, LessonProgressRecord> = {};
    for (const record of progress) {
      lessonProgressMap[progressKey(record.bookId, record.lessonId)] = record;
    }

    const srsStates: Record<string, SrsCardStateRecord> = {};
    for (const record of srs) {
      srsStates[srsKey(record.bookId, record.cardId)] = record;
    }

    const translatedLessons: Record<string, MicroLesson> = {};
    for (const tr of translations) {
      translatedLessons[`${tr.bookId}::${tr.lessonId}::${tr.lang}`] = tr.translatedLesson;
    }

    set({
      cartridges,
      lessonProgressMap,
      srsStates,
      translatedLessons,
      telemetryEvents: telemetry,
      userStats: stats ?? DEFAULT_STATS,
      unlockedAchievementIds: achievements.map((a) => `${a.bookId}::${a.achievementId}`),
      isHydrated: true,
    });

    // Indexar cartuchos instalados en el grafo de conocimiento (glosario global + banco de ejercicios)
    for (const book of Object.values(cartridges)) {
      await indexCartridgeIntoKnowledgeGraph(book).catch(() => {});
    }
    await get().refreshKnowledgeGraph();
  },

  registerCartridge: async (cartridge, persist = true) => {
    const safeCartridge = repairCartridgeForRuntime(cartridge) ?? cartridge;
    set((state) => ({
      cartridges: { ...state.cartridges, [safeCartridge.bookId]: safeCartridge },
    }));
    if (persist) {
      await livingBooksDb.installedCartridges.put({
        bookId: safeCartridge.bookId,
        cartridgeJson: safeCartridge,
        installedAt: Date.now(),
      });
    }
    await indexCartridgeIntoKnowledgeGraph(safeCartridge).catch(() => {});
    await get().refreshKnowledgeGraph();
  },

  deleteBook: async (bookId) => {
    await Promise.all([
      livingBooksDb.installedCartridges.delete(bookId),
      livingBooksDb.lessonProgress.where('bookId').equals(bookId).delete(),
      livingBooksDb.srsCardsState.where('bookId').equals(bookId).delete(),
      livingBooksDb.virtualFileSystems.delete(bookId),
      livingBooksDb.lessonTranslations.where('bookId').equals(bookId).delete().catch(() => {}),
      livingBooksDb.exerciseBank
        ? livingBooksDb.exerciseBank.where('bookId').equals(bookId).delete().catch(() => {})
        : Promise.resolve(),
    ]);
    set((state) => {
      const nextCartridges = { ...state.cartridges };
      delete nextCartridges[bookId];
      const nextProgress = { ...state.lessonProgressMap };
      for (const k of Object.keys(nextProgress)) {
        if (k.startsWith(`${bookId}::`)) delete nextProgress[k];
      }
      return {
        cartridges: nextCartridges,
        lessonProgressMap: nextProgress,
        activeBookId: state.activeBookId === bookId ? null : state.activeBookId,
        activeChapterId: state.activeBookId === bookId ? null : state.activeChapterId,
        activeLessonId: state.activeBookId === bookId ? null : state.activeLessonId,
      };
    });
    await get().refreshKnowledgeGraph();
  },

  openBook: async (bookId) => {
    const cartridge = get().cartridges[bookId];
    if (!cartridge) return;

    const firstChapter = cartridge.chapters[0];
    const firstLesson = firstChapter?.microLessons[0];

    const vfsRecord = await livingBooksDb.virtualFileSystems.get(bookId);
    const virtualFiles =
      vfsRecord?.files ?? sanitizeVirtualFileSystemSeed(cartridge.runtimeRequirements.virtualFileSystemSeed);

    if (!vfsRecord) {
      await livingBooksDb.virtualFileSystems.put({
        bookId,
        files: virtualFiles,
        updatedAt: Date.now(),
      });
    }

    let progressRecord = firstLesson
      ? await livingBooksDb.lessonProgress.get([bookId, firstLesson.lessonId])
      : undefined;

    if (firstLesson && !progressRecord) {
      progressRecord = {
        bookId,
        lessonId: firstLesson.lessonId,
        unlockedBlockIndex: 0,
        isCompleted: false,
        masteryTier: 'IN_PROGRESS',
        hadMistakes: false,
        updatedAt: Date.now(),
      };
      await livingBooksDb.lessonProgress.put(progressRecord);
    }

    const unlocked = progressRecord?.unlockedBlockIndex ?? 0;

    set((state) => ({
      activeBookId: bookId,
      activeChapterId: firstChapter?.chapterId ?? null,
      activeLessonId: firstLesson?.lessonId ?? null,
      activeBlockIndex: 0,
      unlockedBlockIndex: unlocked,
      virtualFiles,
      activeGlossaryTerm: null,
      activeConceptModal: null,
      liveMemoryTrace: null,
      sandboxCodeRequest: null,
      lessonProgressMap:
        firstLesson && progressRecord
          ? {
              ...state.lessonProgressMap,
              [progressKey(bookId, firstLesson.lessonId)]: progressRecord,
            }
          : state.lessonProgressMap,
    }));
  },

  openBookAtLesson: async (bookId, chapterId, lessonId, blockIndex) => {
    await get().openBook(bookId);
    await get().selectLesson(chapterId, lessonId);
    if (typeof blockIndex === 'number' && blockIndex >= 0) {
      await get().advanceUnlockedBlock(blockIndex);
      get().setActiveBlockIndex(blockIndex);
    }
  },

  closeBook: (targetRoute = 'LIBRARY') => {
    set({
      globalRoute: targetRoute,
      activeBookId: null,
      activeChapterId: null,
      activeLessonId: null,
      activeBlockIndex: 0,
      unlockedBlockIndex: 0,
      activeGlossaryTerm: null,
      liveMemoryTrace: null,
      sandboxCodeRequest: null,
    });
  },

  selectLesson: async (chapterId, lessonId, options) => {
    const { activeBookId } = get();
    if (!activeBookId) return;
    let record = await livingBooksDb.lessonProgress.get([activeBookId, lessonId]);
    if (!record) {
      record = {
        bookId: activeBookId,
        lessonId,
        unlockedBlockIndex: 0,
        isCompleted: false,
        masteryTier: 'IN_PROGRESS',
        hadMistakes: false,
        updatedAt: Date.now(),
      };
      await livingBooksDb.lessonProgress.put(record);
    }
    const maxIdx = record.unlockedBlockIndex ?? 0;
    // Siempre abrir al principio de la lección (Paso 1) salvo que se pida resume explícito
    const startIdx = options?.resume ? maxIdx : 0;
    set((state) => ({
      activeChapterId: chapterId,
      activeLessonId: lessonId,
      activeBlockIndex: startIdx,
      unlockedBlockIndex: maxIdx,
      activeGlossaryTerm: null,
      liveMemoryTrace: null,
      sandboxCodeRequest: null,
      lessonProgressMap: {
        ...state.lessonProgressMap,
        [progressKey(activeBookId, lessonId)]: record as LessonProgressRecord,
      },
    }));
  },

  markLessonAsStudied: async (bookId, chapterId, lessonId) => {
    const cartridge = get().cartridges[bookId];
    const chapter = cartridge?.chapters.find((c) => c.chapterId === chapterId);
    const lesson = chapter?.microLessons.find((l) => l.lessonId === lessonId);
    if (!cartridge || !chapter || !lesson) return 0;

    const now = Date.now();
    const existingProg = await livingBooksDb.lessonProgress.get([bookId, lessonId]);
    const lastIdx = Math.max(0, lesson.blocks.length - 1);
    const updatedProg: LessonProgressRecord = {
      bookId,
      lessonId,
      unlockedBlockIndex: Math.max(existingProg?.unlockedBlockIndex ?? 0, lastIdx),
      isCompleted: true,
      masteryTier: existingProg?.masteryTier === 'GOLD' ? 'GOLD' : 'SILVER',
      hadMistakes: existingProg?.hadMistakes ?? false,
      updatedAt: now,
    };
    await livingBooksDb.lessonProgress.put(updatedProg);

    const updatedSrs = { ...get().srsStates };
    let enrolledCount = 0;
    const lessonComps =
      lesson.competencyIds && lesson.competencyIds.length > 0
        ? lesson.competencyIds
        : matchCompetenciesFromText([chapter.title, lesson.title], 2);

    for (const blk of lesson.blocks) {
      if (blk.type === 'FLASHCARD') {
        const key = srsKey(bookId, blk.cardId);
        const existing = updatedSrs[key];
        const base = existing ?? createInitialSrsState(bookId, blk.cardId, now, true);
        const compIds =
          blk.competencyIds && blk.competencyIds.length > 0
            ? blk.competencyIds
            : matchCompetenciesFromText([...(blk.conceptTags ?? []), ...blk.tags, lesson.title], 2);
        const enrolledRecord: SrsCardStateRecord = {
          ...base,
          enrolled: true,
          enrolledAt: base.enrolledAt ?? now,
          // Vence de inmediato para permitir practicar en el Global SRS Hub al marcar como estudiado
          nextReviewTimestamp: existing?.enrolled ? existing.nextReviewTimestamp : now,
          sourceBlockId: blk.sourceBlockId ?? base.sourceBlockId,
          conceptTags: blk.conceptTags ?? blk.tags,
          competencyIds: compIds.length > 0 ? compIds : lessonComps,
          chapterId: chapter.chapterId,
          chapterNumber: chapter.number,
          lessonId: lesson.lessonId,
          fsrsState: base.fsrsState ?? 'NEW',
          updatedAt: now,
        };
        updatedSrs[key] = enrolledRecord;
        await livingBooksDb.srsCardsState.put(enrolledRecord);
        enrolledCount += 1;
      }
    }

    set((state) => ({
      srsStates: updatedSrs,
      lessonProgressMap: {
        ...state.lessonProgressMap,
        [progressKey(bookId, lessonId)]: updatedProg,
      },
    }));

    return enrolledCount;
  },

  markChapterAsStudied: async (bookId, chapterId) => {
    const cartridge = get().cartridges[bookId];
    const chapter = cartridge?.chapters.find((c) => c.chapterId === chapterId);
    if (!chapter) return 0;

    let totalEnrolled = 0;
    for (const ml of chapter.microLessons) {
      totalEnrolled += await get().markLessonAsStudied(bookId, chapterId, ml.lessonId);
    }

    get().pushToast({
      title: `Módulo ${chapter.number} marcado como estudiado`,
      description: `${totalEnrolled} tarjetas enroladas en tu Hub Global de Repaso FSRS.`,
      iconKey: 'sparkles',
    });
    return totalEnrolled;
  },

  goToNextLesson: async () => {
    const { activeBookId, activeChapterId, activeLessonId, cartridges } = get();
    if (!activeBookId || !activeLessonId) return false;
    const cartridge = cartridges[activeBookId];
    if (!cartridge) return false;

    const flat: Array<{ chapterId: string; lessonId: string }> = [];
    for (const ch of cartridge.chapters) {
      for (const ml of ch.microLessons) {
        flat.push({ chapterId: ch.chapterId, lessonId: ml.lessonId });
      }
    }
    const idx = flat.findIndex(
      (item) => item.lessonId === activeLessonId && (!activeChapterId || item.chapterId === activeChapterId)
    );
    if (idx < 0 || idx + 1 >= flat.length) return false;
    const next = flat[idx + 1];
    await get().selectLesson(next.chapterId, next.lessonId);
    return true;
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setStudioTab: (tab) => set({ studioTab: tab }),
  setMobileTab: (tab) => set({ mobileTab: tab }),
  setActiveGlossaryTerm: (entry) => set({ activeGlossaryTerm: entry }),
  setActiveConceptModal: (concept) => set({ activeConceptModal: concept }),

  setActiveBlockIndex: (index) => {
    const { unlockedBlockIndex } = get();
    const clamped = Math.max(0, Math.min(index, unlockedBlockIndex));
    set({ activeBlockIndex: clamped });
  },

  advanceUnlockedBlock: async (nextIndex) => {
    const { activeBookId, activeChapterId, activeLessonId, unlockedBlockIndex, cartridges } = get();
    if (!activeBookId || !activeLessonId) return;

    const cartridge = cartridges[activeBookId];
    const chapter = cartridge?.chapters.find(
      (c) =>
        c.chapterId === activeChapterId ||
        c.microLessons.some((l) => l.lessonId === activeLessonId)
    );
    const lesson = chapter?.microLessons.find((l) => l.lessonId === activeLessonId);
    const totalBlocks = lesson?.blocks.length ?? 0;
    const clampedTarget = totalBlocks > 0 ? Math.min(nextIndex, totalBlocks - 1) : nextIndex;

    if (clampedTarget <= unlockedBlockIndex) {
      set({ activeBlockIndex: Math.max(0, clampedTarget) });
      return;
    }

    const reachedEnd = totalBlocks > 0 && clampedTarget >= totalBlocks - 1;

    const existing = await livingBooksDb.lessonProgress.get([activeBookId, activeLessonId]);
    const hadMistakes = existing?.hadMistakes ?? false;
    const isCompleted = (existing?.isCompleted ?? false) || reachedEnd;
    const masteryTier: MasteryTier = isCompleted
      ? hadMistakes
        ? 'SILVER'
        : 'GOLD'
      : existing?.masteryTier ?? 'IN_PROGRESS';

    const merged: LessonProgressRecord = {
      bookId: activeBookId,
      lessonId: activeLessonId,
      unlockedBlockIndex: clampedTarget,
      isCompleted,
      masteryTier,
      hadMistakes,
      updatedAt: Date.now(),
    };

    await livingBooksDb.lessonProgress.put(merged);

    // Enrolar tarjetas de esta lección en FSRS al completarla (solo material ya estudiado)
    let nextSrsStates = get().srsStates;
    if (isCompleted && lesson && chapter) {
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const updatedSrs = { ...nextSrsStates };
      let changed = false;
      const lessonComps =
        lesson.competencyIds && lesson.competencyIds.length > 0
          ? lesson.competencyIds
          : matchCompetenciesFromText([chapter.title, lesson.title], 2);

      for (const blk of lesson.blocks) {
        if (blk.type === 'FLASHCARD') {
          const key = srsKey(activeBookId, blk.cardId);
          if (!updatedSrs[key] || !updatedSrs[key].enrolled) {
            const base = updatedSrs[key] ?? createInitialSrsState(activeBookId, blk.cardId, now, true);
            const compIds =
              blk.competencyIds && blk.competencyIds.length > 0
                ? blk.competencyIds
                : matchCompetenciesFromText([...(blk.conceptTags ?? []), ...blk.tags, lesson.title], 2);
            const enrolledRecord: SrsCardStateRecord = {
              ...base,
              enrolled: true,
              enrolledAt: base.enrolledAt ?? now,
              nextReviewTimestamp: base.failedInPcLab ? now : now + ONE_DAY_MS,
              sourceBlockId: blk.sourceBlockId ?? base.sourceBlockId,
              conceptTags: blk.conceptTags ?? blk.tags,
              competencyIds: compIds.length > 0 ? compIds : lessonComps,
              chapterId: chapter.chapterId,
              chapterNumber: chapter.number,
              lessonId: lesson.lessonId,
              fsrsState: base.fsrsState ?? 'NEW',
              updatedAt: now,
            };
            updatedSrs[key] = enrolledRecord;
            await livingBooksDb.srsCardsState.put(enrolledRecord);
            changed = true;
          }
        }
      }
      if (changed) nextSrsStates = updatedSrs;
    }

    set((state) => ({
      activeBlockIndex: clampedTarget,
      unlockedBlockIndex: clampedTarget,
      srsStates: nextSrsStates,
      lessonProgressMap: {
        ...state.lessonProgressMap,
        [progressKey(activeBookId, activeLessonId)]: merged,
      },
    }));
    if (isCompleted) {
      await get().checkAchievements();
    }
  },

  setStudyLanguage: async (lang) => {
    set({ preferredLanguage: lang });
    const { activeBookId, activeLessonId, translatedLessons, settings } = get();
    const baseLesson = selectActiveLessonRaw(get());
    if (!activeBookId || !activeLessonId || !baseLesson) return;

    const cacheKey = `${activeBookId}::${activeLessonId}::${lang}`;
    if (translatedLessons[cacheKey]) return;

    // Consultar Dexie por si ya fue traducida previamente
    const dbCached = await livingBooksDb.lessonTranslations.get([activeBookId, activeLessonId, lang]);
    if (dbCached) {
      set((state) => ({
        translatedLessons: { ...state.translatedLessons, [cacheKey]: dbCached.translatedLesson },
      }));
      return;
    }

    // Si no tiene API key, no fallar silenciosamente: notificar claramente
    if (!settings.openrouterApiKey && !settings.geminiApiKey) {
      get().pushToast({
        title: 'Traduccion bajo demanda',
        description: 'Agrega una API Key en Configuracion para traducir esta leccion al vuelo (se guarda en cache).',
        iconKey: 'error',
      });
      return;
    }

    set({ isTranslatingLesson: true });
    try {
      const provider = settings.geminiApiKey && !settings.openrouterApiKey ? 'gemini' : 'openrouter';
      const translated = await translateMicroLessonOnDemand(baseLesson, lang, {
        provider,
        openrouterApiKey: settings.openrouterApiKey,
        geminiApiKey: settings.geminiApiKey,
        model: provider === 'gemini' ? 'gemini-2.5-flash-lite' : 'google/gemini-2.5-flash-lite',
      });
      await livingBooksDb.lessonTranslations.put({
        bookId: activeBookId,
        lessonId: activeLessonId,
        lang,
        translatedLesson: translated,
        updatedAt: Date.now(),
      });
      set((state) => ({
        translatedLessons: { ...state.translatedLessons, [cacheKey]: translated },
      }));
    } catch (err) {
      get().pushToast({
        title: 'No se pudo traducir',
        description: err instanceof Error ? err.message : String(err),
        iconKey: 'error',
      });
    } finally {
      set({ isTranslatingLesson: false });
    }
  },

  updateVirtualFile: async (fileName, content) => {
    const { activeBookId, virtualFiles } = get();
    if (!activeBookId) return;
    const next = { ...virtualFiles, [fileName]: content };
    set({ virtualFiles: next });
    await livingBooksDb.virtualFileSystems.put({
      bookId: activeBookId,
      files: next,
      updatedAt: Date.now(),
    });
  },

  createVirtualFile: async (fileName, content = '') => {
    await get().updateVirtualFile(fileName, content);
  },

  deleteVirtualFile: async (fileName) => {
    const { activeBookId, virtualFiles } = get();
    if (!activeBookId) return;
    const next = { ...virtualFiles };
    delete next[fileName];
    set({ virtualFiles: next });
    await livingBooksDb.virtualFileSystems.put({
      bookId: activeBookId,
      files: next,
      updatedAt: Date.now(),
    });
  },

  syncVirtualFilesFromRuntime: async (files) => {
    const { activeBookId, virtualFiles } = get();
    if (!activeBookId) return;
    const next = { ...virtualFiles, ...files };
    set({ virtualFiles: next });
    await livingBooksDb.virtualFileSystems.put({
      bookId: activeBookId,
      files: next,
      updatedAt: Date.now(),
    });
  },

  recordAttempt: async (firstTryCorrect) => {
    const { userStats, activeBookId, activeLessonId, unlockedBlockIndex, lessonProgressMap } = get();
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = userStats.lastStudyDate;

    let streak = userStats.currentStreakDays;
    if (lastDate !== today) {
      const last = new Date(lastDate).getTime();
      const now = new Date(today).getTime();
      const dayDiff = Math.round((now - last) / (24 * 60 * 60 * 1000));
      streak = dayDiff === 1 ? streak + 1 : 1;
    }

    const next: UserStatsRecord = {
      ...userStats,
      currentStreakDays: streak,
      lastStudyDate: today,
      totalAttempts: userStats.totalAttempts + 1,
      totalFirstTryHits: userStats.totalFirstTryHits + (firstTryCorrect ? 1 : 0),
      currentFirstTryStreak: firstTryCorrect ? userStats.currentFirstTryStreak + 1 : 0,
      updatedAt: Date.now(),
    };

    await livingBooksDb.userStats.put(next);

    // Corregir GOLD falso: si falla un intento en la lección activa, marcar hadMistakes=true
    let nextProgressMap = lessonProgressMap;
    if (!firstTryCorrect && activeBookId && activeLessonId) {
      const pKey = progressKey(activeBookId, activeLessonId);
      const existing =
        lessonProgressMap[pKey] ??
        (await livingBooksDb.lessonProgress.get([activeBookId, activeLessonId]));
      const updatedProg: LessonProgressRecord = {
        bookId: activeBookId,
        lessonId: activeLessonId,
        unlockedBlockIndex: existing?.unlockedBlockIndex ?? unlockedBlockIndex,
        isCompleted: existing?.isCompleted ?? false,
        masteryTier: existing?.isCompleted ? 'SILVER' : existing?.masteryTier ?? 'IN_PROGRESS',
        hadMistakes: true,
        updatedAt: Date.now(),
      };
      await livingBooksDb.lessonProgress.put(updatedProg);
      nextProgressMap = { ...lessonProgressMap, [pKey]: updatedProg };
    }

    set({ userStats: next, lessonProgressMap: nextProgressMap });
    await get().checkAchievements();
  },

  recordAstMastery: async () => {
    const stats = get().userStats;
    const next: UserStatsRecord = {
      ...stats,
      astMasteryCount: stats.astMasteryCount + 1,
      updatedAt: Date.now(),
    };
    await livingBooksDb.userStats.put(next);
    set({ userStats: next });
    await get().checkAchievements();
  },

  recordCompetencySignal: async (signal) => {
    const updated = await recordCompetencyEvidence(signal);
    if (updated.length > 0) {
      set((state) => {
        const nextMap = { ...state.globalCompetencyMastery };
        for (const rec of updated) {
          nextMap[rec.competencyId] = rec;
        }
        return { globalCompetencyMastery: nextMap };
      });
    }
  },

  recordLearningTelemetry: async (event) => {
    const record: LearningTelemetryRecord = {
      ...event,
      createdAt: Date.now(),
    };
    try {
      if (livingBooksDb.learningTelemetry) {
        await livingBooksDb.learningTelemetry.add(record);
      }
    } catch {
      // ignore in mocked test environments
    }
    set((state) => ({ telemetryEvents: [...state.telemetryEvents.slice(-500), record] }));

    // Propagar evidencia automáticamente al grafo de dominio libro-agnóstico
    const compIds = event.competencyId ? [event.competencyId] : undefined;
    const tags = event.conceptTag ? [event.conceptTag] : undefined;
    if (event.eventType === 'PREDICTION_ATTEMPT') {
      await get().recordCompetencySignal({
        bookId: event.bookId,
        competencyIds: compIds,
        conceptTags: tags,
        kind: 'PREDICTION',
        passed: event.passed,
      });
    } else if (event.eventType === 'TRANSFER_LAB') {
      await get().recordCompetencySignal({
        bookId: event.bookId,
        competencyIds: compIds,
        conceptTags: tags,
        kind: 'TRANSFER_LAB',
        passed: event.passed,
      });
    } else if (event.eventType === 'DICTIONARY_MICRO_EVAL') {
      await get().recordCompetencySignal({
        bookId: event.bookId,
        competencyIds: compIds,
        conceptTags: tags,
        kind: 'ACTIVE_EXERCISE',
        passed: event.passed,
      });
    } else if (event.eventType === 'MISCONCEPTION_TRIGGERED' && event.misconceptionId) {
      await get().recordCompetencySignal({
        bookId: event.bookId,
        competencyIds: compIds,
        misconceptionId: event.misconceptionId,
        kind: 'MISCONCEPTION_TRIGGERED',
      });
    } else if (event.eventType === 'MISCONCEPTION_RESOLVED' && event.misconceptionId) {
      await get().recordCompetencySignal({
        bookId: event.bookId,
        competencyIds: compIds,
        misconceptionId: event.misconceptionId,
        kind: 'MISCONCEPTION_RESOLVED',
      });
    }
  },

  flagPcLabFailure: async (cardId) => {
    const { activeBookId, srsStates } = get();
    if (!activeBookId) return;
    const key = srsKey(activeBookId, cardId);
    const next = injectPcLabFailure(srsStates[key], activeBookId, cardId);
    await livingBooksDb.srsCardsState.put(next);
    set((state) => ({ srsStates: { ...state.srsStates, [key]: next } }));
  },

  gradeGlobalFlashcard: async (bookId, cardId, rating, latencyMs, competencyIds) => {
    const { srsStates, userStats } = get();
    const key = srsKey(bookId, cardId);
    const prev = srsStates[key] ?? createInitialSrsState(bookId, cardId, Date.now(), true);
    const daysSinceLastPractice = prev.lastReviewAt ?? prev.updatedAt
      ? Math.max(0, (Date.now() - (prev.lastReviewAt ?? prev.updatedAt)) / (24 * 60 * 60 * 1000))
      : 0;
    const next = computeNextFsrsState(prev, rating);
    if (competencyIds && competencyIds.length > 0 && (!next.competencyIds || next.competencyIds.length === 0)) {
      next.competencyIds = competencyIds;
    }
    await livingBooksDb.srsCardsState.put(next);

    const nextStats: UserStatsRecord = {
      ...userStats,
      srsReviewsCount: userStats.srsReviewsCount + 1,
      updatedAt: Date.now(),
    };
    await livingBooksDb.userStats.put(nextStats);

    set((state) => ({
      srsStates: { ...state.srsStates, [key]: next },
      userStats: nextStats,
    }));

    const resolvedComps = next.competencyIds ?? competencyIds;
    await get().recordCompetencySignal({
      bookId,
      competencyIds: resolvedComps,
      conceptTags: next.conceptTags,
      kind: 'SRS_REVIEW',
      passed: rating >= 2,
      fsrsStability: next.stability,
      daysSinceLastPractice,
    });

    await get().recordLearningTelemetry({
      bookId,
      blockId: cardId,
      eventType: 'SRS_DELAYED_REVIEW',
      conceptTag: next.conceptTags?.[0],
      competencyId: resolvedComps?.[0],
      passed: rating >= 2,
      latencyMs,
      daysSinceLastPractice,
    });
    await get().checkAchievements();
  },

  gradeFlashcard: async (cardId, grade, latencyMs) => {
    const { activeBookId } = get();
    if (!activeBookId) return;
    await get().gradeGlobalFlashcard(activeBookId, cardId, sm2GradeToFsrsRating(grade), latencyMs);
  },

  setLiveMemoryTrace: (result) => set({ liveMemoryTrace: result }),

  setLiveMemorySteps: (steps, ownerBlockId = null) =>
    set({ liveMemorySteps: steps, liveMemoryOwnerBlockId: ownerBlockId }),

  pushToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => get().dismissToast(id), 5200);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  checkAchievements: async () => {
    const { activeBookId, cartridges, userStats, unlockedAchievementIds } = get();
    if (!activeBookId) return;
    const cartridge = cartridges[activeBookId];
    if (!cartridge) return;

    for (const achievement of cartridge.achievements) {
      const key = `${activeBookId}::${achievement.id}`;
      if (unlockedAchievementIds.includes(key)) continue;

      let currentValue = 0;
      switch (achievement.rule.metric) {
        case 'FIRST_TRY_STREAK':
          currentValue = userStats.currentFirstTryStreak;
          break;
        case 'AST_MASTERY':
          currentValue = userStats.astMasteryCount;
          break;
        case 'SRS_REVIEWS':
          currentValue = userStats.srsReviewsCount;
          break;
        case 'LESSON_COMPLETE':
          currentValue = Object.values(get().lessonProgressMap).filter((p) => p.isCompleted).length;
          break;
      }

      if (currentValue >= achievement.rule.threshold) {
        await livingBooksDb.unlockedAchievements.put({
          bookId: activeBookId,
          achievementId: achievement.id,
          unlockedAt: Date.now(),
        });
        set((state) => ({ unlockedAchievementIds: [...state.unlockedAchievementIds, key] }));
        get().pushToast({
          title: `Logro desbloqueado: ${achievement.title}`,
          description: achievement.description,
          iconKey: achievement.iconKey,
        });
      }
    }
  },
}));

export function selectActiveCartridge(state: PlatformState): BookCartridge | null {
  if (!state.activeBookId) return null;
  return state.cartridges[state.activeBookId] ?? null;
}

export function selectActiveLessonRaw(state: PlatformState): MicroLesson | null {
  const cartridge = selectActiveCartridge(state);
  if (!cartridge || !state.activeLessonId) return null;
  for (const chapter of cartridge.chapters) {
    for (const lesson of chapter.microLessons) {
      if (lesson.lessonId === state.activeLessonId) return lesson;
    }
  }
  return null;
}

export function selectActiveLesson(state: PlatformState): MicroLesson | null {
  const base = selectActiveLessonRaw(state);
  if (!base || !state.activeBookId) return base;
  const cacheKey = `${state.activeBookId}::${base.lessonId}::${state.preferredLanguage}`;
  return state.translatedLessons[cacheKey] ?? base;
}

export function selectActiveBlock(state: PlatformState): LessonBlock | null {
  const lesson = selectActiveLesson(state);
  if (!lesson) return null;
  return lesson.blocks[state.activeBlockIndex] ?? lesson.blocks[state.unlockedBlockIndex] ?? null;
}

export function computeLessonMasteryTier(
  progress: LessonProgressRecord | undefined,
  totalBlocks: number
): MasteryTier {
  if (!progress) return 'LOCKED';
  if (progress.isCompleted && !progress.hadMistakes) return 'GOLD';
  if (progress.isCompleted) return 'SILVER';
  if (progress.unlockedBlockIndex > 0 || totalBlocks > 0) return 'IN_PROGRESS';
  return 'LOCKED';
}

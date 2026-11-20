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
  type LessonProgressRecord,
  type SrsCardStateRecord,
  type UserStatsRecord,
} from '../db/dexieDb';
import { validateBookCartridge } from '../types/cartridge.schema';
import {
  computeNextSm2State,
  createInitialSrsState,
  injectPcLabFailure,
  type Sm2Grade,
} from '../engine/srs/sm2Scheduler';
import { repairCartridgeForRuntime } from '../engine/compiler/lessonSanitizer';
import { translateMicroLessonOnDemand } from '../engine/compiler/llmCompiler';
import { sanitizeVirtualFileSystemSeed } from '../ui/utils/sanitize';

export type ViewMode = 'DESKTOP_STUDIO' | 'MOBILE_COMPANION';
export type StudioTab = 'MEMORY' | 'DATA' | 'GPU';
export type MobileTab = 'READ' | 'PRACTICE' | 'SRS' | 'MAP';
export type StudyLanguage = 'es' | 'en';

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
  lessonProgressMap: Record<string, LessonProgressRecord>;
  srsStates: Record<string, SrsCardStateRecord>;
  pcLabQueue: PcLabQueueItem[];
  userStats: UserStatsRecord;
  unlockedAchievementIds: string[];
  toasts: ToastMessage[];
  liveMemoryTrace: PythonExecutionResult | null;
  liveMemorySteps: MemoryStep[];
  isHydrated: boolean;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  compilerOpen: boolean;
  settings: PlatformSettings;

  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCompilerOpen: (open: boolean) => void;
  setSettings: (partial: Partial<PlatformSettings>) => void;
  setSandboxCodeRequest: (code: string | null) => void;
  hydrateFromDb: () => Promise<void>;
  registerCartridge: (cartridge: BookCartridge, persist?: boolean) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  openBook: (bookId: string) => Promise<void>;
  closeBook: () => void;
  selectLesson: (chapterId: string, lessonId: string) => Promise<void>;
  goToNextLesson: () => Promise<boolean>;
  setViewMode: (mode: ViewMode) => void;
  setStudioTab: (tab: StudioTab) => void;
  setMobileTab: (tab: MobileTab) => void;
  setActiveGlossaryTerm: (entry: GlossaryEntry | null) => void;
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
  flagPcLabFailure: (cardId: string) => Promise<void>;
  gradeFlashcard: (cardId: string, grade: Sm2Grade) => Promise<void>;
  setLiveMemoryTrace: (result: PythonExecutionResult | null) => void;
  setLiveMemorySteps: (steps: MemoryStep[]) => void;
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
  lessonProgressMap: {},
  srsStates: {},
  pcLabQueue: loadPcLabQueue(),
  userStats: DEFAULT_STATS,
  unlockedAchievementIds: [],
  toasts: [],
  liveMemoryTrace: null,
  liveMemorySteps: [],
  isHydrated: false,
  commandPaletteOpen: false,
  settingsOpen: false,
  compilerOpen: false,
  settings: loadStoredSettings(),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setCompilerOpen: (open) => set({ compilerOpen: open }),
  setSandboxCodeRequest: (code) => set({ sandboxCodeRequest: code }),
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

  hydrateFromDb: async () => {
    const [installed, progress, srs, stats, achievements, translations] = await Promise.all([
      livingBooksDb.installedCartridges.toArray(),
      livingBooksDb.lessonProgress.toArray(),
      livingBooksDb.srsCardsState.toArray(),
      livingBooksDb.userStats.get('global'),
      livingBooksDb.unlockedAchievements.toArray(),
      livingBooksDb.lessonTranslations.toArray().catch(() => []),
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
      userStats: stats ?? DEFAULT_STATS,
      unlockedAchievementIds: achievements.map((a) => `${a.bookId}::${a.achievementId}`),
      isHydrated: true,
    });
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
  },

  deleteBook: async (bookId) => {
    await Promise.all([
      livingBooksDb.installedCartridges.delete(bookId),
      livingBooksDb.lessonProgress.where('bookId').equals(bookId).delete(),
      livingBooksDb.srsCardsState.where('bookId').equals(bookId).delete(),
      livingBooksDb.virtualFileSystems.delete(bookId),
      livingBooksDb.lessonTranslations.where('bookId').equals(bookId).delete().catch(() => {}),
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

    const startBlock = progressRecord?.unlockedBlockIndex ?? 0;

    set((state) => ({
      activeBookId: bookId,
      activeChapterId: firstChapter?.chapterId ?? null,
      activeLessonId: firstLesson?.lessonId ?? null,
      activeBlockIndex: startBlock,
      unlockedBlockIndex: startBlock,
      virtualFiles,
      activeGlossaryTerm: null,
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

  closeBook: () => {
    set({
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

  selectLesson: async (chapterId, lessonId) => {
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
    set((state) => ({
      activeChapterId: chapterId,
      activeLessonId: lessonId,
      activeBlockIndex: maxIdx,
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

  setActiveBlockIndex: (index) => {
    const { unlockedBlockIndex } = get();
    const clamped = Math.max(0, Math.min(index, unlockedBlockIndex));
    set({ activeBlockIndex: clamped });
  },

  advanceUnlockedBlock: async (nextIndex) => {
    const { activeBookId, activeLessonId, unlockedBlockIndex, cartridges } = get();
    if (!activeBookId || !activeLessonId) return;

    const cartridge = cartridges[activeBookId];
    const lesson = cartridge?.chapters
      .flatMap((c) => c.microLessons)
      .find((l) => l.lessonId === activeLessonId);
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
    set((state) => ({
      activeBlockIndex: clampedTarget,
      unlockedBlockIndex: clampedTarget,
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
    const stats = get().userStats;
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = stats.lastStudyDate;

    let streak = stats.currentStreakDays;
    if (lastDate !== today) {
      const last = new Date(lastDate).getTime();
      const now = new Date(today).getTime();
      const dayDiff = Math.round((now - last) / (24 * 60 * 60 * 1000));
      streak = dayDiff === 1 ? streak + 1 : 1;
    }

    const next: UserStatsRecord = {
      ...stats,
      currentStreakDays: streak,
      lastStudyDate: today,
      totalAttempts: stats.totalAttempts + 1,
      totalFirstTryHits: stats.totalFirstTryHits + (firstTryCorrect ? 1 : 0),
      currentFirstTryStreak: firstTryCorrect ? stats.currentFirstTryStreak + 1 : 0,
      updatedAt: Date.now(),
    };

    await livingBooksDb.userStats.put(next);
    set({ userStats: next });
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

  flagPcLabFailure: async (cardId) => {
    const { activeBookId, srsStates } = get();
    if (!activeBookId) return;
    const key = srsKey(activeBookId, cardId);
    const next = injectPcLabFailure(srsStates[key], activeBookId, cardId);
    await livingBooksDb.srsCardsState.put(next);
    set((state) => ({ srsStates: { ...state.srsStates, [key]: next } }));
  },

  gradeFlashcard: async (cardId, grade) => {
    const { activeBookId, srsStates, userStats } = get();
    if (!activeBookId) return;
    const key = srsKey(activeBookId, cardId);
    const prev = srsStates[key] ?? createInitialSrsState(activeBookId, cardId);
    const next = computeNextSm2State(prev, grade);
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
    await get().checkAchievements();
  },

  setLiveMemoryTrace: (result) => set({ liveMemoryTrace: result }),

  setLiveMemorySteps: (steps) => set({ liveMemorySteps: steps }),

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

import { useSyncExternalStore } from 'react';
import { livingBooksDb } from '../../db/dexieDb';
import { usePlatformStore } from '../../store/usePlatformStore';
import type { BookCartridge } from '../../types/cartridge.types';
import type {
  BookMetadataDraft,
  CompilationJob,
  CompilerJobConfig,
  SectionTaskState,
  TelemetrySnapshot,
  TracerTelemetryState,
} from '../../types/compiler.types';
import {
  ParallelBookCompiler,
  buildPreFlightQuote,
  createSectionTasks,
  type CompilerCredentials,
} from './parallelCompilerEngine';
import {
  ParallelMemoryTracer,
  collectTracerSnippets,
} from './parallelMemoryTracer';
import type { SectionChunk, TracedSnippet } from './semanticChunker';

export type OrchestratorPhase =
  | 'IDLE'
  | 'TRACING'
  | 'COMPILING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface OrchestratorSnapshot {
  phase: OrchestratorPhase;
  bookId: string | null;
  bookTitle: string;
  jobId: string | null;
  tracerTelemetry: TracerTelemetryState | null;
  telemetry: TelemetrySnapshot | null;
  sections: Record<string, SectionTaskState>;
  readyChapters: number[];
  log: string[];
  error: string | null;
  tracerPaused: boolean;
  compilerPaused: boolean;
}

const INITIAL_SNAPSHOT: OrchestratorSnapshot = {
  phase: 'IDLE',
  bookId: null,
  bookTitle: '',
  jobId: null,
  tracerTelemetry: null,
  telemetry: null,
  sections: {},
  readyChapters: [],
  log: [],
  error: null,
  tracerPaused: false,
  compilerPaused: false,
};

export interface StartCompilationParams {
  bookId: string;
  metadata: BookMetadataDraft;
  chunks: SectionChunk[];
  config: CompilerJobConfig;
  credentials: CompilerCredentials;
  estimatedCostFallback: number;
  onChapterReady?: (chapterNumber: number, cartridge: BookCartridge) => void;
}

export interface InterruptedCompilationJob {
  bookId: string;
  metadata: BookMetadataDraft;
  chunks: SectionChunk[];
  totalChunks?: number;
  storedInIdb?: boolean;
  config: CompilerJobConfig;
  completedSectionIds: string[];
  estimatedCostFallback: number;
  savedAt: number;
}

const PENDING_JOB_KEY = 'ulb_pending_compilation_job';
const IDB_PENDING_JOB_ID = '__pending_compilation_job__';

function savePendingJob(job: InterruptedCompilationJob): void {
  const fullJson = JSON.stringify(job);
  void livingBooksDb.documentPages
    .put({ jobId: IDB_PENDING_JOB_ID, pageNumber: 0, text: fullJson })
    .catch(() => {});

  if (typeof localStorage === 'undefined') return;
  try {
    if (fullJson.length < 350_000) {
      localStorage.setItem(PENDING_JOB_KEY, fullJson);
    } else {
      const compact: InterruptedCompilationJob = {
        ...job,
        chunks: [],
        totalChunks: job.chunks.length,
        storedInIdb: true,
      };
      localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(compact));
    }
  } catch {
    // Fallback por si localStorage esta lleno en movil
    try {
      const compact: InterruptedCompilationJob = {
        ...job,
        chunks: [],
        totalChunks: job.chunks.length,
        storedInIdb: true,
      };
      localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(compact));
    } catch {
      // ignore quota errors
    }
  }
}

function updatePendingCompletedIds(bookId: string, sectionId: string): void {
  const current = readPendingJob();
  if (current && current.bookId === bookId && !current.completedSectionIds.includes(sectionId)) {
    const nextIds = [...current.completedSectionIds, sectionId];
    if (current.storedInIdb) {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(
            PENDING_JOB_KEY,
            JSON.stringify({ ...current, completedSectionIds: nextIds, savedAt: Date.now() })
          );
        } catch {
          // ignore
        }
      }
      void livingBooksDb.documentPages
        .get([IDB_PENDING_JOB_ID, 0])
        .then((rec) => {
          if (!rec?.text) return;
          const full = JSON.parse(rec.text) as InterruptedCompilationJob;
          if (full.bookId === bookId && !full.completedSectionIds.includes(sectionId)) {
            return livingBooksDb.documentPages.put({
              jobId: IDB_PENDING_JOB_ID,
              pageNumber: 0,
              text: JSON.stringify({
                ...full,
                completedSectionIds: [...full.completedSectionIds, sectionId],
                savedAt: Date.now(),
              }),
            });
          }
        })
        .catch(() => {});
    } else {
      savePendingJob({
        ...current,
        completedSectionIds: nextIds,
        savedAt: Date.now(),
      });
    }
  }
}

function readPendingJob(): InterruptedCompilationJob | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InterruptedCompilationJob;
    if (!parsed?.bookId || (!Array.isArray(parsed.chunks) && !parsed.storedInIdb)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingJob(): void {
  void livingBooksDb.documentPages.delete([IDB_PENDING_JOB_ID, 0]).catch(() => {});
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_JOB_KEY);
  } catch {
    // ignore
  }
}

function isCompactMobileDevice(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 1024;
}

class CompilationOrchestrator {
  private state: OrchestratorSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<() => void>();
  private tracer: ParallelMemoryTracer | null = null;
  private compiler: ParallelBookCompiler | null = null;
  private lastParams: StartCompilationParams | null = null;
  private lastTraces: TracedSnippet[] = [];
  private wakeLock: { release: () => Promise<void> } | null = null;

  private async requestWakeLock(): Promise<void> {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return;
    try {
      this.wakeLock = await nav.wakeLock.request('screen');
    } catch {
      // No soportado o rechazado (p.ej. pestaña en segundo plano)
    }
  }

  private releaseWakeLock(): void {
    const lock = this.wakeLock;
    this.wakeLock = null;
    if (lock) {
      void lock.release().catch(() => {});
    }
  }

  getSnapshot = (): OrchestratorSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(partial: Partial<OrchestratorSnapshot>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private appendLog = (line: string): void => {
    this.update({ log: [...this.state.log.slice(-80), line] });
  };

  isBusy(): boolean {
    return this.state.phase === 'TRACING' || this.state.phase === 'COMPILING' || this.state.phase === 'PAUSED';
  }

  async startCompilation(params: StartCompilationParams): Promise<void> {
    if (this.isBusy()) {
      this.appendLog('Ya hay una compilacion en curso.');
      return;
    }

    this.lastParams = params;
    this.lastTraces = [];
    const { bookId, metadata, chunks, config, credentials, estimatedCostFallback, onChapterReady } = params;
    const mobile = isCompactMobileDevice();

    this.update({
      phase: 'TRACING',
      bookId,
      bookTitle: metadata.title,
      jobId: null,
      tracerTelemetry: null,
      telemetry: null,
      sections: {},
      readyChapters: [],
      log: [],
      error: null,
      tracerPaused: false,
      compilerPaused: false,
    });

    await this.requestWakeLock();

    // --- FASE A: TRAZADOR PARALELO DE MEMORIA ---
    const snippets = collectTracerSnippets(chunks);
    const traces: TracedSnippet[] = [];

    if (snippets.length > 0) {
      const tracerWorkers = mobile ? 1 : 4;
      this.appendLog(`Fase A: trazando ${snippets.length} snippets con ${tracerWorkers} worker(s)...`);
      const tracer = new ParallelMemoryTracer({
        workerCount: tracerWorkers,
        maxSteps: 35,
        timeoutMs: mobile ? 1200 : 800,
        callbacks: {
          onTelemetry: (t) => this.update({ tracerTelemetry: t }),
          onLog: this.appendLog,
        },
      });
      this.tracer = tracer;
      try {
        const traced = await tracer.traceSnippets(snippets);
        for (const r of traced) {
          if ((r.status === 'TRACED' || r.status === 'CACHED') && r.memorySteps.length > 0) {
            traces.push({
              sectionId: r.sectionId,
              snippetIndex: r.snippetIndex,
              code: r.code,
              memorySteps: r.memorySteps,
            });
          }
        }
        const snap = tracer.getTelemetry();
        this.appendLog(
          `Fase A completa: ${snap.tracedCount} trazados, ${snap.cachedCount} en cache, ${snap.skippedTrivialOrUnsafeCount} descartados.`
        );
      } finally {
        tracer.dispose();
        this.tracer = null;
      }
    } else {
      this.appendLog('Fase A: no hay snippets trazables en los capitulos seleccionados.');
    }

    this.lastTraces = traces;
    if (this.state.phase === 'CANCELLED') {
      this.releaseWakeLock();
      return;
    }

    // --- FASE B: COMPILADOR MULTI-AGENTE LLM ---
    const freshQuote = buildPreFlightQuote(chunks, config);
    const job: CompilationJob = {
      jobId: `job-${Date.now()}`,
      bookId,
      title: metadata.title,
      status: 'RUNNING',
      config,
      sectionsMap: createSectionTasks(chunks, config),
      totalSpentUsd: 0,
      totalEstimatedUsd: freshQuote.expectedCostUsd || estimatedCostFallback,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.update({
      phase: 'COMPILING',
      jobId: job.jobId,
      sections: job.sectionsMap,
    });

    savePendingJob({
      bookId,
      metadata,
      chunks,
      config,
      completedSectionIds: [],
      estimatedCostFallback,
      savedAt: Date.now(),
    });

    const compiler = new ParallelBookCompiler({
      job,
      chunks,
      traces,
      meta: {
        bookId,
        metadata: {
          title: metadata.title,
          subtitle: metadata.subtitle,
          authors: metadata.authors,
          edition: metadata.edition,
          difficulty: metadata.difficulty,
          coverAccentIcon: metadata.coverAccentIcon,
          coverImageDataUrl: metadata.coverImageDataUrl,
        },
        themeDNA: metadata.themeDNA,
        runtimeRequirements: {
          pythonVersion: '3.14',
          packages: [],
          enableLiveMemoryTracer: true,
          virtualFileSystemSeed: {},
        },
      },
      credentials,
      callbacks: {
        onTelemetry: (t) => this.update({ telemetry: t }),
        onSectionUpdate: (section) => {
          const nextSections = { ...this.state.sections, [section.sectionId]: { ...section } };
          this.update({ sections: nextSections });
          if (section.status === 'COMPLETED') {
            updatePendingCompletedIds(bookId, section.sectionId);
          }
        },
        onChapterReady: (chapterNumber, cartridge) => {
          const prevChapters = this.state.readyChapters;
          this.update({
            readyChapters: prevChapters.includes(chapterNumber)
              ? prevChapters
              : [...prevChapters, chapterNumber],
          });
          void usePlatformStore.getState().registerCartridge(cartridge, false);
          usePlatformStore.getState().pushToast({
            title: `Capitulo ${chapterNumber} listo`,
            description: 'Ya puedes empezar a estudiarlo en la Biblioteca.',
            iconKey: 'check',
          });
          onChapterReady?.(chapterNumber, cartridge);
        },
        onFatalError: (msg) => {
          this.update({ error: msg, compilerPaused: true, phase: 'PAUSED' });
        },
        onLog: this.appendLog,
      },
    });

    this.compiler = compiler;
    try {
      await compiler.start();
      const finalStatus = compiler.getJob().status;
      if (finalStatus === 'COMPLETED' || finalStatus === 'CANCELLED') {
        clearPendingJob();
      }
      this.update({
        phase:
          finalStatus === 'COMPLETED'
            ? 'COMPLETED'
            : finalStatus === 'PAUSED'
              ? 'PAUSED'
              : finalStatus === 'CANCELLED'
                ? 'CANCELLED'
                : 'FAILED',
      });
    } catch (err) {
      this.update({
        phase: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.releaseWakeLock();
    }
  }

  getInterruptedJob(): InterruptedCompilationJob | null {
    if (this.isBusy()) return null;
    const saved = readPendingJob();
    if (!saved) return null;
    if (saved.storedInIdb) {
      const total = saved.totalChunks ?? 0;
      if (total > 0 && saved.completedSectionIds.length >= total) {
        clearPendingJob();
        return null;
      }
      return saved;
    }
    const remaining = saved.chunks.filter((c) => !saved.completedSectionIds.includes(c.sectionId));
    if (remaining.length === 0) {
      clearPendingJob();
      return null;
    }
    return saved;
  }

  discardInterruptedJob(): void {
    clearPendingJob();
  }

  async resumeInterruptedJob(credentials: CompilerCredentials): Promise<void> {
    let saved = this.getInterruptedJob();
    if (!saved) return;
    if (saved.storedInIdb || saved.chunks.length === 0) {
      const idbRecord = await livingBooksDb.documentPages.get([IDB_PENDING_JOB_ID, 0]);
      if (idbRecord?.text) {
        const full = JSON.parse(idbRecord.text) as InterruptedCompilationJob;
        saved = { ...full, completedSectionIds: saved.completedSectionIds };
      }
    }
    const remainingChunks = saved.chunks.filter(
      (c) => !saved.completedSectionIds.includes(c.sectionId)
    );
    if (remainingChunks.length === 0) {
      clearPendingJob();
      return;
    }
    await this.startCompilation({
      bookId: saved.bookId,
      metadata: saved.metadata,
      chunks: remainingChunks,
      config: saved.config,
      credentials,
      estimatedCostFallback: saved.estimatedCostFallback,
    });
  }

  togglePauseTracer(): void {
    if (!this.tracer) return;
    if (this.state.tracerPaused) {
      this.tracer.resume();
      this.update({ tracerPaused: false, phase: 'TRACING' });
    } else {
      this.tracer.pause();
      this.update({ tracerPaused: true, phase: 'PAUSED' });
    }
  }

  async togglePauseCompiler(): Promise<void> {
    if (!this.compiler) return;
    if (this.state.compilerPaused) {
      this.update({ compilerPaused: false, phase: 'COMPILING' });
      await this.compiler.start();
      const finalStatus = this.compiler.getJob().status;
      if (finalStatus === 'COMPLETED') this.update({ phase: 'COMPLETED' });
    } else {
      this.compiler.pause();
      this.update({ compilerPaused: true, phase: 'PAUSED' });
    }
  }

  async retryFailed(): Promise<void> {
    if (!this.compiler) return;
    const job = this.compiler.getJob();
    let resetCount = 0;
    for (const sec of Object.values(job.sectionsMap)) {
      if (sec.status === 'FAILED') {
        sec.status = 'QUEUED';
        sec.errorLog = [];
        resetCount += 1;
      }
    }
    if (resetCount === 0) return;
    this.appendLog(`Reintentando ${resetCount} seccion(es) fallida(s)...`);
    this.update({ phase: 'COMPILING', compilerPaused: false, sections: { ...job.sectionsMap } });
    await this.compiler.start();
    const finalStatus = this.compiler.getJob().status;
    this.update({ phase: finalStatus === 'COMPLETED' ? 'COMPLETED' : 'FAILED' });
  }

  cancelAll(): void {
    this.tracer?.cancel();
    this.tracer?.dispose();
    this.tracer = null;
    this.compiler?.cancel();
    this.update({ phase: 'CANCELLED', tracerPaused: false, compilerPaused: false });
    this.appendLog('Compilacion cancelada por el usuario.');
  }

  dismiss(): void {
    if (this.isBusy()) return;
    this.compiler = null;
    this.tracer = null;
    this.lastParams = null;
    this.lastTraces = [];
    this.update(INITIAL_SNAPSHOT);
  }
}

export const compilationOrchestrator = new CompilationOrchestrator();

export function useCompilationOrchestrator(): OrchestratorSnapshot {
  return useSyncExternalStore(compilationOrchestrator.subscribe, compilationOrchestrator.getSnapshot);
}

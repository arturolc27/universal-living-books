import { useSyncExternalStore } from 'react';
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
  config: CompilerJobConfig;
  completedSectionIds: string[];
  estimatedCostFallback: number;
  savedAt: number;
}

const PENDING_JOB_KEY = 'ulb_pending_compilation_job';

function savePendingJob(job: InterruptedCompilationJob): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(job));
  } catch {
    // ignore quota errors
  }
}

function readPendingJob(): InterruptedCompilationJob | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InterruptedCompilationJob;
    if (!parsed?.bookId || !Array.isArray(parsed.chunks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingJob(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_JOB_KEY);
  } catch {
    // ignore
  }
}

class CompilationOrchestrator {
  private state: OrchestratorSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<() => void>();
  private tracer: ParallelMemoryTracer | null = null;
  private compiler: ParallelBookCompiler | null = null;
  private lastParams: StartCompilationParams | null = null;
  private lastTraces: TracedSnippet[] = [];

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

    // --- FASE A: TRAZADOR PARALELO DE MEMORIA ---
    const snippets = collectTracerSnippets(chunks);
    const traces: TracedSnippet[] = [];

    if (snippets.length > 0) {
      this.appendLog(`Fase A: trazando ${snippets.length} snippets con 4 workers paralelos...`);
      const tracer = new ParallelMemoryTracer({
        workerCount: 4,
        maxSteps: 35,
        timeoutMs: 500,
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
    if (this.state.phase === 'CANCELLED') return;

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
            const current = readPendingJob();
            if (current && current.bookId === bookId && !current.completedSectionIds.includes(section.sectionId)) {
              savePendingJob({
                ...current,
                completedSectionIds: [...current.completedSectionIds, section.sectionId],
                savedAt: Date.now(),
              });
            }
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
    }
  }

  getInterruptedJob(): InterruptedCompilationJob | null {
    if (this.isBusy()) return null;
    const saved = readPendingJob();
    if (!saved) return null;
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
    const saved = this.getInterruptedJob();
    if (!saved) return;
    const remainingChunks = saved.chunks.filter(
      (c) => !saved.completedSectionIds.includes(c.sectionId)
    );
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

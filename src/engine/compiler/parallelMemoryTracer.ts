import type { MemoryStep } from '../../types/cartridge.types';
import type { TracerTelemetryState } from '../../types/compiler.types';
import { livingBooksDb } from '../../db/dexieDb';
import { PythonRuntimeBridge } from '../pyodide/pythonRuntimeBridge';
import { analyzeSnippetStatic, normalizeSnippetCode } from './snippetStaticFilter';

export { analyzeSnippetStatic, normalizeSnippetCode } from './snippetStaticFilter';
export type { StaticFilterVerdict } from './snippetStaticFilter';

/**
 * Fase 1 — Trazador de Memoria Paralelo, Ultra-Rapido y Pausable.
 *
 * Optimizaciones:
 *  a) Filtro Estatico AST Pre-Ejecucion (0 ms): descarta snippets con errores
 *     de sintaxis intencionales, llamadas bloqueantes (`input`, `open`,
 *     `urlopen`, `import`) o expresiones triviales de una linea sin cambios de
 *     estado. Solo se traza codigo con `Assign`, `AugAssign`, `FunctionDef`,
 *     `List`, `For`, `While`, etc.
 *  b) Limite de Pasos y Watchdog: maximo 35 pasos por snippet y timeout duro
 *     de 500 ms por snippet.
 *  c) Pool de Workers Paralelos + Telemetria + Pausa: ejecuta en paralelo,
 *     cachea cada traza por su hash SHA-256 en IndexedDB y permite pausar y
 *     reanudar sin repetir trazas ya calculadas.
 */

export interface TracerSnippetInput {
  sectionId: string;
  snippetIndex: number;
  code: string;
}

export type TracerSnippetStatus =
  | 'TRACED'
  | 'CACHED'
  | 'SKIPPED_TRIVIAL'
  | 'SKIPPED_UNSAFE'
  | 'SKIPPED_SYNTAX'
  | 'FAILED';

export interface TracerResult {
  sectionId: string;
  snippetIndex: number;
  code: string;
  hash: string;
  status: TracerSnippetStatus;
  memorySteps: MemoryStep[];
  durationMs: number;
  reason: string;
}

export interface TracerCallbacks {
  onTelemetry?: (state: TracerTelemetryState) => void;
  onResult?: (result: TracerResult) => void;
  onLog?: (line: string) => void;
}

export interface TracerOptions {
  workerCount?: number;
  maxSteps?: number;
  timeoutMs?: number;
  callbacks?: TracerCallbacks;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ParallelMemoryTracer {
  private workerCount: number;
  private maxSteps: number;
  private timeoutMs: number;
  private callbacks: TracerCallbacks;
  private workers: PythonRuntimeBridge[] = [];
  private paused = false;
  private cancelled = false;
  private startedAt = 0;
  private emaSecPerSnippet = 0;
  private telemetry: TracerTelemetryState;
  private results: TracerResult[] = [];
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TracerOptions = {}) {
    this.workerCount = Math.max(1, Math.min(8, options.workerCount ?? 4));
    this.maxSteps = options.maxSteps ?? 35;
    this.timeoutMs = options.timeoutMs ?? 500;
    this.callbacks = options.callbacks ?? {};
    this.telemetry = {
      totalSnippets: 0,
      tracedCount: 0,
      skippedTrivialOrUnsafeCount: 0,
      cachedCount: 0,
      failedCount: 0,
      elapsedSec: 0,
      etaSec: 0,
      workersActive: 0,
      workerCount: this.workerCount,
      isPaused: false,
    };
  }

  getResults(): TracerResult[] {
    return this.results;
  }

  getTelemetry(): TracerTelemetryState {
    return { ...this.telemetry };
  }

  pause(): void {
    this.paused = true;
    this.telemetry.isPaused = true;
    this.callbacks.onLog?.('Trazador pausado. Las trazas ya calculadas quedan en cache.');
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.telemetry.isPaused = false;
    this.callbacks.onLog?.('Trazador reanudado.');
    this.emit();
  }

  cancel(): void {
    this.cancelled = true;
  }

  dispose(): void {
    for (const worker of this.workers) worker.dispose();
    this.workers = [];
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
  }

  private ensureWorkers(): PythonRuntimeBridge[] {
    if (this.workers.length === 0) {
      this.workers = Array.from({ length: this.workerCount }, () => new PythonRuntimeBridge());
    }
    return this.workers;
  }

  async traceSnippets(snippets: TracerSnippetInput[]): Promise<TracerResult[]> {
    this.results = [];
    this.cancelled = false;
    this.paused = false;
    this.startedAt = Date.now();
    this.emaSecPerSnippet = 0;
    this.telemetry = {
      totalSnippets: snippets.length,
      tracedCount: 0,
      skippedTrivialOrUnsafeCount: 0,
      cachedCount: 0,
      failedCount: 0,
      elapsedSec: 0,
      etaSec: 0,
      workersActive: 0,
      workerCount: this.workerCount,
      isPaused: false,
    };
    this.emit();
    this.telemetryTimer = setInterval(() => this.emit(), 500);

    const workers = this.ensureWorkers();
    let cursor = 0;
    let processed = 0;

    const runWorker = async (worker: PythonRuntimeBridge) => {
      while (!this.cancelled) {
        if (this.paused) {
          await sleep(150);
          continue;
        }
        const index = cursor;
        cursor += 1;
        if (index >= snippets.length) break;
        const snippet = snippets[index];
        this.telemetry.workersActive += 1;
        try {
          const result = await this.processSnippet(snippet, worker);
          this.results.push(result);
          this.applyResultToTelemetry(result);
        } catch (err) {
          this.telemetry.failedCount += 1;
          this.callbacks.onLog?.(
            `Fallo trazando ${snippet.sectionId}#${snippet.snippetIndex}: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          this.telemetry.workersActive = Math.max(0, this.telemetry.workersActive - 1);
          processed += 1;
          this.updateEta(processed, snippets.length);
          this.emit();
        }
      }
    };

    await Promise.all(workers.map((worker) => runWorker(worker)));

    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    this.telemetry.elapsedSec = (Date.now() - this.startedAt) / 1000;
    this.telemetry.etaSec = 0;
    this.emit();
    return this.results;
  }

  private async processSnippet(
    snippet: TracerSnippetInput,
    worker: PythonRuntimeBridge
  ): Promise<TracerResult> {
    const normalized = normalizeSnippetCode(snippet.code);
    const hash = await sha256Hex(`${this.maxSteps}::${normalized}`);
    const verdict = analyzeSnippetStatic(snippet.code);
    const startedAt = Date.now();

    if (!verdict.safe) {
      const status: TracerSnippetStatus = verdict.trivial
        ? 'SKIPPED_TRIVIAL'
        : /sintax|Syntax|literal|colgante|desbalancead|incompleta/i.test(verdict.reason)
          ? 'SKIPPED_SYNTAX'
          : 'SKIPPED_UNSAFE';
      return {
        sectionId: snippet.sectionId,
        snippetIndex: snippet.snippetIndex,
        code: normalized,
        hash,
        status,
        memorySteps: [],
        durationMs: 0,
        reason: verdict.reason,
      };
    }

    const cached = await livingBooksDb.memoryTraces.get(hash);
    if (cached) {
      return {
        sectionId: snippet.sectionId,
        snippetIndex: snippet.snippetIndex,
        code: normalized,
        hash,
        status: 'CACHED',
        memorySteps: cached.memorySteps,
        durationMs: 0,
        reason: 'Cache SHA-256.',
      };
    }

    const steps = await this.traceWithTimeout(worker, normalized);
    await livingBooksDb.memoryTraces.put({
      hash,
      code: normalized,
      maxSteps: this.maxSteps,
      memorySteps: steps,
      createdAt: Date.now(),
    });

    return {
      sectionId: snippet.sectionId,
      snippetIndex: snippet.snippetIndex,
      code: normalized,
      hash,
      status: 'TRACED',
      memorySteps: steps,
      durationMs: Date.now() - startedAt,
      reason: 'Trazado determinista.',
    };
  }

  private async traceWithTimeout(worker: PythonRuntimeBridge, code: string): Promise<MemoryStep[]> {
    const underlying = worker.traceExecutionMemory(code, this.maxSteps);
    // Evita rechazos no manejados si el timeout gana la carrera.
    underlying.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<MemoryStep[]>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout de ${this.timeoutMs} ms excedido.`)), this.timeoutMs);
    });

    try {
      return await Promise.race([underlying, timeout]);
    } catch (err) {
      // El worker quedo atascado: lo reiniciamos para no bloquear la cola.
      worker.dispose();
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private applyResultToTelemetry(result: TracerResult): void {
    switch (result.status) {
      case 'TRACED':
        this.telemetry.tracedCount += 1;
        break;
      case 'CACHED':
        this.telemetry.cachedCount += 1;
        break;
      case 'SKIPPED_TRIVIAL':
      case 'SKIPPED_UNSAFE':
      case 'SKIPPED_SYNTAX':
        this.telemetry.skippedTrivialOrUnsafeCount += 1;
        break;
      case 'FAILED':
        this.telemetry.failedCount += 1;
        break;
    }
    this.callbacks.onResult?.(result);
  }

  private updateEta(processed: number, total: number): void {
    const elapsed = (Date.now() - this.startedAt) / 1000;
    this.telemetry.elapsedSec = elapsed;
    if (processed > 0) {
      const instant = elapsed / processed;
      this.emaSecPerSnippet =
        this.emaSecPerSnippet === 0 ? instant : 0.3 * instant + 0.7 * this.emaSecPerSnippet;
    }
    const remaining = Math.max(0, total - processed);
    const perSnippet = this.emaSecPerSnippet || 0.05;
    this.telemetry.etaSec = (remaining * perSnippet) / Math.max(1, this.workerCount);
  }

  private emit(): void {
    this.callbacks.onTelemetry?.({ ...this.telemetry });
  }
}

/**
 * Extrae todos los snippets trazables de una lista de chunks, aplicando el
 * filtro estatico para no encolar codigo trivial o inseguro.
 */
export function collectTracerSnippets(
  chunks: Array<{ sectionId: string; codeSnippets: string[] }>
): TracerSnippetInput[] {
  const snippets: TracerSnippetInput[] = [];
  for (const chunk of chunks) {
    chunk.codeSnippets.forEach((code, index) => {
      snippets.push({ sectionId: chunk.sectionId, snippetIndex: index, code });
    });
  }
  return snippets;
}

import type { MicroLesson, ThemeDNA } from './cartridge.types';

export type LlmProviderId = 'openrouter' | 'gemini' | 'ollama' | 'deepseek';

export interface ModelPricingConfig {
  id: string;
  label: string;
  provider: LlmProviderId;
  inputPer1M: number;
  outputPer1M: number;
  isLocal: boolean;
  tpsBase: number;
}

export type SectionStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PAUSED' | 'FAILED';

export interface SectionTaskState {
  sectionId: string;
  chapterNumber: number;
  chapterTitle: string;
  sectionTitle: string;
  status: SectionStatus;
  contentHash: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  estimatedDurationSec: number;
  actualDurationSec: number;
  assignedWorkerId: number | null;
  assignedModel: string;
  tier: 'FAST' | 'REASONING';
  attempts: number;
  compiledLesson: MicroLesson | null;
  errorLog: string[];
}

export type JobStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export interface CompilerJobConfig {
  fastModel: string;
  reasoningModel: string;
  concurrencyLimit: number;
  dryRun: boolean;
  maxRetries: number;
  outputExpansionFactor: number;
  targetLanguage?: 'es' | 'en';
}

export interface CompilationJob {
  jobId: string;
  bookId: string;
  title: string;
  status: JobStatus;
  config: CompilerJobConfig;
  sectionsMap: Record<string, SectionTaskState>;
  totalSpentUsd: number;
  totalEstimatedUsd: number;
  createdAt: number;
  updatedAt: number;
}

export interface TelemetrySnapshot {
  elapsedSec: number;
  etaSec: number;
  tokensPerSec: number;
  spentUsd: number;
  estimatedRemainingUsd: number;
  projectedTotalUsd: number;
  cacheSavingsUsd: number;
  completedSections: number;
  totalSections: number;
  activeWorkers: number;
  concurrencyLimit: number;
  workerActivity: Record<number, string>;
}

export interface PreFlightQuote {
  totalSections: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  minCostUsd: number;
  expectedCostUsd: number;
  maxCostUsd: number;
  estimatedTotalSec: number;
  perSection: Array<{
    sectionId: string;
    sectionTitle: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationSec: number;
    tier: 'FAST' | 'REASONING';
  }>;
}

// --- INCREMENTAL INGESTION PIPELINE (Fase 0 / Fase 1 / Fase 2) ---

/** Estado de un capitulo respecto a la base de datos del libro (Dexie.js). */
export type ChapterDbStatus = 'NOT_COMPILED' | 'TRACED' | 'IN_DATABASE';

/**
 * Metadatos del libro extraidos por el LLM en la Fase 0 (TOC Extractor).
 * Todos los campos son editables por el usuario antes de iniciar la ingesta.
 */
export interface BookMetadataDraft {
  title: string;
  subtitle: string;
  authors: string[];
  year: number;
  edition: string;
  totalPages: number;
  totalChars: number;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  coverAccentIcon: string;
  themeDNA: ThemeDNA;
  /** Miniatura de la portada (data URL JPEG) extraida del PDF. */
  coverImageDataUrl?: string;
}

/**
 * Entrada del Indice Maestro de Capitulos devuelto por el LLM.
 * `startPage`/`endPage` son numeros de pagina reales del PDF (1-based).
 */
export interface ChapterIndexEntry {
  chapterNumber: number;
  title: string;
  startPage: number;
  endPage: number;
  estimatedChars: number;
  estimatedMicroLessons: number;
  codeBlockCount: number;
  estimatedCostUsd: number;
  estimatedTimeSec: number;
  /** Checkbox de seleccion en la UI. */
  selectionState: boolean;
  /** Estado del capitulo en la base de datos del libro. */
  dbStatus: ChapterDbStatus;
}

/** Telemetria en vivo del Trazador de Memoria Paralelo (Fase 1). */
export interface TracerTelemetryState {
  totalSnippets: number;
  tracedCount: number;
  skippedTrivialOrUnsafeCount: number;
  cachedCount: number;
  failedCount: number;
  elapsedSec: number;
  etaSec: number;
  workersActive: number;
  workerCount: number;
  isPaused: boolean;
}

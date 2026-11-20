import type { BookCartridge, Chapter, GlossaryEntry, MicroLesson } from '../../types/cartridge.types';
import type {
  CompilationJob,
  CompilerJobConfig,
  ModelPricingConfig,
  PreFlightQuote,
  SectionTaskState,
  TelemetrySnapshot,
} from '../../types/compiler.types';
import { validateBookCartridge } from '../../types/cartridge.schema';
import { livingBooksDb, upsertCompiledChapterToBook } from '../../db/dexieDb';
import { buildCompilerSystemInstruction, MICROLESSON_RESPONSE_SCHEMA } from './llmCompiler';
import { formatBookSourceMarkdown, sanitizeLesson } from './lessonSanitizer';
import { parseJsonLoose } from './metadataTocExtractor';
import type { SectionChunk, TracedSnippet } from './semanticChunker';

export const MODEL_PRICING: ModelPricingConfig[] = [
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (recomendado)', provider: 'openrouter', inputPer1M: 0.15, outputPer1M: 0.6, isLocal: false, tpsBase: 130 },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (mas economico)', provider: 'openrouter', inputPer1M: 0.075, outputPer1M: 0.3, isLocal: false, tpsBase: 160 },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini (JSON preciso)', provider: 'openrouter', inputPer1M: 0.15, outputPer1M: 0.6, isLocal: false, tpsBase: 100 },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3', provider: 'openrouter', inputPer1M: 0.27, outputPer1M: 1.1, isLocal: false, tpsBase: 70 },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (premium)', provider: 'openrouter', inputPer1M: 3.0, outputPer1M: 15.0, isLocal: false, tpsBase: 55 },
  { id: 'ollama/llama3.1:8b', label: 'Ollama Llama 3.1 8B (local)', provider: 'ollama', inputPer1M: 0, outputPer1M: 0, isLocal: true, tpsBase: 45 },
  { id: 'ollama/qwen2.5:14b', label: 'Ollama Qwen 2.5 14B (local)', provider: 'ollama', inputPer1M: 0, outputPer1M: 0, isLocal: true, tpsBase: 30 },
];

export function getPricing(modelId: string): ModelPricingConfig {
  return (
    MODEL_PRICING.find((m) => m.id === modelId) ?? {
      id: modelId,
      label: modelId,
      provider: 'openrouter',
      inputPer1M: 0.5,
      outputPer1M: 1.5,
      isLocal: false,
      tpsBase: 80,
    }
  );
}

/** Heuristic BPE token estimator (~4 chars/token for English + code). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const REASONING_KEYWORDS = [
  'recursion', 'recursive', 'algorithm', 'complexity', 'big-o', 'big o',
  'generator', 'decorator', 'metaclass', 'inheritance', 'polymorphism',
  'comprehension', 'lambda', 'closure', 'asyncio', 'thread', 'concurrency',
  'ast', 'bytecode', 'memory model', 'garbage', 'reference', 'mutab',
  'dataframe', 'vectoriz', 'numpy', 'pandas', 'optimiz',
];

/** Lexical classifier: dense sections get the reasoning model. */
export function classifyTier(chunk: SectionChunk): 'FAST' | 'REASONING' {
  const haystack = `${chunk.sectionTitle} ${chunk.text}`.toLowerCase();
  const hits = REASONING_KEYWORDS.filter((k) => haystack.includes(k)).length;
  const codeDensity = chunk.codeSnippets.length;
  return hits >= 2 || codeDensity >= 3 ? 'REASONING' : 'FAST';
}

export interface CompilerCredentials {
  openrouterApiKey: string;
  geminiApiKey: string;
  ollamaBaseUrl: string;
}

export interface CompilerCallbacks {
  onTelemetry?: (snapshot: TelemetrySnapshot) => void;
  onSectionUpdate?: (section: SectionTaskState) => void;
  onChapterReady?: (chapterNumber: number, cartridge: BookCartridge) => void;
  onFatalError?: (message: string) => void;
  onLog?: (line: string) => void;
}

interface LlmResult {
  lesson: MicroLesson;
  inputTokens: number;
  outputTokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isFatalCredentialError(msg: string): boolean {
  return /\b(401|402|403)\b|invalid.*api.*key|insufficient.*credits|unauthorized/i.test(msg);
}

function getSectionNumericOrder(sectionId: string): number {
  const match = sectionId.match(/sec(\d+)$/i) ?? sectionId.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 65000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Tiempo de espera agotado (${Math.round(timeoutMs / 1000)}s) esperando respuesta del modelo.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class ParallelBookCompiler {
  private job: CompilationJob;
  private chunks: SectionChunk[];
  private traces: TracedSnippet[];
  private meta: { bookId: string; metadata: BookCartridge['metadata']; themeDNA: BookCartridge['themeDNA']; runtimeRequirements: BookCartridge['runtimeRequirements'] };
  private credentials: CompilerCredentials;
  private callbacks: CompilerCallbacks;

  private running = false;
  private paused = false;
  private cancelled = false;
  private activeWorkers = 0;
  private workerActivity: Record<number, string> = {};
  private startedAt = 0;
  private emaTps = 0;
  private cacheSavingsUsd = 0;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(params: {
    job: CompilationJob;
    chunks: SectionChunk[];
    traces: TracedSnippet[];
    meta: { bookId: string; metadata: BookCartridge['metadata']; themeDNA: BookCartridge['themeDNA']; runtimeRequirements: BookCartridge['runtimeRequirements'] };
    credentials: CompilerCredentials;
    callbacks?: CompilerCallbacks;
  }) {
    this.job = params.job;
    this.chunks = params.chunks;
    this.traces = params.traces;
    this.meta = params.meta;
    this.credentials = params.credentials;
    this.callbacks = params.callbacks ?? {};
  }

  getJob(): CompilationJob {
    return this.job;
  }

  setConcurrency(limit: number): void {
    this.job.config.concurrencyLimit = Math.max(1, Math.min(8, limit));
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.cancelled = false;
    this.startedAt = Date.now();
    this.job.status = 'RUNNING';
    await this.persist();

    this.telemetryTimer = setInterval(() => this.emitTelemetry(), 1000);

    const queue = Object.values(this.job.sectionsMap).filter((s) => s.status !== 'COMPLETED');
    let cursor = 0;

    const runWorker = async (workerId: number) => {
      while (!this.cancelled && !this.paused) {
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) break;
        const task = queue[index];
        this.activeWorkers += 1;
        this.workerActivity[workerId] = `Compilando ${task.sectionTitle}...`;
        try {
          await this.processSection(task, workerId);
        } catch (err) {
          task.status = 'FAILED';
          task.errorLog.push(err instanceof Error ? err.message : String(err));
          this.callbacks.onSectionUpdate?.(task);
        } finally {
          this.activeWorkers -= 1;
          this.workerActivity[workerId] = 'Idle';
        }
      }
    };

    const workers = Array.from({ length: this.job.config.concurrencyLimit }, (_, i) => runWorker(i + 1));
    await Promise.all(workers);

    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    this.running = false;

    if (this.cancelled) {
      this.job.status = 'CANCELLED';
    } else if (this.paused) {
      this.job.status = 'PAUSED';
    } else {
      const allDone = Object.values(this.job.sectionsMap).every((s) => s.status === 'COMPLETED');
      this.job.status = allDone ? 'COMPLETED' : 'FAILED';
    }
    await this.persist();
    this.emitTelemetry();
  }

  pause(): void {
    this.paused = true;
    this.job.status = 'PAUSED';
    this.callbacks.onLog?.('Pausa solicitada: los workers terminaran su peticion en curso.');
  }

  cancel(): void {
    this.cancelled = true;
    this.job.status = 'CANCELLED';
  }

  private async processSection(task: SectionTaskState, workerId: number): Promise<void> {
    const chunk = this.chunks.find((c) => c.sectionId === task.sectionId);
    if (!chunk) {
      task.status = 'FAILED';
      task.errorLog.push('Seccion no encontrada en el chunker.');
      return;
    }

    task.status = 'RUNNING';
    task.assignedWorkerId = workerId;
    this.callbacks.onSectionUpdate?.(task);

    const model = task.tier === 'REASONING' ? this.job.config.reasoningModel : this.job.config.fastModel;
    task.assignedModel = model;
    const pricing = getPricing(model);

    const startedAt = Date.now();
    let attempt = 0;
    let lastError = '';

    while (attempt <= this.job.config.maxRetries && !this.cancelled && !this.paused) {
      attempt += 1;
      task.attempts = attempt;
      try {
        const result = await this.callLlm(chunk, model, pricing, lastError);
        task.compiledLesson = result.lesson;
        task.actualInputTokens = result.inputTokens;
        task.actualOutputTokens = result.outputTokens;
        task.actualCostUsd = this.computeCost(result.inputTokens, result.outputTokens, pricing);
        task.actualDurationSec = (Date.now() - startedAt) / 1000;
        task.status = 'COMPLETED';
        this.job.totalSpentUsd += task.actualCostUsd;
        this.updateEma(result.outputTokens, task.actualDurationSec);
        this.callbacks.onSectionUpdate?.(task);
        await this.persist();
        await this.tryAssembleChapter(task.chapterNumber);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        task.errorLog.push(`Intento ${attempt}: ${lastError}`);
        if (isFatalCredentialError(lastError)) {
          task.status = 'FAILED';
          task.actualDurationSec = (Date.now() - startedAt) / 1000;
          this.callbacks.onSectionUpdate?.(task);
          this.callbacks.onLog?.(
            `Error de autenticacion/cuota (${lastError}). Pausando compilacion para que revises tu API Key.`
          );
          this.callbacks.onFatalError?.(lastError);
          this.pause();
          await this.persist();
          return;
        }
        const isRateLimit = /429|rate limit|too many/i.test(lastError);
        const isNetwork = /failed to fetch|load failed|network|timeout|tiempo de espera|502|503|504/i.test(
          lastError
        );
        if (isRateLimit) {
          const backoff = Math.min(30000, 1500 * 2 ** attempt) + Math.random() * 500;
          this.callbacks.onLog?.(`Rate limit en ${task.sectionId}. Backoff ${Math.round(backoff)}ms.`);
          await sleep(backoff);
        } else if (isNetwork && attempt <= this.job.config.maxRetries) {
          const backoff = Math.min(12000, 1200 * 2 ** (attempt - 1)) + Math.random() * 400;
          this.callbacks.onLog?.(
            `Error de red en ${task.sectionId} (intento ${attempt}). Reintentando en ${Math.round(backoff)}ms...`
          );
          await sleep(backoff);
        } else if (attempt <= this.job.config.maxRetries) {
          await sleep(700 * attempt);
        }
      }
    }

    task.status = 'FAILED';
    task.actualDurationSec = (Date.now() - startedAt) / 1000;
    this.callbacks.onSectionUpdate?.(task);
    await this.persist();
    // Si el resto del capitulo ya termino, guardar los capitulos/lecciones que si funcionaron
    await this.tryAssembleChapter(task.chapterNumber);
  }

  private computeCost(inputTokens: number, outputTokens: number, pricing: ModelPricingConfig): number {
    return (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M;
  }

  private updateEma(outputTokens: number, durationSec: number): void {
    if (durationSec <= 0) return;
    const instant = outputTokens / durationSec;
    this.emaTps = this.emaTps === 0 ? instant : 0.3 * instant + 0.7 * this.emaTps;
  }

  private async callLlm(
    chunk: SectionChunk,
    model: string,
    pricing: ModelPricingConfig,
    previousError: string
  ): Promise<LlmResult> {
    if (this.job.config.dryRun) {
      await sleep(400 + Math.random() * 600);
      const inputTokens = task_estimate(chunk);
      const outputTokens = Math.round(inputTokens * this.job.config.outputExpansionFactor);
      return {
        lesson: this.syntheticLesson(chunk),
        inputTokens,
        outputTokens,
      };
    }

    const targetLanguage = this.job.config.targetLanguage ?? 'es';
    const detailLevel = this.job.config.detailLevel ?? 'BALANCED';
    const sysInstruction = buildCompilerSystemInstruction(targetLanguage, detailLevel);
    const relevantTraces = this.traces.filter((t) => t.sectionId === chunk.sectionId);
    const userPayload = JSON.stringify({
      sectionId: chunk.sectionId,
      chapterNumber: chunk.chapterNumber,
      chapterTitle: chunk.chapterTitle,
      sectionTitle: chunk.sectionTitle,
      targetLanguage,
      cleanText: chunk.text,
      precomputedMemoryTraces: relevantTraces,
      repairHint: previousError || undefined,
    });

    if (pricing.provider === 'ollama') {
      return this.callOllama(model, sysInstruction, userPayload, chunk);
    }
    if (
      pricing.provider === 'gemini' ||
      (!this.credentials.openrouterApiKey && Boolean(this.credentials.geminiApiKey))
    ) {
      const geminiModel = model.startsWith('google/')
        ? model.slice('google/'.length)
        : model.includes('/')
          ? 'gemini-2.5-flash'
          : model;
      return this.callGemini(geminiModel, sysInstruction, userPayload, chunk);
    }
    return this.callOpenRouter(model, sysInstruction, userPayload, chunk);
  }

  private async callOpenRouter(
    model: string,
    sysInstruction: string,
    userPayload: string,
    chunk: SectionChunk
  ): Promise<LlmResult> {
    const requestOnce = async (withJsonFormat: boolean): Promise<Response> =>
      fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.credentials.openrouterApiKey}`,
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://living-books.app',
          'X-Title': 'Universal Living Book Engine',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: sysInstruction },
            { role: 'user', content: userPayload },
          ],
          ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
          temperature: 0.2,
        }),
      });

    let response = await requestOnce(true);
    if ((response.status === 400 || response.status === 422) && !this.cancelled) {
      response = await requestOnce(false);
    }
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Respuesta vacia del LLM.');
    return {
      lesson: this.parseLesson(text, chunk),
      inputTokens: data.usage?.prompt_tokens ?? estimateTokens(userPayload),
      outputTokens: data.usage?.completion_tokens ?? estimateTokens(text),
    };
  }

  private async callGemini(
    model: string,
    sysInstruction: string,
    userPayload: string,
    chunk: SectionChunk
  ): Promise<LlmResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.credentials.geminiApiKey}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sysInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPayload }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: MICROLESSON_RESPONSE_SCHEMA, temperature: 0.2 },
      }),
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Respuesta vacia del LLM.');
    return {
      lesson: this.parseLesson(text, chunk),
      inputTokens: data.usageMetadata?.promptTokenCount ?? estimateTokens(userPayload),
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
    };
  }

  private async callOllama(
    model: string,
    sysInstruction: string,
    userPayload: string,
    chunk: SectionChunk
  ): Promise<LlmResult> {
    const base = this.credentials.ollamaBaseUrl || 'http://localhost:11434';
    const response = await fetchWithTimeout(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.replace(/^ollama\//, ''),
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: sysInstruction },
          { role: 'user', content: userPayload },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = data.message?.content;
    if (!text) throw new Error('Respuesta vacia de Ollama.');
    return {
      lesson: this.parseLesson(text, chunk),
      inputTokens: data.prompt_eval_count ?? estimateTokens(userPayload),
      outputTokens: data.eval_count ?? estimateTokens(text),
    };
  }

  private parseLesson(text: string, chunk: SectionChunk): MicroLesson {
    const parsed = parseJsonLoose(text);
    return sanitizeLesson(parsed, {
      sectionTitle: chunk.sectionTitle,
      cleanText: chunk.text,
    });
  }

  private syntheticLesson(chunk: SectionChunk): MicroLesson {
    const formatted = formatBookSourceMarkdown(chunk.text);
    return {
      lessonId: chunk.sectionId,
      order: 1,
      title: chunk.sectionTitle,
      estimatedMinutes: 10,
      sourceBookMarkdown: formatted.markdown,
      sourcePageRange: formatted.pageRange,
      blocks: [
        {
          blockId: `${chunk.sectionId}-prose`,
          type: 'PROSE',
          markdown: `Guía rápida de **${chunk.sectionTitle}**. Revisa la lectura del libro original y prueba los fragmentos de Python directamente en el laboratorio.`,
        },
        {
          blockId: `${chunk.sectionId}-card`,
          type: 'FLASHCARD',
          cardId: `${chunk.sectionId}-card`,
          frontMarkdown: `Concepto clave de ${chunk.sectionTitle}`,
          backMarkdown: 'Definicion generada en modo simulacion.',
          tags: ['dry-run'],
        },
      ],
    };
  }

  /** Ensambla un unico capitulo (con su glosario) a partir de las tareas completadas. */
  private assembleChapter(
    chapterNumber: number
  ): { chapter: Chapter; glossary: Record<string, GlossaryEntry> } | null {
    const chapterTasks = Object.values(this.job.sectionsMap)
      .filter((s) => s.chapterNumber === chapterNumber && s.status === 'COMPLETED' && s.compiledLesson)
      .sort((a, b) => getSectionNumericOrder(a.sectionId) - getSectionNumericOrder(b.sectionId));
    if (chapterTasks.length === 0) return null;

    const chapter: Chapter = {
      chapterId: `ch${chapterNumber}`,
      number: chapterNumber,
      title: chapterTasks[0].chapterTitle,
      summary: '',
      microLessons: chapterTasks.map((t) => t.compiledLesson as MicroLesson),
    };

    const glossary: Record<string, GlossaryEntry> = {};
    for (const task of chapterTasks) {
      const extracted = (task.compiledLesson as unknown as { extractedGlossary?: Record<string, GlossaryEntry> })
        .extractedGlossary;
      if (extracted) {
        for (const [key, value] of Object.entries(extracted)) {
          if (!glossary[key]) glossary[key] = value;
        }
      }
    }
    return { chapter, glossary };
  }

  private async tryAssembleChapter(chapterNumber: number): Promise<void> {
    const chapterTasks = Object.values(this.job.sectionsMap).filter((s) => s.chapterNumber === chapterNumber);
    if (chapterTasks.length === 0) return;
    const stillActive = chapterTasks.some((s) => s.status === 'QUEUED' || s.status === 'RUNNING');
    if (stillActive) return;
    const completedCount = chapterTasks.filter((s) => s.status === 'COMPLETED').length;
    if (completedCount === 0) return;

    const assembled = this.assembleChapter(chapterNumber);
    if (!assembled) return;

    // Fusion incremental (Upsert ordenado) en la base de datos del libro.
    const merged = await upsertCompiledChapterToBook(
      this.meta.bookId,
      this.meta.metadata,
      assembled.chapter,
      assembled.glossary,
      { themeDNA: this.meta.themeDNA, runtimeRequirements: this.meta.runtimeRequirements }
    );

    const validation = validateBookCartridge(merged);
    if (!validation.success) {
      this.callbacks.onLog?.(
        `Capitulo ${chapterNumber} fusionado, pero el cartucho no valida: ${validation.issues.join('; ')}`
      );
    }

    this.callbacks.onChapterReady?.(chapterNumber, merged);
    const partialNote =
      completedCount < chapterTasks.length
        ? ` (${completedCount}/${chapterTasks.length} secciones; las fallidas se pueden reintentar)`
        : '';
    this.callbacks.onLog?.(`Capitulo ${chapterNumber} fusionado en la base de datos del libro${partialNote}.`);
  }

  assembleCartridge(): BookCartridge {
    const chaptersMap = new Map<number, BookCartridge['chapters'][number]>();
    for (const task of Object.values(this.job.sectionsMap)) {
      if (task.status !== 'COMPLETED' || !task.compiledLesson) continue;
      const chapter = chaptersMap.get(task.chapterNumber) ?? {
        chapterId: `ch${task.chapterNumber}`,
        number: task.chapterNumber,
        title: task.chapterTitle,
        summary: '',
        microLessons: [],
      };
      chapter.microLessons.push(task.compiledLesson);
      chaptersMap.set(task.chapterNumber, chapter);
    }

    const glossary: BookCartridge['glossary'] = {};
    for (const chapter of chaptersMap.values()) {
      for (const lesson of chapter.microLessons) {
        const extracted = (lesson as unknown as { extractedGlossary?: Record<string, unknown> }).extractedGlossary;
        if (extracted) {
          for (const [key, value] of Object.entries(extracted)) {
            if (!glossary[key]) glossary[key] = value as BookCartridge['glossary'][string];
          }
        }
      }
    }

    return {
      schemaVersion: '2.0',
      bookId: this.meta.bookId,
      metadata: this.meta.metadata,
      themeDNA: this.meta.themeDNA,
      runtimeRequirements: this.meta.runtimeRequirements,
      glossary,
      achievements: [],
      chapters: [...chaptersMap.values()].sort((a, b) => a.number - b.number),
    };
  }

  private emitTelemetry(): void {
    const sections = Object.values(this.job.sectionsMap);
    const completed = sections.filter((s) => s.status === 'COMPLETED');
    const remaining = sections.filter((s) => s.status !== 'COMPLETED');
    const elapsedSec = (Date.now() - this.startedAt) / 1000;
    const remainingTokens = remaining.reduce((acc, s) => acc + s.estimatedOutputTokens, 0);
    const tps = this.emaTps > 0 ? this.emaTps : 60;
    const etaSec = remainingTokens / (tps * Math.max(1, this.job.config.concurrencyLimit));
    const estimatedRemainingUsd = remaining.reduce((acc, s) => acc + s.estimatedCostUsd, 0);

    const snapshot: TelemetrySnapshot = {
      elapsedSec,
      etaSec,
      tokensPerSec: Math.round(tps),
      spentUsd: this.job.totalSpentUsd,
      estimatedRemainingUsd,
      projectedTotalUsd: this.job.totalSpentUsd + estimatedRemainingUsd,
      cacheSavingsUsd: this.cacheSavingsUsd,
      completedSections: completed.length,
      totalSections: sections.length,
      activeWorkers: this.activeWorkers,
      concurrencyLimit: this.job.config.concurrencyLimit,
      workerActivity: { ...this.workerActivity },
    };
    this.callbacks.onTelemetry?.(snapshot);
  }

  private async persist(): Promise<void> {
    this.job.updatedAt = Date.now();
    await livingBooksDb.compilationJobs.put(this.job);
  }
}

function task_estimate(chunk: SectionChunk): number {
  return estimateTokens(chunk.text) + 400;
}

export { sanitizeLesson } from './lessonSanitizer';

export function buildPreFlightQuote(
  chunks: SectionChunk[],
  config: CompilerJobConfig
): PreFlightQuote {
  const fast = getPricing(config.fastModel);
  const reasoning = getPricing(config.reasoningModel);
  let totalInput = 0;
  let totalOutput = 0;
  let expected = 0;
  let min = 0;
  let max = 0;
  let totalSec = 0;

  const perSection = chunks.map((chunk) => {
    const inputTokens = task_estimate(chunk);
    const outputTokens = Math.round(inputTokens * config.outputExpansionFactor);
    const tier = classifyTier(chunk);
    const pricing = tier === 'REASONING' ? reasoning : fast;
    const costUsd = (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M;
    const durationSec = outputTokens / Math.max(1, pricing.tpsBase);

    totalInput += inputTokens;
    totalOutput += outputTokens;
    expected += costUsd;
    min += costUsd * 0.7;
    max += costUsd * 1.6;
    totalSec += durationSec;

    return { sectionId: chunk.sectionId, sectionTitle: chunk.sectionTitle, inputTokens, outputTokens, costUsd, durationSec, tier };
  });

  return {
    totalSections: chunks.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    minCostUsd: min,
    expectedCostUsd: expected,
    maxCostUsd: max,
    estimatedTotalSec: totalSec / Math.max(1, config.concurrencyLimit),
    perSection,
  };
}

export function createSectionTasks(chunks: SectionChunk[], config: CompilerJobConfig): Record<string, SectionTaskState> {
  const fast = getPricing(config.fastModel);
  const reasoning = getPricing(config.reasoningModel);
  const map: Record<string, SectionTaskState> = {};
  for (const chunk of chunks) {
    const inputTokens = task_estimate(chunk);
    const outputTokens = Math.round(inputTokens * config.outputExpansionFactor);
    const tier = classifyTier(chunk);
    const pricing = tier === 'REASONING' ? reasoning : fast;
    map[chunk.sectionId] = {
      sectionId: chunk.sectionId,
      chapterNumber: chunk.chapterNumber,
      chapterTitle: chunk.chapterTitle,
      sectionTitle: chunk.sectionTitle,
      status: 'QUEUED',
      contentHash: '',
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      actualInputTokens: 0,
      actualOutputTokens: 0,
      estimatedCostUsd: (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M,
      actualCostUsd: 0,
      estimatedDurationSec: outputTokens / Math.max(1, pricing.tpsBase),
      actualDurationSec: 0,
      assignedWorkerId: null,
      assignedModel: tier === 'REASONING' ? config.reasoningModel : config.fastModel,
      tier,
      attempts: 0,
      compiledLesson: null,
      errorLog: [],
    };
  }
  return map;
}

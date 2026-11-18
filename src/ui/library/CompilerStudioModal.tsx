import { useCallback, useMemo, useRef, useState } from 'react';
import {
  X,
  Upload,
  Sparkles,
  Play,
  Pause,
  Square,
  Clock,
  DollarSign,
  Cpu,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  BookOpen,
  Minus,
  Plus,
  Brain,
  Database,
  ListChecks,
  Wand2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import type { SectionChunk, TracedSnippet } from '../../engine/compiler/semanticChunker';
import {
  ParallelBookCompiler,
  buildPreFlightQuote,
  createSectionTasks,
  getPricing,
  MODEL_PRICING,
} from '../../engine/compiler/parallelCompilerEngine';
import {
  extractMetadataAndToc,
  segmentBookByIndex,
} from '../../engine/compiler/metadataTocExtractor';
import {
  ParallelMemoryTracer,
  collectTracerSnippets,
} from '../../engine/compiler/parallelMemoryTracer';
import { extractPdfInWorker } from '../../engine/compiler/pdfExtractor';
import { livingBooksDb } from '../../db/dexieDb';
import type { BookCartridge } from '../../types/cartridge.types';
import type {
  BookMetadataDraft,
  ChapterIndexEntry,
  CompilationJob,
  CompilerJobConfig,
  PreFlightQuote,
  SectionTaskState,
  TelemetrySnapshot,
  TracerTelemetryState,
} from '../../types/compiler.types';
import { cn } from '../utils/cn';

type View = 'CONFIG' | 'RUNNING';

const STATUS_META: Record<SectionTaskState['status'], { label: string; className: string }> = {
  QUEUED: { label: 'En cola', className: 'text-muted' },
  RUNNING: { label: 'Compilando', className: 'text-accent' },
  COMPLETED: { label: 'OK', className: 'text-success' },
  PAUSED: { label: 'Pausado', className: 'text-secondary' },
  FAILED: { label: 'Fallo', className: 'text-danger' },
};

const DB_STATUS_META: Record<ChapterIndexEntry['dbStatus'], { label: string; className: string }> = {
  IN_DATABASE: { label: '✅ En BD', className: 'text-success border-success/40 bg-success/10' },
  TRACED: { label: '🧠 Trazado', className: 'text-accent border-accent/40 bg-accent/10' },
  NOT_COMPILED: { label: '⏳ Pendiente', className: 'text-muted border-subtle bg-elevated' },
};

function fmtUsd(v: number): string {
  return `$${v.toFixed(4)}`;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'libro-compilado';
}

function toCartridgeMetadata(draft: BookMetadataDraft): BookCartridge['metadata'] {
  return {
    title: draft.title,
    subtitle: draft.subtitle,
    authors: draft.authors,
    edition: draft.edition,
    difficulty: draft.difficulty,
    coverAccentIcon: draft.coverAccentIcon,
    coverImageDataUrl: draft.coverImageDataUrl,
  };
}

function estimateChapterCost(chars: number, config: CompilerJobConfig): number {
  const inputTokens = Math.ceil(chars / 4) + 400;
  const outputTokens = Math.round(inputTokens * config.outputExpansionFactor);
  const pricing = getPricing(config.fastModel);
  return (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M;
}

export function CompilerStudioModal({ onClose }: { onClose: () => void }) {
  const settings = usePlatformStore((s) => s.settings);
  const pushToast = usePlatformStore((s) => s.pushToast);
  const registerCartridge = usePlatformStore((s) => s.registerCartridge);

  const [view, setView] = useState<View>('CONFIG');
  const [rawText, setRawText] = useState('');
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<BookMetadataDraft | null>(null);
  const [chaptersIndex, setChaptersIndex] = useState<ChapterIndexEntry[]>([]);
  const [chunks, setChunks] = useState<SectionChunk[]>([]);
  const [config, setConfig] = useState<CompilerJobConfig>({
    fastModel: settings.openrouterModel || 'deepseek/deepseek-v4.1-flash',
    reasoningModel: 'deepseek/deepseek-v4.1-flash',
    concurrencyLimit: 4,
    dryRun: false,
    maxRetries: 2,
    outputExpansionFactor: 1.45,
  });
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [tracerTelemetry, setTracerTelemetry] = useState<TracerTelemetryState | null>(null);
  const [sections, setSections] = useState<Record<string, SectionTaskState>>({});
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [readyChapters, setReadyChapters] = useState<number[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ page: number; total: number } | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [tracerPaused, setTracerPaused] = useState(false);
  const [compilerPaused, setCompilerPaused] = useState(false);

  const compilerRef = useRef<ParallelBookCompiler | null>(null);
  const tracerRef = useRef<ParallelMemoryTracer | null>(null);

  const appendLog = useCallback((line: string) => setLog((prev) => [...prev.slice(-80), line]), []);

  const bookId = useMemo(() => (metadata ? slugify(metadata.title) : 'libro-compilado'), [metadata]);

  const selectedChapters = useMemo(
    () => chaptersIndex.filter((c) => c.selectionState),
    [chaptersIndex]
  );

  const quote: PreFlightQuote | null = useMemo(
    () => (chunks.length > 0 ? buildPreFlightQuote(chunks, config) : null),
    [chunks, config]
  );

  const selectedEstimatedCost = useMemo(
    () => selectedChapters.reduce((acc, c) => acc + c.estimatedCostUsd, 0),
    [selectedChapters]
  );

  const handleFile = async (file: File) => {
    setError(null);
    setMetadata(null);
    setChaptersIndex([]);
    setChunks([]);
    setCoverDataUrl(null);
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    try {
      if (isPdf) {
        setIsExtractingPdf(true);
        setPdfProgress({ page: 0, total: 0 });
        appendLog(`Extrayendo texto y portada de ${file.name} en segundo plano (sin bloquear la UI)...`);
        const result = await extractPdfInWorker(file, (p) => setPdfProgress(p), { wantCover: true });
        setRawText(result.text);
        setCoverDataUrl(result.coverDataUrl);
        appendLog(
          `PDF procesado: ${result.text.length.toLocaleString()} caracteres` +
            (result.coverDataUrl ? ' + portada extraida.' : '.')
        );
      } else {
        const text = await file.text();
        setRawText(text);
        appendLog(`Archivo cargado: ${text.length.toLocaleString()} caracteres.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExtractingPdf(false);
      setPdfProgress(null);
    }
  };

  const refreshDbStatus = useCallback(
    async (index: ChapterIndexEntry[], id: string): Promise<ChapterIndexEntry[]> => {
      const record = await livingBooksDb.installedCartridges.get(id);
      const existingNumbers = new Set(record?.cartridgeJson.chapters.map((c) => c.number) ?? []);
      return index.map((c) => ({
        ...c,
        dbStatus: existingNumbers.has(c.chapterNumber) ? 'IN_DATABASE' : c.dbStatus,
      }));
    },
    []
  );

  const handleExtractMetadata = async () => {
    setError(null);
    if (!rawText.trim()) {
      setError('Carga o pega primero el texto del libro.');
      return;
    }
    if (!config.dryRun && !settings.openrouterApiKey && !settings.geminiApiKey) {
      setError('Configura una API Key (OpenRouter o Gemini) o activa el Modo Simulacion.');
      return;
    }
    setIsExtracting(true);
    try {
      const provider = settings.geminiApiKey && !settings.openrouterApiKey ? 'gemini' : 'openrouter';
      const result = await extractMetadataAndToc(rawText, {
        provider,
        openrouterApiKey: settings.openrouterApiKey,
        geminiApiKey: settings.geminiApiKey,
        ollamaBaseUrl: 'http://localhost:11434',
        model: provider === 'gemini' ? settings.geminiModel : config.fastModel,
      }, { onLog: appendLog, coverImageDataUrl: coverDataUrl ?? undefined });

      // Fija los metadatos de inmediato, aunque falle la consulta a la base de datos.
      setMetadata(result.metadata);

      const id = slugify(result.metadata.title);
      let withStatus = result.chaptersIndex;
      try {
        withStatus = await refreshDbStatus(result.chaptersIndex, id);
      } catch (dbErr) {
        appendLog(
          `No se pudo consultar la base de datos: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
        );
      }
      // Auto-selecciona los capitulos pendientes para poder avanzar de inmediato.
      const withCosts = withStatus.map((c) => ({
        ...c,
        estimatedCostUsd: estimateChapterCost(c.estimatedChars, config),
        estimatedTimeSec: Math.max(4, Math.round(c.estimatedChars / 900)),
        selectionState: c.dbStatus !== 'IN_DATABASE',
      }));

      setChaptersIndex(withCosts);
      appendLog(
        `Fase 0 completa: "${result.metadata.title}" con ${withCosts.length} capitulos ` +
          `(${withCosts.filter((c) => c.selectionState).length} preseleccionados).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExtracting(false);
    }
  };

  const updateMetadataField = <K extends keyof BookMetadataDraft>(key: K, value: BookMetadataDraft[K]) => {
    setMetadata((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleChapter = (chapterNumber: number) => {
    setChaptersIndex((prev) =>
      prev.map((c) => (c.chapterNumber === chapterNumber ? { ...c, selectionState: !c.selectionState } : c))
    );
  };

  const selectPending = () => {
    setChaptersIndex((prev) => prev.map((c) => ({ ...c, selectionState: c.dbStatus !== 'IN_DATABASE' })));
  };

  const selectAll = () => {
    setChaptersIndex((prev) => prev.map((c) => ({ ...c, selectionState: true })));
  };

  const handleStart = async () => {
    setError(null);
    if (!metadata) {
      setError('Primero escanea los metadatos y el indice con IA.');
      return;
    }
    if (selectedChapters.length === 0) {
      setError('Selecciona al menos un capitulo para procesar.');
      return;
    }
    if (!config.dryRun && !settings.openrouterApiKey && !settings.geminiApiKey) {
      setError('Configura una API Key (OpenRouter o Gemini) o activa el Modo Simulacion.');
      return;
    }

    const selectedNumbers = selectedChapters.map((c) => c.chapterNumber);
    const bookChunks = segmentBookByIndex(rawText, chaptersIndex, {
      selectedChapterNumbers: selectedNumbers,
      onLog: appendLog,
    });
    if (bookChunks.length === 0) {
      setError('No se generaron micro-lecciones. Revisa el indice detectado.');
      return;
    }
    setChunks(bookChunks);
    setView('RUNNING');
    setReadyChapters([]);
    setTracerPaused(false);
    setCompilerPaused(false);

    // --- FASE A: TRAZADOR DE MEMORIA PARALELO ---
    const snippets = collectTracerSnippets(bookChunks);
    let traces: TracedSnippet[] = [];
    if (snippets.length > 0) {
      setIsTracing(true);
      appendLog(`Fase A: ${snippets.length} snippets detectados. Iniciando trazador paralelo.`);
      const tracer = new ParallelMemoryTracer({
        workerCount: 4,
        maxSteps: 35,
        timeoutMs: 500,
        callbacks: {
          onTelemetry: setTracerTelemetry,
          onLog: appendLog,
        },
      });
      tracerRef.current = tracer;
      try {
        const results = await tracer.traceSnippets(snippets);
        traces = results
          .filter((r) => r.memorySteps.length > 0)
          .map((r) => ({
            sectionId: r.sectionId,
            snippetIndex: r.snippetIndex,
            code: r.code,
            memorySteps: r.memorySteps,
          }));
        appendLog(`Fase A completa: ${traces.length} trazas utiles de ${snippets.length} snippets.`);
      } catch (err) {
        appendLog(`Fase A fallo: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        // Libera los workers de Pyodide para no dejar procesos colgados.
        tracer.dispose();
        tracerRef.current = null;
        setIsTracing(false);
      }
    } else {
      appendLog('Fase A: no hay snippets trazables en los capitulos seleccionados.');
    }

    // --- FASE B: COMPILADOR MULTI-AGENTE LLM ---
    const job: CompilationJob = {
      jobId: `job-${Date.now()}`,
      bookId,
      title: metadata.title,
      status: 'RUNNING',
      config,
      sectionsMap: createSectionTasks(bookChunks, config),
      totalSpentUsd: 0,
      totalEstimatedUsd: quote?.expectedCostUsd ?? selectedEstimatedCost,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSections(job.sectionsMap);

    const compiler = new ParallelBookCompiler({
      job,
      chunks: bookChunks,
      traces,
      meta: {
        bookId,
        metadata: toCartridgeMetadata(metadata),
        themeDNA: metadata.themeDNA,
        runtimeRequirements: {
          pythonVersion: '3.14',
          packages: [],
          enableLiveMemoryTracer: true,
          virtualFileSystemSeed: {},
        },
      },
      credentials: {
        openrouterApiKey: settings.openrouterApiKey,
        geminiApiKey: settings.geminiApiKey,
        ollamaBaseUrl: 'http://localhost:11434',
      },
      callbacks: {
        onTelemetry: setTelemetry,
        onSectionUpdate: (section) => setSections((prev) => ({ ...prev, [section.sectionId]: { ...section } })),
        onChapterReady: (chapterNumber, cartridge) => {
          setReadyChapters((prev) => (prev.includes(chapterNumber) ? prev : [...prev, chapterNumber]));
          setChaptersIndex((prev) =>
            prev.map((c) => (c.chapterNumber === chapterNumber ? { ...c, dbStatus: 'IN_DATABASE' } : c))
          );
          void registerCartridge(cartridge, false);
          pushToast({
            title: `Capitulo ${chapterNumber} fusionado`,
            description: 'Ya puedes abrirlo en la Biblioteca.',
            iconKey: 'check',
          });
        },
        onLog: appendLog,
      },
    });

    compilerRef.current = compiler;
    await compiler.start();
  };

  const handlePauseTracer = () => {
    if (tracerPaused) {
      tracerRef.current?.resume();
      setTracerPaused(false);
    } else {
      tracerRef.current?.pause();
      setTracerPaused(true);
    }
  };

  const handlePauseCompiler = () => {
    if (compilerPaused) {
      appendLog('Reanudacion del compilador no soportada en caliente; reinicia la compilacion.');
      return;
    }
    compilerRef.current?.pause();
    setCompilerPaused(true);
  };

  const handleCancel = () => {
    compilerRef.current?.cancel();
    tracerRef.current?.cancel();
    appendLog('Cancelacion solicitada.');
  };

  const handleConcurrency = (delta: number) => {
    const next = Math.max(1, Math.min(8, config.concurrencyLimit + delta));
    setConfig((c) => ({ ...c, concurrencyLimit: next }));
    compilerRef.current?.setConcurrency(next);
  };

  const sectionList = useMemo(
    () =>
      Object.values(sections).sort(
        (a, b) => a.chapterNumber - b.chapterNumber || a.sectionId.localeCompare(b.sectionId)
      ),
    [sections]
  );

  const progressPct =
    telemetry && telemetry.totalSections > 0
      ? Math.round((telemetry.completedSections / telemetry.totalSections) * 100)
      : 0;

  const tracerProgressPct =
    tracerTelemetry && tracerTelemetry.totalSnippets > 0
      ? Math.round(
          ((tracerTelemetry.tracedCount +
            tracerTelemetry.cachedCount +
            tracerTelemetry.skippedTrivialOrUnsafeCount +
            tracerTelemetry.failedCount) /
            tracerTelemetry.totalSnippets) *
            100
        )
      : 0;

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass-strong flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-subtle">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <h3 className="text-sm font-semibold text-primary">Estudio de Ingesta Incremental</h3>
            <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">
              {metadata ? metadata.title : 'Multi-Agente'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {view === 'RUNNING' && (
              <button
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-1.5 rounded-lg border border-danger/50 px-3 py-1.5 text-xs text-danger hover:bg-danger/10"
              >
                <Square size={13} /> Cancelar
              </button>
            )}
            <button type="button" onClick={onClose} className="text-muted hover:text-primary">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {view === 'CONFIG' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-subtle p-4 text-center hover:border-accent/60">
                    {isExtractingPdf ? (
                      <Loader2 size={18} className="animate-spin text-accent" />
                    ) : (
                      <Upload size={18} className="text-muted" />
                    )}
                    <span className="text-[11px] text-muted">
                      {isExtractingPdf
                        ? `Extrayendo PDF... ${pdfProgress?.total ? `${pdfProgress.page}/${pdfProgress.total} pags` : ''}`
                        : 'Cargar PDF / TXT / MD del libro'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.markdown"
                      className="hidden"
                      disabled={isExtractingPdf}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleFile(f);
                      }}
                    />
                  </label>
                  {isExtractingPdf && pdfProgress && pdfProgress.total > 0 && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${Math.round((pdfProgress.page / pdfProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="...o pega aqui el texto del libro"
                    className="code-font h-28 w-full resize-none rounded-lg border border-subtle bg-canvas p-3 text-[11px] text-primary outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handleExtractMetadata}
                    disabled={!rawText.trim() || isExtracting}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs font-semibold text-canvas disabled:opacity-40"
                  >
                    {isExtracting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                    {isExtracting ? 'Escaneando indice...' : 'Escanear metadatos e indice (IA)'}
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Modelo rapido (secciones estandar)
                    </span>
                    <select
                      value={config.fastModel}
                      onChange={(e) => setConfig((c) => ({ ...c, fastModel: e.target.value }))}
                      className="w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                    >
                      {MODEL_PRICING.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Modelo de razonamiento (AST/denso)
                    </span>
                    <select
                      value={config.reasoningModel}
                      onChange={(e) => setConfig((c) => ({ ...c, reasoningModel: e.target.value }))}
                      className="w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                    >
                      {MODEL_PRICING.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center justify-between rounded-lg border border-subtle px-3 py-2">
                    <span className="text-[11px] text-muted">Agentes paralelos</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleConcurrency(-1)}
                        className="rounded-md border border-subtle p-1 text-muted hover:text-primary"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center text-xs font-semibold text-primary">
                        {config.concurrencyLimit}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleConcurrency(1)}
                        className="rounded-md border border-subtle p-1 text-muted hover:text-primary"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-subtle px-3 py-2">
                    <input
                      type="checkbox"
                      checked={config.dryRun}
                      onChange={(e) => setConfig((c) => ({ ...c, dryRun: e.target.checked }))}
                      className="accent-[var(--accent-primary)]"
                    />
                    <span className="text-[11px] text-muted">Modo Simulacion (Dry-Run, $0.00)</span>
                  </label>
                </div>
              </div>

              {coverDataUrl && (
                <div className="flex items-center gap-3 rounded-xl border border-subtle bg-canvas p-3">
                  <img
                    src={coverDataUrl}
                    alt="Portada extraida"
                    className="h-24 w-16 rounded-lg border border-subtle object-cover"
                  />
                  <div>
                    <p className="text-xs font-semibold text-primary">Portada extraida del PDF</p>
                    <p className="text-[10px] text-muted">Se usara como miniatura en la Biblioteca.</p>
                  </div>
                </div>
              )}

              {metadata && (
                <div className="rounded-xl border border-subtle bg-canvas p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles size={13} className="text-accent" /> Metadatos extraidos por IA (Editables)
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      value={metadata.title}
                      onChange={(e) => updateMetadataField('title', e.target.value)}
                      placeholder="Titulo"
                      className="rounded-lg border border-subtle bg-surface px-3 py-1.5 text-xs text-primary outline-none focus:border-accent"
                    />
                    <input
                      value={metadata.subtitle}
                      onChange={(e) => updateMetadataField('subtitle', e.target.value)}
                      placeholder="Subtitulo"
                      className="rounded-lg border border-subtle bg-surface px-3 py-1.5 text-xs text-primary outline-none focus:border-accent"
                    />
                    <input
                      value={metadata.authors.join(', ')}
                      onChange={(e) =>
                        updateMetadataField(
                          'authors',
                          e.target.value.split(',').map((a) => a.trim()).filter(Boolean)
                        )
                      }
                      placeholder="Autores (coma)"
                      className="rounded-lg border border-subtle bg-surface px-3 py-1.5 text-xs text-primary outline-none focus:border-accent"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        value={metadata.year}
                        onChange={(e) => updateMetadataField('year', Number(e.target.value))}
                        placeholder="Anio"
                        className="rounded-lg border border-subtle bg-surface px-2 py-1.5 text-xs text-primary outline-none focus:border-accent"
                      />
                      <input
                        value={metadata.edition}
                        onChange={(e) => updateMetadataField('edition', e.target.value)}
                        placeholder="Edicion"
                        className="rounded-lg border border-subtle bg-surface px-2 py-1.5 text-xs text-primary outline-none focus:border-accent"
                      />
                      <input
                        type="number"
                        value={metadata.totalPages}
                        onChange={(e) => updateMetadataField('totalPages', Number(e.target.value))}
                        placeholder="Paginas"
                        className="rounded-lg border border-subtle bg-surface px-2 py-1.5 text-xs text-primary outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-muted">
                    {metadata.authors.join(', ')} | Paginas: {metadata.totalPages} | Caracteres:{' '}
                    {metadata.totalChars.toLocaleString()} | bookId: <span className="code-font">{bookId}</span>
                  </p>
                </div>
              )}

              {chaptersIndex.length > 0 && (
                <div className="rounded-xl border border-subtle bg-canvas p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <ListChecks size={13} className="text-accent" /> Selecciona los capitulos a procesar
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={selectPending}
                        className="rounded-lg border border-subtle px-2 py-1 text-[10px] text-secondary hover:border-accent/50"
                      >
                        Seleccionar Pendientes
                      </button>
                      <button
                        type="button"
                        onClick={selectAll}
                        className="rounded-lg border border-subtle px-2 py-1 text-[10px] text-secondary hover:border-accent/50"
                      >
                        Todos
                      </button>
                    </div>
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {chaptersIndex.map((c) => {
                      const dbMeta = DB_STATUS_META[c.dbStatus];
                      return (
                        <label
                          key={c.chapterNumber}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-subtle/60 px-2 py-1.5 hover:border-accent/40"
                        >
                          <input
                            type="checkbox"
                            checked={c.selectionState}
                            onChange={() => toggleChapter(c.chapterNumber)}
                            className="accent-[var(--accent-primary)]"
                          />
                          <span className="flex-1 truncate text-[11px] text-primary">
                            Cap {c.chapterNumber}: {c.title}
                          </span>
                          <span className="code-font text-[10px] text-muted">
                            Pags. {c.startPage}-{c.endPage} | {c.estimatedMicroLessons} micro-lecciones
                          </span>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[9px]', dbMeta.className)}>
                            {dbMeta.label}
                          </span>
                          <span className="code-font w-16 text-right text-[10px] text-secondary">
                            ~{fmtUsd(c.estimatedCostUsd)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-muted">
                    Seleccionados: {selectedChapters.length} | Costo estimado:{' '}
                    <span className="text-success">{fmtUsd(selectedEstimatedCost)}</span>
                  </p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">
                  <AlertTriangle size={13} className="mt-0.5" /> {error}
                </div>
              )}
            </div>
          )}

          {view === 'RUNNING' && (
            <div className="space-y-4">
              {/* FASE A: TRAZADOR DE MEMORIA PARALELO */}
              <div className="rounded-xl border border-subtle bg-canvas p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <Brain size={12} className="text-accent" /> Fase A: Trazador de Memoria Paralelo
                    {tracerTelemetry && ` (${tracerTelemetry.workerCount} Workers • Filtro AST Activo)`}
                  </p>
                  <button
                    type="button"
                    onClick={handlePauseTracer}
                    disabled={!isTracing}
                    className="flex items-center gap-1 rounded-lg border border-subtle px-2 py-1 text-[10px] text-secondary hover:border-secondary/50 disabled:opacity-40"
                  >
                    {tracerPaused ? <Play size={11} /> : <Pause size={11} />}
                    {tracerPaused ? 'Reanudar' : 'Pausar y Guardar'}
                  </button>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${tracerProgressPct}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
                  <span>{tracerProgressPct}%</span>
                  <span className="text-success">{tracerTelemetry?.tracedCount ?? 0} trazados</span>
                  <span className="text-secondary">{tracerTelemetry?.cachedCount ?? 0} en cache</span>
                  <span>{tracerTelemetry?.skippedTrivialOrUnsafeCount ?? 0} triviales/omitidos</span>
                  <span className="text-danger">{tracerTelemetry?.failedCount ?? 0} fallos</span>
                  <span>Tiempo: {fmtTime(tracerTelemetry?.elapsedSec ?? 0)}</span>
                  <span>ETA: {fmtTime(tracerTelemetry?.etaSec ?? 0)}</span>
                  <span className="text-success">Costo: $0.00</span>
                </div>
              </div>

              {/* FASE B: COMPILADOR MULTI-AGENTE LLM */}
              <div className="rounded-xl border border-subtle bg-canvas p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <Cpu size={12} className="text-accent" /> Fase B: Compilador Multi-Agente LLM
                  </p>
                  <button
                    type="button"
                    onClick={handlePauseCompiler}
                    disabled={compilerPaused}
                    className="flex items-center gap-1 rounded-lg border border-subtle px-2 py-1 text-[10px] text-secondary hover:border-secondary/50 disabled:opacity-40"
                  >
                    <Pause size={11} /> Pausar y Guardar
                  </button>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
                  <span>
                    {progressPct}% ({telemetry?.completedSections ?? 0}/{telemetry?.totalSections ?? 0} secciones)
                  </span>
                  <span className="text-primary">
                    Gastado: {fmtUsd(telemetry?.spentUsd ?? 0)} / ~{fmtUsd(telemetry?.projectedTotalUsd ?? 0)}
                  </span>
                  <span>ETA: {fmtTime(telemetry?.etaSec ?? 0)}</span>
                  <span className="text-accent">{telemetry?.tokensPerSec ?? 0} tok/s</span>
                  <span>
                    Workers: {telemetry?.activeWorkers ?? 0}/{telemetry?.concurrencyLimit ?? config.concurrencyLimit}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-subtle bg-canvas p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    <Clock size={11} /> Tiempo y Velocidad
                  </p>
                  <p className="text-xs text-primary">Transcurrido: {fmtTime(telemetry?.elapsedSec ?? 0)}</p>
                  <p className="text-xs text-primary">ETA: {fmtTime(telemetry?.etaSec ?? 0)}</p>
                  <p className="text-xs text-accent">{telemetry?.tokensPerSec ?? 0} tokens/seg</p>
                </div>
                <div className="rounded-xl border border-subtle bg-canvas p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    <DollarSign size={11} /> Control Financiero
                  </p>
                  <p className="text-xs text-primary">Gastado: {fmtUsd(telemetry?.spentUsd ?? 0)}</p>
                  <p className="text-xs text-primary">
                    Restante est.: {fmtUsd(telemetry?.estimatedRemainingUsd ?? 0)}
                  </p>
                  <p className="text-xs text-success">Proyectado: {fmtUsd(telemetry?.projectedTotalUsd ?? 0)}</p>
                </div>
                <div className="rounded-xl border border-subtle bg-canvas p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    <Database size={11} /> Base de Datos
                  </p>
                  <p className="text-xs text-primary">bookId: {bookId}</p>
                  <p className="text-xs text-success">Capitulos fusionados: {readyChapters.length}</p>
                  <p className="text-xs text-muted">Fast: {config.fastModel.split('/').pop()}</p>
                </div>
              </div>

              {readyChapters.length > 0 && (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-[11px] font-medium text-success"
                >
                  <BookOpen size={12} /> Abrir capitulos listos ({readyChapters.join(', ')})
                </button>
              )}

              <div className="overflow-hidden rounded-xl border border-subtle">
                <div className="grid grid-cols-[80px_1fr_90px_120px_80px_70px] gap-2 border-b border-subtle bg-elevated px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <span>Estado</span>
                  <span>Micro-Leccion</span>
                  <span>Agente</span>
                  <span>Tokens (in/out)</span>
                  <span>Costo</span>
                  <span>Tiempo</span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {sectionList.map((s) => {
                    const meta = STATUS_META[s.status];
                    return (
                      <div
                        key={s.sectionId}
                        className="grid grid-cols-[80px_1fr_90px_120px_80px_70px] items-center gap-2 border-b border-subtle/50 px-3 py-1.5 text-[11px]"
                      >
                        <span className={cn('flex items-center gap-1 font-medium', meta.className)}>
                          {s.status === 'RUNNING' && <Loader2 size={10} className="animate-spin" />}
                          {s.status === 'COMPLETED' && <CheckCircle2 size={10} />}
                          {s.status === 'FAILED' && <AlertTriangle size={10} />}
                          {meta.label}
                        </span>
                        <span className="truncate text-primary">
                          {s.chapterNumber}. {s.sectionTitle}
                        </span>
                        <span className="text-muted">{s.assignedWorkerId ? `#${s.assignedWorkerId}` : '-'}</span>
                        <span className="code-font text-muted">
                          {s.actualInputTokens || s.estimatedInputTokens} /{' '}
                          {s.actualOutputTokens || `~${s.estimatedOutputTokens}`}
                        </span>
                        <span className="code-font text-secondary">
                          {fmtUsd(s.actualCostUsd || s.estimatedCostUsd)}
                        </span>
                        <span className="code-font text-muted">
                          {s.actualDurationSec ? `${s.actualDurationSec.toFixed(1)}s` : `~${s.estimatedDurationSec.toFixed(1)}s`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {log.length > 0 && (
                <div className="max-h-28 overflow-y-auto rounded-lg border border-subtle bg-canvas p-2">
                  {log.map((line, idx) => (
                    <p key={idx} className="code-font text-[10px] text-muted">
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-subtle px-4 py-3">
          <span className="flex items-center gap-1.5 text-[10px] text-muted">
            <Zap size={11} className="text-accent" />
            {config.dryRun ? 'Modo Simulacion activo ($0.00)' : 'Consumo real de API'}
          </span>
          {view === 'CONFIG' ? (
            <button
              type="button"
              onClick={handleStart}
              disabled={!metadata || selectedChapters.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas disabled:opacity-40"
            >
              <Play size={13} /> Iniciar ingesta incremental
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas"
            >
              <RefreshCw size={13} /> Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

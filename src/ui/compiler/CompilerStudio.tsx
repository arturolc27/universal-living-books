import { useCallback, useMemo, useState } from 'react';
import {
  X,
  FileText,
  Upload,
  Scissors,
  Footprints,
  Sparkles,
  CheckCircle2,
  Loader2,
  Download,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { chunkText, normalizeSnippet, type SectionChunk, type TracedSnippet } from '../../engine/compiler/semanticChunker';
import { compileCartridge, type CompileBookMeta } from '../../engine/compiler/llmCompiler';
import { pythonRuntimeBridge } from '../../engine/pyodide/pythonRuntimeBridge';
import { validateBookCartridge } from '../../types/cartridge.schema';
import type { BookCartridge } from '../../types/cartridge.types';
import { cn } from '../utils/cn';

type Step = 'INPUT' | 'CHUNK' | 'TRACE' | 'COMPILE' | 'DONE';

const STEPS: Array<{ id: Step; label: string; icon: typeof FileText }> = [
  { id: 'INPUT', label: 'Fuente', icon: FileText },
  { id: 'CHUNK', label: 'Segmentar', icon: Scissors },
  { id: 'TRACE', label: 'Trazar', icon: Footprints },
  { id: 'COMPILE', label: 'Compilar', icon: Sparkles },
  { id: 'DONE', label: 'Instalar', icon: CheckCircle2 },
];

interface PdfTextItem {
  str?: string;
}

interface PdfPage {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs';
  const pdfjs = (await import(/* @vite-ignore */ pdfjsUrl)) as unknown as PdfJsModule;
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str ?? '').join(' ') + '\n\n';
  }
  return text;
}

export function CompilerStudio({ onClose }: { onClose: () => void }) {
  const settings = usePlatformStore((s) => s.settings);
  const registerCartridge = usePlatformStore((s) => s.registerCartridge);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const [step, setStep] = useState<Step>('INPUT');
  const [rawText, setRawText] = useState('');
  const [chunks, setChunks] = useState<SectionChunk[]>([]);
  const [traces, setTraces] = useState<TracedSnippet[]>([]);
  const [cartridge, setCartridge] = useState<BookCartridge | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('Mi Libro Compilado');
  const [authors, setAuthors] = useState('Autor Desconocido');
  const [difficulty, setDifficulty] = useState<'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'>('BEGINNER');
  const [packages, setPackages] = useState('');

  const appendLog = useCallback((line: string) => setLog((prev) => [...prev, line]), []);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        appendLog(`Extrayendo texto de ${file.name}...`);
        const text = await extractPdfText(file);
        setRawText(text);
        appendLog(`PDF procesado: ${text.length} caracteres.`);
      } else {
        const text = await file.text();
        setRawText(text);
        appendLog(`Archivo cargado: ${text.length} caracteres.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleChunk = () => {
    setError(null);
    const result = chunkText(rawText);
    setChunks(result);
    appendLog(`Segmentado en ${result.length} micro-secciones.`);
    setStep('CHUNK');
  };

  const handleTrace = async () => {
    setError(null);
    setBusy(true);
    try {
      const traced: TracedSnippet[] = [];
      for (const chunk of chunks) {
        for (let i = 0; i < chunk.codeSnippets.length; i += 1) {
          const code = normalizeSnippet(chunk.codeSnippets[i]);
          try {
            const steps = await pythonRuntimeBridge.traceExecutionMemory(code, 200);
            traced.push({ sectionId: chunk.sectionId, snippetIndex: i, code, memorySteps: steps });
          } catch {
            traced.push({ sectionId: chunk.sectionId, snippetIndex: i, code, memorySteps: [] });
          }
        }
      }
      setTraces(traced);
      appendLog(`Trazadas ${traced.length} snippets de codigo.`);
      setStep('TRACE');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCompile = async () => {
    setError(null);
    const activeKey = settings.llmProvider === 'openrouter' ? settings.openrouterApiKey : settings.geminiApiKey;
    if (!activeKey) {
      setError(
        settings.llmProvider === 'openrouter'
          ? 'Configura tu API Key de OpenRouter en Configuracion > Compilador.'
          : 'Configura tu API Key de Gemini en Configuracion > Compilador.'
      );
      return;
    }
    setBusy(true);
    try {
      const meta: CompileBookMeta = {
        bookId: `compiled-${Date.now()}`,
        metadata: {
          title,
          subtitle: 'Compilado con el Estudio de Compilacion',
          authors: authors.split(',').map((a) => a.trim()).filter(Boolean),
          edition: '1st Edition',
          difficulty,
          coverAccentIcon: '📘',
        },
        themeDNA: {
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
        },
        runtimeRequirements: {
          pythonVersion: '3.14',
          packages: packages.split(',').map((p) => p.trim()).filter(Boolean),
          enableLiveMemoryTracer: true,
          virtualFileSystemSeed: {},
        },
      };

      const result = await compileCartridge(chunks, traces, meta, {
        provider: settings.llmProvider,
        apiKey: settings.llmProvider === 'openrouter' ? settings.openrouterApiKey : settings.geminiApiKey,
        model: settings.llmProvider === 'openrouter' ? settings.openrouterModel : settings.geminiModel,
        onProgress: appendLog,
      });
      setCartridge(result);
      appendLog('Cartucho compilado. Validando esquema...');
      setStep('COMPILE');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const validation = useMemo(() => (cartridge ? validateBookCartridge(cartridge) : null), [cartridge]);

  const handleInstall = async () => {
    if (!cartridge) return;
    await registerCartridge(cartridge, true);
    pushToast({ title: 'Libro compilado instalado', description: cartridge.metadata.title, iconKey: 'check' });
    setStep('DONE');
  };

  const handleDownload = () => {
    if (!cartridge) return;
    const blob = new Blob([JSON.stringify(cartridge, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cartridge.bookId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass-strong flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-subtle">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <h3 className="text-sm font-semibold text-primary">Estudio de Compilacion</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-primary">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-subtle px-3 py-2">
          {STEPS.map((s, idx) => (
            <div key={s.id} className="flex items-center gap-1">
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium',
                  idx === stepIndex
                    ? 'bg-accent/15 text-accent'
                    : idx < stepIndex
                      ? 'text-success'
                      : 'text-muted'
                )}
              >
                <s.icon size={12} /> {s.label}
              </div>
              {idx < STEPS.length - 1 && <ChevronRight size={11} className="text-muted" />}
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {step === 'INPUT' && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted">
                Sube un PDF o pega el texto de un capitulo. El pipeline segmenta, traza memoria y compila con el LLM.
              </p>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-subtle p-6 text-center hover:border-accent/60">
                <Upload size={20} className="text-muted" />
                <span className="text-xs text-muted">Arrastra o selecciona un PDF / TXT / MD</span>
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.markdown"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="...o pega aqui el texto del libro"
                className="code-font h-40 w-full resize-none rounded-lg border border-subtle bg-canvas p-3 text-[11px] text-primary outline-none focus:border-accent"
              />
              <div className="grid grid-cols-2 gap-2">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titulo" className="rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent" />
                <input value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Autores (coma)" className="rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent" />
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)} className="rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent">
                  <option value="BEGINNER">Principiante</option>
                  <option value="INTERMEDIATE">Intermedio</option>
                  <option value="ADVANCED">Avanzado</option>
                </select>
                <input value={packages} onChange={(e) => setPackages(e.target.value)} placeholder="Paquetes: pandas, matplotlib" className="rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent" />
              </div>
            </div>
          )}

          {step === 'CHUNK' && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted">{chunks.length} micro-secciones detectadas.</p>
              {chunks.map((c) => (
                <div key={c.sectionId} className="rounded-lg border border-subtle bg-canvas p-2">
                  <p className="text-xs font-medium text-primary">Cap {c.chapterNumber}: {c.sectionTitle}</p>
                  <p className="text-[10px] text-muted">{c.text.length} chars - {c.codeSnippets.length} snippets</p>
                </div>
              ))}
            </div>
          )}

          {step === 'TRACE' && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted">{traces.length} snippets trazados con sys.settrace.</p>
              {traces.slice(0, 20).map((t, idx) => (
                <div key={idx} className="rounded-lg border border-subtle bg-canvas p-2">
                  <p className="code-font truncate text-[10px] text-muted">{t.code.split('\n')[0]}</p>
                  <p className="text-[10px] text-accent">{t.memorySteps.length} pasos de memoria</p>
                </div>
              ))}
            </div>
          )}

          {step === 'COMPILE' && validation && (
            <div className="space-y-3">
              {validation.success ? (
                <div className="rounded-lg border border-success/40 bg-success/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                    <CheckCircle2 size={13} /> Cartucho valido
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                    <span className="text-muted">Titulo:</span><span className="text-primary">{validation.diagnostics.title}</span>
                    <span className="text-muted">Capitulos:</span><span className="text-primary">{validation.diagnostics.chapterCount}</span>
                    <span className="text-muted">Lecciones:</span><span className="text-primary">{validation.diagnostics.lessonCount}</span>
                    <span className="text-muted">Bloques:</span><span className="text-primary">{validation.diagnostics.totalBlocks}</span>
                    <span className="text-muted">Flashcards:</span><span className="text-primary">{validation.diagnostics.flashcardCount}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                    <AlertTriangle size={13} /> Esquema invalido
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {validation.issues.slice(0, 6).map((issue, idx) => (
                      <li key={idx} className="code-font text-[10px] text-danger/90">{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {step === 'DONE' && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 size={32} className="text-success" />
              <p className="text-sm font-semibold text-primary">Libro instalado</p>
              <p className="text-xs text-muted">Ya esta disponible en tu Biblioteca.</p>
            </div>
          )}

          {log.length > 0 && (
            <div className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-subtle bg-canvas p-2">
              {log.map((line, idx) => (
                <p key={idx} className="code-font text-[10px] text-muted">{line}</p>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">
              <AlertTriangle size={13} className="mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-subtle px-4 py-3">
          <button
            type="button"
            onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].id)}
            disabled={stepIndex === 0 || busy}
            className="rounded-lg border border-subtle px-3 py-1.5 text-xs text-muted hover:text-primary disabled:opacity-40"
          >
            Atras
          </button>

          <div className="flex items-center gap-2">
            {step === 'INPUT' && (
              <button type="button" onClick={handleChunk} disabled={!rawText.trim()} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas disabled:opacity-40">
                Segmentar
              </button>
            )}
            {step === 'CHUNK' && (
              <button type="button" onClick={handleTrace} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas disabled:opacity-40">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Footprints size={13} />} Trazar memoria
              </button>
            )}
            {step === 'TRACE' && (
              <button type="button" onClick={handleCompile} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas disabled:opacity-40">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Compilar con LLM
              </button>
            )}
            {step === 'COMPILE' && (
              <>
                <button type="button" onClick={handleDownload} className="flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:border-accent/50">
                  <Download size={13} /> JSON
                </button>
                <button type="button" onClick={handleInstall} disabled={!validation?.success} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas disabled:opacity-40">
                  Instalar
                </button>
              </>
            )}
            {step === 'DONE' && (
              <button type="button" onClick={onClose} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas">
                Cerrar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
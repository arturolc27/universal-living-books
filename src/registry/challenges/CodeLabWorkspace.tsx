import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  Play,
  Footprints,
  Terminal,
  LineChart,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  HelpCircle,
  AlertTriangle,
  Sparkles,
  Brain,
} from 'lucide-react';
import type { CodeLabBlock, MemoryStep, PythonExecutionResult } from '../../types/cartridge.types';
import { pythonRuntimeBridge } from '../../engine/pyodide/pythonRuntimeBridge';
import {
  detectPythonMisconception,
  type MisconceptionDiagnosis,
} from '../../engine/evaluators/misconceptionDetector';
import { requestSocraticHint } from '../../engine/compiler/socraticTutor';
import { MemoryHeapVisualizer } from '../visualizers/MemoryHeapVisualizer';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

const FDR_STEPS = [
  { key: 'examples', label: '1. Ejemplos', hint: 'Escribe ejemplos >>> antes de programar.' },
  { key: 'header', label: '2. Header', hint: 'Firma tipada con type hints.' },
  { key: 'description', label: '3. Docstring', hint: 'Describe proposito y contrato.' },
  { key: 'body', label: '4. Cuerpo', hint: 'Implementa la logica.' },
  { key: 'test', label: '5. Test', hint: 'Verifica con asserts/doctest.' },
] as const;

type ResultTab = 'CONSOLE' | 'PLOTS' | 'AUDIT' | 'MEMORY';

export function CodeLabWorkspace({
  block,
  onResolved,
}: {
  block: CodeLabBlock;
  onResolved?: () => void;
}) {
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const cartridges = usePlatformStore((s) => s.cartridges);
  const virtualFiles = usePlatformStore((s) => s.virtualFiles);
  const settings = usePlatformStore((s) => s.settings);
  const syncVirtualFilesFromRuntime = usePlatformStore((s) => s.syncVirtualFilesFromRuntime);
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const recordLearningTelemetry = usePlatformStore((s) => s.recordLearningTelemetry);
  const flagPcLabFailure = usePlatformStore((s) => s.flagPcLabFailure);
  const setLiveMemorySteps = usePlatformStore((s) => s.setLiveMemorySteps);
  const sandboxCodeRequest = usePlatformStore((s) => s.sandboxCodeRequest);
  const setSandboxCodeRequest = usePlatformStore((s) => s.setSandboxCodeRequest);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const cartridge = activeBookId ? cartridges[activeBookId] : null;

  const [code, setCode] = useState(block.starterCode ?? '');
  const [result, setResult] = useState<PythonExecutionResult | null>(null);
  const [traceSteps, setTraceSteps] = useState<MemoryStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isTracing, setIsTracing] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>('CONSOLE');
  const [fdrStep, setFdrStep] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [revealedHintCount, setRevealedHintCount] = useState(0);
  const [misconception, setMisconception] = useState<MisconceptionDiagnosis | null>(null);
  const [activeMisconceptionId, setActiveMisconceptionId] = useState<MisconceptionDiagnosis['id'] | null>(null);
  const [thrashingUntil, setThrashingUntil] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [socraticHint, setSocraticHint] = useState<string | null>(null);
  const [isAskingTutor, setIsAskingTutor] = useState(false);

  const runHistoryRef = useRef<Array<{ ts: number; len: number; passed: boolean }>>([]);

  useEffect(() => {
    setCode(block.starterCode ?? '');
    setResult(null);
    setTraceSteps([]);
    setFdrStep(0);
    setFailCount(0);
    setRevealedHintCount(0);
    setMisconception(null);
    setActiveMisconceptionId(null);
    setThrashingUntil(0);
    setSocraticHint(null);
    runHistoryRef.current = [];
  }, [block.blockId, block.starterCode]);

  useEffect(() => {
    if (sandboxCodeRequest) {
      setCode(sandboxCodeRequest);
      setSandboxCodeRequest(null);
    }
  }, [sandboxCodeRequest, setSandboxCodeRequest]);

  useEffect(() => {
    if (thrashingUntil <= Date.now()) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [thrashingUntil]);

  const thrashSecondsLeft = Math.max(0, Math.ceil((thrashingUntil - nowTick) / 1000));

  const ensureRuntime = useCallback(async () => {
    if (!cartridge) return;
    await pythonRuntimeBridge.initBookRuntime(
      cartridge.bookId,
      cartridge.runtimeRequirements.packages,
      virtualFiles
    );
  }, [cartridge, virtualFiles]);

  const handleRun = useCallback(async () => {
    if (!cartridge || thrashSecondsLeft > 0) return;
    setIsRunning(true);
    try {
      await ensureRuntime();
      const execResult = await pythonRuntimeBridge.executeAndEvaluate(code, {
        unitTestCode: block.unitTestCode || undefined,
        hiddenTestCode: block.hiddenTestCode || undefined,
      });
      setResult(execResult);
      if (execResult.updatedVirtualFiles) {
        await syncVirtualFilesFromRuntime(execResult.updatedVirtualFiles);
      }
      const passed = execResult.unitTestReport ? execResult.unitTestReport.passed : execResult.ok;
      await recordAttempt(passed);

      if (block.unitTestCode || block.hiddenTestCode) {
        void recordLearningTelemetry({
          bookId: cartridge.bookId,
          blockId: block.blockId,
          eventType: 'TRANSFER_LAB',
          conceptTag: block.conceptTags?.[0],
          passed,
        });
      }

      if (passed) {
        setMisconception(null);
        if (activeMisconceptionId) {
          void recordLearningTelemetry({
            bookId: cartridge.bookId,
            blockId: block.blockId,
            eventType: 'MISCONCEPTION_RESOLVED',
            misconceptionId: activeMisconceptionId,
            passed: true,
          });
          setActiveMisconceptionId(null);
        }
        pushToast({
          title: block.unitTestCode ? 'Pruebas superadas' : 'Ejecucion exitosa',
          description: block.unitTestCode
            ? 'Tu codigo paso la suite visible y los casos ocultos.'
            : 'Codigo ejecutado en Pyodide WASM.',
          iconKey: 'check',
        });
        onResolved?.();
      } else {
        setFailCount((c) => c + 1);
        if (block.linkedFlashcardId) {
          void flagPcLabFailure(block.linkedFlashcardId);
        }
        const detected = detectPythonMisconception(code, execResult);
        setMisconception(detected);
        if (detected) {
          setActiveMisconceptionId(detected.id);
          void recordLearningTelemetry({
            bookId: cartridge.bookId,
            blockId: block.blockId,
            eventType: 'MISCONCEPTION_TRIGGERED',
            misconceptionId: detected.id,
            passed: false,
          });
        }
        // Anti-thrashing: 4 fallos en <60s con cambios <12 chars
        const now = Date.now();
        runHistoryRef.current = [
          ...runHistoryRef.current.filter((h) => now - h.ts < 60_000),
          { ts: now, len: code.trim().length, passed: false },
        ];
        if (runHistoryRef.current.length >= 4) {
          const lens = runHistoryRef.current.map((h) => h.len);
          const span = Math.max(...lens) - Math.min(...lens);
          if (span < 12) {
            setThrashingUntil(now + 8000);
            setNowTick(now);
            void recordLearningTelemetry({
              bookId: cartridge.bookId,
              blockId: block.blockId,
              eventType: 'THRASHING_DETECTED',
              passed: false,
            });
          }
        }
      }

      if (execResult.plotsBase64.length > 0) setActiveTab('PLOTS');
      else if (execResult.unitTestReport) setActiveTab('AUDIT');
      else setActiveTab('CONSOLE');
    } catch (err) {
      setResult({
        ok: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        returnValue: null,
        plotsBase64: [],
        updatedVirtualFiles: {},
        executionTimeMs: 0,
      });
      setActiveTab('CONSOLE');
    } finally {
      setIsRunning(false);
    }
  }, [
    activeMisconceptionId,
    block.blockId,
    block.conceptTags,
    block.hiddenTestCode,
    block.linkedFlashcardId,
    block.unitTestCode,
    cartridge,
    code,
    ensureRuntime,
    flagPcLabFailure,
    onResolved,
    pushToast,
    recordAttempt,
    recordLearningTelemetry,
    syncVirtualFilesFromRuntime,
    thrashSecondsLeft,
  ]);

  const handleTrace = useCallback(async () => {
    if (!cartridge) return;
    setIsTracing(true);
    try {
      await ensureRuntime();
      const steps = await pythonRuntimeBridge.traceExecutionMemory(code);
      setTraceSteps(steps);
      setLiveMemorySteps(steps, block.blockId);
      setActiveTab('MEMORY');
      pushToast({
        title: 'Traza capturada',
        description: `Se registraron ${steps.length} pasos de memoria en vivo.`,
        iconKey: 'footprints',
      });
    } catch (err) {
      pushToast({
        title: 'Traza fallida',
        description: err instanceof Error ? err.message : String(err),
        iconKey: 'error',
      });
    } finally {
      setIsTracing(false);
    }
  }, [block.blockId, cartridge, code, ensureRuntime, pushToast, setLiveMemorySteps]);

  const handleAskSocraticTutor = async () => {
    setIsAskingTutor(true);
    try {
      const provider =
        settings.llmProvider === 'gemini' && settings.geminiApiKey
          ? 'gemini'
          : settings.openrouterApiKey
            ? 'openrouter'
            : 'gemini';
      const hint = await requestSocraticHint(
        {
          challengeTitle: block.title,
          instructions: block.instructions,
          userCode: code,
          lastError:
            result?.stderr ||
            result?.unitTestReport?.items.find((i) => !i.passed)?.message ||
            'Las pruebas aún no pasan.',
          hintLevel: Math.min(3, Math.max(1, failCount)) as 1 | 2 | 3,
          misconceptionTitle: misconception?.title,
        },
        {
          provider,
          openrouterApiKey: settings.openrouterApiKey,
          geminiApiKey: settings.geminiApiKey,
        }
      );
      setSocraticHint(hint);
    } catch (err) {
      setSocraticHint(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAskingTutor(false);
    }
  };

  const editorTheme = cartridge?.themeDNA.mode === 'light' ? 'light' : 'vs-dark';
  const auditItems = useMemo(() => result?.unitTestReport?.items ?? [], [result]);
  const hints = block.progressiveHints ?? [];

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-primary">{block.title}</h3>
            {block.labPhase && (
              <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-accent">
                {block.labPhase}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted">{block.instructions}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hints.length > 0 && revealedHintCount < hints.length && (
            <button
              type="button"
              onClick={() => setRevealedHintCount((c) => Math.min(hints.length, c + 1))}
              className="flex items-center gap-1 rounded-md border border-subtle px-2 py-1 text-[11px] text-accent hover:border-accent/50"
            >
              <HelpCircle size={12} /> Pista ({revealedHintCount}/{hints.length})
            </button>
          )}
          {failCount >= 2 && (settings.openrouterApiKey || settings.geminiApiKey) && (
            <button
              type="button"
              onClick={() => void handleAskSocraticTutor()}
              disabled={isAskingTutor}
              className="flex items-center gap-1 rounded-md border border-secondary/50 bg-secondary/10 px-2 py-1 text-[11px] font-medium text-secondary hover:bg-secondary/20 disabled:opacity-50"
            >
              {isAskingTutor ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Guía Socrática
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setCode(block.starterCode ?? '');
              setResult(null);
              setMisconception(null);
            }}
            title="Restablecer codigo inicial"
            className="rounded-md border border-subtle p-1.5 text-muted hover:text-primary"
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || thrashSecondsLeft > 0}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-canvas disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {thrashSecondsLeft > 0 ? `Reflexiona (${thrashSecondsLeft}s)` : 'Run'}
          </button>
          <button
            type="button"
            onClick={handleTrace}
            disabled={isTracing}
            className="flex items-center gap-1.5 rounded-md border border-subtle px-3 py-1.5 text-xs font-medium text-secondary hover:bg-elevated disabled:opacity-50"
          >
            {isTracing ? <Loader2 size={13} className="animate-spin" /> : <Footprints size={13} />}
            Trace
          </button>
        </div>
      </div>

      {block.scaffoldMode === 'FDR_5_STEPS' && block.fdrGuide && (
        <div className="border-b border-subtle bg-elevated/40 px-3 py-2">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {FDR_STEPS.map((step, idx) => (
              <button
                key={step.key}
                type="button"
                onClick={() => setFdrStep(idx)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  fdrStep === idx
                    ? 'bg-accent text-canvas'
                    : 'bg-surface text-muted hover:text-primary'
                )}
              >
                {step.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted">
            <span className="font-semibold text-secondary">FDR:</span>{' '}
            {FDR_STEPS[fdrStep].hint}
          </p>
        </div>
      )}

      {(revealedHintCount > 0 || socraticHint || misconception || thrashSecondsLeft > 0) && (
        <div className="space-y-1.5 border-b border-subtle bg-elevated/30 px-3 py-2">
          {thrashSecondsLeft > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-secondary/50 bg-secondary/10 px-2.5 py-1.5 text-[11px] text-secondary">
              <AlertTriangle size={13} className="shrink-0" />
              <span>
                Pausa anti ensayo-y-error ({thrashSecondsLeft}s): usa <strong>Trace</strong> para inspeccionar tus variables antes de volver a ejecutar.
              </span>
            </div>
          )}
          {misconception && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">
              <p className="font-semibold">Modelo mental detectado: {misconception.title}</p>
              <p className="mt-0.5 text-primary/90">{misconception.explanation}</p>
              <p className="mt-0.5 font-medium text-accent">{misconception.refutationTip}</p>
            </div>
          )}
          {socraticHint && (
            <div className="flex items-start gap-2 rounded-md border border-secondary/40 bg-secondary/10 p-2 text-[11px] text-primary">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-secondary" />
              <span>{socraticHint}</span>
            </div>
          )}
          {hints.slice(0, revealedHintCount).map((h, idx) => (
            <p key={idx} className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-[11px] text-accent">
              💡 Pista {idx + 1}: {h}
            </p>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language="python"
          theme={editorTheme}
          value={code}
          onChange={(value) => setCode(value ?? '')}
          options={{
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            padding: { top: 12 },
            automaticLayout: true,
          }}
        />
      </div>

      <div className="flex h-56 shrink-0 flex-col border-t border-subtle">
        <div className="flex items-center gap-1 border-b border-subtle px-2">
          {([
            { id: 'CONSOLE', label: 'Consola', icon: Terminal },
            { id: 'AUDIT', label: 'AST & Tests', icon: ShieldCheck },
            { id: 'MEMORY', label: `Memoria (${traceSteps.length})`, icon: Brain },
            { id: 'PLOTS', label: 'Gráficas', icon: LineChart },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-primary'
              )}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {activeTab === 'CONSOLE' && (
            <pre className="code-font whitespace-pre-wrap text-xs leading-relaxed text-primary">
              {result ? (
                <>
                  {result.stdout && <span>{result.stdout}</span>}
                  {result.stderr && <span className="text-danger">{result.stderr}</span>}
                  {!result.stdout && !result.stderr && (
                    <span className="text-muted">Sin salida. Pulsa Run para ejecutar.</span>
                  )}
                </>
              ) : (
                <span className="text-muted">Pulsa Run para ejecutar tu codigo en el runtime de Python.</span>
              )}
            </pre>
          )}

          {activeTab === 'PLOTS' && (
            <div className="flex flex-wrap gap-3">
              {result && result.plotsBase64.length > 0 ? (
                result.plotsBase64.map((b64, idx) => (
                  <img
                    key={idx}
                    src={`data:image/png;base64,${b64}`}
                    alt={`Grafica ${idx + 1}`}
                    className="max-h-40 rounded-md border border-subtle bg-white"
                  />
                ))
              ) : (
                <span className="text-xs text-muted">Sin graficas. Usa matplotlib.pyplot.show() en tu codigo.</span>
              )}
            </div>
          )}

          {activeTab === 'MEMORY' && (
            <div className="h-full min-h-[10rem]">
              <MemoryHeapVisualizer
                block={{
                  blockId: block.blockId,
                  type: 'INTERACTIVE_VISUALIZER',
                  visualizerKind: 'MEMORY_MODEL',
                  title: 'Traza en vivo (Stack & Heap)',
                  codeContext: code,
                  payload: { memorySteps: traceSteps },
                }}
                overrideSteps={traceSteps}
              />
            </div>
          )}

          {activeTab === 'AUDIT' && (
            <div className="space-y-2">
              {result?.astReport && (
                <div className="rounded-md border border-subtle bg-canvas p-2">
                  <p className="mb-1 text-xs font-semibold text-primary">Auditoria AST</p>
                  {result.astReport.checks.map((check, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[11px]">
                      {check.passed ? (
                        <CheckCircle2 size={12} className="text-success" />
                      ) : (
                        <XCircle size={12} className="text-danger" />
                      )}
                      <span className="text-muted">{check.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {result?.unitTestReport && (
                <div className="rounded-md border border-subtle bg-canvas p-2">
                  <p className="mb-1 text-xs font-semibold text-primary">
                    Pruebas Unitarias: {result.unitTestReport.passedCount}/{result.unitTestReport.total}
                  </p>
                  <div className="space-y-1">
                    {auditItems.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px]">
                        {item.passed ? (
                          <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success" />
                        ) : (
                          <XCircle size={12} className="mt-0.5 shrink-0 text-danger" />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-primary">{item.name}: </span>
                          <span className="text-muted">{item.message}</span>
                          {!item.passed && item.expected !== undefined && (
                            <p className="code-font mt-0.5 text-[10px] text-secondary">
                              Esperado: {item.expected} | Obtenido: {item.actual}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!result?.astReport && !result?.unitTestReport && (
                <span className="text-xs text-muted">
                  Ejecuta el codigo para ver la auditoria estructural y el reporte de pruebas.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

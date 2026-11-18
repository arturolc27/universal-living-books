import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  Play,
  Footprints,
  FlaskConical,
  Terminal,
  LineChart,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import type { CodeLabBlock, PythonExecutionResult } from '../../types/cartridge.types';
import { pythonRuntimeBridge } from '../../engine/pyodide/pythonRuntimeBridge';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

const FDR_STEPS = [
  { key: 'examples', label: '1. Ejemplos', hint: 'Escribe ejemplos >>> antes de programar.' },
  { key: 'header', label: '2. Header', hint: 'Firma tipada con type hints.' },
  { key: 'description', label: '3. Docstring', hint: 'Describe proposito y contrato.' },
  { key: 'body', label: '4. Cuerpo', hint: 'Implementa la logica.' },
  { key: 'test', label: '5. Test', hint: 'Verifica con asserts/doctest.' },
] as const;

type ResultTab = 'CONSOLE' | 'PLOTS' | 'AUDIT';

export function CodeLabWorkspace({ block }: { block: CodeLabBlock }) {
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const cartridges = usePlatformStore((s) => s.cartridges);
  const virtualFiles = usePlatformStore((s) => s.virtualFiles);
  const syncVirtualFilesFromRuntime = usePlatformStore((s) => s.syncVirtualFilesFromRuntime);
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const setLiveMemorySteps = usePlatformStore((s) => s.setLiveMemorySteps);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const cartridge = activeBookId ? cartridges[activeBookId] : null;

  const [code, setCode] = useState(block.starterCode);
  const [result, setResult] = useState<PythonExecutionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isTracing, setIsTracing] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>('CONSOLE');
  const [fdrStep, setFdrStep] = useState(0);

  useEffect(() => {
    setCode(block.starterCode);
    setResult(null);
    setFdrStep(0);
  }, [block.blockId, block.starterCode]);

  const ensureRuntime = useCallback(async () => {
    if (!cartridge) return;
    await pythonRuntimeBridge.initBookRuntime(
      cartridge.bookId,
      cartridge.runtimeRequirements.packages,
      virtualFiles
    );
  }, [cartridge, virtualFiles]);

  const handleRun = useCallback(async () => {
    if (!cartridge) return;
    setIsRunning(true);
    try {
      await ensureRuntime();
      const execResult = await pythonRuntimeBridge.executeAndEvaluate(code, {
        unitTestCode: block.unitTestCode,
      });
      setResult(execResult);
      if (execResult.updatedVirtualFiles) {
        await syncVirtualFilesFromRuntime(execResult.updatedVirtualFiles);
      }
      const passed = execResult.unitTestReport?.passed ?? execResult.ok;
      await recordAttempt(passed);
      if (passed) {
        pushToast({
          title: 'Pruebas superadas',
          description: 'Tu codigo paso la suite de verificacion.',
          iconKey: 'check',
        });
      }
      if (execResult.plotsBase64.length > 0) setActiveTab('PLOTS');
      else if (execResult.unitTestReport) setActiveTab('AUDIT');
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
  }, [block.unitTestCode, cartridge, code, ensureRuntime, pushToast, recordAttempt, syncVirtualFilesFromRuntime]);

  const handleTrace = useCallback(async () => {
    if (!cartridge) return;
    setIsTracing(true);
    try {
      await ensureRuntime();
      const steps = await pythonRuntimeBridge.traceExecutionMemory(code);
      setLiveMemorySteps(steps);
      pushToast({
        title: 'Traza capturada',
        description: `Se registraron ${steps.length} pasos de memoria. Abre el visualizador de Memoria.`,
        iconKey: 'footprints',
      });
      usePlatformStore.setState({ studioTab: 'MEMORY' });
    } catch (err) {
      pushToast({
        title: 'Traza fallida',
        description: err instanceof Error ? err.message : String(err),
        iconKey: 'error',
      });
    } finally {
      setIsTracing(false);
    }
  }, [cartridge, code, ensureRuntime, pushToast, setLiveMemorySteps]);

  const editorTheme = cartridge?.themeDNA.mode === 'light' ? 'light' : 'vs-dark';

  const auditItems = useMemo(() => result?.unitTestReport?.items ?? [], [result]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-primary">{block.title}</h3>
          <p className="truncate text-xs text-muted">{block.instructions}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-canvas disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Run
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
            { id: 'PLOTS', label: 'Graficas', icon: LineChart },
            { id: 'AUDIT', label: 'AST & Tests', icon: ShieldCheck },
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
                  {auditItems.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[11px]">
                      {item.passed ? (
                        <CheckCircle2 size={12} className="mt-0.5 text-success" />
                      ) : (
                        <XCircle size={12} className="mt-0.5 text-danger" />
                      )}
                      <span className="text-muted">{item.message}</span>
                    </div>
                  ))}
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

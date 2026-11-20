import { useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Play, ShieldCheck, CheckCircle2, XCircle, Loader2, Sparkles } from 'lucide-react';
import type { AstChallengeBlock, PythonExecutionResult } from '../../types/cartridge.types';
import { pythonRuntimeBridge } from '../../engine/pyodide/pythonRuntimeBridge';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

export function AstStructuralChallenge({
  block,
  onResolved,
}: {
  block: AstChallengeBlock;
  onResolved?: () => void;
}) {
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const cartridges = usePlatformStore((s) => s.cartridges);
  const virtualFiles = usePlatformStore((s) => s.virtualFiles);
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const recordAstMastery = usePlatformStore((s) => s.recordAstMastery);
  const flagPcLabFailure = usePlatformStore((s) => s.flagPcLabFailure);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const cartridge = activeBookId ? cartridges[activeBookId] : null;

  const [code, setCode] = useState(block.starterCode ?? '');
  const [result, setResult] = useState<PythonExecutionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    setCode(block.starterCode ?? '');
    setResult(null);
  }, [block.blockId, block.starterCode]);

  const handleValidate = useCallback(async () => {
    if (!cartridge) return;
    setIsRunning(true);
    try {
      await pythonRuntimeBridge.initBookRuntime(
        cartridge.bookId,
        cartridge.runtimeRequirements.packages,
        virtualFiles
      );
      const execResult = await pythonRuntimeBridge.executeAndEvaluate(code, {
        astConstraints: block.astConstraints,
        unitTestCode: block.unitTestCode || undefined,
      });
      setResult(execResult);

      const astPassed = execResult.astReport?.passed ?? false;
      const testsPassed = execResult.unitTestReport ? execResult.unitTestReport.passed : execResult.ok;
      const fullyPassed = astPassed && testsPassed;

      await recordAttempt(fullyPassed);
      if (fullyPassed) {
        await recordAstMastery();
        pushToast({
          title: 'Estructura AST validada',
          description: 'Tu solucion cumple todas las reglas estructurales y pruebas.',
          iconKey: 'sparkles',
        });
        onResolved?.();
      } else if (block.linkedFlashcardId) {
        await flagPcLabFailure(block.linkedFlashcardId);
      }
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
    } finally {
      setIsRunning(false);
    }
  }, [block.astConstraints, block.linkedFlashcardId, block.unitTestCode, cartridge, code, flagPcLabFailure, onResolved, pushToast, recordAstMastery, recordAttempt, virtualFiles]);

  const editorTheme = cartridge?.themeDNA.mode === 'light' ? 'light' : 'vs-dark';

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-primary">{block.title}</h3>
          <p className="truncate text-xs text-muted">{block.instructions}</p>
        </div>
        <button
          type="button"
          onClick={handleValidate}
          disabled={isRunning}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-canvas disabled:opacity-50"
        >
          {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Validar AST
        </button>
      </div>

      <div className="border-b border-subtle bg-elevated/40 px-3 py-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-secondary">
          <ShieldCheck size={12} /> Reglas estructurales
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(block.astConstraints?.requiredNodeTypes ?? []).map((node) => (
            <span key={node} className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
              Requiere: {node}
            </span>
          ))}
          {(block.astConstraints?.forbiddenNodeTypes ?? []).map((node) => (
            <span key={node} className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
              Prohibe: {node}
            </span>
          ))}
          {(block.astConstraints?.forbiddenCalls ?? []).map((call) => (
            <span key={call} className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
              Prohibe: {call}()
            </span>
          ))}
        </div>
        {block.astConstraints?.customAstMessage && (
          <p className="mt-1.5 text-[11px] italic text-muted">{block.astConstraints.customAstMessage}</p>
        )}
      </div>

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
            padding: { top: 12 },
            automaticLayout: true,
          }}
        />
      </div>

      <div className="h-48 shrink-0 overflow-auto border-t border-subtle p-3">
        {result ? (
          <div className="space-y-2">
            {result.astReport && (
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
            {result.unitTestReport && (
              <div className="rounded-md border border-subtle bg-canvas p-2">
                <p className="mb-1 text-xs font-semibold text-primary">
                  Pruebas: {result.unitTestReport.passedCount}/{result.unitTestReport.total}
                </p>
                {result.unitTestReport.items.map((item, idx) => (
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
            {result.stderr && (
              <pre className="code-font whitespace-pre-wrap text-[11px] text-danger">{result.stderr}</pre>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Sparkles size={13} /> Pulsa Validar AST para auditar la estructura de tu solucion.
          </p>
        )}
      </div>
    </div>
  );
}

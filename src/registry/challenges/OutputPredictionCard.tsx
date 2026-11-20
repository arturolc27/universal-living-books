import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Brain,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  RotateCcw,
  ArrowRight,
  Play,
  Loader2,
  Footprints,
} from 'lucide-react';
import type { MemoryStep, OutputPredictionBlock } from '../../types/cartridge.types';
import { pythonRuntimeBridge } from '../../engine/pyodide/pythonRuntimeBridge';
import { MemoryHeapVisualizer } from '../visualizers/MemoryHeapVisualizer';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';
import { toDisplayText } from '../../ui/utils/sanitize';

const RETURN_TYPES = ['int', 'float', 'str', 'bool', 'NoneType', 'list', 'dict', 'tuple', 'set', 'Error'] as const;

export function OutputPredictionCard({
  block,
  onResolved,
}: {
  block: OutputPredictionBlock;
  onResolved?: () => void;
}) {
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const recordLearningTelemetry = usePlatformStore((s) => s.recordLearningTelemetry);
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const flagPcLabFailure = usePlatformStore((s) => s.flagPcLabFailure);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hasFailedOnce, setHasFailedOnce] = useState(false);
  const [isRunningPy, setIsRunningPy] = useState(false);
  const [liveStdout, setLiveStdout] = useState<string | null>(null);
  const [liveSteps, setLiveSteps] = useState<MemoryStep[]>([]);
  const [showTrace, setShowTrace] = useState(false);
  const shownAtRef = useRef<number>(Date.now());

  useEffect(() => {
    setSelectedOption(null);
    setSelectedType(null);
    setRevealed(false);
    setHasFailedOnce(false);
    setLiveStdout(null);
    setLiveSteps([]);
    setShowTrace(false);
    shownAtRef.current = Date.now();
  }, [block.blockId]);

  const canReveal = selectedOption !== null && selectedType !== null;
  const isCorrect =
    selectedOption === block.correctOptionIndex && selectedType === block.expectedReturnType;

  const handleReveal = async () => {
    if (!canReveal) return;
    setRevealed(true);
    const latencyMs = Math.max(0, Date.now() - shownAtRef.current);
    await recordAttempt(isCorrect && !hasFailedOnce);
    if (activeBookId) {
      void recordLearningTelemetry({
        bookId: activeBookId,
        blockId: block.blockId,
        eventType: 'PREDICTION_ATTEMPT',
        conceptTag: block.conceptTags?.[0],
        misconceptionId: !isCorrect ? block.misconceptionId : undefined,
        passed: isCorrect,
        latencyMs,
      });
    }
    if (isCorrect) {
      pushToast({
        title: 'Prediccion correcta',
        description: 'Tu modelo mental coincide con el resultado real.',
        iconKey: 'check',
      });
    } else {
      setHasFailedOnce(true);
      if (block.linkedFlashcardId) {
        await flagPcLabFailure(block.linkedFlashcardId);
      }
      pushToast({
        title: 'Prediccion fallida',
        description: 'Ejecuta el codigo en Python para investigar el estado real antes de reintentar.',
        iconKey: 'error',
      });
    }
  };

  const handleRunInPython = async () => {
    setIsRunningPy(true);
    try {
      const execResult = await pythonRuntimeBridge.executeAndEvaluate(block.codeSnippet);
      const out = execResult.ok
        ? execResult.stdout || '(sin salida impresa)'
        : execResult.stderr || 'Error en ejecución';
      setLiveStdout(out);
      const steps = await pythonRuntimeBridge.traceExecutionMemory(block.codeSnippet, 40).catch(() => []);
      if (steps.length > 0) {
        setLiveSteps(steps);
        setShowTrace(true);
      }
    } catch (err) {
      setLiveStdout(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningPy(false);
    }
  };

  const handleRetry = () => {
    setSelectedOption(null);
    setSelectedType(null);
    setRevealed(false);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <Brain size={14} className="text-secondary" />
        <h3 className="text-sm font-semibold text-primary">Predicción de Salida (PRIMM)</h3>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">
          {revealed ? <Unlock size={10} /> : <Lock size={10} />}
          Predict → Run
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="mb-2 text-xs text-muted">{block.prompt}</p>
        <pre className="code-font mb-3 overflow-x-auto rounded-md border border-subtle bg-canvas p-3 text-xs leading-relaxed text-primary">
          {block.codeSnippet}
        </pre>

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Valor de salida
        </p>
        <div className="mb-3 space-y-1.5">
          {block.options.map((option, idx) => (
            <button
              key={idx}
              type="button"
              disabled={revealed}
              onClick={() => setSelectedOption(idx)}
              className={cn(
                'code-font w-full rounded-md border px-3 py-2 text-left text-xs transition-colors',
                selectedOption === idx
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-subtle bg-elevated/40 text-primary hover:border-accent/50',
                revealed && idx === block.correctOptionIndex && 'border-success bg-success/10 text-success',
                revealed && selectedOption === idx && idx !== block.correctOptionIndex && 'border-danger bg-danger/10 text-danger'
              )}
            >
              {toDisplayText(option)}
            </button>
          ))}
        </div>

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Tipo de dato
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {RETURN_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              disabled={revealed}
              onClick={() => setSelectedType(type)}
              className={cn(
                'code-font rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                selectedType === type
                  ? 'border-secondary bg-secondary/15 text-secondary'
                  : 'border-subtle text-muted hover:text-primary',
                revealed && type === block.expectedReturnType && 'border-success bg-success/10 text-success'
              )}
            >
              {type}
            </button>
          ))}
        </div>

        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2.5"
          >
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border p-2.5 text-xs',
                isCorrect ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger'
              )}
            >
              {isCorrect ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
              <span>{block.explanation}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRunInPython}
                disabled={isRunningPy}
                className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {isRunningPy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Ejecutar en Python (Run) y trazar memoria
              </button>
              {liveSteps.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowTrace((v) => !v)}
                  className="flex items-center gap-1 rounded-lg border border-subtle px-2.5 py-1.5 text-[11px] text-secondary hover:border-accent/40"
                >
                  <Footprints size={12} /> {showTrace ? 'Ocultar traza' : 'Ver traza Heap'}
                </button>
              )}
            </div>

            {liveStdout !== null && (
              <pre className="code-font rounded-md border border-subtle bg-canvas p-2.5 text-[11px] text-success">
                Salida Pyodide: {liveStdout}
              </pre>
            )}

            {showTrace && liveSteps.length > 0 && (
              <div className="h-72 overflow-hidden rounded-lg border border-subtle">
                <MemoryHeapVisualizer
                  block={{
                    blockId: `${block.blockId}-trace`,
                    type: 'INTERACTIVE_VISUALIZER',
                    visualizerKind: 'MEMORY_MODEL',
                    title: 'Ejecución real en Memoria',
                    codeContext: block.codeSnippet,
                    payload: { memorySteps: liveSteps },
                  }}
                  overrideSteps={liveSteps}
                />
              </div>
            )}
          </motion.div>
        )}
      </div>

      <div className="border-t border-subtle p-3">
        {!revealed ? (
          <button
            type="button"
            onClick={handleReveal}
            disabled={!canReveal}
            className="w-full rounded-lg bg-accent py-2 text-xs font-semibold text-canvas disabled:opacity-40"
          >
            Verificar predicción
          </button>
        ) : (
          <div className="flex gap-2">
            {!isCorrect && (
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-subtle px-3 py-2 text-xs font-medium text-primary hover:border-accent/50"
              >
                <RotateCcw size={13} /> Reintentar
              </button>
            )}
            {onResolved && isCorrect && (
              <button
                type="button"
                onClick={onResolved}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs font-semibold text-canvas"
              >
                Siguiente paso <ArrowRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, RotateCcw, MousePointerClick, CheckCircle2 } from 'lucide-react';
import type { InteractiveVisualizerBlock, MemoryStep } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

const STATUS_COLORS: Record<MemoryStep['heap'][number]['status'], string> = {
  NEW: 'var(--accent-success)',
  ACTIVE: 'var(--accent-secondary)',
  MUTATED: 'var(--accent-primary)',
  ORPHANED: 'var(--text-muted)',
};

export function MemoryHeapVisualizer({
  block,
  overrideSteps,
  onDragResolved,
}: {
  block: InteractiveVisualizerBlock;
  overrideSteps?: MemoryStep[];
  onDragResolved?: () => void;
}) {
  const liveMemorySteps = usePlatformStore((s) => s.liveMemorySteps);
  const liveMemoryOwnerBlockId = usePlatformStore((s) => s.liveMemoryOwnerBlockId);
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const recordLearningTelemetry = usePlatformStore((s) => s.recordLearningTelemetry);
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const steps = useMemo<MemoryStep[]>(() => {
    if (overrideSteps && overrideSteps.length > 0) return overrideSteps;
    if (liveMemoryOwnerBlockId === block.blockId && liveMemorySteps.length > 0) {
      return liveMemorySteps;
    }
    return block.payload?.memorySteps ?? [];
  }, [overrideSteps, liveMemoryOwnerBlockId, block.blockId, block.payload, liveMemorySteps]);

  const [stepIndex, setStepIndex] = useState(0);
  const [dragResolved, setDragResolved] = useState<Record<number, boolean>>({});
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);

  useEffect(() => {
    setStepIndex(0);
    setDragResolved({});
    setSelectedVariable(null);
  }, [block.blockId, steps.length]);

  const currentStep = steps[stepIndex];
  const dragTask = currentStep?.interactiveDragTask;
  const isDragGateActive = Boolean(dragTask) && !dragResolved[stepIndex];

  const handleNext = () => {
    if (isDragGateActive) {
      pushToast({
        title: 'Completa el reto de memoria',
        description: 'Conecta la variable con su objeto en el Heap antes de avanzar.',
        iconKey: 'lock',
      });
      return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const handleHeapClick = async (heapId: string) => {
    if (!dragTask || !selectedVariable) return;
    if (selectedVariable !== dragTask.variable) return;
    if (heapId === dragTask.expectedHeapId) {
      setDragResolved((prev) => ({ ...prev, [stepIndex]: true }));
      setSelectedVariable(null);
      await recordAttempt(true);
      if (activeBookId) {
        void recordLearningTelemetry({
          bookId: activeBookId,
          blockId: block.blockId,
          eventType: 'PREDICTION_ATTEMPT',
          conceptTag: block.conceptTags?.[0],
          passed: true,
        });
      }
      onDragResolved?.();
      pushToast({
        title: 'Conexion correcta',
        description: dragTask.hint,
        iconKey: 'check',
      });
    } else {
      await recordAttempt(false);
      if (activeBookId) {
        void recordLearningTelemetry({
          bookId: activeBookId,
          blockId: block.blockId,
          eventType: 'PREDICTION_ATTEMPT',
          conceptTag: block.conceptTags?.[0],
          passed: false,
        });
      }
      pushToast({
        title: 'Conexion incorrecta',
        description: 'Ese objeto no es el referenciado por la variable. Intenta de nuevo.',
        iconKey: 'error',
      });
    }
  };

  if (!currentStep) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Sin pasos de memoria. Ejecuta una traza en el CodeLab para poblar este visualizador.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-muted">
          Paso {stepIndex + 1} / {steps.length}
        </span>
      </div>

      <div className="border-b border-subtle bg-canvas px-3 py-2">
        <pre className="code-font text-[11px] leading-relaxed text-muted">
          {(block.codeContext ?? '').split('\n').map((line, idx) => (
            <div
              key={idx}
              className={cn(
                'rounded px-1',
                idx + 1 === currentStep.lineNumber && 'bg-accent/15 text-accent'
              )}
            >
              <span className="mr-2 inline-block w-4 text-right opacity-50">{idx + 1}</span>
              {line}
            </div>
          ))}
        </pre>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="overflow-auto border-r border-dashed border-subtle p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-accent">
            Frames (Call Stack)
          </p>
          <div className="space-y-2">
            {(currentStep.frames ?? []).map((frame, idx) => (
              <div
                key={idx}
                className={cn(
                  'rounded-md border p-2',
                  frame.isCurrent ? 'border-accent bg-accent/5' : 'border-subtle bg-elevated/40'
                )}
              >
                <p className="mb-1 text-[11px] font-semibold text-primary">
                  {frame.name}() {frame.isCurrent && <span className="text-accent">(activo)</span>}
                </p>
                {Object.entries(frame.variables ?? {}).map(([varName, heapId]) => (
                  <button
                    key={varName}
                    type="button"
                    onClick={() => dragTask && setSelectedVariable(varName)}
                    className={cn(
                      'flex w-full items-center justify-between rounded px-1.5 py-0.5 text-[11px]',
                      selectedVariable === varName
                        ? 'bg-accent/20 text-accent'
                        : 'text-muted hover:bg-elevated'
                    )}
                  >
                    <span className="code-font">{varName}</span>
                    <span className="code-font text-secondary">{String(heapId)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-auto p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-secondary">
            Objects (Heap RAM)
          </p>
          <div className="space-y-2">
            <AnimatePresence>
              {(currentStep.heap ?? []).map((obj) => (
                <motion.button
                  key={obj.id}
                  type="button"
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  onClick={() => handleHeapClick(obj.id)}
                  disabled={!dragTask}
                  className={cn(
                    'w-full rounded-md border p-2 text-left transition-colors',
                    dragTask && 'cursor-pointer hover:border-accent',
                    'border-subtle bg-elevated/40'
                  )}
                  style={{ borderLeftColor: STATUS_COLORS[obj.status], borderLeftWidth: 3 }}
                >
                  <div className="flex items-center justify-between">
                    <span className="code-font text-[11px] font-semibold text-primary">{obj.id}</span>
                    <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[9px] text-muted">
                      {obj.type}
                    </span>
                  </div>
                  <p className="code-font mt-1 truncate text-[11px] text-muted">{obj.value}</p>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="border-t border-subtle px-3 py-2">
        <p className="mb-2 text-[11px] text-muted">{currentStep.explanation}</p>

        {dragTask && (
          <div
            className={cn(
              'mb-2 flex items-center gap-2 rounded-md border p-2 text-[11px]',
              dragResolved[stepIndex]
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-secondary/40 bg-secondary/10 text-secondary'
            )}
          >
            {dragResolved[stepIndex] ? <CheckCircle2 size={13} /> : <MousePointerClick size={13} />}
            <span>
              {dragResolved[stepIndex]
                ? 'Conexion resuelta. Puedes avanzar.'
                : `Modo User-as-CPU: selecciona la variable '${dragTask.variable}' en el Frame y luego su objeto en el Heap.`}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStepIndex(0)}
            className="rounded-md border border-subtle p-1.5 text-muted hover:text-primary"
            title="Inicio"
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.max(i - 1, 0))}
            disabled={stepIndex === 0}
            className="rounded-md border border-subtle p-1.5 text-muted hover:text-primary disabled:opacity-40"
          >
            <ChevronLeft size={13} />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(steps.length - 1, 0)}
            value={stepIndex}
            onChange={(e) => setStepIndex(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-[var(--accent-primary)]"
          />
          <button
            type="button"
            onClick={handleNext}
            disabled={stepIndex === steps.length - 1}
            className="rounded-md border border-subtle p-1.5 text-muted hover:text-primary disabled:opacity-40"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

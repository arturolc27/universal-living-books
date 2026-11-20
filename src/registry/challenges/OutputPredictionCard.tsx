import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, CheckCircle2, XCircle, Lock, Unlock, RotateCcw, ArrowRight } from 'lucide-react';
import type { OutputPredictionBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';
import { toDisplayText } from '../../ui/utils/sanitize';

const RETURN_TYPES = ['int', 'float', 'str', 'bool', 'Error'] as const;

export function OutputPredictionCard({
  block,
  onResolved,
}: {
  block: OutputPredictionBlock;
  onResolved?: () => void;
}) {
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const flagPcLabFailure = usePlatformStore((s) => s.flagPcLabFailure);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setSelectedOption(null);
    setSelectedType(null);
    setRevealed(false);
  }, [block.blockId]);

  const canReveal = selectedOption !== null && selectedType !== null;
  const isCorrect =
    selectedOption === block.correctOptionIndex && selectedType === block.expectedReturnType;

  const handleReveal = async () => {
    if (!canReveal) return;
    setRevealed(true);
    await recordAttempt(isCorrect);
    if (isCorrect) {
      pushToast({
        title: 'Prediccion correcta',
        description: 'Tu modelo mental coincide con el resultado real.',
        iconKey: 'check',
      });
    } else {
      if (block.linkedFlashcardId) {
        await flagPcLabFailure(block.linkedFlashcardId);
      }
      pushToast({
        title: 'Prediccion fallida',
        description: 'Puedes reintentar o continuar al siguiente paso.',
        iconKey: 'error',
      });
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
        <h3 className="text-sm font-semibold text-primary">Prediccion de Salida</h3>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">
          {revealed ? <Unlock size={10} /> : <Lock size={10} />}
          Predict-First
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
                'code-font rounded-full border px-3 py-1 text-[11px] transition-colors',
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
            className={cn(
              'flex items-start gap-2 rounded-md border p-2.5 text-xs',
              isCorrect ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger'
            )}
          >
            {isCorrect ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
            <span>{block.explanation}</span>
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
            {onResolved && (
              <button
                type="button"
                onClick={onResolved}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs font-semibold text-canvas"
              >
                {isCorrect ? 'Siguiente paso' : 'Entendido, continuar'} <ArrowRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

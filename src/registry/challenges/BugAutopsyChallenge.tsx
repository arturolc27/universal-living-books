import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bug, CheckCircle2, XCircle, AlertTriangle, RotateCcw, ArrowRight } from 'lucide-react';
import type { BugAutopsyBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';
import { toDisplayText } from '../../ui/utils/sanitize';

export function BugAutopsyChallenge({
  block,
  onResolved,
}: {
  block: BugAutopsyBlock;
  onResolved?: () => void;
}) {
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const flagPcLabFailure = usePlatformStore((s) => s.flagPcLabFailure);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setSelectedLine(null);
    setSelectedOption(null);
    setRevealed(false);
  }, [block.blockId]);

  const codeLines = (block.codeSnippet ?? '').split('\n');
  const canReveal = selectedLine !== null && selectedOption !== null;
  const isCorrect =
    selectedLine === block.culpritLineNumber && selectedOption === block.correctOptionIndex;

  const handleReveal = async () => {
    if (!canReveal) return;
    setRevealed(true);
    await recordAttempt(isCorrect);
    if (isCorrect) {
      pushToast({
        title: 'Diagnostico correcto',
        description: 'Identificaste la linea culpable y la causa raiz.',
        iconKey: 'check',
      });
    } else {
      if (block.linkedFlashcardId) await flagPcLabFailure(block.linkedFlashcardId);
      pushToast({
        title: 'Diagnostico incorrecto',
        description: 'Puedes reintentar o continuar al siguiente paso.',
        iconKey: 'error',
      });
    }
  };

  const handleRetry = () => {
    setSelectedLine(null);
    setSelectedOption(null);
    setRevealed(false);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <Bug size={14} className="text-danger" />
        <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="mb-2 text-xs text-muted">{block.prompt}</p>

        <div className="mb-3 overflow-hidden rounded-md border border-subtle">
          {codeLines.map((line, idx) => {
            const lineNo = idx + 1;
            return (
              <button
                key={idx}
                type="button"
                disabled={revealed}
                onClick={() => setSelectedLine(lineNo)}
                className={cn(
                  'code-font flex w-full items-start gap-2 px-2 py-1 text-left text-[11px] transition-colors',
                  selectedLine === lineNo ? 'bg-accent/15' : 'hover:bg-elevated/50',
                  revealed && lineNo === block.culpritLineNumber && 'bg-danger/15'
                )}
              >
                <span className="w-5 shrink-0 text-right text-muted opacity-60">{lineNo}</span>
                <span className="whitespace-pre text-primary">{line}</span>
              </button>
            );
          })}
        </div>

        {block.tracebackText && (
          <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-2">
            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-danger">
              <AlertTriangle size={11} /> Traceback
            </p>
            <pre className="code-font whitespace-pre-wrap text-[10px] leading-relaxed text-danger/90">
              {block.tracebackText}
            </pre>
          </div>
        )}

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Causa raiz
        </p>
        <div className="space-y-1.5">
          {block.options.map((option, idx) => (
            <button
              key={idx}
              type="button"
              disabled={revealed}
              onClick={() => setSelectedOption(idx)}
              className={cn(
                'w-full rounded-md border px-3 py-2 text-left text-[11px] transition-colors',
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

        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs',
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
            Confirmar Diagnostico
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

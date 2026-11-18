import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
import type { InteractiveVisualizerBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

export function AstExpressionCollapser({ block }: { block: InteractiveVisualizerBlock }) {
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const astTokens = block.payload.astTokens;
  const tokens = useMemo(() => astTokens?.tokens ?? [], [astTokens]);
  const tapOrder = useMemo(() => astTokens?.tapOrder ?? [], [astTokens]);
  const collapses = useMemo(() => astTokens?.collapses ?? [], [astTokens]);
  const explanations = astTokens?.explanations ?? [];

  const [tapped, setTapped] = useState<number[]>([]);
  const [collapsedCount, setCollapsedCount] = useState(0);

  useEffect(() => {
    setTapped([]);
    setCollapsedCount(0);
  }, [block.blockId]);

  const expectedNext = tapOrder[tapped.length];
  const isComplete = tapped.length >= tapOrder.length && tapOrder.length > 0;

  const handleTokenTap = async (index: number) => {
    if (isComplete) return;
    if (index === expectedNext) {
      const nextTapped = [...tapped, index];
      setTapped(nextTapped);
      setCollapsedCount((c) => Math.min(c + 1, collapses.length));
      if (nextTapped.length >= tapOrder.length) {
        await recordAttempt(true);
        pushToast({
          title: 'Precedencia resuelta',
          description: 'Tocaste los operadores en el orden de evaluacion correcto.',
          iconKey: 'check',
        });
      }
    } else {
      await recordAttempt(false);
      pushToast({
        title: 'Orden incorrecto',
        description: 'Ese operador no se evalua todavia. Revisa la precedencia.',
        iconKey: 'error',
      });
    }
  };

  const reset = () => {
    setTapped([]);
    setCollapsedCount(0);
  };

  if (tokens.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Sin tokens AST configurados para este visualizador.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1 rounded-md border border-subtle px-2 py-1 text-[11px] text-muted hover:text-primary"
        >
          <RotateCcw size={12} /> Reiniciar
        </button>
      </div>

      <div className="border-b border-subtle bg-canvas px-3 py-2">
        <pre className="code-font text-xs text-muted">{block.codeContext}</pre>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {tokens.map((token, idx) => {
            const isOperator = tapOrder.includes(idx);
            const isTapped = tapped.includes(idx);
            return (
              <motion.button
                key={idx}
                type="button"
                layout
                onClick={() => isOperator && handleTokenTap(idx)}
                disabled={!isOperator || isComplete}
                className={cn(
                  'code-font rounded-md border px-2.5 py-1.5 text-sm transition-colors',
                  isOperator
                    ? isTapped
                      ? 'border-success bg-success/15 text-success'
                      : 'border-secondary bg-secondary/10 text-secondary hover:bg-secondary/20'
                    : 'border-subtle bg-elevated/40 text-primary'
                )}
              >
                {token}
              </motion.button>
            );
          })}
        </div>

        <div className="w-full max-w-md space-y-1.5">
          <AnimatePresence>
            {collapses.slice(0, collapsedCount).map((collapse, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-center gap-2 rounded-md border border-subtle bg-elevated/40 px-2 py-1.5"
              >
                <CheckCircle2 size={12} className="text-success" />
                <span className="code-font text-[11px] text-primary">{collapse}</span>
                {explanations[idx] && (
                  <span className="ml-auto text-[10px] text-muted">{explanations[idx]}</span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {isComplete ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-success">
            <CheckCircle2 size={14} /> Evaluacion completa. Resultado final obtenido.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <XCircle size={13} className="opacity-40" /> Toca los operadores en el orden de evaluacion de Python.
          </p>
        )}
      </div>
    </div>
  );
}

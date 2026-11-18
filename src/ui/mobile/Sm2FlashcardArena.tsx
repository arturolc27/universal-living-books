import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCw, Target, CheckCircle2, Clock } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { buildPrioritizedReviewQueue, type Sm2Grade } from '../../engine/srs/sm2Scheduler';
import { cn } from '../utils/cn';

const GRADE_BUTTONS: Array<{ grade: Sm2Grade; label: string; className: string }> = [
  { grade: 0, label: 'Olvidado', className: 'bg-danger/15 text-danger' },
  { grade: 3, label: 'Dificil', className: 'bg-secondary/15 text-secondary' },
  { grade: 4, label: 'Bien', className: 'bg-accent/15 text-accent' },
  { grade: 5, label: 'Facil', className: 'bg-success/15 text-success' },
];

export function Sm2FlashcardArena() {
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const cartridges = usePlatformStore((s) => s.cartridges);
  const srsStates = usePlatformStore((s) => s.srsStates);
  const gradeFlashcard = usePlatformStore((s) => s.gradeFlashcard);

  const cartridge = activeBookId ? cartridges[activeBookId] : null;

  const queue = useMemo(() => {
    if (!cartridge) return [];
    const statesByCardId: Record<string, (typeof srsStates)[string]> = {};
    for (const [key, value] of Object.entries(srsStates)) {
      if (key.startsWith(`${cartridge.bookId}::`)) {
        statesByCardId[value.cardId] = value;
      }
    }
    return buildPrioritizedReviewQueue(cartridge, statesByCardId);
  }, [cartridge, srsStates]);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const current = queue[index];

  const handleGrade = async (grade: Sm2Grade) => {
    if (!current) return;
    await gradeFlashcard(current.card.cardId, grade);
    setFlipped(false);
    setIndex((i) => (i + 1 < queue.length ? i + 1 : 0));
  };

  if (!cartridge) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Abre un libro para repasar sus tarjetas SM-2.
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Este libro no tiene tarjetas de repaso configuradas.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-primary">Arena SM-2</h3>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">
          {index + 1} / {queue.length}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="perspective-1000 w-full max-w-md">
          <motion.div
            className="preserve-3d relative min-h-[16rem] w-full cursor-pointer"
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ duration: 0.5 }}
            onClick={() => setFlipped((f) => !f)}
          >
            <div className="backface-hidden absolute inset-0 flex flex-col rounded-lg border border-subtle bg-elevated/50 p-4">
              {current.state.failedInPcLab && (
                <span className="mb-2 flex w-fit items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
                  <Target size={10} /> Refuerzo de tu sesion en PC
                </span>
              )}
              <p className="flex-1 whitespace-pre-wrap text-sm text-primary">{current.card.frontMarkdown}</p>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-muted">
                <RotateCw size={10} /> Toca para voltear
              </p>
            </div>
            <div
              className="backface-hidden absolute inset-0 flex flex-col rounded-lg border border-accent/40 bg-accent/5 p-4"
              style={{ transform: 'rotateY(180deg)' }}
            >
              <p className="flex-1 whitespace-pre-wrap text-sm text-primary">{current.card.backMarkdown}</p>
              {current.card.codeExample && (
                <pre className="code-font mt-2 overflow-x-auto rounded-md bg-canvas p-2 text-[11px] text-secondary">
                  {current.card.codeExample}
                </pre>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      <div className="border-t border-subtle p-3">
        {flipped ? (
          <div className="grid grid-cols-4 gap-1.5">
            {GRADE_BUTTONS.map((btn) => (
              <button
                key={btn.grade}
                type="button"
                onClick={() => handleGrade(btn.grade)}
                className={cn('rounded-md py-2 text-[11px] font-semibold', btn.className)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-[11px] text-muted">
            <Clock size={12} />
            {current.isDue ? 'Tarjeta vencida para repaso' : 'Repaso programado'}
            <CheckCircle2 size={12} className="text-success" />
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Award, CheckCircle2, ChevronRight, RotateCcw, XCircle } from 'lucide-react';
import type { QuickQuizBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

export function QuickQuizChallenge({
  block,
  onResolved,
}: {
  block: QuickQuizBlock;
  onResolved?: () => void;
}) {
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [completed, setCompleted] = useState(false);

  const questions = block.questions;
  const question = questions[currentIdx];
  const passingPct = block.passingScorePct ?? 70;

  if (!question) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted">
        Este test no contiene preguntas.
      </div>
    );
  }

  const isAnswered = selectedIdx !== null;
  const isCurrentCorrect = selectedIdx === question.correctIndex;

  const handleSelectOption = (optIdx: number) => {
    if (isAnswered) return;
    setSelectedIdx(optIdx);
    setAnswers((prev) => ({ ...prev, [question.id]: optIdx }));
  };

  const handleNext = async () => {
    if (currentIdx + 1 < questions.length) {
      setCurrentIdx((i) => i + 1);
      setSelectedIdx(null);
      return;
    }

    const correctCount = questions.filter((q) => answers[q.id] === q.correctIndex).length;
    const scorePct = Math.round((correctCount / questions.length) * 100);
    const passed = scorePct >= passingPct;
    setCompleted(true);
    await recordAttempt(passed);
    if (passed) {
      onResolved?.();
    }
  };

  const handleRetry = () => {
    setCurrentIdx(0);
    setSelectedIdx(null);
    setAnswers({});
    setCompleted(false);
  };

  if (completed) {
    const correctCount = questions.filter((q) => answers[q.id] === q.correctIndex).length;
    const scorePct = Math.round((correctCount / questions.length) * 100);
    const passed = scorePct >= passingPct;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-2xl border',
            passed
              ? 'border-success/40 bg-success/15 text-success'
              : 'border-secondary/40 bg-secondary/15 text-secondary'
          )}
        >
          <Award size={28} />
        </div>
        <div>
          <p className="text-base font-semibold text-primary">
            {passed ? '¡Evaluación superada!' : 'Sigue repasando'}
          </p>
          <p className="mt-1 text-xs text-muted">
            Obtuviste {correctCount} de {questions.length} ({scorePct}% • mínimo {passingPct}%)
          </p>
        </div>
        {!passed && (
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-canvas"
          >
            <RotateCcw size={13} /> Reintentar test
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          {block.title}
        </span>
        <span className="text-[11px] text-muted">
          Pregunta {currentIdx + 1} / {questions.length}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.round(((currentIdx + 1) / questions.length) * 100)}%` }}
        />
      </div>

      <p className="text-sm font-semibold leading-snug text-primary">{question.question}</p>

      <div className="space-y-2">
        {question.options.map((opt, idx) => {
          const isThisSelected = selectedIdx === idx;
          const isRight = idx === question.correctIndex;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectOption(idx)}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-xs transition-colors',
                !isAnswered
                  ? 'border-subtle bg-surface text-primary hover:border-accent/60'
                  : isRight
                    ? 'border-success bg-success/15 text-success'
                    : isThisSelected
                      ? 'border-danger bg-danger/15 text-danger'
                      : 'border-subtle bg-canvas text-muted opacity-60'
              )}
            >
              <span>{opt}</span>
              {isAnswered && isRight && <CheckCircle2 size={15} className="shrink-0" />}
              {isAnswered && isThisSelected && !isRight && <XCircle size={15} className="shrink-0" />}
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <div
          className={cn(
            'rounded-xl border p-3 text-xs',
            isCurrentCorrect
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-secondary/40 bg-secondary/10 text-secondary'
          )}
        >
          <p className="font-semibold">
            {isCurrentCorrect ? 'Respuesta correcta' : 'Explicación'}
          </p>
          <p className="mt-1 opacity-90">{question.explanation}</p>
        </div>
      )}

      {isAnswered && (
        <div className="mt-auto flex justify-end">
          <button
            type="button"
            onClick={() => void handleNext()}
            className="flex items-center gap-1 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-canvas"
          >
            {currentIdx + 1 < questions.length ? 'Siguiente pregunta' : 'Finalizar evaluación'}
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

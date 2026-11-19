import { useMemo, useState } from 'react';
import { CheckCircle2, HelpCircle, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import type { SyntaxClozeBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

export function SyntaxClozeChallenge({
  block,
  onResolved,
}: {
  block: SyntaxClozeBlock;
  onResolved?: () => void;
}) {
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const flagPcLabFailure = usePlatformStore((s) => s.flagPcLabFailure);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeBlankIdx, setActiveBlankIdx] = useState(0);
  const [checked, setChecked] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hasFailedOnce, setHasFailedOnce] = useState(false);

  const allFilled = block.blanks.every((b) => Boolean(answers[b.id]));
  const isAllCorrect =
    checked && block.blanks.every((b) => answers[b.id] === b.correctOption);

  const activeBlank = block.blanks[activeBlankIdx] ?? block.blanks[0];

  const renderedSegments = useMemo(() => {
    const parts = block.codeTemplate.split(/(___\d*___)/g);
    let seq = 0;
    return parts.map((part, i) => {
      const match = part.match(/^___(\d*)___$/);
      if (!match) {
        return { kind: 'text' as const, key: `t-${i}`, value: part };
      }
      const idx = match[1] ? Number(match[1]) : seq++;
      const blank = block.blanks[idx];
      return { kind: 'blank' as const, key: `b-${i}`, idx, blank };
    });
  }, [block.codeTemplate, block.blanks]);

  const handleVerify = async () => {
    setChecked(true);
    const ok = block.blanks.every((b) => answers[b.id] === b.correctOption);
    if (ok) {
      await recordAttempt(!hasFailedOnce);
      onResolved?.();
    } else {
      setHasFailedOnce(true);
      await recordAttempt(false);
      if (block.linkedFlashcardId) {
        await flagPcLabFailure(block.linkedFlashcardId);
      }
    }
  };

  const handleReset = () => {
    setAnswers({});
    setChecked(false);
    setActiveBlankIdx(0);
    setShowHint(false);
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
            <Sparkles size={11} /> Completar Sintaxis
          </span>
          <h3 className="mt-1 text-sm font-semibold text-primary">{block.title}</h3>
          <p className="mt-0.5 text-xs text-muted">{block.prompt}</p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-subtle p-1.5 text-muted hover:text-primary"
          title="Reiniciar"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="code-font rounded-xl border border-subtle bg-canvas p-3 text-xs leading-loose text-primary">
        <pre className="whitespace-pre-wrap">
          {renderedSegments.map((seg) => {
            const segKey = seg.key;
            if (seg.kind === 'text') return <span key={segKey}>{seg.value}</span>;
            const blank = seg.blank;
            if (!blank) return <span key={segKey}>___</span>;
            const selected = answers[blank.id];
            const isCorrect = checked && selected === blank.correctOption;
            const isWrong = checked && selected && selected !== blank.correctOption;

            return (
              <button
                key={seg.key}
                type="button"
                onClick={() => setActiveBlankIdx(seg.idx)}
                className={cn(
                  'mx-1 inline-flex min-w-[4.5rem] items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors',
                  isCorrect
                    ? 'border-success bg-success/15 text-success'
                    : isWrong
                      ? 'border-danger bg-danger/15 text-danger'
                      : activeBlankIdx === seg.idx
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-subtle bg-surface text-secondary'
                )}
              >
                {selected ?? `hueco ${seg.idx + 1}`}
              </button>
            );
          })}
        </pre>
      </div>

      {activeBlank && (
        <div className="rounded-xl border border-subtle bg-surface/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-muted">
              Elige la sintaxis para hueco {activeBlankIdx + 1}:
            </p>
            {activeBlank.hint && (
              <button
                type="button"
                onClick={() => setShowHint((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-accent hover:underline"
              >
                <HelpCircle size={12} /> {showHint ? 'Ocultar pista' : 'Ver pista'}
              </button>
            )}
          </div>
          {showHint && activeBlank.hint && (
            <p className="mb-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[11px] text-accent">
              💡 {activeBlank.hint}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {activeBlank.options.map((option) => {
              const selected = answers[activeBlank.id] === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setChecked(false);
                    setAnswers((prev) => ({ ...prev, [activeBlank.id]: option }));
                    if (activeBlankIdx + 1 < block.blanks.length) {
                      setActiveBlankIdx(activeBlankIdx + 1);
                    }
                  }}
                  className={cn(
                    'code-font rounded-lg border px-3 py-2 text-xs transition-colors',
                    selected
                      ? 'border-accent bg-accent/20 font-semibold text-accent'
                      : 'border-subtle bg-canvas text-primary hover:border-accent/50'
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {checked && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl border p-3 text-xs',
            isAllCorrect
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-danger/40 bg-danger/10 text-danger'
          )}
        >
          {isAllCorrect ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={16} className="mt-0.5 shrink-0" />
          )}
          <div>
            <p className="font-semibold">
              {isAllCorrect ? '¡Sintaxis correcta!' : 'Revisa los huecos marcados en rojo.'}
            </p>
            <p className="mt-1 opacity-90">{block.explanation}</p>
          </div>
        </div>
      )}

      <div className="mt-auto flex justify-end">
        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={!allFilled}
          className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-canvas disabled:opacity-40"
        >
          Verificar sintaxis
        </button>
      </div>
    </div>
  );
}

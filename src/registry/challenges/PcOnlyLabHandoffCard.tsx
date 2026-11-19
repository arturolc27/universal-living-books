import { BookmarkPlus, CheckCircle2, Laptop, ArrowRight } from 'lucide-react';
import type { AstChallengeBlock, CodeLabBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';

export function PcOnlyLabHandoffCard({
  block,
  onResolved,
}: {
  block: CodeLabBlock | AstChallengeBlock;
  onResolved?: () => void;
}) {
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const activeChapterId = usePlatformStore((s) => s.activeChapterId);
  const activeLessonId = usePlatformStore((s) => s.activeLessonId);
  const pcLabQueue = usePlatformStore((s) => s.pcLabQueue);
  const enqueuePcLab = usePlatformStore((s) => s.enqueuePcLab);

  const isQueued = pcLabQueue.some(
    (q) =>
      q.bookId === activeBookId &&
      q.lessonId === activeLessonId &&
      q.blockId === block.blockId
  );

  const handleQueueForPc = () => {
    if (!activeBookId || !activeChapterId || !activeLessonId) return;
    enqueuePcLab({
      bookId: activeBookId,
      chapterId: activeChapterId,
      lessonId: activeLessonId,
      blockId: block.blockId,
      title: block.title,
      blockType: block.type,
    });
  };

  return (
    <div className="flex h-full flex-col justify-center gap-4 p-5">
      <div className="rounded-2xl border border-accent/40 bg-surface p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Laptop size={20} />
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
              Práctica Exclusiva de PC
            </span>
            <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          Las prácticas de código libre con editor completo, consola Pyodide y análisis AST están
          diseñadas exclusivamente para escritorio (PC) para brindarte una experiencia de desarrollo
          profundo sin frustraciones en teclado táctil.
        </p>

        <div className="mt-3 rounded-xl border border-subtle bg-canvas p-3">
          <p className="text-[11px] font-medium text-secondary">Objetivo del laboratorio:</p>
          <p className="mt-1 line-clamp-3 text-[11px] text-muted">{block.instructions}</p>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleQueueForPc}
            disabled={isQueued}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-accent/50 bg-accent/10 px-3 py-2.5 text-xs font-semibold text-accent disabled:opacity-70"
          >
            {isQueued ? <CheckCircle2 size={14} /> : <BookmarkPlus size={14} />}
            {isQueued ? 'Guardado en Cola para PC' : 'Guardar para mi sesión en PC'}
          </button>

          {onResolved && (
            <button
              type="button"
              onClick={() => {
                if (!isQueued) handleQueueForPc();
                onResolved();
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-canvas"
            >
              Continuar teoría <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

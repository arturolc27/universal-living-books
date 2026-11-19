import {
  Award,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Laptop,
  Layers,
  Play,
} from 'lucide-react';
import {
  computeLessonMasteryTier,
  selectActiveCartridge,
  usePlatformStore,
} from '../../store/usePlatformStore';
import { groupBlocksIntoStages } from '../../engine/course/courseStages';
import { isSafeCoverImageUrl } from '../utils/sanitize';
import { cn } from '../utils/cn';

export function CourseSyllabusOverview({
  onEnterLesson,
}: {
  onEnterLesson: () => void;
}) {
  const cartridge = usePlatformStore(selectActiveCartridge);
  const activeChapterId = usePlatformStore((s) => s.activeChapterId);
  const activeLessonId = usePlatformStore((s) => s.activeLessonId);
  const lessonProgressMap = usePlatformStore((s) => s.lessonProgressMap);
  const pcLabQueue = usePlatformStore((s) => s.pcLabQueue);
  const selectLesson = usePlatformStore((s) => s.selectLesson);
  const advanceUnlockedBlock = usePlatformStore((s) => s.advanceUnlockedBlock);

  if (!cartridge) return null;

  const bookQueue = pcLabQueue.filter((q) => q.bookId === cartridge.bookId);

  let totalLessons = 0;
  let completedLessons = 0;
  let totalMinutesRemaining = 0;

  for (const ch of cartridge.chapters) {
    for (const ml of ch.microLessons) {
      totalLessons += 1;
      const prog = lessonProgressMap[`${cartridge.bookId}::${ml.lessonId}`];
      if (prog?.isCompleted) completedLessons += 1;
      else totalMinutesRemaining += ml.estimatedMinutes;
    }
  }

  const coursePct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const safeCover = isSafeCoverImageUrl(cartridge.metadata.coverImageDataUrl)
    ? cartridge.metadata.coverImageDataUrl
    : undefined;

  const handleOpenLesson = async (chapterId: string, lessonId: string, blockId?: string) => {
    await selectLesson(chapterId, lessonId);
    if (blockId) {
      const ch = cartridge.chapters.find((c) => c.chapterId === chapterId);
      const ml = ch?.microLessons.find((l) => l.lessonId === lessonId);
      const idx = ml?.blocks.findIndex((b) => b.blockId === blockId) ?? -1;
      if (idx >= 0) {
        await advanceUnlockedBlock(idx);
      }
    }
    onEnterLesson();
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Hero del Curso */}
        <div className="flex flex-col gap-5 rounded-2xl border border-subtle bg-surface p-5 sm:flex-row sm:items-center">
          {safeCover ? (
            <img
              src={safeCover}
              alt={cartridge.metadata.title}
              className="h-36 w-24 shrink-0 rounded-xl border border-subtle object-cover shadow-md"
            />
          ) : (
            <div className="flex h-36 w-24 shrink-0 items-center justify-center rounded-xl border border-subtle bg-canvas text-4xl">
              {cartridge.metadata.coverAccentIcon}
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                Curso Interactivo • {cartridge.metadata.difficulty}
              </span>
              <span className="text-[11px] text-muted">
                {cartridge.chapters.length} módulos • {totalLessons} lecciones
              </span>
            </div>
            <h1 className="text-xl font-bold text-primary">{cartridge.metadata.title}</h1>
            {cartridge.metadata.subtitle && (
              <p className="text-xs text-muted">{cartridge.metadata.subtitle}</p>
            )}

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${coursePct}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-primary">{coursePct}% completado</span>
              </div>
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Clock size={12} /> ~{totalMinutesRemaining} min restantes
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (activeChapterId && activeLessonId) {
                void handleOpenLesson(activeChapterId, activeLessonId);
              } else {
                onEnterLesson();
              }
            }}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-xs font-semibold text-canvas shadow-sm hover:opacity-90"
          >
            <Play size={14} /> {completedLessons > 0 ? 'Continuar curso' : 'Comenzar curso'}
          </button>
        </div>

        {/* Cola de Prácticas Pendientes de PC (enviadas desde Móvil) */}
        {bookQueue.length > 0 && (
          <div className="rounded-2xl border border-secondary/40 bg-secondary/5 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-secondary">
              <Laptop size={14} /> Prácticas guardadas desde Móvil para resolver en PC ({bookQueue.length})
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {bookQueue.map((item) => (
                <button
                  key={`${item.lessonId}-${item.blockId}`}
                  type="button"
                  onClick={() => void handleOpenLesson(item.chapterId, item.lessonId, item.blockId)}
                  className="flex items-center justify-between rounded-xl border border-subtle bg-surface px-3 py-2 text-left hover:border-secondary/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-primary">{item.title}</p>
                    <p className="text-[10px] text-muted">{item.blockType === 'AST_CHALLENGE' ? 'Reto AST' : 'Laboratorio Python'}</p>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-secondary" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Módulos del Curso */}
        <div className="space-y-4">
          {cartridge.chapters.map((chapter) => {
            const chapterCompleted = chapter.microLessons.filter(
              (ml) => lessonProgressMap[`${cartridge.bookId}::${ml.lessonId}`]?.isCompleted
            ).length;

            return (
              <div
                key={chapter.chapterId}
                className="overflow-hidden rounded-2xl border border-subtle bg-surface"
              >
                <div className="flex items-center justify-between border-b border-subtle bg-elevated/40 px-4 py-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                      Módulo {chapter.number}
                    </p>
                    <h2 className="text-sm font-semibold text-primary">{chapter.title}</h2>
                    {chapter.summary && (
                      <p className="mt-0.5 text-[11px] text-muted">{chapter.summary}</p>
                    )}
                  </div>
                  <span className="rounded-full border border-subtle bg-canvas px-2.5 py-1 text-[11px] font-medium text-secondary">
                    {chapterCompleted}/{chapter.microLessons.length}
                  </span>
                </div>

                <div className="divide-y divide-subtle/60">
                  {chapter.microLessons.map((ml) => {
                    const prog = lessonProgressMap[`${cartridge.bookId}::${ml.lessonId}`];
                    const tier = computeLessonMasteryTier(prog, ml.blocks.length);
                    const stages = groupBlocksIntoStages(ml);
                    const isCurrent = ml.lessonId === activeLessonId;

                    return (
                      <button
                        key={ml.lessonId}
                        type="button"
                        onClick={() => void handleOpenLesson(chapter.chapterId, ml.lessonId)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/50',
                          isCurrent && 'bg-accent/5'
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold',
                              tier === 'GOLD'
                                ? 'border-secondary bg-secondary/15 text-secondary'
                                : tier === 'SILVER'
                                  ? 'border-success bg-success/15 text-success'
                                  : isCurrent
                                    ? 'border-accent bg-accent/15 text-accent'
                                    : 'border-subtle bg-canvas text-muted'
                            )}
                          >
                            {tier === 'GOLD' ? (
                              <Award size={15} />
                            ) : tier === 'SILVER' ? (
                              <CheckCircle2 size={15} />
                            ) : (
                              ml.order + 1
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-primary">
                              {ml.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="flex items-center gap-1 text-[10px] text-muted">
                                <Clock size={10} /> {ml.estimatedMinutes} min
                              </span>
                              <span className="text-[10px] text-muted">•</span>
                              <span className="flex items-center gap-1 text-[10px] text-muted">
                                <Layers size={10} /> {stages.map((s) => s.stage.shortLabel).join(' → ')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <span className="flex shrink-0 items-center gap-1 rounded-lg border border-subtle px-2.5 py-1 text-[11px] font-medium text-primary">
                          <BookOpen size={11} /> {tier === 'LOCKED' ? 'Iniciar' : 'Abrir'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

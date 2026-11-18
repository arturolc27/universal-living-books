import { Lock, CircleDot, Medal, Trophy } from 'lucide-react';
import type { MasteryTier } from '../../types/cartridge.types';
import { usePlatformStore, computeLessonMasteryTier } from '../../store/usePlatformStore';
import { cn } from '../utils/cn';

const TIER_META: Record<MasteryTier, { label: string; icon: typeof Lock; className: string }> = {
  LOCKED: { label: 'Bloqueado', icon: Lock, className: 'text-muted' },
  IN_PROGRESS: { label: 'En Progreso', icon: CircleDot, className: 'text-accent' },
  SILVER: { label: 'Plata', icon: Medal, className: 'text-secondary' },
  GOLD: { label: 'Oro', icon: Trophy, className: 'text-success' },
};

export function MasteryPathMap() {
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const cartridges = usePlatformStore((s) => s.cartridges);
  const lessonProgressMap = usePlatformStore((s) => s.lessonProgressMap);
  const selectLesson = usePlatformStore((s) => s.selectLesson);
  const activeLessonId = usePlatformStore((s) => s.activeLessonId);

  const cartridge = activeBookId ? cartridges[activeBookId] : null;

  if (!cartridge) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Abre un libro para ver su mapa de dominio.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-primary">Mapa de Dominio</h3>
        <p className="text-xs text-muted">{cartridge.metadata.title}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {cartridge.chapters.map((chapter) => (
          <div key={chapter.chapterId} className="mb-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Cap {chapter.number}: {chapter.title}
            </p>
            <div className="space-y-1.5">
              {chapter.microLessons.map((lesson) => {
                const progress = lessonProgressMap[`${cartridge.bookId}::${lesson.lessonId}`];
                const tier = computeLessonMasteryTier(progress, lesson.blocks.length);
                const meta = TIER_META[tier];
                const Icon = meta.icon;
                return (
                  <button
                    key={lesson.lessonId}
                    type="button"
                    onClick={() => selectLesson(chapter.chapterId, lesson.lessonId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                      activeLessonId === lesson.lessonId
                        ? 'border-accent bg-accent/10'
                        : 'border-subtle bg-elevated/40 hover:border-accent/50'
                    )}
                  >
                    <Icon size={14} className={meta.className} />
                    <span className="flex-1 truncate text-xs text-primary">{lesson.title}</span>
                    <span className={cn('text-[10px] font-medium', meta.className)}>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

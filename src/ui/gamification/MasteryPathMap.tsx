import { useMemo } from 'react';
import { Lock, CircleDot, Medal, Trophy, Brain, ShieldCheck, Activity, Sparkles } from 'lucide-react';
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
  const telemetryEvents = usePlatformStore((s) => s.telemetryEvents);
  const selectLesson = usePlatformStore((s) => s.selectLesson);
  const activeLessonId = usePlatformStore((s) => s.activeLessonId);

  const cartridge = activeBookId ? cartridges[activeBookId] : null;

  const kpis = useMemo(() => {
    const bookEvents = telemetryEvents.filter((e) => !activeBookId || e.bookId === activeBookId);
    const pred = bookEvents.filter((e) => e.eventType === 'PREDICTION_ATTEMPT');
    const predAcc = pred.length > 0 ? Math.round((pred.filter((e) => e.passed).length / pred.length) * 100) : null;

    const labs = bookEvents.filter((e) => e.eventType === 'TRANSFER_LAB');
    const transferPct = labs.length > 0 ? Math.round((labs.filter((e) => e.passed).length / labs.length) * 100) : null;

    const delayed = bookEvents.filter(
      (e) => e.eventType === 'SRS_DELAYED_REVIEW' && (e.daysSinceLastPractice ?? 0) >= 6
    );
    const retentionPct =
      delayed.length > 0 ? Math.round((delayed.filter((e) => e.passed).length / delayed.length) * 100) : null;

    const resolvedMisconceptions = bookEvents.filter((e) => e.eventType === 'MISCONCEPTION_RESOLVED').length;
    const thrashCount = bookEvents.filter((e) => e.eventType === 'THRASHING_DETECTED').length;

    return { predAcc, transferPct, retentionPct, resolvedMisconceptions, thrashCount };
  }, [telemetryEvents, activeBookId]);

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
        <h3 className="text-sm font-semibold text-primary">Mapa de Dominio y Eficacia</h3>
        <p className="text-xs text-muted">{cartridge.metadata.title}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-subtle bg-canvas p-2">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted">
              <Brain size={11} className="text-accent" /> Máquina Nocional
            </p>
            <p className="mt-0.5 text-sm font-bold text-primary">
              {kpis.predAcc !== null ? `${kpis.predAcc}%` : '—'}
            </p>
            <p className="text-[9px] text-muted">Predicción 1.er intento</p>
          </div>
          <div className="rounded-lg border border-subtle bg-canvas p-2">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted">
              <ShieldCheck size={11} className="text-success" /> Transferencia
            </p>
            <p className="mt-0.5 text-sm font-bold text-primary">
              {kpis.transferPct !== null ? `${kpis.transferPct}%` : '—'}
            </p>
            <p className="text-[9px] text-muted">Labs + tests ocultos</p>
          </div>
          <div className="rounded-lg border border-subtle bg-canvas p-2">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted">
              <Activity size={11} className="text-secondary" /> Retención ≥7d
            </p>
            <p className="mt-0.5 text-sm font-bold text-primary">
              {kpis.retentionPct !== null ? `${kpis.retentionPct}%` : '—'}
            </p>
            <p className="text-[9px] text-muted">Repaso diferido SRS</p>
          </div>
          <div className="rounded-lg border border-subtle bg-canvas p-2">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted">
              <Sparkles size={11} className="text-accent" /> Diagnóstico
            </p>
            <p className="mt-0.5 text-sm font-bold text-primary">
              {kpis.resolvedMisconceptions} <span className="text-[10px] font-normal text-muted">resueltos</span>
            </p>
            <p className="text-[9px] text-muted">Thrashing: {kpis.thrashCount}</p>
          </div>
        </div>

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

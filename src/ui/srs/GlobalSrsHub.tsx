import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Brain,
  CheckCircle2,
  Clock,
  Filter,
  Flame,
  Layers,
  RotateCw,
  Sparkles,
  Target,
  Zap,
  BookCheck,
} from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import {
  buildGlobalFsrsReviewQueue,
  formatIntervalLabel,
  sm2GradeToFsrsRating,
  type FsrsRating,
} from '../../engine/srs/fsrsScheduler';
import { gradeFromObjectiveOutcome } from '../../engine/srs/sm2Scheduler';
import { PYTHON_DOMAINS, type PythonDomainId } from '../../data/pythonTaxonomy';
import { renderBlockWidget } from '../../registry/widgetRegistry';
import { cn } from '../utils/cn';

const FSRS_BUTTONS: Array<{
  rating: FsrsRating;
  label: string;
  className: string;
}> = [
  { rating: 1, label: 'Olvidado', className: 'border-danger/40 bg-danger/15 text-danger hover:bg-danger/25' },
  { rating: 2, label: 'Difícil', className: 'border-secondary/40 bg-secondary/15 text-secondary hover:bg-secondary/25' },
  { rating: 3, label: 'Bien', className: 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25' },
  { rating: 4, label: 'Fácil', className: 'border-success/40 bg-success/15 text-success hover:bg-success/25' },
];

export function GlobalSrsHub({
  scopedBookId,
}: {
  /** Si se pasa, acota la sesión a un libro concreto (ej. dentro de DesktopStudio/MobileShell). */
  scopedBookId?: string;
} = {}) {
  const cartridges = usePlatformStore((s) => s.cartridges);
  const srsStates = usePlatformStore((s) => s.srsStates);
  const gradeGlobalFlashcard = usePlatformStore((s) => s.gradeGlobalFlashcard);
  const markChapterAsStudied = usePlatformStore((s) => s.markChapterAsStudied);
  const openBookAtLesson = usePlatformStore((s) => s.openBookAtLesson);

  const [selectedBookId, setSelectedBookId] = useState<string>(scopedBookId ?? 'ALL');
  const [selectedDomain, setSelectedDomain] = useState<PythonDomainId | 'ALL'>('ALL');
  const [queueMode, setQueueMode] = useState<'DUE' | 'WEAK' | 'ALL_ENROLLED'>('DUE');
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [showEnrollPanel, setShowEnrollPanel] = useState(false);
  const cardShownAtRef = useRef<number>(Date.now());

  const effectiveBookId = scopedBookId ?? selectedBookId;

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    cardShownAtRef.current = Date.now();
  }, [effectiveBookId, selectedDomain, queueMode]);

  const books = useMemo(() => Object.values(cartridges), [cartridges]);

  const stats = useMemo(() => {
    const now = Date.now();
    const allEnrolled = buildGlobalFsrsReviewQueue(cartridges, srsStates, {
      bookId: effectiveBookId,
      domainId: selectedDomain,
      dueOnly: false,
      maxItems: 500,
      now,
    });
    const dueCount = allEnrolled.filter((c) => c.isDue).length;
    const avgStability =
      allEnrolled.length > 0
        ? allEnrolled.reduce((acc, c) => acc + (c.state.stability ?? 0), 0) / allEnrolled.length
        : 0;
    const avgRetrievability =
      allEnrolled.length > 0
        ? Math.round(
            (allEnrolled.reduce((acc, c) => acc + c.retrievability, 0) / allEnrolled.length) * 100
          )
        : 0;
    return {
      enrolledCount: allEnrolled.length,
      dueCount,
      avgStability: Number(avgStability.toFixed(1)),
      avgRetrievability,
    };
  }, [cartridges, srsStates, effectiveBookId, selectedDomain]);

  const queue = useMemo(() => {
    return buildGlobalFsrsReviewQueue(cartridges, srsStates, {
      bookId: effectiveBookId,
      domainId: selectedDomain,
      dueOnly: queueMode === 'DUE',
      weakOnly: queueMode === 'WEAK',
      maxItems: 30,
    });
  }, [cartridges, srsStates, effectiveBookId, selectedDomain, queueMode]);

  const safeIndex = queue.length > 0 ? Math.min(index, queue.length - 1) : 0;
  const current = queue[safeIndex];

  const handleRate = async (rating: FsrsRating) => {
    if (!current) return;
    const latencyMs = Math.max(0, Date.now() - cardShownAtRef.current);
    await gradeGlobalFlashcard(
      current.bookId,
      current.card.cardId,
      rating,
      latencyMs,
      current.card.competencyIds
    );
    setSessionReviewed((n) => n + 1);
    setFlipped(false);
    cardShownAtRef.current = Date.now();
    setIndex((i) => (i + 1 < queue.length ? i + 1 : 0));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* Cabecera FSRS */}
      <div className="border-b border-subtle bg-surface/60 px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-accent" />
              <h2 className="text-sm font-bold text-primary">
                {scopedBookId ? 'Repaso Espaciado FSRS (Libro Actual)' : 'Hub Global de Repaso FSRS'}
              </h2>
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {stats.dueCount} vencidas
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted">
              Solo incluye módulos que ya estudiaste o marcaste como estudiados. Intercalado entre capítulos y libros.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-3 rounded-xl border border-subtle bg-canvas px-3 py-1.5 text-[11px]">
              <span className="flex items-center gap-1 text-primary">
                <Layers size={11} className="text-accent" /> {stats.enrolledCount} enroladas
              </span>
              <span className="flex items-center gap-1 text-muted">
                <Clock size={11} className="text-secondary" /> Estabilidad: {stats.avgStability}d
              </span>
              <span className="hidden items-center gap-1 text-success sm:flex">
                <Flame size={11} /> Hoy: {sessionReviewed}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowEnrollPanel((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                showEnrollPanel
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-subtle bg-canvas text-primary hover:border-accent/50'
              )}
            >
              <BookCheck size={13} /> Enrolar capítulos
            </button>
          </div>
        </div>

        {/* Barra de Filtros */}
        <div className="mx-auto mt-2.5 flex max-w-5xl flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-subtle bg-canvas p-0.5">
            {([
              { id: 'DUE' as const, label: `Pendientes (${stats.dueCount})` },
              { id: 'WEAK' as const, label: 'Reforzar débiles' },
              { id: 'ALL_ENROLLED' as const, label: 'Práctica libre' },
            ]).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setQueueMode(m.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  queueMode === m.id ? 'bg-accent text-canvas' : 'text-muted hover:text-primary'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {!scopedBookId && books.length > 1 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-subtle bg-canvas px-2 py-1 text-[11px]">
              <Filter size={11} className="text-muted" />
              <select
                value={selectedBookId}
                onChange={(e) => setSelectedBookId(e.target.value)}
                className="bg-transparent text-primary outline-none"
                aria-label="Filtrar por libro"
              >
                <option value="ALL">Todos los libros ({books.length})</option>
                {books.map((b) => (
                  <option key={b.bookId} value={b.bookId}>
                    {b.metadata.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5 rounded-lg border border-subtle bg-canvas px-2 py-1 text-[11px]">
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value as PythonDomainId | 'ALL')}
              className="bg-transparent text-primary outline-none"
              aria-label="Filtrar por dominio Python"
            >
              <option value="ALL">Todos los dominios Python</option>
              {PYTHON_DOMAINS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.order}. {d.shortTitle}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Panel Desplegable para Enrolar Capítulos ya estudiados */}
      {showEnrollPanel && (
        <div className="border-b border-subtle bg-surface/80 px-4 py-3">
          <div className="mx-auto max-w-5xl">
            <p className="mb-2 text-xs font-semibold text-primary">
              ¿Ya leíste algún capítulo en papel o en otro dispositivo? Márcalo aquí para desbloquear sus tarjetas en FSRS:
            </p>
            <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {books.map((book) =>
                book.chapters.map((ch) => {
                  const cardCount = ch.microLessons.reduce(
                    (acc, ml) => acc + ml.blocks.filter((b) => b.type === 'FLASHCARD').length,
                    0
                  );
                  return (
                    <div
                      key={`${book.bookId}-${ch.chapterId}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-subtle bg-canvas px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[10px] text-muted">{book.metadata.title}</p>
                        <p className="truncate text-xs font-semibold text-primary">
                          Cap {ch.number}: {ch.title}
                        </p>
                        <p className="text-[10px] text-accent">{cardCount} flashcards atómicas</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void markChapterAsStudied(book.bookId, ch.chapterId)}
                        className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent/20"
                      >
                        Enrolar
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cuerpo de la sesión de repaso */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex h-full max-w-3xl flex-col">
          {queue.length === 0 || !current ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-subtle bg-surface/50 p-8 text-center">
              <CheckCircle2 size={32} className="text-success" />
              <h3 className="text-base font-bold text-primary">
                {stats.enrolledCount === 0
                  ? 'Aún no tienes tarjetas enroladas en tu cola FSRS'
                  : '¡Al día! No hay tarjetas pendientes con este filtro'}
              </h3>
              <p className="max-w-md text-xs leading-relaxed text-muted">
                {stats.enrolledCount === 0
                  ? 'Completa una lección o pulsa "Enrolar capítulos" arriba (o en el temario de cualquier libro) para activar únicamente los conceptos que ya estudiaste.'
                  : 'Tu memoria está al día para el intervalo actual. Puedes cambiar a "Práctica libre" para adelantar repasos o estudiar una nueva lección.'}
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {stats.enrolledCount === 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowEnrollPanel(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-canvas"
                  >
                    <BookCheck size={14} /> Marcar capítulos estudiados ahora
                  </button>
                ) : (
                  queueMode !== 'ALL_ENROLLED' && (
                    <button
                      type="button"
                      onClick={() => setQueueMode('ALL_ENROLLED')}
                      className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent"
                    >
                      <Sparkles size={14} /> Practicar tarjetas enroladas ({stats.enrolledCount})
                    </button>
                  )
                )}
              </div>
            </div>
          ) : current.linkedBlock ? (
            /* Modo ACTIVE SRS: reto verificable vinculado con calificación FSRS objetiva */
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-subtle bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle bg-elevated/40 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-accent" />
                  <span className="text-xs font-bold text-primary">Active SRS Verificable</span>
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] text-muted">
                    {current.bookTitle} · Cap {current.chapterNumber}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted">
                    R={Math.round(current.retrievability * 100)}% · {safeIndex + 1}/{queue.length}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void openBookAtLesson(current.bookId, current.chapterId, current.lessonId)
                    }
                    className="rounded-md border border-subtle px-2 py-0.5 text-[10px] text-accent hover:border-accent"
                  >
                    Ir a lección
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {renderBlockWidget(current.linkedBlock, {
                  deviceMode: 'MOBILE',
                  onResolved: () => {
                    const latencyMs = Math.max(0, Date.now() - cardShownAtRef.current);
                    const sm2Grade = gradeFromObjectiveOutcome(true, latencyMs, false);
                    void handleRate(sm2GradeToFsrsRating(sm2Grade));
                  },
                })}
              </div>
            </div>
          ) : (
            /* Modo Tarjeta Atómica FSRS */
            <div className="flex flex-1 flex-col justify-between gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-subtle bg-surface px-3.5 py-2 text-[11px]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-primary">{current.bookTitle}</span>
                  <span className="text-muted">·</span>
                  <span className="shrink-0 text-accent">
                    Cap {current.chapterNumber}
                  </span>
                  {current.card.conceptTerm && (
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {current.card.conceptTerm}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted">
                  <span>
                    Tarjeta {safeIndex + 1}/{queue.length}
                  </span>
                  <span>·</span>
                  <span>Estabilidad {current.state.stability ?? 0}d</span>
                  <button
                    type="button"
                    onClick={() =>
                      void openBookAtLesson(current.bookId, current.chapterId, current.lessonId)
                    }
                    className="rounded border border-subtle px-2 py-0.5 text-accent hover:border-accent"
                  >
                    Ver contexto
                  </button>
                </div>
              </div>

              <div className="flex flex-1 items-center justify-center py-2">
                <div className="perspective-1000 w-full max-w-xl">
                  <motion.div
                    className="preserve-3d relative min-h-[18rem] w-full cursor-pointer"
                    animate={{ rotateY: flipped ? 180 : 0 }}
                    transition={{ duration: 0.45 }}
                    onClick={() => setFlipped((f) => !f)}
                  >
                    <div className="backface-hidden absolute inset-0 flex flex-col rounded-2xl border border-subtle bg-surface p-5 shadow-md">
                      {current.state.failedInPcLab && (
                        <span className="mb-3 flex w-fit items-center gap-1 rounded-full bg-danger/15 px-2.5 py-0.5 text-[10px] font-semibold text-danger">
                          <Target size={11} /> Refuerzo prioritario tras error en laboratorio
                        </span>
                      )}
                      <p className="flex-1 whitespace-pre-wrap text-base font-medium leading-relaxed text-primary">
                        {current.card.frontMarkdown}
                      </p>
                      <div className="mt-4 flex items-center justify-between text-[11px] text-muted">
                        <span className="flex items-center gap-1">
                          <RotateCw size={12} /> Toca para revelar respuesta
                        </span>
                        <span>Recuperabilidad est.: {Math.round(current.retrievability * 100)}%</span>
                      </div>
                    </div>

                    <div
                      className="backface-hidden absolute inset-0 flex flex-col overflow-y-auto rounded-2xl border border-accent/50 bg-surface p-5 shadow-md"
                      style={{ transform: 'rotateY(180deg)' }}
                    >
                      <span className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-accent">
                        Respuesta y Modelo Mental
                      </span>
                      <p className="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-primary">
                        {current.card.backMarkdown}
                      </p>
                      {current.card.codeExample && (
                        <pre className="code-font mt-3 overflow-x-auto rounded-xl border border-subtle bg-canvas p-3 text-xs text-secondary">
                          {current.card.codeExample}
                        </pre>
                      )}
                    </div>
                  </motion.div>
                </div>
              </div>

              <div className="rounded-2xl border border-subtle bg-surface p-3">
                {flipped ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {FSRS_BUTTONS.map((btn) => (
                      <button
                        key={btn.rating}
                        type="button"
                        onClick={() => void handleRate(btn.rating)}
                        className={cn(
                          'flex flex-col items-center justify-center rounded-xl border py-2.5 transition-colors',
                          btn.className
                        )}
                      >
                        <span className="text-xs font-bold">{btn.label}</span>
                        <span className="mt-0.5 text-[10px] opacity-80">
                          {formatIntervalLabel(current.state, btn.rating)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFlipped(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-xs font-semibold text-canvas"
                  >
                    <RotateCw size={14} /> Mostrar respuesta
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

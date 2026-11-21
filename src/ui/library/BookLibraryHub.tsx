import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Plus,
  Package,
  Layers,
  Sparkles,
  Play,
  Clock,
  Zap,
  Wand2,
  Download,
  Trash2,
  Brain,
  BookMarked,
  Compass,
} from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { PYTHON_COMPETENCIES } from '../../data/pythonTaxonomy';
import { CartridgeImporterModal } from './CartridgeImporterModal';
import { CompilerStudioModal } from './CompilerStudioModal';
import { cn } from '../utils/cn';
import { isSafeCoverImageUrl } from '../utils/sanitize';
import type { BookCartridge } from '../../types/cartridge.types';

export function BookLibraryHub() {
  const cartridges = usePlatformStore((s) => s.cartridges);
  const openBook = usePlatformStore((s) => s.openBook);
  const deleteBook = usePlatformStore((s) => s.deleteBook);
  const setGlobalRoute = usePlatformStore((s) => s.setGlobalRoute);
  const lessonProgressMap = usePlatformStore((s) => s.lessonProgressMap);
  const srsStates = usePlatformStore((s) => s.srsStates);
  const globalConcepts = usePlatformStore((s) => s.globalConcepts);
  const globalCompetencyMastery = usePlatformStore((s) => s.globalCompetencyMastery);
  const exerciseBankCount = usePlatformStore((s) => s.exerciseBankCount);
  const [showImporter, setShowImporter] = useState(false);
  const [showCompiler, setShowCompiler] = useState(false);

  const handleExportBook = (book: BookCartridge) => {
    const blob = new Blob([JSON.stringify(book, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.bookId || 'living-book'}.ulb.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const books = useMemo(() => Object.values(cartridges), [cartridges]);

  const progressByBook = useMemo(() => {
    const completedByBook: Record<string, number> = {};
    for (const p of Object.values(lessonProgressMap)) {
      if (p.isCompleted) {
        completedByBook[p.bookId] = (completedByBook[p.bookId] ?? 0) + 1;
      }
    }
    const map: Record<string, number> = {};
    for (const book of books) {
      const totalLessons = book.chapters.reduce((acc, ch) => acc + ch.microLessons.length, 0);
      const completed = completedByBook[book.bookId] ?? 0;
      map[book.bookId] = totalLessons > 0 ? Math.min(100, Math.round((completed / totalLessons) * 100)) : 0;
    }
    return map;
  }, [books, lessonProgressMap]);

  const dueCardsByBook = useMemo(() => {
    const now = Date.now();
    const map: Record<string, number> = {};
    for (const s of Object.values(srsStates)) {
      const isEnrolled = Boolean(s.enrolled || s.failedInPcLab || s.repetitions > 0 || (s.reps ?? 0) > 0);
      if (isEnrolled && (s.failedInPcLab || s.nextReviewTimestamp <= now)) {
        map[s.bookId] = (map[s.bookId] ?? 0) + 1;
      }
    }
    return map;
  }, [srsStates]);

  const totalDueGlobal = useMemo(
    () => Object.values(dueCardsByBook).reduce((a, b) => a + b, 0),
    [dueCardsByBook]
  );

  const globalPythonScore = useMemo(() => {
    const total = PYTHON_COMPETENCIES.reduce(
      (acc, c) => acc + (globalCompetencyMastery[c.id]?.masteryScore ?? 0),
      0
    );
    return Math.round(total / PYTHON_COMPETENCIES.length);
  }, [globalCompetencyMastery]);

  const progressFor = (bookId: string) => progressByBook[bookId] ?? 0;
  const dueCardsFor = (bookId: string) => dueCardsByBook[bookId] ?? 0;

  const continueBook = useMemo(() => {
    const withProgress = books
      .map((b) => ({ book: b, progress: progressByBook[b.bookId] ?? 0 }))
      .filter((x) => x.progress > 0 && x.progress < 100)
      .sort((a, b) => b.progress - a.progress);
    return withProgress[0]?.book ?? books[0] ?? null;
  }, [books, progressByBook]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="hero-mesh border-b border-subtle px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-6xl">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface/60 px-3 py-1 text-[11px] text-muted">
              <Sparkles size={12} className="text-accent" /> Motor Universal de Libros Vivos v3.0 · FSRS + Knowledge Graph
            </span>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-primary sm:mt-4 sm:text-4xl">
              Tu biblioteca <span className="gradient-text">interactiva</span> de Python
            </h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted sm:mt-2 sm:text-sm">
              Cursos interactivos offline: lee libros técnicos con Deep Dive, practica en móvil ({exerciseBankCount} ejercicios offline) y construye dominio real en Python.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <button
                type="button"
                onClick={() => setShowCompiler(true)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2.5 text-xs font-semibold text-canvas transition-transform hover:scale-[1.03] sm:rounded-lg sm:px-4 sm:py-2"
              >
                <Wand2 size={14} /> <span className="truncate">Compilar Libro</span>
              </button>
              <button
                type="button"
                onClick={() => setShowImporter(true)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-subtle px-3 py-2.5 text-xs font-medium text-primary transition-colors hover:border-accent/50 sm:rounded-lg sm:px-4 sm:py-2"
              >
                <Plus size={14} /> Importar JSON
              </button>
            </div>
          </motion.div>

          {/* Accesos Directos Globales (Desacoplados del libro) */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setGlobalRoute('GLOBAL_SRS')}
              className="surface-card flex items-center gap-3 p-3.5 text-left transition-all hover:border-accent/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                <Brain size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-primary">Hub Global FSRS</p>
                <p className="text-[11px] text-muted">
                  {totalDueGlobal > 0
                    ? `${totalDueGlobal} tarjetas pendientes ahora`
                    : 'Repaso espaciado tipo Anki'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setGlobalRoute('DICTIONARY')}
              className="surface-card flex items-center gap-3 p-3.5 text-left transition-all hover:border-accent/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <BookMarked size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-primary">Diccionario Transversal</p>
                <p className="text-[11px] text-muted">
                  {globalConcepts.length} conceptos · evaluables offline
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setGlobalRoute('PYTHON_ROADMAP')}
              className="surface-card flex items-center gap-3 p-3.5 text-left transition-all hover:border-accent/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
                <Compass size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-primary">Ruta Global Python</p>
                <p className="text-[11px] text-muted">
                  Dominio demostrado: {globalPythonScore}/100
                </p>
              </div>
            </button>
          </div>

          {continueBook && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              onClick={() => openBook(continueBook.bookId)}
              className="surface-card accent-glow mt-6 flex w-full max-w-2xl items-center gap-4 p-4 text-left"
            >
              {isSafeCoverImageUrl(continueBook.metadata.coverImageDataUrl) ? (
                <img
                  src={continueBook.metadata.coverImageDataUrl}
                  alt={continueBook.metadata.title}
                  className="h-16 w-12 shrink-0 rounded-lg border border-subtle object-cover shadow-sm"
                />
              ) : (
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
                  style={{ backgroundColor: `${continueBook.themeDNA.colors.accentPrimary}22` }}
                >
                  {continueBook.metadata.coverAccentIcon}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                  <Play size={10} /> Continuar donde lo dejaste
                </p>
                <p className="truncate text-sm font-semibold text-primary">{continueBook.metadata.title}</p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${progressFor(continueBook.bookId)}%`,
                      backgroundColor: continueBook.themeDNA.colors.accentPrimary,
                    }}
                  />
                </div>
              </div>
              <span className="hidden shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-canvas sm:block">
                Abrir
              </span>
            </motion.button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Cartuchos compilados ({books.length})
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {books.map((book, idx) => {
            const progress = progressFor(book.bookId);
            const due = dueCardsFor(book.bookId);
            return (
              <motion.div
                key={book.bookId}
                role="button"
                tabIndex={0}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: idx * 0.06 }}
                onClick={() => openBook(book.bookId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openBook(book.bookId);
                  }
                }}
                className="surface-card group flex cursor-pointer flex-col p-4 text-left"
              >
                <div
                  className="mb-3 h-1.5 w-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${book.themeDNA.colors.accentPrimary}, ${book.themeDNA.colors.accentSecondary})`,
                  }}
                />
                <div className="mb-3 flex items-start gap-3">
                  {isSafeCoverImageUrl(book.metadata.coverImageDataUrl) ? (
                    <img
                      src={book.metadata.coverImageDataUrl}
                      alt={`Portada de ${book.metadata.title}`}
                      loading="lazy"
                      className="h-28 w-20 shrink-0 rounded-lg border border-subtle bg-canvas object-cover shadow-sm"
                    />
                  ) : (
                    <span
                      className="flex h-16 w-12 shrink-0 items-center justify-center rounded-xl border border-subtle text-2xl"
                      style={{ backgroundColor: `${book.themeDNA.colors.accentPrimary}22` }}
                    >
                      {book.metadata.coverAccentIcon}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="inline-block rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">
                      {book.metadata.difficulty}
                    </span>
                    <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-primary">
                      {book.metadata.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted">
                      {book.metadata.subtitle || book.metadata.authors.join(', ')}
                    </p>
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-1.5 text-[10px] text-muted">
                  <Sparkles size={10} /> {book.themeDNA.themeName}
                </div>

                <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
                  <span>Progreso</span>
                  <span>{progress}%</span>
                </div>
                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${progress}%`, backgroundColor: book.themeDNA.colors.accentPrimary }}
                  />
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 text-[10px] text-muted">
                  <span className="flex items-center gap-1">
                    <Layers size={10} /> {book.chapters.length} caps
                  </span>
                  <span className={cn('flex items-center gap-1', due > 0 && 'text-secondary')}>
                    <Package size={10} /> {due} repasos
                  </span>
                  <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => handleExportBook(book)}
                      className="rounded-md border border-subtle bg-canvas p-1.5 text-muted transition-colors hover:border-accent hover:text-accent"
                      title="Exportar cartucho (.ulb.json)"
                    >
                      <Download size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`¿Eliminar "${book.metadata.title}" de tu biblioteca local?`)) {
                          void deleteBook(book.bookId);
                        }
                      }}
                      className="rounded-md border border-subtle bg-canvas p-1.5 text-muted transition-colors hover:border-danger hover:text-danger"
                      title="Eliminar libro"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}

          <motion.button
            type="button"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: books.length * 0.06 }}
            onClick={() => setShowCompiler(true)}
            className="flex min-h-[13rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-subtle p-4 text-center transition-colors hover:border-accent/60 hover:bg-accent/5"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated">
              <Wand2 size={20} className="text-accent" />
            </span>
            <p className="text-xs font-medium text-primary">Compilar un libro</p>
            <p className="text-[11px] text-muted">
              Multi-agente desde PDF / texto o importa un <span className="code-font text-accent">cartridge.json</span>
            </p>
          </motion.button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: Zap, title: 'Python en el navegador', desc: 'Pyodide + micropip, sin servidores' },
            { icon: Clock, title: 'Repaso espaciado SM-2', desc: 'Refuerza lo que fallaste en el PC Lab' },
            { icon: BookOpen, title: '100% offline', desc: 'Tu progreso vive en IndexedDB' },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-3 rounded-xl border border-subtle bg-surface/50 p-3">
              <f.icon size={16} className="mt-0.5 text-accent" />
              <div>
                <p className="text-xs font-semibold text-primary">{f.title}</p>
                <p className="text-[11px] text-muted">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showImporter && <CartridgeImporterModal onClose={() => setShowImporter(false)} />}
      {showCompiler && <CompilerStudioModal onClose={() => setShowCompiler(false)} />}
    </div>
  );
}

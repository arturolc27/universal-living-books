import { useMemo, useState } from 'react';
import { BookMarked, BookOpen, Filter, Search, Sparkles, Zap } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { PYTHON_COMPETENCY_BY_ID, PYTHON_DOMAINS, type PythonDomainId } from '../../data/pythonTaxonomy';
import type { ConceptMasteryStatus } from '../../db/dexieDb';
import { cn } from '../utils/cn';

const STATUS_META: Record<ConceptMasteryStatus, { label: string; className: string }> = {
  MASTERED: { label: 'Dominado', className: 'border-success/40 bg-success/10 text-success' },
  PRACTICING: { label: 'En práctica', className: 'border-accent/40 bg-accent/10 text-accent' },
  NEEDS_REVIEW: { label: 'Repasar', className: 'border-danger/40 bg-danger/10 text-danger' },
  UNSEEN: { label: 'Sin evaluar', className: 'border-subtle bg-elevated text-muted' },
};

export function GlobalDictionaryView() {
  const globalConcepts = usePlatformStore((s) => s.globalConcepts);
  const globalCompetencyMastery = usePlatformStore((s) => s.globalCompetencyMastery);
  const cartridges = usePlatformStore((s) => s.cartridges);
  const setActiveConceptModal = usePlatformStore((s) => s.setActiveConceptModal);

  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<PythonDomainId | 'ALL'>('ALL');
  const [bookFilter, setBookFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<ConceptMasteryStatus | 'ALL'>('ALL');

  const books = useMemo(() => Object.values(cartridges), [cartridges]);

  const enriched = useMemo(() => {
    return globalConcepts.map((c) => {
      const primaryComp = c.competencyIds[0];
      const mastery = primaryComp ? globalCompetencyMastery[primaryComp] : undefined;
      const status: ConceptMasteryStatus = mastery?.status ?? 'UNSEEN';
      const domainIds = [
        ...new Set(
          c.competencyIds
            .map((cid) => PYTHON_COMPETENCY_BY_ID[cid]?.domainId)
            .filter((d): d is PythonDomainId => Boolean(d))
        ),
      ];
      return { concept: c, status, score: mastery?.masteryScore ?? 0, domainIds };
    });
  }, [globalConcepts, globalCompetencyMastery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter(({ concept, status, domainIds }) => {
      if (domainFilter !== 'ALL' && !domainIds.includes(domainFilter)) return false;
      if (bookFilter !== 'ALL' && !concept.sources.some((s) => s.bookId === bookFilter)) return false;
      if (statusFilter !== 'ALL' && status !== statusFilter) return false;
      if (!q) return true;
      const bag = `${concept.term} ${concept.aliases.join(' ')} ${concept.definition}`.toLowerCase();
      return bag.includes(q);
    });
  }, [enriched, query, domainFilter, bookFilter, statusFilter]);

  const counts = useMemo(() => {
    const mastered = enriched.filter((e) => e.status === 'MASTERED').length;
    const practicing = enriched.filter((e) => e.status === 'PRACTICING').length;
    const needsReview = enriched.filter((e) => e.status === 'NEEDS_REVIEW').length;
    return { total: enriched.length, mastered, practicing, needsReview };
  }, [enriched]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* Cabecera y buscador */}
      <div className="border-b border-subtle bg-surface/60 px-4 py-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-bold text-primary">
                <BookMarked size={18} className="text-accent" /> Diccionario Técnico Transversal
              </h1>
              <p className="text-xs text-muted">
                Índice consolidado entre todos tus libros (100% offline). Haz clic en cualquier término para ver ejemplos, ir a su lección o evaluarte al instante.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full border border-subtle bg-canvas px-2.5 py-1 text-primary">
                {counts.total} términos
              </span>
              <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-success">
                {counts.mastered} dominados
              </span>
              {counts.needsReview > 0 && (
                <span className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-danger">
                  {counts.needsReview} por reforzar
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-subtle bg-canvas px-3 py-2">
              <Search size={14} className="text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar concepto, alias o definición (ej. aliasing, comprehension, namespace)..."
                className="w-full bg-transparent text-xs text-primary outline-none placeholder:text-muted"
              />
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-subtle bg-canvas px-2.5 py-2 text-xs">
              <Filter size={12} className="text-muted" />
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value as PythonDomainId | 'ALL')}
                className="bg-transparent text-primary outline-none"
                aria-label="Dominio"
              >
                <option value="ALL">Todos los dominios</option>
                {PYTHON_DOMAINS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.shortTitle}
                  </option>
                ))}
              </select>
            </div>

            {books.length > 1 && (
              <div className="flex items-center gap-1.5 rounded-xl border border-subtle bg-canvas px-2.5 py-2 text-xs">
                <select
                  value={bookFilter}
                  onChange={(e) => setBookFilter(e.target.value)}
                  className="bg-transparent text-primary outline-none"
                  aria-label="Libro"
                >
                  <option value="ALL">Todos los libros</option>
                  {books.map((b) => (
                    <option key={b.bookId} value={b.bookId}>
                      {b.metadata.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5 rounded-xl border border-subtle bg-canvas px-2.5 py-2 text-xs">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ConceptMasteryStatus | 'ALL')}
                className="bg-transparent text-primary outline-none"
                aria-label="Estado de dominio"
              >
                <option value="ALL">Cualquier estado</option>
                <option value="MASTERED">Dominado</option>
                <option value="PRACTICING">En práctica</option>
                <option value="NEEDS_REVIEW">Requiere repaso</option>
                <option value="UNSEEN">Sin evaluar</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Grid de conceptos */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-subtle bg-surface/50 p-10 text-center text-xs text-muted">
              No se encontraron conceptos que coincidan con tu búsqueda o filtros.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map(({ concept, status, score }) => {
                const meta = STATUS_META[status];
                return (
                  <button
                    key={concept.conceptKey}
                    type="button"
                    onClick={() => setActiveConceptModal(concept)}
                    className="surface-card flex flex-col justify-between p-4 text-left transition-all hover:border-accent/60"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold text-accent">{concept.term}</h3>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold',
                            meta.className
                          )}
                        >
                          {meta.label}
                          {score > 0 ? ` ${score}%` : ''}
                        </span>
                      </div>

                      {concept.aliases.length > 0 && (
                        <p className="mt-0.5 truncate text-[10px] text-muted">
                          {concept.aliases.slice(0, 4).join(' · ')}
                        </p>
                      )}

                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-primary">
                        {concept.definition}
                      </p>

                      {concept.snippet && (
                        <pre className="code-font mt-2 truncate rounded-md bg-canvas px-2 py-1 text-[10px] text-secondary">
                          {concept.snippet.split('\n')[0]}
                        </pre>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-subtle/60 pt-2.5 text-[10px] text-muted">
                      <span className="flex items-center gap-1 truncate">
                        <BookOpen size={10} />
                        {concept.sources.length === 1
                          ? `${concept.sources[0].bookTitle} (Cap ${concept.sources[0].chapterNumber})`
                          : `${concept.sources.length} libros`}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 font-semibold text-accent">
                        {concept.deepDive && <Sparkles size={10} />}
                        <Zap size={10} /> Evaluar
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

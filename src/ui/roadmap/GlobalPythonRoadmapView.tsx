import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Compass,
  Filter,
  Loader2,
  Lock,
  Sparkles,
  Target,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import {
  PYTHON_COMPETENCIES,
  PYTHON_DOMAINS,
  matchCompetenciesFromText,
  type PythonCompetencyNode,
  type PythonDomainId,
} from '../../data/pythonTaxonomy';
import { livingBooksDb, type ExerciseBankRecord } from '../../db/dexieDb';
import { usePlatformStore } from '../../store/usePlatformStore';
import { generateDynamicExercise } from '../../engine/compiler/dynamicExerciseGenerator';
import { renderBlockWidget } from '../../registry/widgetRegistry';
import { cn } from '../utils/cn';

interface CoverageRef {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterNumber: number;
  lessonId: string;
  lessonTitle: string;
}

export function GlobalPythonRoadmapView() {
  const cartridges = usePlatformStore((s) => s.cartridges);
  const globalCompetencyMastery = usePlatformStore((s) => s.globalCompetencyMastery);
  const openBookAtLesson = usePlatformStore((s) => s.openBookAtLesson);
  const recordLearningTelemetry = usePlatformStore((s) => s.recordLearningTelemetry);
  const refreshKnowledgeGraph = usePlatformStore((s) => s.refreshKnowledgeGraph);
  const settings = usePlatformStore((s) => s.settings);
  const preferredLanguage = usePlatformStore((s) => s.preferredLanguage);
  const viewMode = usePlatformStore((s) => s.viewMode);

  const [selectedDomain, setSelectedDomain] = useState<PythonDomainId | 'ALL'>('ALL');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [practiceNode, setPracticeNode] = useState<PythonCompetencyNode | null>(null);
  const [practiceRecord, setPracticeRecord] = useState<ExerciseBankRecord | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [practiceSolved, setPracticeSolved] = useState(false);

  // Mapear qué libros/lecciones de la biblioteca cubren cada competencia canónica
  const coverageByCompetency = useMemo(() => {
    const map: Record<string, CoverageRef[]> = {};
    for (const book of Object.values(cartridges)) {
      for (const ch of book.chapters) {
        for (const ml of ch.microLessons) {
          const explicit = new Set<string>(ml.competencyIds ?? []);
          for (const blk of ml.blocks) {
            for (const cid of blk.competencyIds ?? []) explicit.add(cid);
          }
          const inferred =
            explicit.size > 0
              ? [...explicit]
              : matchCompetenciesFromText(
                  [ch.title, ml.title, ...(ml.learningObjectives ?? [])],
                  3
                );
          for (const cid of inferred) {
            if (!map[cid]) map[cid] = [];
            if (!map[cid].some((r) => r.bookId === book.bookId && r.lessonId === ml.lessonId)) {
              map[cid].push({
                bookId: book.bookId,
                bookTitle: book.metadata.title,
                chapterId: ch.chapterId,
                chapterNumber: ch.number,
                lessonId: ml.lessonId,
                lessonTitle: ml.title,
              });
            }
          }
        }
      }
    }
    return map;
  }, [cartridges]);

  // Calcular métricas globales y por dominio
  const summary = useMemo(() => {
    let totalScore = 0;
    let mastered = 0;
    let practicing = 0;
    let needsReview = 0;
    let coveredByLibrary = 0;
    let openMisconceptions = 0;

    for (const comp of PYTHON_COMPETENCIES) {
      const m = globalCompetencyMastery[comp.id];
      const score = m?.masteryScore ?? 0;
      totalScore += score;
      if (m?.status === 'MASTERED') mastered += 1;
      else if (m?.status === 'PRACTICING') practicing += 1;
      else if (m?.status === 'NEEDS_REVIEW') needsReview += 1;

      if ((coverageByCompetency[comp.id]?.length ?? 0) > 0) coveredByLibrary += 1;
      if (m) {
        const unresolved = Object.keys(m.misconceptionHits).filter(
          (k) => (m.misconceptionHits[k] ?? 0) > 0 && !m.misconceptionResolved.includes(k)
        );
        openMisconceptions += unresolved.length;
      }
    }

    const globalScore = Math.round(totalScore / PYTHON_COMPETENCIES.length);
    return {
      globalScore,
      mastered,
      practicing,
      needsReview,
      total: PYTHON_COMPETENCIES.length,
      coveredByLibrary,
      openMisconceptions,
    };
  }, [globalCompetencyMastery, coverageByCompetency]);

  const domainMetrics = useMemo(() => {
    return PYTHON_DOMAINS.map((domain) => {
      const nodes = PYTHON_COMPETENCIES.filter((c) => c.domainId === domain.id);
      const avgScore = Math.round(
        nodes.reduce((acc, n) => acc + (globalCompetencyMastery[n.id]?.masteryScore ?? 0), 0) /
          Math.max(1, nodes.length)
      );
      const masteredCount = nodes.filter(
        (n) => globalCompetencyMastery[n.id]?.status === 'MASTERED'
      ).length;
      const coveredCount = nodes.filter((n) => (coverageByCompetency[n.id]?.length ?? 0) > 0).length;
      return { domain, nodes, avgScore, masteredCount, coveredCount };
    });
  }, [globalCompetencyMastery, coverageByCompetency]);

  const launchPracticeForNode = async (node: PythonCompetencyNode, forceAi = false) => {
    setPracticeNode(node);
    setPracticeRecord(null);
    setPracticeError(null);
    setPracticeSolved(false);
    setPracticeLoading(true);
    try {
      if (!forceAi && livingBooksDb.exerciseBank) {
        const all = await livingBooksDb.exerciseBank.toArray();
        const matches = all.filter((ex) => {
          if (viewMode === 'MOBILE_COMPANION' && !ex.mobileFriendly) return false;
          return ex.competencyIds.includes(node.id);
        });
        if (matches.length > 0) {
          setPracticeRecord(matches[Math.floor(Math.random() * matches.length)]);
          setPracticeLoading(false);
          return;
        }
      }

      const ref = coverageByCompetency[node.id]?.[0];
      const generated = await generateDynamicExercise(
        {
          bookId: ref?.bookId ?? 'global-roadmap',
          chapterId: ref?.chapterId ?? node.domainId,
          lessonId: ref?.lessonId ?? node.id,
          topicTitle: node.title,
          contextExcerpt: `${node.title}: ${node.description}`,
          mechanic: 'OUTPUT_PREDICTION',
          competencyIds: [node.id],
          conceptKeys: node.keywords.slice(0, 3),
          language: preferredLanguage,
        },
        {
          provider: settings.llmProvider,
          openrouterApiKey: settings.openrouterApiKey,
          geminiApiKey: settings.geminiApiKey,
          model:
            settings.llmProvider === 'gemini' ? settings.geminiModel : settings.openrouterModel,
        }
      );
      setPracticeRecord(generated);
      await refreshKnowledgeGraph();
    } catch (err) {
      setPracticeError(err instanceof Error ? err.message : String(err));
    } finally {
      setPracticeLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* Hero Global Python Mastery */}
      <div className="border-b border-subtle bg-surface/60 px-4 py-4">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold text-accent">
                <Compass size={11} /> Ruta Global de Dominio en Python (Libro-Agnóstica)
              </span>
              <h1 className="mt-1.5 text-lg font-bold text-primary sm:text-xl">
                Mapa de Competencias Demostradas ({summary.total} nodos · 9 dominios)
              </h1>
              <p className="mt-0.5 max-w-2xl text-xs text-muted">
                Mide dominio real mediante predicción en 1.er intento, práctica activa/transferencia, retención FSRS y resolución de misconceptions — independiente del libro que uses.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-accent/40 bg-canvas px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase text-muted">Score Python</p>
                <p className="text-xl font-bold text-accent">{summary.globalScore}/100</p>
              </div>
              <div className="rounded-xl border border-subtle bg-canvas px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase text-muted">Dominadas</p>
                <p className="text-xl font-bold text-success">
                  {summary.mastered}
                  <span className="text-xs font-normal text-muted">/{summary.total}</span>
                </p>
              </div>
              <div className="rounded-xl border border-subtle bg-canvas px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase text-muted">En biblioteca</p>
                <p className="text-xl font-bold text-primary">
                  {summary.coveredByLibrary}
                  <span className="text-xs font-normal text-muted">/{summary.total}</span>
                </p>
              </div>
              <div className="rounded-xl border border-subtle bg-canvas px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase text-muted">Trampas abiertas</p>
                <p className={cn('text-xl font-bold', summary.openMisconceptions > 0 ? 'text-danger' : 'text-success')}>
                  {summary.openMisconceptions}
                </p>
              </div>
            </div>
          </div>

          {/* Radar/Barras de los 9 Dominios */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            {domainMetrics.map(({ domain, avgScore, masteredCount, nodes }) => {
              const isSelected = selectedDomain === domain.id;
              return (
                <button
                  key={domain.id}
                  type="button"
                  onClick={() => setSelectedDomain(isSelected ? 'ALL' : domain.id)}
                  className={cn(
                    'flex flex-col rounded-xl border p-2 text-left transition-all',
                    isSelected
                      ? 'border-accent bg-accent/15'
                      : 'border-subtle bg-canvas hover:border-accent/50'
                  )}
                >
                  <span className="truncate text-[10px] font-semibold text-primary">
                    {domain.order}. {domain.shortTitle}
                  </span>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${avgScore}%`, backgroundColor: domain.accentColor }}
                    />
                  </div>
                  <span className="mt-1 text-[9px] text-muted">
                    {avgScore}% · {masteredCount}/{nodes.length}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <Filter size={12} className="text-muted" />
              <span className="text-muted">
                {selectedDomain === 'ALL'
                  ? 'Mostrando los 9 dominios'
                  : `Dominio: ${PYTHON_DOMAINS.find((d) => d.id === selectedDomain)?.title}`}
              </span>
              {selectedDomain !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setSelectedDomain('ALL')}
                  className="text-[11px] font-semibold text-accent hover:underline"
                >
                  Ver todos
                </button>
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={onlyGaps}
                onChange={(e) => setOnlyGaps(e.target.checked)}
                className="accent-accent"
              />
              Mostrar solo brechas (sin dominar o sin libro)
            </label>
          </div>
        </div>
      </div>

      {/* Lista de dominios y nodos de competencia */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {domainMetrics
            .filter(({ domain }) => selectedDomain === 'ALL' || domain.id === selectedDomain)
            .map(({ domain, nodes, avgScore, coveredCount }) => {
              const visibleNodes = onlyGaps
                ? nodes.filter((n) => globalCompetencyMastery[n.id]?.status !== 'MASTERED')
                : nodes;
              if (visibleNodes.length === 0) return null;

              return (
                <section
                  key={domain.id}
                  className="overflow-hidden rounded-2xl border border-subtle bg-surface"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle bg-elevated/40 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: domain.accentColor }}>
                        Dominio {domain.order} de 9
                      </p>
                      <h2 className="text-sm font-bold text-primary">{domain.title}</h2>
                      <p className="text-[11px] text-muted">{domain.description}</p>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="rounded-full border border-subtle bg-canvas px-2.5 py-1 text-muted">
                        Cobertura biblioteca: {coveredCount}/{nodes.length}
                      </span>
                      <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-bold text-accent">
                        {avgScore}%
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
                    {visibleNodes.map((node) => {
                      const m = globalCompetencyMastery[node.id];
                      const score = m?.masteryScore ?? 0;
                      const status = m?.status ?? 'UNSEEN';
                      const refs = coverageByCompetency[node.id] ?? [];
                      const prereqsMet = node.prerequisites.every(
                        (pid) => (globalCompetencyMastery[pid]?.masteryScore ?? 0) >= 40
                      );

                      return (
                        <div
                          key={node.id}
                          className="flex flex-col justify-between rounded-xl border border-subtle bg-canvas p-3.5"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                {status === 'MASTERED' ? (
                                  <CheckCircle2 size={14} className="shrink-0 text-success" />
                                ) : status === 'NEEDS_REVIEW' ? (
                                  <AlertTriangle size={14} className="shrink-0 text-danger" />
                                ) : status === 'PRACTICING' ? (
                                  <Target size={14} className="shrink-0 text-accent" />
                                ) : !prereqsMet && node.prerequisites.length > 0 ? (
                                  <Lock size={13} className="shrink-0 text-muted opacity-60" />
                                ) : (
                                  <Sparkles size={13} className="shrink-0 text-muted" />
                                )}
                                <h3 className="text-xs font-bold text-primary">{node.title}</h3>
                              </div>
                              <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold text-accent">
                                {score}%
                              </span>
                            </div>

                            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                              {node.description}
                            </p>

                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${score}%`,
                                  backgroundColor:
                                    status === 'MASTERED'
                                      ? '#10B981'
                                      : status === 'NEEDS_REVIEW'
                                        ? '#F43F5E'
                                        : domain.accentColor,
                                }}
                              />
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] text-muted">
                              <span className="rounded bg-elevated px-1.5 py-0.5">
                                Complejidad Tier {node.complexityTier}
                              </span>
                              {m && m.predictionAttempts > 0 && (
                                <span className="rounded bg-elevated px-1.5 py-0.5">
                                  Pred: {m.predictionHits}/{m.predictionAttempts}
                                </span>
                              )}
                              {m && m.fsrsMaxStability > 0 && (
                                <span className="rounded bg-elevated px-1.5 py-0.5 text-success">
                                  FSRS {m.fsrsMaxStability}d
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 space-y-1.5 border-t border-subtle/60 pt-2.5">
                            {refs.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {refs.slice(0, 2).map((ref) => (
                                  <button
                                    key={`${ref.bookId}-${ref.lessonId}`}
                                    type="button"
                                    onClick={() =>
                                      void openBookAtLesson(ref.bookId, ref.chapterId, ref.lessonId)
                                    }
                                    className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-subtle bg-surface px-2 py-0.5 text-[10px] text-primary hover:border-accent"
                                    title={`${ref.bookTitle} — ${ref.lessonTitle}`}
                                  >
                                    <BookOpen size={9} className="shrink-0 text-accent" />
                                    <span className="truncate">{ref.bookTitle} (Cap {ref.chapterNumber})</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] italic text-muted">
                                Brecha: ningún libro instalado cubre aún este nodo.
                              </p>
                            )}

                            <button
                              type="button"
                              onClick={() => void launchPracticeForNode(node, false)}
                              className="flex w-full items-center justify-center gap-1 rounded-lg border border-accent/40 bg-accent/10 py-1.5 text-[10px] font-semibold text-accent hover:bg-accent/20"
                            >
                              <Zap size={11} /> Practicar / Evaluar nodo
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
        </div>
      </div>

      {/* Modal de práctica directa desde la Ruta Global */}
      {practiceNode && (
        <div
          className="fixed inset-0 z-[75] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setPracticeNode(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-strong flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-subtle shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase text-accent">
                  Práctica Directa de Competencia
                </p>
                <h3 className="truncate text-sm font-bold text-primary">{practiceNode.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPracticeNode(null)}
                className="rounded-lg border border-subtle p-1 text-muted hover:text-primary"
              >
                <X size={15} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {practiceLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-xs text-muted">
                  <Loader2 size={22} className="animate-spin text-accent" />
                  Preparando ejercicio verificado en Pyodide...
                </div>
              ) : practiceError ? (
                <div className="space-y-3 rounded-xl border border-danger/40 bg-danger/10 p-4 text-xs text-danger">
                  <p>{practiceError}</p>
                  <p className="text-[11px] text-muted">
                    Consejo: instala o compila un libro que cubra este tema para practicarlo 100% offline, o configura tu API Key en Ajustes para generar retos IA verificados.
                  </p>
                </div>
              ) : practiceRecord ? (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-xl border border-subtle bg-surface">
                    {renderBlockWidget(practiceRecord.block, {
                      deviceMode: viewMode === 'MOBILE_COMPANION' ? 'MOBILE' : 'PC',
                      onResolved: () => {
                        setPracticeSolved(true);
                        void recordLearningTelemetry({
                          bookId: practiceRecord.bookId,
                          lessonId: practiceRecord.lessonId,
                          blockId: practiceRecord.block.blockId,
                          eventType: 'DICTIONARY_MICRO_EVAL',
                          competencyId: practiceNode.id,
                          passed: true,
                        });
                      },
                    })}
                  </div>
                  {practiceSolved && (
                    <div className="flex items-center justify-between rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 size={14} /> ¡Competencia actualizada!
                      </span>
                      <button
                        type="button"
                        onClick={() => void launchPracticeForNode(practiceNode, true)}
                        className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-canvas"
                      >
                        <Wand2 size={11} /> Generar otro reto IA
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

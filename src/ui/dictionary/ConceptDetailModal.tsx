import { useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Play,
  Sparkles,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import { livingBooksDb, type ExerciseBankRecord, type GlobalConceptRecord } from '../../db/dexieDb';
import { usePlatformStore } from '../../store/usePlatformStore';
import { pythonRuntimeBridge } from '../../engine/pyodide/pythonRuntimeBridge';
import {
  generateDynamicExercise,
  type DynamicExerciseMechanic,
} from '../../engine/compiler/dynamicExerciseGenerator';
import { renderBlockWidget } from '../../registry/widgetRegistry';
import { PYTHON_COMPETENCY_BY_ID } from '../../data/pythonTaxonomy';
import { cn } from '../utils/cn';

const MASTERY_BADGE: Record<string, { label: string; className: string }> = {
  MASTERED: { label: 'Dominado', className: 'border-success/40 bg-success/10 text-success' },
  PRACTICING: { label: 'En práctica', className: 'border-accent/40 bg-accent/10 text-accent' },
  NEEDS_REVIEW: { label: 'Requiere repaso', className: 'border-danger/40 bg-danger/10 text-danger' },
  UNSEEN: { label: 'Sin evaluar', className: 'border-subtle bg-elevated text-muted' },
};

export function ConceptDetailModal({
  concept,
  onClose,
}: {
  concept: GlobalConceptRecord;
  onClose: () => void;
}) {
  const openBookAtLesson = usePlatformStore((s) => s.openBookAtLesson);
  const globalCompetencyMastery = usePlatformStore((s) => s.globalCompetencyMastery);
  const recordLearningTelemetry = usePlatformStore((s) => s.recordLearningTelemetry);
  const refreshKnowledgeGraph = usePlatformStore((s) => s.refreshKnowledgeGraph);
  const settings = usePlatformStore((s) => s.settings);
  const preferredLanguage = usePlatformStore((s) => s.preferredLanguage);
  const viewMode = usePlatformStore((s) => s.viewMode);

  const [showDeepDive, setShowDeepDive] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [isRunningSnippet, setIsRunningSnippet] = useState(false);
  const [matchingExercises, setMatchingExercises] = useState<ExerciseBankRecord[]>([]);
  const [activeEval, setActiveEval] = useState<ExerciseBankRecord | null>(null);
  const [evalCompleted, setEvalCompleted] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Cargar ejercicios offline disponibles para este concepto/competencia
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!livingBooksDb.exerciseBank) return;
      try {
        const all = await livingBooksDb.exerciseBank.toArray();
        const compSet = new Set(concept.competencyIds);
        const matches = all.filter((ex) => {
          if (viewMode === 'MOBILE_COMPANION' && !ex.mobileFriendly) return false;
          if (ex.conceptKeys.includes(concept.conceptKey)) return true;
          return ex.competencyIds.some((cid) => compSet.has(cid));
        });
        if (!cancelled) setMatchingExercises(matches);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [concept, viewMode]);

  const primaryCompId = concept.competencyIds[0];
  const compMastery = primaryCompId ? globalCompetencyMastery[primaryCompId] : undefined;
  const badge = MASTERY_BADGE[compMastery?.status ?? 'UNSEEN'];

  const handleRunSnippet = async () => {
    if (!concept.snippet) return;
    setIsRunningSnippet(true);
    setRunOutput(null);
    try {
      const code = concept.snippet.includes('print(')
        ? concept.snippet
        : `${concept.snippet}\n`;
      const res = await pythonRuntimeBridge.executeAndEvaluate(code);
      if (res.ok) {
        const out = res.stdout.trim() || (res.returnValue ? `=> ${res.returnValue}` : 'Ejecutado sin salida.');
        setRunOutput(out);
      } else {
        setRunOutput(`Error: ${res.stderr.trim()}`);
      }
    } catch (err) {
      setRunOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningSnippet(false);
    }
  };

  const handleLaunchOfflineEval = () => {
    setAiError(null);
    setEvalCompleted(false);
    if (matchingExercises.length > 0) {
      const idx = Math.floor(Math.random() * matchingExercises.length);
      setActiveEval(matchingExercises[idx]);
    }
  };

  const handleGenerateAiEval = async (mechanic: DynamicExerciseMechanic = 'OUTPUT_PREDICTION') => {
    setIsGeneratingAi(true);
    setAiError(null);
    setEvalCompleted(false);
    try {
      const primarySource = concept.sources[0];
      const generated = await generateDynamicExercise(
        {
          bookId: primarySource?.bookId ?? 'global-dictionary',
          chapterId: primarySource?.chapterId ?? 'dict',
          lessonId: primarySource?.lessonId ?? concept.conceptKey,
          topicTitle: concept.term,
          contextExcerpt: `${concept.term}: ${concept.definition}\n${concept.snippet ?? ''}`,
          mechanic,
          competencyIds: concept.competencyIds,
          conceptKeys: [concept.conceptKey],
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
      setMatchingExercises((prev) => [generated, ...prev]);
      setActiveEval(generated);
      await refreshKnowledgeGraph();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingAi(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-subtle shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-subtle px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-accent">{concept.term}</h3>
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', badge.className)}>
                {badge.label}
                {compMastery ? ` · ${compMastery.masteryScore}%` : ''}
              </span>
            </div>
            {concept.aliases.length > 0 && (
              <p className="mt-0.5 text-[10px] text-muted">
                También conocido como: {concept.aliases.slice(0, 5).join(', ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-subtle p-1 text-muted hover:text-primary"
            aria-label="Cerrar"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {activeEval ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                  <Zap size={13} /> Micro-Evaluación: {concept.term}
                  {activeEval.origin === 'AI_GENERATED' && (
                    <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-[9px] text-secondary">
                      IA · Verificado Pyodide
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveEval(null)}
                  className="text-[11px] text-muted hover:text-primary"
                >
                  ← Volver a definición
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-subtle bg-surface">
                {renderBlockWidget(activeEval.block, {
                  deviceMode: viewMode === 'MOBILE_COMPANION' ? 'MOBILE' : 'PC',
                  onResolved: () => {
                    setEvalCompleted(true);
                    void recordLearningTelemetry({
                      bookId: activeEval.bookId,
                      lessonId: activeEval.lessonId,
                      blockId: activeEval.block.blockId,
                      eventType: 'DICTIONARY_MICRO_EVAL',
                      conceptTag: concept.conceptKey,
                      competencyId: concept.competencyIds[0],
                      passed: true,
                    });
                  },
                })}
              </div>

              {evalCompleted && (
                <div className="flex items-center justify-between rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 size={14} /> ¡Evidencia registrada en tu Ruta Global de Python!
                  </span>
                  {matchingExercises.length > 1 && (
                    <button
                      type="button"
                      onClick={handleLaunchOfflineEval}
                      className="rounded-lg bg-success px-2.5 py-1 text-[10px] font-bold text-canvas"
                    >
                      Otro reto
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-primary">{concept.definition}</p>

              {/* Ejemplo mínimo ejecutable */}
              {concept.snippet && (
                <div className="overflow-hidden rounded-xl border border-subtle bg-canvas">
                  <div className="flex items-center justify-between border-b border-subtle/60 bg-surface/60 px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Ejemplo mínimo Python
                    </span>
                    <button
                      type="button"
                      disabled={isRunningSnippet}
                      onClick={() => void handleRunSnippet()}
                      className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-60"
                    >
                      {isRunningSnippet ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Play size={10} />
                      )}
                      Ejecutar
                    </button>
                  </div>
                  <pre className="code-font overflow-x-auto p-3 text-xs text-secondary">
                    {concept.snippet}
                  </pre>
                  {runOutput !== null && (
                    <div className="border-t border-subtle/60 bg-surface/40 px-3 py-2 font-mono text-[11px] text-primary">
                      {runOutput}
                    </div>
                  )}
                </div>
              )}

              {/* Competencias canónicas vinculadas */}
              {concept.competencyIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {concept.competencyIds.map((cid) => {
                    const node = PYTHON_COMPETENCY_BY_ID[cid];
                    if (!node) return null;
                    return (
                      <span
                        key={cid}
                        className="inline-flex items-center gap-1 rounded-full border border-subtle bg-elevated px-2.5 py-0.5 text-[10px] text-muted"
                      >
                        <Layers size={10} className="text-accent" /> {node.title}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Deep Dive colapsable si el concepto tiene capa de profundidad */}
              {concept.deepDive && (
                <div className="rounded-xl border border-accent/30 bg-accent/5">
                  <button
                    type="button"
                    onClick={() => setShowDeepDive((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-accent"
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles size={13} /> Deep Dive: mecánica interna y casos borde
                    </span>
                    {showDeepDive ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showDeepDive && (
                    <div className="space-y-2 border-t border-accent/20 px-3 py-2.5 text-xs text-primary">
                      <p className="leading-relaxed">{concept.deepDive.internalMechanics}</p>
                      {concept.deepDive.edgeCases.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase text-secondary">Casos borde</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
                            {concept.deepDive.edgeCases.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {concept.deepDive.commonPitfalls.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase text-danger">Errores comunes</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
                            {concept.deepDive.commonPitfalls.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Fuentes del libro (1-click jump) */}
              {concept.sources.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Aparece en tus libros ({concept.sources.length})
                  </p>
                  <div className="space-y-1.5">
                    {concept.sources.map((src) => (
                      <button
                        key={`${src.bookId}-${src.lessonId}`}
                        type="button"
                        onClick={() => {
                          onClose();
                          void openBookAtLesson(src.bookId, src.chapterId, src.lessonId);
                        }}
                        className="flex w-full items-center justify-between rounded-xl border border-subtle bg-surface px-3 py-2 text-left text-xs transition-colors hover:border-accent/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-primary">{src.bookTitle}</p>
                          <p className="truncate text-[10px] text-muted">
                            Cap {src.chapterNumber}: {src.lessonTitle}
                            {src.pageRef ? ` · pág. ${src.pageRef}` : ''}
                          </p>
                        </div>
                        <span className="ml-2 flex shrink-0 items-center gap-1 text-[10px] font-semibold text-accent">
                          <BookOpen size={11} /> Ir a lección
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {aiError && (
                <p className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">
                  {aiError}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer: Evaluación directa desde el diccionario */}
        {!activeEval && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle bg-surface/70 px-4 py-3">
            <button
              type="button"
              disabled={matchingExercises.length === 0}
              onClick={handleLaunchOfflineEval}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Zap size={13} />
              {matchingExercises.length > 0
                ? `Evaluarme offline (${matchingExercises.length} retos)`
                : 'Sin retos offline aún'}
            </button>

            <button
              type="button"
              disabled={isGeneratingAi}
              onClick={() => void handleGenerateAiEval('OUTPUT_PREDICTION')}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
              title="Genera un ejercicio nuevo verificado en Pyodide y lo guarda offline"
            >
              {isGeneratingAi ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              Generar reto IA
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

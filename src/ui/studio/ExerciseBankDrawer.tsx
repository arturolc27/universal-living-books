import { useEffect, useState } from 'react';
import { CheckCircle2, Layers, Loader2, Sparkles, Wand2, X, Zap } from 'lucide-react';
import { livingBooksDb, type ExerciseBankRecord } from '../../db/dexieDb';
import { usePlatformStore } from '../../store/usePlatformStore';
import {
  generateDynamicExercise,
  type DynamicExerciseMechanic,
} from '../../engine/compiler/dynamicExerciseGenerator';
import { matchCompetenciesFromText } from '../../data/pythonTaxonomy';
import { renderBlockWidget } from '../../registry/widgetRegistry';
import type { DeviceMode, MicroLesson } from '../../types/cartridge.types';
import { cn } from '../utils/cn';

const MECHANIC_OPTIONS: Array<{
  id: DynamicExerciseMechanic;
  label: string;
  mobileOk: boolean;
}> = [
  { id: 'OUTPUT_PREDICTION', label: 'Predicción', mobileOk: true },
  { id: 'PARSONS_PROBLEM', label: 'Parsons', mobileOk: true },
  { id: 'BUG_AUTOPSY', label: 'Bug Autopsy', mobileOk: true },
  { id: 'SYNTAX_CLOZE', label: 'Cloze', mobileOk: true },
  { id: 'CODE_LAB', label: 'Código Libre', mobileOk: false },
];

export function ExerciseBankDrawer({
  bookId,
  chapterId,
  lesson,
  deviceMode,
  onClose,
}: {
  bookId: string;
  chapterId: string;
  lesson: MicroLesson;
  deviceMode: DeviceMode;
  onClose: () => void;
}) {
  const settings = usePlatformStore((s) => s.settings);
  const preferredLanguage = usePlatformStore((s) => s.preferredLanguage);
  const recordLearningTelemetry = usePlatformStore((s) => s.recordLearningTelemetry);
  const refreshKnowledgeGraph = usePlatformStore((s) => s.refreshKnowledgeGraph);

  const [exercises, setExercises] = useState<ExerciseBankRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [solvedIds, setSolvedIds] = useState<Set<string>>(new Set());
  const [selectedMechanic, setSelectedMechanic] = useState<DynamicExerciseMechanic>('OUTPUT_PREDICTION');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!livingBooksDb.exerciseBank) return;
      const rows = await livingBooksDb.exerciseBank
        .where('lessonId')
        .equals(lesson.lessonId)
        .toArray()
        .catch(() => []);
      const filtered = rows.filter(
        (r) => r.bookId === bookId && (deviceMode === 'PC' || r.mobileFriendly)
      );
      if (!cancelled) {
        setExercises(filtered);
        if (filtered[0]) setSelectedId(filtered[0].exerciseId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, lesson.lessonId, deviceMode]);

  const active = exercises.find((e) => e.exerciseId === selectedId) ?? exercises[0] ?? null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const proseContext = lesson.blocks
        .filter((b) => b.type === 'PROSE')
        .map((b) => b.markdown)
        .join('\n\n');
      const comps =
        lesson.competencyIds && lesson.competencyIds.length > 0
          ? lesson.competencyIds
          : matchCompetenciesFromText([lesson.title, ...(lesson.learningObjectives ?? [])], 3);

      const created = await generateDynamicExercise(
        {
          bookId,
          chapterId,
          lessonId: lesson.lessonId,
          topicTitle: lesson.title,
          contextExcerpt: proseContext || lesson.sourceBookMarkdown || lesson.title,
          mechanic: selectedMechanic,
          competencyIds: comps,
          conceptKeys: [],
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
      setExercises((prev) => [created, ...prev]);
      setSelectedId(created.exerciseId);
      await refreshKnowledgeGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const availableMechanics = MECHANIC_OPTIONS.filter((m) => deviceMode === 'PC' || m.mobileOk);

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/65 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-subtle shadow-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-accent">
              <Layers size={11} /> Banco de Práctica Offline + Generador IA Verificado
            </p>
            <h3 className="truncate text-sm font-bold text-primary">{lesson.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-subtle p-1.5 text-muted hover:text-primary"
          >
            <X size={15} />
          </button>
        </div>

        {/* Barra de generación IA */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle bg-surface/70 px-4 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {availableMechanics.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMechanic(m.id)}
                className={cn(
                  'rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors',
                  selectedMechanic === m.id
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted hover:text-primary'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => void handleGenerate()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-canvas disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {isGenerating ? 'Verificando en Pyodide...' : 'Generar ejercicio IA'}
          </button>
        </div>

        {error && (
          <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-[11px] text-danger">
            {error}
          </div>
        )}

        {/* Selector de ejercicios del banco */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-subtle bg-canvas px-4 py-2">
          {exercises.map((ex, i) => {
            const isSelected = ex.exerciseId === active?.exerciseId;
            const isSolved = solvedIds.has(ex.exerciseId);
            return (
              <button
                key={ex.exerciseId}
                type="button"
                onClick={() => setSelectedId(ex.exerciseId)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-colors',
                  isSelected
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-subtle bg-surface text-muted hover:text-primary'
                )}
              >
                {isSolved ? (
                  <CheckCircle2 size={11} className="text-success" />
                ) : ex.origin === 'AI_GENERATED' ? (
                  <Sparkles size={11} className="text-secondary" />
                ) : (
                  <Zap size={10} />
                )}
                #{i + 1} {ex.blockType.replace('_', ' ')}
              </button>
            );
          })}
          {exercises.length === 0 && (
            <span className="text-[11px] text-muted">
              Pulsa "Generar ejercicio IA" para crear práctica adicional verificada en Pyodide.
            </span>
          )}
        </div>

        {/* Visor del ejercicio activo */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-2 sm:p-4">
          {active ? (
            renderBlockWidget(active.block, {
              deviceMode,
              onResolved: () => {
                setSolvedIds((prev) => new Set([...prev, active.exerciseId]));
                void recordLearningTelemetry({
                  bookId,
                  lessonId: lesson.lessonId,
                  blockId: active.block.blockId,
                  eventType: 'DICTIONARY_MICRO_EVAL',
                  competencyId: active.competencyIds[0],
                  passed: true,
                });
              },
            })
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">
              Selecciona o genera un ejercicio para practicar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

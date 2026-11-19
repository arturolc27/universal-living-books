import { Suspense, lazy, useMemo, useState } from 'react';
import {
  ChevronRight,
  FileCode2,
  FolderTree,
  Trophy,
  BookOpen,
  Layers,
  LayoutList,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { usePlatformStore, selectActiveCartridge, selectActiveLesson } from '../../store/usePlatformStore';
import { EditorialReader } from './EditorialReader';
import { VirtualFileDrawer } from './VirtualFileDrawer';
import { renderBlockWidget, isInteractiveBlock } from '../../registry/widgetRegistry';
import { MasteryPathMap } from '../gamification/MasteryPathMap';
import { Sm2FlashcardArena } from '../mobile/Sm2FlashcardArena';
import { CourseSyllabusOverview } from '../course/CourseSyllabusOverview';
import { classifyBlockStage, groupBlocksIntoStages } from '../../engine/course/courseStages';
import { cn } from '../utils/cn';

const CodeLabWorkspace = lazy(() =>
  import('../../registry/challenges/CodeLabWorkspace').then((m) => ({ default: m.CodeLabWorkspace }))
);
const AstStructuralChallenge = lazy(() =>
  import('../../registry/challenges/AstStructuralChallenge').then((m) => ({
    default: m.AstStructuralChallenge,
  }))
);

type RightPanelTab = 'CODELAB' | 'VFS' | 'SRS' | 'MAP';
type StudioView = 'SYLLABUS' | 'LESSON';

function ProgressRing({ value }: { value: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div className="relative h-10 w-10">
      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="var(--accent-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-primary">
        {value}%
      </span>
    </div>
  );
}

export function DesktopStudioShell() {
  const cartridge = usePlatformStore(selectActiveCartridge);
  const lesson = usePlatformStore(selectActiveLesson);
  const activeChapterId = usePlatformStore((s) => s.activeChapterId);
  const unlockedBlockIndex = usePlatformStore((s) => s.unlockedBlockIndex);
  const selectLesson = usePlatformStore((s) => s.selectLesson);
  const advanceUnlockedBlock = usePlatformStore((s) => s.advanceUnlockedBlock);
  const resolvePcLab = usePlatformStore((s) => s.resolvePcLab);
  const [rightTab, setRightTab] = useState<RightPanelTab>('CODELAB');
  const [studioView, setStudioView] = useState<StudioView>('LESSON');

  const chapter = cartridge?.chapters.find((c) => c.chapterId === activeChapterId) ?? cartridge?.chapters[0];

  const stageGroups = useMemo(
    () => (lesson ? groupBlocksIntoStages(lesson) : []),
    [lesson]
  );

  if (!cartridge || !lesson || !chapter) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted">
        Cargando curso...
      </div>
    );
  }

  const currentBlock = lesson.blocks[unlockedBlockIndex];
  const currentStageId = currentBlock ? classifyBlockStage(currentBlock.type) : 'FOUNDATION';
  const progressPct = Math.round(((unlockedBlockIndex + 1) / lesson.blocks.length) * 100);

  const handleBlockResolved = () => {
    if (currentBlock && (currentBlock.type === 'CODE_LAB' || currentBlock.type === 'AST_CHALLENGE')) {
      resolvePcLab(cartridge.bookId, lesson.lessonId, currentBlock.blockId);
    }
    if (currentBlock?.gatesNextBlock && unlockedBlockIndex < lesson.blocks.length - 1) {
      void advanceUnlockedBlock(unlockedBlockIndex + 1);
    }
  };

  const rightPanelTabs: Array<{ id: RightPanelTab; label: string; icon: typeof FileCode2 }> = [
    { id: 'CODELAB', label: 'CodeLab', icon: FileCode2 },
    { id: 'VFS', label: 'VFS', icon: FolderTree },
    { id: 'SRS', label: 'SM-2', icon: Trophy },
    { id: 'MAP', label: 'Mapa', icon: BookOpen },
  ];

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-3 border-b border-subtle bg-surface/40 px-4 py-2">
        <button
          type="button"
          onClick={() => setStudioView((v) => (v === 'SYLLABUS' ? 'LESSON' : 'SYLLABUS'))}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
            studioView === 'SYLLABUS'
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-subtle text-secondary hover:border-accent/50'
          )}
        >
          <LayoutList size={12} />
          {studioView === 'SYLLABUS' ? 'Volver a la lección' : 'Temario del curso'}
        </button>

        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate">{cartridge.metadata.title}</span>
          <ChevronRight size={11} />
          <span className="truncate">Módulo {chapter.number}</span>
          <ChevronRight size={11} />
          <span className="truncate font-medium text-primary">{lesson.title}</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[10px] text-muted lg:block">
            Paso {unlockedBlockIndex + 1} de {lesson.blocks.length}
          </span>
          <ProgressRing value={progressPct} />
        </div>
      </div>

      {studioView === 'SYLLABUS' ? (
        <div className="min-h-0 flex-1">
          <CourseSyllabusOverview onEnterLesson={() => setStudioView('LESSON')} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="w-56 shrink-0 overflow-y-auto border-r border-subtle bg-surface/60 p-2">
            {cartridge.chapters.map((ch) => (
              <div key={ch.chapterId} className="mb-2">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Módulo {ch.number}
                </p>
                {ch.microLessons.map((ml) => (
                  <button
                    key={ml.lessonId}
                    type="button"
                    onClick={() => selectLesson(ch.chapterId, ml.lessonId)}
                    className={cn(
                      'flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
                      ml.lessonId === lesson.lessonId
                        ? 'bg-accent/15 text-accent'
                        : 'text-muted hover:bg-elevated hover:text-primary'
                    )}
                  >
                    <ChevronRight size={11} />
                    <span className="truncate">{ml.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <section className="flex w-[34%] min-w-[18rem] flex-col border-r border-subtle">
            <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <BookOpen size={11} /> Contenido del Curso
              </span>
              {unlockedBlockIndex < lesson.blocks.length - 1 && !currentBlock?.gatesNextBlock && (
                <button
                  type="button"
                  onClick={() => void advanceUnlockedBlock(unlockedBlockIndex + 1)}
                  className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/25"
                >
                  Siguiente paso <ArrowRight size={10} />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <EditorialReader
                cartridge={cartridge}
                blocks={lesson.blocks}
                unlockedBlockIndex={unlockedBlockIndex}
                learningObjectives={lesson.learningObjectives}
                takeaways={lesson.takeaways}
              />
            </div>
          </section>

          <section className="flex min-w-0 flex-1 flex-col border-r border-subtle">
            {/* Rail de Etapas Pedagógicas del Curso */}
            <div className="flex items-center gap-1 overflow-x-auto border-b border-subtle px-2 py-1.5">
              {stageGroups.map((group) => {
                const isActiveStage = group.stage.id === currentStageId;
                const firstIdx = group.blockIndices[0];
                const lastIdx = group.blockIndices[group.blockIndices.length - 1];
                const isStageCompleted = unlockedBlockIndex > lastIdx;

                return (
                  <button
                    key={group.stage.id}
                    type="button"
                    onClick={() => {
                      if (firstIdx <= unlockedBlockIndex) {
                        void advanceUnlockedBlock(firstIdx);
                      }
                    }}
                    disabled={firstIdx > unlockedBlockIndex}
                    title={group.stage.description}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40',
                      isActiveStage
                        ? 'bg-accent/15 text-accent'
                        : isStageCompleted
                          ? 'text-success hover:bg-success/10'
                          : 'text-muted hover:text-primary'
                    )}
                  >
                    {isStageCompleted && <CheckCircle2 size={11} />}
                    {group.stage.shortLabel}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {currentBlock && isInteractiveBlock(currentBlock) ? (
                renderBlockWidget(currentBlock, { onResolved: handleBlockResolved, deviceMode: 'PC' })
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <Layers size={24} className="text-accent" />
                  <p className="text-xs font-medium text-primary">Etapa de Fundamento</p>
                  <p className="max-w-xs text-[11px] text-muted">
                    Lee el concepto en el panel izquierdo y avanza al siguiente paso para activar el
                    modelo mental o la práctica.
                  </p>
                  {unlockedBlockIndex < lesson.blocks.length - 1 && (
                    <button
                      type="button"
                      onClick={() => void advanceUnlockedBlock(unlockedBlockIndex + 1)}
                      className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-canvas"
                    >
                      Continuar <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="flex w-[32%] min-w-[20rem] flex-col">
            <div className="flex items-center gap-1 border-b border-subtle px-2 py-1.5">
              {rightPanelTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                    rightTab === tab.id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-primary'
                  )}
                >
                  <tab.icon size={12} /> {tab.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {rightTab === 'CODELAB' &&
                (currentBlock?.type === 'CODE_LAB' ? (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center p-6">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-subtle border-t-accent" />
                      </div>
                    }
                  >
                    <CodeLabWorkspace block={currentBlock} />
                  </Suspense>
                ) : currentBlock?.type === 'AST_CHALLENGE' ? (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center p-6">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-subtle border-t-accent" />
                      </div>
                    }
                  >
                    <AstStructuralChallenge block={currentBlock} />
                  </Suspense>
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
                    Selecciona un laboratorio de codigo para abrir Monaco y Pyodide.
                  </div>
                ))}
              {rightTab === 'VFS' && <VirtualFileDrawer />}
              {rightTab === 'SRS' && <Sm2FlashcardArena />}
              {rightTab === 'MAP' && <MasteryPathMap />}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

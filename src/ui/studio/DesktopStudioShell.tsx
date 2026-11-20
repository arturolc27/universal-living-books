import { Suspense, lazy, useMemo, useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  FileCode2,
  FolderTree,
  Trophy,
  BookOpen,
  LayoutList,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Languages,
  Loader2,
  Sparkles,
  CircleDot,
  Lock,
} from 'lucide-react';
import {
  usePlatformStore,
  selectActiveCartridge,
  selectActiveLesson,
  computeLessonMasteryTier,
} from '../../store/usePlatformStore';
import { EditorialReader } from './EditorialReader';
import { VirtualFileDrawer } from './VirtualFileDrawer';
import { renderBlockWidget, isInteractiveBlock } from '../../registry/widgetRegistry';
import { MasteryPathMap } from '../gamification/MasteryPathMap';
import { Sm2FlashcardArena } from '../mobile/Sm2FlashcardArena';
import { CourseSyllabusOverview } from '../course/CourseSyllabusOverview';
import { classifyBlockStage, groupBlocksIntoStages } from '../../engine/course/courseStages';
import type { CodeLabBlock } from '../../types/cartridge.types';
import { cn } from '../utils/cn';

const CodeLabWorkspace = lazy(() =>
  import('../../registry/challenges/CodeLabWorkspace').then((m) => ({ default: m.CodeLabWorkspace }))
);

type WorkspaceTab = 'ACTIVITY' | 'SANDBOX' | 'VFS' | 'SRS' | 'MAP';
type StudioView = 'SYLLABUS' | 'LESSON';

function ProgressRing({ value }: { value: number }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div className="relative h-9 w-9 shrink-0">
      <svg className="h-9 w-9 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
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
  const activeBlockIndex = usePlatformStore((s) => s.activeBlockIndex);
  const unlockedBlockIndex = usePlatformStore((s) => s.unlockedBlockIndex);
  const lessonProgressMap = usePlatformStore((s) => s.lessonProgressMap);
  const preferredLanguage = usePlatformStore((s) => s.preferredLanguage);
  const isTranslatingLesson = usePlatformStore((s) => s.isTranslatingLesson);
  const setStudyLanguage = usePlatformStore((s) => s.setStudyLanguage);
  const setSandboxCodeRequest = usePlatformStore((s) => s.setSandboxCodeRequest);
  const selectLesson = usePlatformStore((s) => s.selectLesson);
  const goToNextLesson = usePlatformStore((s) => s.goToNextLesson);
  const setActiveBlockIndex = usePlatformStore((s) => s.setActiveBlockIndex);
  const advanceUnlockedBlock = usePlatformStore((s) => s.advanceUnlockedBlock);
  const resolvePcLab = usePlatformStore((s) => s.resolvePcLab);

  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('ACTIVITY');
  const [studioView, setStudioView] = useState<StudioView>('LESSON');
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const safeActiveIdx = Math.max(0, Math.min(activeBlockIndex, lesson.blocks.length - 1));
  const currentBlock = lesson.blocks[safeActiveIdx];
  const currentStageId = currentBlock ? classifyBlockStage(currentBlock.type) : 'FOUNDATION';
  const progressPct = Math.round(((unlockedBlockIndex + 1) / lesson.blocks.length) * 100);
  const isAtEndOfLesson = safeActiveIdx >= lesson.blocks.length - 1;

  const sandboxBlock: CodeLabBlock = {
    blockId: `sandbox-${lesson.lessonId}`,
    type: 'CODE_LAB',
    title: `Sandbox Python — ${lesson.title}`,
    instructions: 'Experimenta libremente con los ejemplos de esta leccion o pulsa Trace para ver la memoria en vivo.',
    scaffoldMode: 'FREE_SANDBOX',
    starterCode: `# Sandbox interactivo: ${lesson.title}\nprint("Hola desde Python WASM!")\n`,
    unitTestCode: '',
  };

  const handleAdvanceStep = () => {
    if (safeActiveIdx < unlockedBlockIndex) {
      setActiveBlockIndex(safeActiveIdx + 1);
    } else if (safeActiveIdx < lesson.blocks.length - 1) {
      void advanceUnlockedBlock(safeActiveIdx + 1);
    }
  };

  const handleBlockResolved = () => {
    if (currentBlock && (currentBlock.type === 'CODE_LAB' || currentBlock.type === 'AST_CHALLENGE')) {
      resolvePcLab(cartridge.bookId, lesson.lessonId, currentBlock.blockId);
    }
    if (safeActiveIdx < lesson.blocks.length - 1) {
      void advanceUnlockedBlock(safeActiveIdx + 1);
    }
  };

  const handleTrySnippet = (code: string) => {
    setSandboxCodeRequest(code);
    setWorkspaceTab('SANDBOX');
  };

  const workspaceTabs: Array<{ id: WorkspaceTab; label: string; icon: typeof Sparkles }> = [
    { id: 'ACTIVITY', label: 'Actividad', icon: Sparkles },
    { id: 'SANDBOX', label: 'Sandbox Python', icon: FileCode2 },
    { id: 'VFS', label: 'Archivos VFS', icon: FolderTree },
    { id: 'SRS', label: 'SM-2', icon: Trophy },
    { id: 'MAP', label: 'Mapa', icon: BookOpen },
  ];

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Barra de Curso */}
      <div className="flex items-center gap-2 border-b border-subtle bg-surface/50 px-3 py-2">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="rounded-lg border border-subtle p-1.5 text-muted hover:text-primary"
          title={sidebarOpen ? 'Ocultar temario lateral' : 'Mostrar temario lateral'}
        >
          {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>

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
          {studioView === 'SYLLABUS' ? 'Volver a la lección' : 'Temario'}
        </button>

        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate">{cartridge.metadata.title}</span>
          <ChevronRight size={11} className="shrink-0" />
          <span className="shrink-0">Módulo {chapter.number}</span>
          <ChevronRight size={11} className="shrink-0" />
          <span className="truncate font-medium text-primary">{lesson.title}</span>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          {/* Selector Bilingüe ES / EN con caché local */}
          <div className="flex items-center gap-0.5 rounded-lg border border-subtle bg-canvas p-0.5">
            <Languages size={12} className="mx-1.5 text-muted" />
            {(['es', 'en'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                disabled={isTranslatingLesson}
                onClick={() => void setStudyLanguage(lang)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase transition-colors',
                  preferredLanguage === lang
                    ? 'bg-accent text-canvas'
                    : 'text-muted hover:text-primary'
                )}
              >
                {isTranslatingLesson && preferredLanguage === lang ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  lang
                )}
              </button>
            ))}
          </div>

          <span className="hidden text-[10px] text-muted lg:block">
            Paso {safeActiveIdx + 1} de {lesson.blocks.length}
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
          {/* Sidebar Colapsable de Módulos */}
          {sidebarOpen && (
            <aside className="w-60 shrink-0 overflow-y-auto border-r border-subtle bg-surface/60 p-2.5">
              {cartridge.chapters.map((ch) => (
                <div key={ch.chapterId} className="mb-3">
                  <p className="mb-1 truncate px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Módulo {ch.number}: {ch.title}
                  </p>
                  <div className="space-y-0.5">
                    {ch.microLessons.map((ml) => {
                      const prog = lessonProgressMap[`${cartridge.bookId}::${ml.lessonId}`];
                      const tier = computeLessonMasteryTier(prog, ml.blocks.length);
                      const isCurrent = ml.lessonId === lesson.lessonId;
                      return (
                        <button
                          key={ml.lessonId}
                          type="button"
                          onClick={() => {
                            setWorkspaceTab('ACTIVITY');
                            void selectLesson(ch.chapterId, ml.lessonId);
                          }}
                          className={cn(
                            'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
                            isCurrent
                              ? 'bg-accent/15 font-medium text-accent'
                              : 'text-muted hover:bg-elevated hover:text-primary'
                          )}
                        >
                          {tier === 'GOLD' || tier === 'SILVER' ? (
                            <CheckCircle2 size={11} className="shrink-0 text-success" />
                          ) : tier === 'IN_PROGRESS' || isCurrent ? (
                            <CircleDot size={11} className="shrink-0 text-accent" />
                          ) : (
                            <Lock size={10} className="shrink-0 opacity-50" />
                          )}
                          <span className="truncate">{ml.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </aside>
          )}

          {/* Panel 1 (46%): Lector Editorial Vivo + Navegación fija */}
          <section className="flex w-[46%] min-w-[20rem] flex-col border-r border-subtle">
            <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <BookOpen size={11} /> Lección: {lesson.title}
              </span>
              <span className="text-[10px] text-muted">{lesson.estimatedMinutes} min</span>
            </div>

            <div className="min-h-0 flex-1">
              <EditorialReader
                cartridge={cartridge}
                blocks={lesson.blocks}
                unlockedBlockIndex={unlockedBlockIndex}
                learningObjectives={lesson.learningObjectives}
                takeaways={lesson.takeaways}
                onTryCode={handleTrySnippet}
              />
            </div>

            {/* Barra de Progresión Fija */}
            <div className="flex items-center justify-between gap-2 border-t border-subtle bg-surface/60 px-3 py-2">
              <button
                type="button"
                disabled={safeActiveIdx === 0}
                onClick={() => setActiveBlockIndex(safeActiveIdx - 1)}
                className="flex items-center gap-1 rounded-lg border border-subtle px-2.5 py-1.5 text-xs text-primary hover:border-accent/50 disabled:opacity-40"
              >
                <ArrowLeft size={13} /> Anterior
              </button>

              <span className="text-[11px] font-medium text-muted">
                Paso {safeActiveIdx + 1} / {lesson.blocks.length}
              </span>

              {!isAtEndOfLesson ? (
                <button
                  type="button"
                  onClick={handleAdvanceStep}
                  className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-canvas"
                >
                  Siguiente <ArrowRight size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void goToNextLesson()}
                  className="flex items-center gap-1 rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-canvas"
                >
                  Siguiente lección <ChevronLeft size={13} className="rotate-180" />
                </button>
              )}
            </div>
          </section>

          {/* Panel 2 (54%): Workspace Contextual Unificado */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-3 py-1.5">
              {/* Rail de Etapas Pedagógicas */}
              <div className="flex items-center gap-1 overflow-x-auto">
                {stageGroups.map((group) => {
                  const isActiveStage = group.stage.id === currentStageId && workspaceTab === 'ACTIVITY';
                  const firstIdx = group.blockIndices[0];
                  const lastIdx = group.blockIndices[group.blockIndices.length - 1];
                  const isStageCompleted = unlockedBlockIndex > lastIdx;

                  return (
                    <button
                      key={group.stage.id}
                      type="button"
                      onClick={() => {
                        setWorkspaceTab('ACTIVITY');
                        if (firstIdx <= unlockedBlockIndex) {
                          setActiveBlockIndex(firstIdx);
                        }
                      }}
                      disabled={firstIdx > unlockedBlockIndex}
                      title={group.stage.description}
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40',
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

              {/* Pestañas de Herramientas */}
              <div className="flex items-center gap-1">
                {workspaceTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setWorkspaceTab(tab.id)}
                    className={cn(
                      'flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors',
                      workspaceTab === tab.id
                        ? 'bg-accent/15 text-accent'
                        : 'text-muted hover:text-primary'
                    )}
                  >
                    <tab.icon size={12} />
                    <span className="hidden xl:inline">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {workspaceTab === 'ACTIVITY' &&
                (currentBlock && isInteractiveBlock(currentBlock) ? (
                  renderBlockWidget(currentBlock, { onResolved: handleBlockResolved, deviceMode: 'PC' })
                ) : (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center p-6">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-subtle border-t-accent" />
                      </div>
                    }
                  >
                    <CodeLabWorkspace block={sandboxBlock} />
                  </Suspense>
                ))}
              {workspaceTab === 'SANDBOX' && (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center p-6">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-subtle border-t-accent" />
                    </div>
                  }
                >
                  <CodeLabWorkspace block={sandboxBlock} />
                </Suspense>
              )}
              {workspaceTab === 'VFS' && <VirtualFileDrawer />}
              {workspaceTab === 'SRS' && <Sm2FlashcardArena />}
              {workspaceTab === 'MAP' && <MasteryPathMap />}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

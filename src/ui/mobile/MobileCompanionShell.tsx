import { useState } from 'react';
import {
  BookOpen,
  Zap,
  Trophy,
  Map,
  ArrowLeft,
  ArrowRight,
  LayoutList,
  Clock,
  Globe,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { usePlatformStore, selectActiveCartridge, selectActiveLesson } from '../../store/usePlatformStore';
import { EditorialReader } from '../studio/EditorialReader';
import { renderBlockWidget, isInteractiveBlock } from '../../registry/widgetRegistry';
import { Sm2FlashcardArena } from './Sm2FlashcardArena';
import { MasteryPathMap } from '../gamification/MasteryPathMap';
import { CourseSyllabusOverview } from '../course/CourseSyllabusOverview';
import { cn } from '../utils/cn';

export function MobileCompanionShell() {
  const cartridge = usePlatformStore(selectActiveCartridge);
  const lesson = usePlatformStore(selectActiveLesson);
  const mobileTab = usePlatformStore((s) => s.mobileTab);
  const setMobileTab = usePlatformStore((s) => s.setMobileTab);
  const activeBlockIndex = usePlatformStore((s) => s.activeBlockIndex);
  const setActiveBlockIndex = usePlatformStore((s) => s.setActiveBlockIndex);
  const unlockedBlockIndex = usePlatformStore((s) => s.unlockedBlockIndex);
  const advanceUnlockedBlock = usePlatformStore((s) => s.advanceUnlockedBlock);
  const goToNextLesson = usePlatformStore((s) => s.goToNextLesson);
  const preferredLanguage = usePlatformStore((s) => s.preferredLanguage);
  const isTranslatingLesson = usePlatformStore((s) => s.isTranslatingLesson);
  const setStudyLanguage = usePlatformStore((s) => s.setStudyLanguage);
  const [showSyllabus, setShowSyllabus] = useState(false);

  if (!cartridge || !lesson) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted">
        Cargando curso...
      </div>
    );
  }

  const totalBlocks = lesson.blocks.length;
  const maxIndex = Math.max(0, totalBlocks - 1);
  const safeActiveIndex = Math.min(activeBlockIndex, maxIndex);
  const currentBlock = lesson.blocks[safeActiveIndex];
  const isInteractive = Boolean(currentBlock && isInteractiveBlock(currentBlock));
  const isLastBlock = safeActiveIndex >= maxIndex;

  const handleResolved = () => {
    if (!isLastBlock) {
      if (safeActiveIndex >= unlockedBlockIndex) {
        void advanceUnlockedBlock(safeActiveIndex + 1);
      } else {
        setActiveBlockIndex(safeActiveIndex + 1);
      }
      const nextBlock = lesson.blocks[safeActiveIndex + 1];
      if (nextBlock && !isInteractiveBlock(nextBlock)) {
        setMobileTab('READ');
      }
    } else {
      void advanceUnlockedBlock(totalBlocks);
    }
  };

  const handlePrevStep = () => {
    if (safeActiveIndex > 0) {
      setActiveBlockIndex(safeActiveIndex - 1);
    }
  };

  const handleNextStep = () => {
    if (safeActiveIndex < unlockedBlockIndex && !isLastBlock) {
      const nextIdx = safeActiveIndex + 1;
      setActiveBlockIndex(nextIdx);
      const nextBlock = lesson.blocks[nextIdx];
      if (nextBlock && isInteractiveBlock(nextBlock)) {
        setMobileTab('PRACTICE');
      }
      return;
    }
    if (isInteractive && safeActiveIndex >= unlockedBlockIndex) {
      setMobileTab('PRACTICE');
      return;
    }
    if (!isLastBlock) {
      void advanceUnlockedBlock(safeActiveIndex + 1);
      const nextBlock = lesson.blocks[safeActiveIndex + 1];
      if (nextBlock && isInteractiveBlock(nextBlock)) {
        setMobileTab('PRACTICE');
      }
    } else {
      void goToNextLesson();
    }
  };

  const tabs = [
    { id: 'READ' as const, label: 'Leer', icon: BookOpen },
    { id: 'PRACTICE' as const, label: 'Práctica', icon: Zap },
    { id: 'SRS' as const, label: 'SM-2', icon: Trophy },
    { id: 'MAP' as const, label: 'Mapa', icon: Map },
  ];

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-2 border-b border-subtle bg-surface/40 px-3 py-2">
        <button
          type="button"
          onClick={() => setShowSyllabus((v) => !v)}
          className={cn(
            'shrink-0 rounded-lg border p-1.5 transition-colors',
            showSyllabus ? 'border-accent bg-accent/15 text-accent' : 'border-subtle text-muted'
          )}
          title="Temario del curso"
        >
          <LayoutList size={15} />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-primary">{lesson.title}</p>
          <p className="text-[10px] text-muted">
            Paso {totalBlocks > 0 ? safeActiveIndex + 1 : 0} de {totalBlocks} • Móvil
          </p>
        </div>

        <button
          type="button"
          onClick={() => void setStudyLanguage(preferredLanguage === 'es' ? 'en' : 'es')}
          disabled={isTranslatingLesson}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-subtle bg-canvas px-2 py-1 text-[10px] font-semibold uppercase text-primary transition-colors hover:border-accent disabled:opacity-60"
          title="Cambiar idioma de estudio (traducción bajo demanda con caché local)"
        >
          {isTranslatingLesson ? <Loader2 size={11} className="animate-spin text-accent" /> : <Globe size={11} className="text-accent" />}
          {preferredLanguage.toUpperCase()}
        </button>

        <button
          type="button"
          onClick={() => {
            setShowSyllabus(false);
            setMobileTab('SRS');
          }}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent"
          title="Sesión rápida de 5 minutos (SM-2)"
        >
          <Clock size={11} /> 5 min
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {showSyllabus ? (
          <CourseSyllabusOverview onEnterLesson={() => setShowSyllabus(false)} />
        ) : (
          <>
            {mobileTab === 'READ' && (
              <div className="flex h-full flex-col">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <EditorialReader
                    cartridge={cartridge}
                    blocks={lesson.blocks}
                    unlockedBlockIndex={Math.max(unlockedBlockIndex, safeActiveIndex)}
                    learningObjectives={lesson.learningObjectives}
                    takeaways={lesson.takeaways}
                    sourceBookMarkdown={lesson.sourceBookMarkdown}
                    sourcePageRange={lesson.sourcePageRange}
                    onRecompileBook={() => usePlatformStore.getState().setCompilerOpen(true)}
                  />
                </div>
                <div className="flex items-center gap-2 border-t border-subtle bg-surface/60 px-3 py-2">
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    disabled={safeActiveIndex <= 0}
                    className="flex items-center justify-center gap-1 rounded-xl border border-subtle bg-canvas px-3 py-2 text-xs font-medium text-primary disabled:opacity-40"
                  >
                    <ArrowLeft size={13} /> Anterior
                  </button>
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent py-2 text-xs font-semibold text-canvas"
                  >
                    {isInteractive && safeActiveIndex >= unlockedBlockIndex ? (
                      <>
                        Ir al reto interactivo <Zap size={13} />
                      </>
                    ) : isLastBlock ? (
                      <>
                        Siguiente lección <CheckCircle2 size={13} />
                      </>
                    ) : (
                      <>
                        Siguiente paso <ArrowRight size={13} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            {mobileTab === 'PRACTICE' && (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {isInteractive && currentBlock ? (
                    renderBlockWidget(currentBlock, {
                      onResolved: handleResolved,
                      deviceMode: 'MOBILE',
                    })
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                      <Zap size={22} className="text-muted" />
                      <p className="text-xs text-muted">
                        Este paso es de lectura conceptual. Avanza para continuar con la lección o el siguiente reto.
                      </p>
                      <button
                        type="button"
                        onClick={handleNextStep}
                        className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-canvas"
                      >
                        {isLastBlock ? 'Siguiente lección' : 'Continuar'} <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {isLastBlock && unlockedBlockIndex >= totalBlocks && (
                  <div className="border-t border-subtle bg-surface/60 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void goToNextLesson()}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-success py-2 text-xs font-semibold text-canvas"
                    >
                      Lección completada • Siguiente lección <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {mobileTab === 'SRS' && <Sm2FlashcardArena />}
            {mobileTab === 'MAP' && <MasteryPathMap />}
          </>
        )}
      </div>

      <nav
        className="glass flex items-center justify-around border-t border-subtle pt-1.5"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setShowSyllabus(false);
              setMobileTab(tab.id);
            }}
            className={cn(
              'flex min-h-[44px] min-w-[64px] flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-medium transition-colors',
              !showSyllabus && mobileTab === tab.id ? 'bg-accent/15 text-accent' : 'text-muted'
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

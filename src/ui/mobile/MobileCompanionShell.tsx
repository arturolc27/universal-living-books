import { useState } from 'react';
import { BookOpen, Zap, Trophy, Map, ArrowRight, LayoutList, Clock } from 'lucide-react';
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
  const unlockedBlockIndex = usePlatformStore((s) => s.unlockedBlockIndex);
  const advanceUnlockedBlock = usePlatformStore((s) => s.advanceUnlockedBlock);
  const [showSyllabus, setShowSyllabus] = useState(false);

  if (!cartridge || !lesson) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted">
        Cargando curso...
      </div>
    );
  }

  const currentBlock = lesson.blocks[unlockedBlockIndex];

  const handleResolved = () => {
    if (unlockedBlockIndex < lesson.blocks.length - 1) {
      void advanceUnlockedBlock(unlockedBlockIndex + 1);
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
            'rounded-lg border p-1.5 transition-colors',
            showSyllabus ? 'border-accent bg-accent/15 text-accent' : 'border-subtle text-muted'
          )}
          title="Temario del curso"
        >
          <LayoutList size={15} />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-primary">{lesson.title}</p>
          <p className="text-[10px] text-muted">
            Paso {unlockedBlockIndex + 1} de {lesson.blocks.length} • Modo Móvil
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowSyllabus(false);
            setMobileTab('SRS');
          }}
          className="flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent"
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
                    unlockedBlockIndex={unlockedBlockIndex}
                    learningObjectives={lesson.learningObjectives}
                    takeaways={lesson.takeaways}
                  />
                </div>
                {unlockedBlockIndex < lesson.blocks.length - 1 && (
                  <div className="border-t border-subtle bg-surface/60 px-4 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (currentBlock && isInteractiveBlock(currentBlock)) {
                          setMobileTab('PRACTICE');
                        } else {
                          void advanceUnlockedBlock(unlockedBlockIndex + 1);
                        }
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2 text-xs font-semibold text-canvas"
                    >
                      {currentBlock && isInteractiveBlock(currentBlock)
                        ? 'Ir al reto interactivo'
                        : 'Siguiente concepto'}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {mobileTab === 'PRACTICE' && (
              <div className="h-full overflow-hidden">
                {currentBlock && isInteractiveBlock(currentBlock) ? (
                  renderBlockWidget(currentBlock, {
                    onResolved: handleResolved,
                    deviceMode: 'MOBILE',
                  })
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <Zap size={22} className="text-muted" />
                    <p className="text-xs text-muted">
                      Este paso es de lectura conceptual. Avanza para desbloquear el siguiente reto.
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
            )}
            {mobileTab === 'SRS' && <Sm2FlashcardArena />}
            {mobileTab === 'MAP' && <MasteryPathMap />}
          </>
        )}
      </div>

      <nav className="glass flex items-center justify-around border-t border-subtle py-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setShowSyllabus(false);
              setMobileTab(tab.id);
            }}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-[10px] transition-colors',
              !showSyllabus && mobileTab === tab.id ? 'bg-accent/15 text-accent' : 'text-muted'
            )}
          >
            <tab.icon size={17} />
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

import { useState } from 'react';
import { ChevronRight, Brain, Table2, Film, FileCode2, FolderTree, Trophy, BookOpen, Layers } from 'lucide-react';
import { usePlatformStore, selectActiveCartridge, selectActiveLesson } from '../../store/usePlatformStore';
import { EditorialReader } from './EditorialReader';
import { VirtualFileDrawer } from './VirtualFileDrawer';
import { renderBlockWidget, isInteractiveBlock } from '../../registry/widgetRegistry';
import { CodeLabWorkspace } from '../../registry/challenges/CodeLabWorkspace';
import { AstStructuralChallenge } from '../../registry/challenges/AstStructuralChallenge';
import { MasteryPathMap } from '../gamification/MasteryPathMap';
import { Sm2FlashcardArena } from '../mobile/Sm2FlashcardArena';
import { cn } from '../utils/cn';

type RightPanelTab = 'CODELAB' | 'VFS' | 'SRS' | 'MAP';

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
  const studioTab = usePlatformStore((s) => s.studioTab);
  const setStudioTab = usePlatformStore((s) => s.setStudioTab);
  const selectLesson = usePlatformStore((s) => s.selectLesson);
  const advanceUnlockedBlock = usePlatformStore((s) => s.advanceUnlockedBlock);
  const [rightTab, setRightTab] = useState<RightPanelTab>('CODELAB');

  const chapter = cartridge?.chapters.find((c) => c.chapterId === activeChapterId) ?? cartridge?.chapters[0];

  if (!cartridge || !lesson || !chapter) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted">
        Cargando libro...
      </div>
    );
  }

  const currentBlock = lesson.blocks[unlockedBlockIndex];
  const progressPct = Math.round(((unlockedBlockIndex + 1) / lesson.blocks.length) * 100);

  const handleBlockResolved = () => {
    if (currentBlock?.gatesNextBlock && unlockedBlockIndex < lesson.blocks.length - 1) {
      advanceUnlockedBlock(unlockedBlockIndex + 1);
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
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span className="truncate">{cartridge.metadata.title}</span>
          <ChevronRight size={11} />
          <span className="truncate">Cap {chapter.number}</span>
          <ChevronRight size={11} />
          <span className="truncate font-medium text-primary">{lesson.title}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[10px] text-muted lg:block">
            Bloque {unlockedBlockIndex + 1} de {lesson.blocks.length}
          </span>
          <ProgressRing value={progressPct} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-subtle bg-surface/60 p-2">
          {cartridge.chapters.map((ch) => (
            <div key={ch.chapterId} className="mb-2">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Cap {ch.number}
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
              <BookOpen size={11} /> Editorial Vivo
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <EditorialReader cartridge={cartridge} blocks={lesson.blocks} unlockedBlockIndex={unlockedBlockIndex} />
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col border-r border-subtle">
          <div className="flex items-center gap-1 border-b border-subtle px-2 py-1.5">
            {([
              { id: 'MEMORY', label: 'Memoria', icon: Brain },
              { id: 'DATA', label: 'Datos', icon: Table2 },
              { id: 'GPU', label: 'GPU', icon: Film },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStudioTab(tab.id)}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                  studioTab === tab.id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-primary'
                )}
              >
                <tab.icon size={12} /> {tab.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {currentBlock && isInteractiveBlock(currentBlock) ? (
              renderBlockWidget(currentBlock, { onResolved: handleBlockResolved })
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <Layers size={22} className="text-muted" />
                <p className="text-xs text-muted">
                  Este bloque es de lectura. Avanza en el panel editorial.
                </p>
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
                <CodeLabWorkspace block={currentBlock} />
              ) : currentBlock?.type === 'AST_CHALLENGE' ? (
                <AstStructuralChallenge block={currentBlock} />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
                  Selecciona un bloque CODE_LAB o AST_CHALLENGE para usar el laboratorio.
                </div>
              ))}
            {rightTab === 'VFS' && <VirtualFileDrawer />}
            {rightTab === 'SRS' && <Sm2FlashcardArena />}
            {rightTab === 'MAP' && <MasteryPathMap />}
          </div>
        </section>
      </div>
    </div>
  );
}

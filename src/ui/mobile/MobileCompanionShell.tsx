import { BookOpen, Zap, Trophy, Map, ChevronRight } from 'lucide-react';
import { usePlatformStore, selectActiveCartridge, selectActiveLesson } from '../../store/usePlatformStore';
import { EditorialReader } from '../studio/EditorialReader';
import { renderBlockWidget, isInteractiveBlock } from '../../registry/widgetRegistry';
import { Sm2FlashcardArena } from './Sm2FlashcardArena';
import { MasteryPathMap } from '../gamification/MasteryPathMap';
import { cn } from '../utils/cn';

export function MobileCompanionShell() {
  const cartridge = usePlatformStore(selectActiveCartridge);
  const lesson = usePlatformStore(selectActiveLesson);
  const mobileTab = usePlatformStore((s) => s.mobileTab);
  const setMobileTab = usePlatformStore((s) => s.setMobileTab);
  const unlockedBlockIndex = usePlatformStore((s) => s.unlockedBlockIndex);
  const advanceUnlockedBlock = usePlatformStore((s) => s.advanceUnlockedBlock);

  if (!cartridge || !lesson) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted">
        Cargando libro...
      </div>
    );
  }

  const currentBlock = lesson.blocks[unlockedBlockIndex];

  const handleResolved = () => {
    if (currentBlock?.gatesNextBlock && unlockedBlockIndex < lesson.blocks.length - 1) {
      advanceUnlockedBlock(unlockedBlockIndex + 1);
    }
  };

  const tabs = [
    { id: 'READ' as const, label: 'Leer', icon: BookOpen },
    { id: 'PRACTICE' as const, label: 'Practica', icon: Zap },
    { id: 'SRS' as const, label: 'SM-2', icon: Trophy },
    { id: 'MAP' as const, label: 'Mapa', icon: Map },
  ];

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-2 border-b border-subtle bg-surface/40 px-4 py-2">
        <span className="text-sm">{cartridge.metadata.coverAccentIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-primary">{lesson.title}</p>
          <p className="text-[10px] text-muted">
            Bloque {unlockedBlockIndex + 1} de {lesson.blocks.length}
          </p>
        </div>
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.round(((unlockedBlockIndex + 1) / lesson.blocks.length) * 100)}%` }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mobileTab === 'READ' && (
          <EditorialReader cartridge={cartridge} blocks={lesson.blocks} unlockedBlockIndex={unlockedBlockIndex} />
        )}
        {mobileTab === 'PRACTICE' && (
          <div className="h-full overflow-hidden">
            {currentBlock && isInteractiveBlock(currentBlock) ? (
              renderBlockWidget(currentBlock, { onResolved: handleResolved })
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <Zap size={22} className="text-muted" />
                <p className="text-xs text-muted">Avanza en la lectura para desbloquear retos tactiles.</p>
              </div>
            )}
          </div>
        )}
        {mobileTab === 'SRS' && <Sm2FlashcardArena />}
        {mobileTab === 'MAP' && <MasteryPathMap />}
      </div>

      <nav className="glass flex items-center justify-around border-t border-subtle py-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileTab(tab.id)}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-[10px] transition-colors',
              mobileTab === tab.id ? 'bg-accent/15 text-accent' : 'text-muted'
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

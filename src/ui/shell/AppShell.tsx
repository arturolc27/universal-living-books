import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Monitor,
  Smartphone,
  Upload,
  Flame,
  Target,
  Trophy,
  Command,
  Settings,
  Wand2,
  WifiOff,
  Download,
  Play,
  X,
} from 'lucide-react';
import { usePlatformStore, selectActiveCartridge } from '../../store/usePlatformStore';
import { CommandPalette } from './CommandPalette';
import { CartridgeImporterModal } from '../library/CartridgeImporterModal';
import { SettingsModal } from '../settings/SettingsModal';
import { CompilerStudioModal } from '../library/CompilerStudioModal';
import { CompilerBackgroundPill } from '../library/CompilerBackgroundPill';
import {
  compilationOrchestrator,
  type InterruptedCompilationJob,
} from '../../engine/compiler/compilationOrchestrator';
import { cn } from '../utils/cn';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const setCommandPaletteOpen = usePlatformStore((s) => s.setCommandPaletteOpen);
  const viewMode = usePlatformStore((s) => s.viewMode);
  const setViewMode = usePlatformStore((s) => s.setViewMode);
  const closeBook = usePlatformStore((s) => s.closeBook);
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const cartridge = usePlatformStore(selectActiveCartridge);
  const userStats = usePlatformStore((s) => s.userStats);
  const settings = usePlatformStore((s) => s.settings);
  const settingsOpen = usePlatformStore((s) => s.settingsOpen);
  const setSettingsOpen = usePlatformStore((s) => s.setSettingsOpen);
  const compilerOpen = usePlatformStore((s) => s.compilerOpen);
  const setCompilerOpen = usePlatformStore((s) => s.setCompilerOpen);
  const [showImporter, setShowImporter] = useState(false);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [interruptedJob, setInterruptedJob] = useState<InterruptedCompilationJob | null>(() =>
    compilationOrchestrator.getInterruptedJob()
  );

  useEffect(() => {
    const onOpenImporter = () => setShowImporter(true);
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    const onInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('living-books:open-importer', onOpenImporter);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    return () => {
      window.removeEventListener('living-books:open-importer', onOpenImporter);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
    };
  }, []);

  const accuracy =
    userStats.totalAttempts > 0
      ? Math.round((userStats.totalFirstTryHits / userStats.totalAttempts) * 100)
      : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="glass z-40 flex items-center gap-3 border-b border-subtle px-4 py-2.5">
        <button
          type="button"
          onClick={closeBook}
          className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-elevated/60"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-secondary text-sm">
            📚
          </span>
          <span className="hidden text-sm font-semibold text-primary sm:block">
            Living<span className="gradient-text">Books</span>
          </span>
        </button>

        {cartridge && (
          <div className="hidden min-w-0 items-center gap-2 border-l border-subtle pl-3 md:flex">
            <span className="text-sm">{cartridge.metadata.coverAccentIcon}</span>
            <span className="truncate text-xs font-medium text-muted">{cartridge.metadata.title}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="ml-auto flex items-center gap-2 rounded-lg border border-subtle bg-surface/60 px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/50 hover:text-primary"
        >
          <Search size={13} />
          <span className="hidden sm:block">Buscar o saltar a...</span>
          <kbd className="hidden items-center gap-0.5 rounded border border-subtle px-1.5 py-0.5 text-[10px] sm:flex">
            <Command size={9} /> K
          </kbd>
        </button>

        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-secondary">
            <Flame size={12} /> {userStats.currentStreakDays}d
          </span>
          <span className="hidden items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-accent sm:flex">
            <Target size={12} /> {accuracy}%
          </span>
          <span className="hidden items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-success sm:flex">
            <Trophy size={12} /> {userStats.astMasteryCount}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-subtle p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('DESKTOP_STUDIO')}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              viewMode === 'DESKTOP_STUDIO' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-primary'
            )}
            title="Modo PC Studio"
          >
            <Monitor size={14} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('MOBILE_COMPANION')}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              viewMode === 'MOBILE_COMPANION' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-primary'
            )}
            title="Modo Movil"
          >
            <Smartphone size={14} />
          </button>
        </div>

        {isOffline && (
          <span
            className="flex items-center gap-1 rounded-full border border-secondary/40 bg-secondary/10 px-2.5 py-1 text-[10px] font-semibold text-secondary"
            title="Trabajando sin conexión (PWA Offline)"
          >
            <WifiOff size={11} /> Offline
          </span>
        )}

        {installPrompt && (
          <button
            type="button"
            onClick={async () => {
              await installPrompt.prompt();
              await installPrompt.userChoice;
              setInstallPrompt(null);
            }}
            className="flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20"
            title="Instalar app para uso offline"
          >
            <Download size={12} />
            <span className="hidden sm:inline">Instalar App</span>
          </button>
        )}

        <CompilerBackgroundPill />

        <button
          type="button"
          onClick={() => setCompilerOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-accent/50"
          title="Compilar un libro"
        >
          <Wand2 size={13} />
          <span className="hidden lg:block">Compilar</span>
        </button>

        <button
          type="button"
          onClick={() => setShowImporter(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-canvas transition-transform hover:scale-[1.03]"
        >
          <Upload size={13} />
          <span className="hidden sm:block">Importar</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg border border-subtle p-1.5 text-muted transition-colors hover:border-accent/50 hover:text-primary"
          title="Configuracion"
        >
          <Settings size={15} />
        </button>
      </header>

      {interruptedJob && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs">
          <span className="text-primary">
            Compilación pendiente de <strong>{interruptedJob.metadata.title}</strong> (
            {interruptedJob.completedSectionIds.length}/{interruptedJob.chunks.length} secciones guardadas).
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setInterruptedJob(null);
                setCompilerOpen(true);
                void compilationOrchestrator.resumeInterruptedJob({
                  openrouterApiKey: settings.openrouterApiKey,
                  geminiApiKey: settings.geminiApiKey,
                  ollamaBaseUrl: 'http://localhost:11434',
                });
              }}
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-[11px] font-semibold text-canvas"
            >
              <Play size={11} /> Reanudar ahora
            </button>
            <button
              type="button"
              onClick={() => {
                compilationOrchestrator.discardInterruptedJob();
                setInterruptedJob(null);
              }}
              className="rounded-lg border border-subtle p-1 text-muted hover:text-primary"
              title="Descartar"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <motion.main
        key={activeBookId ?? 'library'}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="min-h-0 flex-1 overflow-hidden"
      >
        {children}
      </motion.main>

      <CommandPalette />
      {showImporter && <CartridgeImporterModal onClose={() => setShowImporter(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {compilerOpen && <CompilerStudioModal onClose={() => setCompilerOpen(false)} />}
    </div>
  );
}

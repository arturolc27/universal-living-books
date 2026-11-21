import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { usePlatformStore, selectActiveCartridge } from './store/usePlatformStore';
import { ThemeInjector } from './ui/theme/ThemeInjector';
import { AppShell } from './ui/shell/AppShell';
import { BookLibraryHub } from './ui/library/BookLibraryHub';
import { GlobalSrsHub } from './ui/srs/GlobalSrsHub';
import { GlobalDictionaryView } from './ui/dictionary/GlobalDictionaryView';
import { ConceptDetailModal } from './ui/dictionary/ConceptDetailModal';
import { GlobalPythonRoadmapView } from './ui/roadmap/GlobalPythonRoadmapView';
import { DesktopStudioShell } from './ui/studio/DesktopStudioShell';
import { MobileCompanionShell } from './ui/mobile/MobileCompanionShell';
import { ToastStack } from './ui/gamification/GamificationHud';
import { loadBundledCartridges } from './data/bundledCartridges';
import { livingBooksDb } from './db/dexieDb';
import { AccessGate } from './ui/security/AccessGate';

export default function App() {
  const hydrateFromDb = usePlatformStore((s) => s.hydrateFromDb);
  const registerCartridge = usePlatformStore((s) => s.registerCartridge);
  const syncWithServer = usePlatformStore((s) => s.syncWithServer);
  const isHydrated = usePlatformStore((s) => s.isHydrated);
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  const globalRoute = usePlatformStore((s) => s.globalRoute);
  const viewMode = usePlatformStore((s) => s.viewMode);
  const setViewMode = usePlatformStore((s) => s.setViewMode);
  const cartridge = usePlatformStore(selectActiveCartridge);
  const activeGlossaryTerm = usePlatformStore((s) => s.activeGlossaryTerm);
  const setActiveGlossaryTerm = usePlatformStore((s) => s.setActiveGlossaryTerm);
  const activeConceptModal = usePlatformStore((s) => s.activeConceptModal);
  const setActiveConceptModal = usePlatformStore((s) => s.setActiveConceptModal);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setBootError(
          'La inicializacion tardo demasiado. Es posible que haya datos locales corruptos; usa "Reparar".'
        );
      }
    }, 12000);

    (async () => {
      try {
        await hydrateFromDb();
        const bundled = await loadBundledCartridges();
        for (const book of bundled) {
          await registerCartridge(book, false);
        }
        // Sincronización automática en segundo plano con la VPS (libros, ajustes y progreso)
        void syncWithServer();
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : String(err));
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [hydrateFromDb, registerCartridge, syncWithServer]);

  // Re-sincronizar al recuperar conexión, desbloquear PIN o volver a la pestaña (>30s)
  useEffect(() => {
    let lastAutoSync = Date.now();
    const triggerSync = (force = false) => {
      const now = Date.now();
      if (!force && now - lastAutoSync < 30_000) return;
      lastAutoSync = now;
      void syncWithServer();
    };
    const onOnline = () => triggerSync(true);
    const onUnlocked = () => triggerSync(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerSync(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('living-books:access-unlocked', onUnlocked);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('living-books:access-unlocked', onUnlocked);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [syncWithServer]);

  const handleRepair = async () => {
    try {
      await livingBooksDb.delete();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('No se pudo borrar la base de datos:', err);
    }
    window.location.reload();
  };

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) setViewMode('MOBILE_COMPANION');
      else setViewMode('DESKTOP_STUDIO');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setViewMode]);

  if (bootError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <p className="max-w-md text-sm text-danger">Error al inicializar la plataforma: {bootError}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:border-accent/50"
          >
            Recargar
          </button>
          <button
            type="button"
            onClick={handleRepair}
            className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-canvas"
          >
            Reparar (borrar datos locales)
          </button>
        </div>
      </div>
    );
  }

  if (!isHydrated) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-subtle border-t-accent" />
        <p className="text-sm text-muted">Inicializando Living Book Engine...</p>
      </div>
    );
  }

  return (
    <AccessGate>
      <ThemeInjector theme={cartridge?.themeDNA ?? null} />

      <AppShell>
        {!activeBookId && globalRoute === 'LIBRARY' && <BookLibraryHub />}
        {!activeBookId && globalRoute === 'GLOBAL_SRS' && <GlobalSrsHub />}
        {!activeBookId && globalRoute === 'DICTIONARY' && <GlobalDictionaryView />}
        {!activeBookId && globalRoute === 'PYTHON_ROADMAP' && <GlobalPythonRoadmapView />}
        {activeBookId && viewMode === 'DESKTOP_STUDIO' && <DesktopStudioShell />}
        {activeBookId && viewMode === 'MOBILE_COMPANION' && <MobileCompanionShell />}
      </AppShell>

      {activeConceptModal && (
        <ConceptDetailModal
          concept={activeConceptModal}
          onClose={() => setActiveConceptModal(null)}
        />
      )}

      {!activeConceptModal && activeGlossaryTerm && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setActiveGlossaryTerm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-strong w-full max-w-sm rounded-2xl border border-subtle p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-accent">{activeGlossaryTerm.term}</h4>
              <button
                type="button"
                onClick={() => setActiveGlossaryTerm(null)}
                className="text-muted hover:text-primary"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-primary">{activeGlossaryTerm.definition}</p>
            {activeGlossaryTerm.snippet && (
              <pre className="code-font mt-2 overflow-x-auto rounded-md bg-canvas p-2 text-[11px] text-secondary">
                {activeGlossaryTerm.snippet}
              </pre>
            )}
            <p className="mt-2 text-[10px] text-muted">
              Introducido en el capitulo {activeGlossaryTerm.chapterIntroduced}
              {activeGlossaryTerm.pageRef ? ` - pag. ${activeGlossaryTerm.pageRef}` : ''}
            </p>
          </div>
        </div>
      )}

      <ToastStack />
    </AccessGate>
  );
}

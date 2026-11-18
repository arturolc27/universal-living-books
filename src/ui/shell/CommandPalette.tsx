import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  BookOpen,
  Layers,
  FileText,
  Monitor,
  Smartphone,
  Upload,
  Trophy,
  Map,
  CornerDownLeft,
  Wand2,
  Settings,
} from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../utils/cn';

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: typeof BookOpen;
  group: string;
  run: () => void;
}

export function CommandPalette() {
  const open = usePlatformStore((s) => s.commandPaletteOpen);
  const setOpen = usePlatformStore((s) => s.setCommandPaletteOpen);
  const cartridges = usePlatformStore((s) => s.cartridges);
  const openBook = usePlatformStore((s) => s.openBook);
  const closeBook = usePlatformStore((s) => s.closeBook);
  const selectLesson = usePlatformStore((s) => s.selectLesson);
  const setViewMode = usePlatformStore((s) => s.setViewMode);
  const setMobileTab = usePlatformStore((s) => s.setMobileTab);
  const setStudioTab = usePlatformStore((s) => s.setStudioTab);
  const setCompilerOpen = usePlatformStore((s) => s.setCompilerOpen);
  const setSettingsOpen = usePlatformStore((s) => s.setSettingsOpen);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!usePlatformStore.getState().commandPaletteOpen);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    for (const book of Object.values(cartridges)) {
      list.push({
        id: `book-${book.bookId}`,
        label: book.metadata.title,
        hint: `Abrir libro - ${book.metadata.difficulty}`,
        icon: BookOpen,
        group: 'Libros',
        run: () => openBook(book.bookId),
      });
      for (const chapter of book.chapters) {
        for (const lesson of chapter.microLessons) {
          list.push({
            id: `lesson-${book.bookId}-${lesson.lessonId}`,
            label: lesson.title,
            hint: `${book.metadata.title} - Cap ${chapter.number}`,
            icon: FileText,
            group: 'Lecciones',
            run: async () => {
              await openBook(book.bookId);
              await selectLesson(chapter.chapterId, lesson.lessonId);
            },
          });
        }
      }
    }

    list.push(
      {
        id: 'action-library',
        label: 'Ir a la Biblioteca',
        hint: 'Ver todos los libros',
        icon: Layers,
        group: 'Acciones',
        run: () => closeBook(),
      },
      {
        id: 'action-desktop',
        label: 'Modo PC Studio',
        hint: 'Laboratorio de 3 paneles',
        icon: Monitor,
        group: 'Acciones',
        run: () => setViewMode('DESKTOP_STUDIO'),
      },
      {
        id: 'action-mobile',
        label: 'Modo Movil',
        hint: 'Companero tactil',
        icon: Smartphone,
        group: 'Acciones',
        run: () => setViewMode('MOBILE_COMPANION'),
      },
      {
        id: 'action-srs',
        label: 'Repaso SM-2',
        hint: 'Arena de tarjetas',
        icon: Trophy,
        group: 'Acciones',
        run: () => {
          setViewMode('MOBILE_COMPANION');
          setMobileTab('SRS');
        },
      },
      {
        id: 'action-map',
        label: 'Mapa de Dominio',
        hint: 'Progreso por leccion',
        icon: Map,
        group: 'Acciones',
        run: () => {
          setViewMode('MOBILE_COMPANION');
          setMobileTab('MAP');
        },
      },
      {
        id: 'action-import',
        label: 'Importar Cartucho JSON',
        hint: 'Instalar un libro compilado',
        icon: Upload,
        group: 'Acciones',
        run: () => {
          closeBook();
          window.dispatchEvent(new CustomEvent('living-books:open-importer'));
        },
      },
      {
        id: 'action-compile',
        label: 'Compilar un libro',
        hint: 'Estudio de Compilacion (PDF -> cartucho)',
        icon: Wand2,
        group: 'Acciones',
        run: () => setCompilerOpen(true),
      },
      {
        id: 'action-settings',
        label: 'Configuracion',
        hint: 'API key, sincronizacion y datos',
        icon: Settings,
        group: 'Acciones',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'action-memory',
        label: 'Panel de Memoria',
        hint: 'Frames | Objects',
        icon: Layers,
        group: 'Acciones',
        run: () => setStudioTab('MEMORY'),
      }
    );

    return list;
  }, [cartridges, openBook, closeBook, selectLesson, setViewMode, setMobileTab, setStudioTab, setCompilerOpen, setSettingsOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 40);
    return items
      .filter((item) => `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const runItem = (item: PaletteItem) => {
    item.run();
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      runItem(filtered[activeIndex]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong w-full max-w-xl overflow-hidden rounded-2xl border border-subtle shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-subtle px-4 py-3">
              <Search size={16} className="text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Busca libros, lecciones o acciones..."
                className="flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
              />
              <kbd className="rounded border border-subtle px-1.5 py-0.5 text-[10px] text-muted">ESC</kbd>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-2">
              {filtered.length === 0 && (
                <p className="p-4 text-center text-xs text-muted">Sin resultados para "{query}".</p>
              )}
              {filtered.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => runItem(item)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                    idx === activeIndex ? 'bg-accent/15' : 'hover:bg-elevated/60'
                  )}
                >
                  <item.icon size={15} className={idx === activeIndex ? 'text-accent' : 'text-muted'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-primary">{item.label}</p>
                    <p className="truncate text-[10px] text-muted">{item.hint}</p>
                  </div>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-[9px] text-muted">{item.group}</span>
                  {idx === activeIndex && <CornerDownLeft size={12} className="text-accent" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
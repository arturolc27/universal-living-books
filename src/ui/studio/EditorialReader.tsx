import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  Lightbulb,
  AlertTriangle,
  BookOpen,
  Bug,
  Youtube,
  Target,
  CheckCircle2,
  Play,
  Sparkles,
  BookText,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Wand2,
} from 'lucide-react';
import type {
  BookCartridge,
  DeepDiveSection,
  GlossaryEntry,
  LessonBlock,
  ProseBlock,
  YouTubeRefBlock,
} from '../../types/cartridge.types';
import { livingBooksDb, type GlobalConceptRecord } from '../../db/dexieDb';
import { usePlatformStore } from '../../store/usePlatformStore';
import {
  autoLinkGlossaryMarkdown,
  buildAutoLinkTargets,
  type AutoLinkTarget,
} from '../../engine/knowledge/glossaryAutoLinker';
import { normalizeConceptKey } from '../../engine/knowledge/knowledgeIndexer';
import { generateExtendedDeepDiveOnDemand } from '../../engine/compiler/dynamicExerciseGenerator';
import { cn } from '../utils/cn';
import { sanitizeYouTubeId } from '../utils/sanitize';

type ReaderTab = 'COMBINED' | 'BOOK' | 'GUIDE';
type DeepDiveTab = 'MECHANICS' | 'EDGES' | 'PITFALLS' | 'REAL_WORLD';

const CALLOUT_META: Record<
  NonNullable<ProseBlock['callout']>['kind'],
  { icon: typeof Lightbulb; className: string; label: string }
> = {
  TIP: { icon: Lightbulb, className: 'border-success/40 bg-success/5 text-success', label: 'Tip' },
  WARNING: { icon: AlertTriangle, className: 'border-secondary/40 bg-secondary/5 text-secondary', label: 'Atencion' },
  BOOK_NOTE: { icon: BookOpen, className: 'border-accent/40 bg-accent/5 text-accent', label: 'Nota del Autor' },
  ERROR_TRAP: { icon: Bug, className: 'border-danger/40 bg-danger/5 text-danger', label: 'Trampa' },
};

function RichMarkdown({
  content,
  autoLinkTargets,
  onConceptKeyClick,
  onTryCode,
}: {
  content: string;
  autoLinkTargets: AutoLinkTarget[];
  onConceptKeyClick: (conceptKey: string, label: string) => void;
  onTryCode?: (code: string) => void;
}) {
  const markdown = useMemo(
    () => autoLinkGlossaryMarkdown(content, autoLinkTargets),
    [content, autoLinkTargets]
  );

  return (
    <div className="editorial-prose space-y-2.5 text-sm leading-relaxed text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="leading-relaxed text-primary">{children}</p>,
          h1: ({ children }) => <h2 className="mt-3 text-base font-bold text-primary">{children}</h2>,
          h2: ({ children }) => <h3 className="mt-2.5 text-sm font-bold text-primary">{children}</h3>,
          h3: ({ children }) => (
            <h4 className="mt-2 text-xs font-semibold uppercase tracking-wide text-accent">{children}</h4>
          ),
          h5: ({ children }) => (
            <span className="mt-2 inline-block rounded-full border border-subtle bg-elevated px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {children}
            </span>
          ),
          hr: () => <hr className="my-3 border-subtle/60" />,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-sm text-primary">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-sm text-primary">{children}</ol>,
          code: ({ children, className }) => {
            const rawText = String(children).replace(/\n$/, '');
            const isBlock = Boolean(className?.includes('language-')) || rawText.includes('\n');
            if (isBlock) {
              return (
                <div className="my-2 overflow-hidden rounded-lg border border-subtle bg-canvas">
                  {onTryCode && (
                    <div className="flex items-center justify-between border-b border-subtle/60 bg-surface/60 px-2.5 py-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                        Python
                      </span>
                      <button
                        type="button"
                        onClick={() => onTryCode(rawText)}
                        className="flex items-center gap-1 rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/25"
                      >
                        <Play size={9} /> Probar en Python
                      </button>
                    </div>
                  )}
                  <code className="code-font block overflow-x-auto p-3 text-xs text-accent">
                    {rawText}
                  </code>
                </div>
              );
            }
            return (
              <code className="code-font rounded bg-elevated px-1.5 py-0.5 text-[12px] text-accent">
                {children}
              </code>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/60 pl-3 text-xs italic text-muted">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => {
            if (href?.startsWith('#glossary:')) {
              const key = decodeURIComponent(href.slice('#glossary:'.length));
              const label = typeof children === 'string' ? children : key;
              return (
                <button
                  type="button"
                  onClick={() => onConceptKeyClick(key, label)}
                  className="mx-0.5 border-b border-dotted border-accent text-accent transition-colors hover:bg-accent/10"
                >
                  {children}
                </button>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline hover:opacity-80"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function ProseRenderer({
  block,
  stepNumber,
  isActiveStep,
  autoLinkTargets,
  onConceptKeyClick,
  onTryCode,
}: {
  block: ProseBlock;
  stepNumber: number;
  isActiveStep: boolean;
  autoLinkTargets: AutoLinkTarget[];
  onConceptKeyClick: (conceptKey: string, label: string) => void;
  onTryCode?: (code: string) => void;
}) {
  const callout = block.callout;
  const calloutMeta = callout ? CALLOUT_META[callout.kind] ?? CALLOUT_META.BOOK_NOTE : null;
  const CalloutIcon = calloutMeta?.icon;

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-3.5 transition-colors',
        isActiveStep
          ? 'border-accent/40 bg-accent/[0.03]'
          : 'border-subtle/60 bg-surface/20'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
            isActiveStep ? 'bg-accent/15 text-accent' : 'bg-elevated text-muted'
          )}
        >
          Sección · Paso {stepNumber}
        </span>
        {block.subgoals && block.subgoals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {block.subgoals.map((sg, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent"
                title={sg.description}
              >
                <span className="opacity-70">#{idx + 1}</span> {sg.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <RichMarkdown
        content={block.markdown}
        autoLinkTargets={autoLinkTargets}
        onConceptKeyClick={onConceptKeyClick}
        onTryCode={onTryCode}
      />

      {callout && calloutMeta && CalloutIcon && (
        <div className={cn('rounded-md border p-3', calloutMeta.className)}>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <CalloutIcon size={13} />
            {callout.title}
          </p>
          <p className="text-xs opacity-90">{callout.body}</p>
        </div>
      )}
    </div>
  );
}

function YouTubeRefRenderer({ block }: { block: YouTubeRefBlock }) {
  const safeId = sanitizeYouTubeId(block.videoId);
  return (
    <div className="flex items-center gap-2 rounded-md border border-subtle bg-elevated/40 p-2">
      <Youtube size={15} className="text-danger" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-primary">{block.title}</p>
        <p className="truncate text-[11px] text-muted">{block.contextWhyWatch}</p>
      </div>
      {safeId && (
        <a
          href={`https://www.youtube.com/watch?v=${safeId}${block.timestampStartSec ? `&t=${block.timestampStartSec}` : ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-subtle px-2 py-1 text-[11px] text-muted hover:text-primary"
        >
          Ver
        </a>
      )}
    </div>
  );
}

function DeepDiveAccordion({
  bookId,
  lessonId,
  lessonTitle,
  initialDeepDive,
  contextExcerpt,
  onTryCode,
}: {
  bookId: string;
  lessonId: string;
  lessonTitle: string;
  initialDeepDive?: DeepDiveSection;
  contextExcerpt: string;
  onTryCode?: (code: string) => void;
}) {
  const settings = usePlatformStore((s) => s.settings);
  const preferredLanguage = usePlatformStore((s) => s.preferredLanguage);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DeepDiveTab>('MECHANICS');
  const [deepDive, setDeepDive] = useState<DeepDiveSection | null>(initialDeepDive ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDeepDive(initialDeepDive ?? null);
    setOpen(false);
    setError(null);
    if (!initialDeepDive && livingBooksDb.deepDiveCache) {
      const cacheKey = `${bookId}::${lessonId}::lesson`;
      void livingBooksDb.deepDiveCache
        .get(cacheKey)
        .then((cached) => {
          if (cached) setDeepDive(cached.deepDive);
        })
        .catch(() => {});
    }
  }, [bookId, lessonId, initialDeepDive]);

  const handleGenerateDeepDive = async () => {
    setLoading(true);
    setError(null);
    try {
      const generated = await generateExtendedDeepDiveOnDemand(
        {
          bookId,
          lessonId,
          title: lessonTitle,
          contextExcerpt,
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
      setDeepDive(generated);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!deepDive) {
    return (
      <div className="rounded-xl border border-dashed border-accent/35 bg-accent/[0.03] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-accent">
              <Layers size={13} /> Divulgación progresiva (Deep Dive)
            </p>
            <p className="text-[11px] text-muted">
              ¿Quieres ir más allá? Genera mecánica interna, casos borde y trampas reales (se guarda offline).
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGenerateDeepDive()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Profundizar
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-accent/35 bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/5"
      >
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-accent" />
          <span className="text-xs font-bold text-primary">
            Deep Dive: Mecánica interna, casos borde y producción
          </span>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-semibold text-accent">
            Opcional
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
      </button>

      {open && (
        <div className="border-t border-subtle p-3.5">
          <div className="mb-3 flex flex-wrap gap-1">
            {([
              { id: 'MECHANICS' as const, label: 'Cómo funciona' },
              { id: 'EDGES' as const, label: `Casos borde (${deepDive.edgeCases.length})` },
              { id: 'PITFALLS' as const, label: `Errores comunes (${deepDive.commonPitfalls.length})` },
              { id: 'REAL_WORLD' as const, label: 'Práctica real' },
            ]).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-colors',
                  tab === t.id ? 'bg-accent text-canvas' : 'bg-elevated text-muted hover:text-primary'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'MECHANICS' && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-primary">
              {deepDive.internalMechanics}
            </p>
          )}
          {tab === 'EDGES' && (
            <ul className="list-disc space-y-1.5 pl-4 text-xs text-primary">
              {deepDive.edgeCases.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          )}
          {tab === 'PITFALLS' && (
            <ul className="list-disc space-y-1.5 pl-4 text-xs text-primary">
              {deepDive.commonPitfalls.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          )}
          {tab === 'REAL_WORLD' && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-primary">
              {deepDive.realWorldContrast}
            </p>
          )}

          {deepDive.codeExample && (
            <div className="mt-3 overflow-hidden rounded-lg border border-subtle bg-canvas">
              <div className="flex items-center justify-between border-b border-subtle/60 bg-surface/60 px-2.5 py-1">
                <span className="text-[10px] font-semibold uppercase text-muted">
                  Demostración técnica
                </span>
                {onTryCode && (
                  <button
                    type="button"
                    onClick={() => onTryCode(deepDive.codeExample!)}
                    className="flex items-center gap-1 rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/25"
                  >
                    <Play size={9} /> Probar
                  </button>
                )}
              </div>
              <pre className="code-font overflow-x-auto p-2.5 text-[11px] text-secondary">
                {deepDive.codeExample}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EditorialReader({
  cartridge,
  lessonId,
  lessonTitle,
  chapterNumber,
  chapterTitle,
  lessonIndex,
  totalLessonsInChapter,
  blocks,
  activeBlockIndex = 0,
  unlockedBlockIndex,
  learningObjectives,
  takeaways,
  deepDive,
  sourceBookMarkdown,
  sourcePageRange,
  onTryCode,
  onRecompileBook,
}: {
  cartridge: BookCartridge;
  lessonId?: string;
  lessonTitle?: string;
  chapterNumber?: number;
  chapterTitle?: string;
  lessonIndex?: number;
  totalLessonsInChapter?: number;
  blocks: LessonBlock[];
  activeBlockIndex?: number;
  unlockedBlockIndex: number;
  learningObjectives?: string[];
  takeaways?: string[];
  deepDive?: DeepDiveSection;
  sourceBookMarkdown?: string;
  sourcePageRange?: string;
  onTryCode?: (code: string) => void;
  onRecompileBook?: () => void;
}) {
  const setActiveGlossaryTerm = usePlatformStore((s) => s.setActiveGlossaryTerm);
  const setActiveConceptModal = usePlatformStore((s) => s.setActiveConceptModal);
  const globalConcepts = usePlatformStore((s) => s.globalConcepts);

  const [readerTab, setReaderTab] = useState<ReaderTab>('GUIDE');
  const [expandedForSource, setExpandedForSource] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeStepRef = useRef<HTMLDivElement>(null);

  const expandFullBookPassage = Boolean(sourceBookMarkdown && expandedForSource === sourceBookMarkdown);
  const setExpandFullBookPassage = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(expandFullBookPassage) : next;
    setExpandedForSource(resolved && sourceBookMarkdown ? sourceBookMarkdown : null);
  };

  // Aislamiento estricto de scroll al cambiar de unidad/lección
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [lessonId]);

  // Al avanzar a un bloque PROSE nuevo, hacer scroll suave hacia ese paso
  useEffect(() => {
    const current = blocks[activeBlockIndex];
    if (current?.type === 'PROSE' && activeBlockIndex > 0 && activeStepRef.current) {
      activeStepRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeBlockIndex, blocks]);

  const autoLinkTargets = useMemo(
    () => buildAutoLinkTargets(cartridge.glossary, globalConcepts),
    [cartridge.glossary, globalConcepts]
  );

  const handleConceptKeyClick = (conceptKey: string, label: string) => {
    const norm = normalizeConceptKey(conceptKey);
    const globalMatch: GlobalConceptRecord | undefined = globalConcepts.find(
      (c) =>
        c.conceptKey === norm ||
        c.term.toLowerCase() === label.toLowerCase() ||
        c.aliases.some((a) => normalizeConceptKey(a) === norm)
    );
    if (globalMatch) {
      setActiveConceptModal(globalMatch);
      return;
    }
    // Fallback al glosario local del cartucho (case-insensitive)
    const localEntry: GlossaryEntry | undefined =
      cartridge.glossary[label] ??
      Object.values(cartridge.glossary).find(
        (g) =>
          normalizeConceptKey(g.term) === norm ||
          g.aliases?.some((a) => normalizeConceptKey(a) === norm)
      );
    if (localEntry) {
      setActiveGlossaryTerm(localEntry);
    }
  };

  // Mostrar todos los bloques PROSE/YOUTUBE introductorios previos al primer reto desde el Paso 1
  const visibleBlocksWithIndex = useMemo(() => {
    const firstInteractiveIdx = blocks.findIndex(
      (b) => b.type !== 'PROSE' && b.type !== 'YOUTUBE_REF' && b.type !== 'FLASHCARD'
    );
    const introEnd = firstInteractiveIdx > 0 ? firstInteractiveIdx - 1 : blocks.length - 1;
    const minReveal = Math.max(unlockedBlockIndex, introEnd);
    return blocks
      .slice(0, Math.min(minReveal + 1, blocks.length))
      .map((block, originalIndex) => ({ block, originalIndex }))
      .filter(({ block }) => block.type === 'PROSE' || block.type === 'YOUTUBE_REF');
  }, [blocks, unlockedBlockIndex]);

  const isLessonEndReached = unlockedBlockIndex >= blocks.length - 1;
  const hasBookSource = Boolean(sourceBookMarkdown && sourceBookMarkdown.trim().length > 0);

  const contextExcerpt = useMemo(() => {
    const prose = blocks
      .filter((b): b is ProseBlock => b.type === 'PROSE')
      .map((b) => b.markdown)
      .join('\n\n');
    return prose || sourceBookMarkdown || lessonTitle || '';
  }, [blocks, sourceBookMarkdown, lessonTitle]);

  const { excerptMarkdown, isBookTruncated } = useMemo(() => {
    if (!sourceBookMarkdown) return { excerptMarkdown: '', isBookTruncated: false };
    const PREVIEW_LIMIT = 1800;
    if (sourceBookMarkdown.length <= PREVIEW_LIMIT + 350) {
      return { excerptMarkdown: sourceBookMarkdown, isBookTruncated: false };
    }
    let cut = sourceBookMarkdown.lastIndexOf('\n\n', PREVIEW_LIMIT);
    if (cut < PREVIEW_LIMIT * 0.5) cut = PREVIEW_LIMIT;
    let slice = sourceBookMarkdown.slice(0, cut).trim();
    if ((slice.match(/```/g) ?? []).length % 2 === 1) {
      const nextClose = sourceBookMarkdown.indexOf('```', cut);
      if (nextClose !== -1 && nextClose < cut + 1200) {
        slice = sourceBookMarkdown.slice(0, nextClose + 3).trim();
      } else {
        const lastOpen = slice.lastIndexOf('```');
        if (lastOpen > 0) slice = slice.slice(0, lastOpen).trim();
      }
    }
    return { excerptMarkdown: slice, isBookTruncated: true };
  }, [sourceBookMarkdown]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Barra de lectura Libro Original / Guía Interactiva */}
      <div className="flex items-center justify-between gap-2 border-b border-subtle bg-surface/40 px-3 py-1.5">
        <div className="flex items-center gap-1">
          {([
            { id: 'COMBINED' as const, label: 'Libro + Guía', icon: BookOpen },
            { id: 'BOOK' as const, label: 'Libro Original', icon: BookText },
            { id: 'GUIDE' as const, label: 'Guía IA', icon: Sparkles },
          ]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setReaderTab(t.id)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors',
                readerTab === t.id
                  ? 'bg-accent/15 text-accent'
                  : 'text-muted hover:text-primary'
              )}
            >
              <t.icon size={11} />
              {t.label}
            </button>
          ))}
        </div>
        {sourcePageRange && (
          <span className="rounded-full border border-subtle bg-canvas px-2 py-0.5 text-[10px] text-muted">
            {sourcePageRange}
          </span>
        )}
      </div>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="space-y-5">
          {/* Cabecera visual clara de aislamiento por unidad/lección */}
          {(lessonTitle || chapterNumber !== undefined) && (
            <div className="border-b border-subtle pb-3">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                {chapterNumber !== undefined && <span>Módulo {chapterNumber}</span>}
                {lessonIndex !== undefined && totalLessonsInChapter !== undefined && (
                  <>
                    <span className="text-muted">·</span>
                    <span className="text-muted">
                      Lección {lessonIndex + 1} de {totalLessonsInChapter}
                    </span>
                  </>
                )}
              </div>
              {lessonTitle && (
                <h1 className="mt-1 text-base font-bold leading-snug text-primary sm:text-lg">
                  {lessonTitle}
                </h1>
              )}
              {chapterTitle && (
                <p className="mt-0.5 text-[11px] text-muted">{chapterTitle}</p>
              )}
            </div>
          )}

          {/* Guía Interactiva / Objetivos */}
          {(readerTab === 'COMBINED' || readerTab === 'GUIDE') && (
            <div className="space-y-4">
              {learningObjectives && learningObjectives.length > 0 && (
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
                    <Target size={12} /> Objetivos de esta lección
                  </p>
                  <ul className="space-y-1 text-xs text-primary">
                    {learningObjectives.map((obj, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-accent">•</span>
                        <span>{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {visibleBlocksWithIndex.map(({ block, originalIndex }) => {
                const isActive = originalIndex === activeBlockIndex;
                if (block.type === 'PROSE') {
                  return (
                    <div key={block.blockId} ref={isActive ? activeStepRef : undefined}>
                      <ProseRenderer
                        block={block}
                        stepNumber={originalIndex + 1}
                        isActiveStep={isActive}
                        autoLinkTargets={autoLinkTargets}
                        onConceptKeyClick={handleConceptKeyClick}
                        onTryCode={onTryCode}
                      />
                    </div>
                  );
                }
                if (block.type === 'YOUTUBE_REF') {
                  return <YouTubeRefRenderer key={block.blockId} block={block} />;
                }
                return null;
              })}

              {/* Capa de Divulgación Progresiva (Deep Dive) */}
              {lessonId && (
                <DeepDiveAccordion
                  bookId={cartridge.bookId}
                  lessonId={lessonId}
                  lessonTitle={lessonTitle ?? lessonId}
                  initialDeepDive={deepDive}
                  contextExcerpt={contextExcerpt}
                  onTryCode={onTryCode}
                />
              )}
            </div>
          )}

          {/* Texto Real del Libro Original (con auto-enlazado de diccionario también) */}
          {(readerTab === 'COMBINED' || readerTab === 'BOOK') && (
            <div className="rounded-xl border border-subtle bg-surface/40 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary">
                  <BookText size={13} />{' '}
                  {readerTab === 'BOOK' ? 'Texto Íntegro del Libro' : 'Pasaje del Libro Original'}
                </span>
                <div className="flex items-center gap-2">
                  {sourcePageRange && (
                    <span className="text-[10px] text-muted">{sourcePageRange}</span>
                  )}
                  {readerTab === 'COMBINED' && isBookTruncated && (
                    <button
                      type="button"
                      onClick={() => setExpandFullBookPassage((v) => !v)}
                      className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/20"
                    >
                      {expandFullBookPassage ? 'Mostrar extracto clave' : 'Ver pasaje completo'}
                    </button>
                  )}
                </div>
              </div>

              {hasBookSource && sourceBookMarkdown ? (
                <>
                  <RichMarkdown
                    content={
                      readerTab === 'BOOK' || expandFullBookPassage
                        ? sourceBookMarkdown
                        : excerptMarkdown
                    }
                    autoLinkTargets={autoLinkTargets}
                    onConceptKeyClick={handleConceptKeyClick}
                    onTryCode={onTryCode}
                  />
                  {readerTab === 'COMBINED' && isBookTruncated && !expandFullBookPassage && (
                    <div className="mt-3 flex justify-center border-t border-subtle/60 pt-3">
                      <button
                        type="button"
                        onClick={() => setExpandFullBookPassage(true)}
                        className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/20"
                      >
                        Seguir leyendo sección completa del libro...
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2 text-xs text-muted">
                  <p>
                    Esta lección fue compilada antes de activar el visor íntegro del libro original (o pertenece a un cartucho resumido).
                  </p>
                  {onRecompileBook && (
                    <button
                      type="button"
                      onClick={onRecompileBook}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/20"
                    >
                      <RefreshCw size={12} /> Re-compilar libro para incluir páginas completas
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {isLessonEndReached && takeaways && takeaways.length > 0 && (
            <div className="rounded-xl border border-success/40 bg-success/5 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-success">
                <CheckCircle2 size={12} /> Puntos clave del módulo
              </p>
              <ul className="space-y-1 text-xs text-primary">
                {takeaways.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-success">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

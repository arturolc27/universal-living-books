import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Lightbulb, AlertTriangle, BookOpen, Bug, Youtube, Target, CheckCircle2, Play } from 'lucide-react';
import type { BookCartridge, GlossaryEntry, LessonBlock, ProseBlock, YouTubeRefBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../utils/cn';
import { sanitizeYouTubeId } from '../utils/sanitize';

const CALLOUT_META: Record<
  NonNullable<ProseBlock['callout']>['kind'],
  { icon: typeof Lightbulb; className: string; label: string }
> = {
  TIP: { icon: Lightbulb, className: 'border-success/40 bg-success/5 text-success', label: 'Tip' },
  WARNING: { icon: AlertTriangle, className: 'border-secondary/40 bg-secondary/5 text-secondary', label: 'Atencion' },
  BOOK_NOTE: { icon: BookOpen, className: 'border-accent/40 bg-accent/5 text-accent', label: 'Nota del Autor' },
  ERROR_TRAP: { icon: Bug, className: 'border-danger/40 bg-danger/5 text-danger', label: 'Trampa' },
};

function preprocessGlossaryLinks(markdown: string): string {
  const safe = typeof markdown === 'string' ? markdown : '';
  return safe.replace(/\[\[([^\]]+)\]\]/g, (_m, term: string) => {
    return `[${term}](#glossary:${encodeURIComponent(term)})`;
  });
}

function ProseRenderer({
  block,
  glossary,
  onTermClick,
  onTryCode,
}: {
  block: ProseBlock;
  glossary: Record<string, GlossaryEntry>;
  onTermClick: (entry: GlossaryEntry) => void;
  onTryCode?: (code: string) => void;
}) {
  const markdown = useMemo(() => preprocessGlossaryLinks(block.markdown), [block.markdown]);
  const callout = block.callout;
  const calloutMeta = callout ? CALLOUT_META[callout.kind] ?? CALLOUT_META.BOOK_NOTE : null;
  const CalloutIcon = calloutMeta?.icon;

  return (
    <div className="space-y-3">
      <div className="editorial-prose space-y-2.5 text-sm leading-relaxed text-primary">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{
            p: ({ children }) => <p className="leading-relaxed text-primary">{children}</p>,
            h1: ({ children }) => <h2 className="mt-3 text-base font-bold text-primary">{children}</h2>,
            h2: ({ children }) => <h3 className="mt-2.5 text-sm font-bold text-primary">{children}</h3>,
            h3: ({ children }) => <h4 className="mt-2 text-xs font-semibold uppercase tracking-wide text-accent">{children}</h4>,
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
                const term = decodeURIComponent(href.slice('#glossary:'.length));
                const entry = glossary[term];
                return (
                  <button
                    type="button"
                    onClick={() => entry && onTermClick(entry)}
                    className="mx-0.5 border-b border-dotted border-accent text-accent hover:bg-accent/10"
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

export function EditorialReader({
  cartridge,
  blocks,
  unlockedBlockIndex,
  learningObjectives,
  takeaways,
  onTryCode,
}: {
  cartridge: BookCartridge;
  blocks: LessonBlock[];
  unlockedBlockIndex: number;
  learningObjectives?: string[];
  takeaways?: string[];
  onTryCode?: (code: string) => void;
}) {
  const setActiveGlossaryTerm = usePlatformStore((s) => s.setActiveGlossaryTerm);

  const visibleBlocks = useMemo(
    () => blocks.slice(0, Math.min(unlockedBlockIndex + 1, blocks.length)),
    [blocks, unlockedBlockIndex]
  );
  const proseCount = visibleBlocks.filter((b) => b.type === 'PROSE' || b.type === 'YOUTUBE_REF').length;
  const isLessonEndReached = unlockedBlockIndex >= blocks.length - 1;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className="space-y-4">
        {learningObjectives && learningObjectives.length > 0 && (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
              <Target size={12} /> Objetivos de esta leccion
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

        {visibleBlocks.map((block) => {
          if (block.type === 'PROSE') {
            return (
              <ProseRenderer
                key={block.blockId}
                block={block}
                glossary={cartridge.glossary}
                onTermClick={setActiveGlossaryTerm}
                onTryCode={onTryCode}
              />
            );
          }
          if (block.type === 'YOUTUBE_REF') {
            return <YouTubeRefRenderer key={block.blockId} block={block} />;
          }
          return null;
        })}

        {proseCount === 0 && (
          <div className="rounded-xl border border-subtle bg-surface/60 p-4 text-xs text-muted">
            Completa el reto interactivo del panel derecho para desbloquear las notas y el siguiente concepto de esta leccion.
          </div>
        )}

        {isLessonEndReached && takeaways && takeaways.length > 0 && (
          <div className="rounded-xl border border-success/40 bg-success/5 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-success">
              <CheckCircle2 size={12} /> Puntos clave del modulo
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
  );
}

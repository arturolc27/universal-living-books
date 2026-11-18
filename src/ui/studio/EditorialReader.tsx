import { useMemo } from 'react';
import { Lightbulb, AlertTriangle, BookOpen, Bug, Youtube } from 'lucide-react';
import type { BookCartridge, GlossaryEntry, LessonBlock, ProseBlock, YouTubeRefBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../utils/cn';

const CALLOUT_META: Record<
  NonNullable<ProseBlock['callout']>['kind'],
  { icon: typeof Lightbulb; className: string; label: string }
> = {
  TIP: { icon: Lightbulb, className: 'border-success/40 bg-success/5 text-success', label: 'Tip' },
  WARNING: { icon: AlertTriangle, className: 'border-secondary/40 bg-secondary/5 text-secondary', label: 'Atencion' },
  BOOK_NOTE: { icon: BookOpen, className: 'border-accent/40 bg-accent/5 text-accent', label: 'Nota del Autor' },
  ERROR_TRAP: { icon: Bug, className: 'border-danger/40 bg-danger/5 text-danger', label: 'Trampa' },
};

function renderInlineGlossary(
  markdown: string,
  glossary: Record<string, GlossaryEntry>,
  onTermClick: (entry: GlossaryEntry) => void
) {
  const safe = typeof markdown === 'string' ? markdown : '';
  const parts = safe.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((part, idx) => {
    const match = part.match(/^\[\[([^\]]+)\]\]$/);
    if (match) {
      const term = match[1];
      const entry = glossary[term];
      return (
        <button
          key={idx}
          type="button"
          onClick={() => entry && onTermClick(entry)}
          className="mx-0.5 border-b border-dotted border-accent text-accent hover:bg-accent/10"
        >
          {term}
        </button>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function ProseRenderer({
  block,
  glossary,
  onTermClick,
}: {
  block: ProseBlock;
  glossary: Record<string, GlossaryEntry>;
  onTermClick: (entry: GlossaryEntry) => void;
}) {
  const markdown = typeof block.markdown === 'string' ? block.markdown : '';
  const paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const callout = block.callout;
  // Defensa: un `kind` desconocido del LLM no debe tumbar la app.
  const calloutMeta = callout ? CALLOUT_META[callout.kind] ?? CALLOUT_META.BOOK_NOTE : null;
  const CalloutIcon = calloutMeta?.icon;

  return (
    <div className="space-y-3">
      {paragraphs.map((para, idx) => (
        <p key={idx} className="editorial-prose text-sm leading-relaxed text-primary">
          {renderInlineGlossary(para, glossary, onTermClick)}
        </p>
      ))}
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
  return (
    <div className="flex items-center gap-2 rounded-md border border-subtle bg-elevated/40 p-2">
      <Youtube size={15} className="text-danger" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-primary">{block.title}</p>
        <p className="truncate text-[11px] text-muted">{block.contextWhyWatch}</p>
      </div>
      <a
        href={`https://www.youtube.com/watch?v=${block.videoId}${block.timestampStartSec ? `&t=${block.timestampStartSec}` : ''}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-subtle px-2 py-1 text-[11px] text-muted hover:text-primary"
      >
        Ver
      </a>
    </div>
  );
}

export function EditorialReader({
  cartridge,
  blocks,
  unlockedBlockIndex,
}: {
  cartridge: BookCartridge;
  blocks: LessonBlock[];
  unlockedBlockIndex: number;
}) {
  const setActiveGlossaryTerm = usePlatformStore((s) => s.setActiveGlossaryTerm);

  const visibleBlocks = useMemo(
    () => blocks.slice(0, Math.min(unlockedBlockIndex + 1, blocks.length)),
    [blocks, unlockedBlockIndex]
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="space-y-4">
        {visibleBlocks.map((block) => {
          if (block.type === 'PROSE') {
            return (
              <ProseRenderer
                key={block.blockId}
                block={block}
                glossary={cartridge.glossary}
                onTermClick={setActiveGlossaryTerm}
              />
            );
          }
          if (block.type === 'YOUTUBE_REF') {
            return <YouTubeRefRenderer key={block.blockId} block={block} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

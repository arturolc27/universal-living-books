import { useState } from 'react';
import { FileText, ChevronRight, RotateCcw } from 'lucide-react';
import type { InteractiveVisualizerBlock } from '../../types/cartridge.types';
import { cn } from '../../ui/utils/cn';

export function FileCursorTapeVisualizer({ block }: { block: InteractiveVisualizerBlock }) {
  const tape = block.payload.fileTape;
  const [cursor, setCursor] = useState(0);
  const [opIndex, setOpIndex] = useState(0);

  if (!tape) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Sin cinta de archivo configurada.
      </div>
    );
  }

  const chars = tape.content.split('');

  const advance = () => {
    setCursor((c) => Math.min(c + 1, chars.length));
    setOpIndex((i) => Math.min(i + 1, tape.operations.length - 1));
  };

  const reset = () => {
    setCursor(0);
    setOpIndex(0);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
        </div>
        <span className="code-font text-[11px] text-muted">{tape.filename}</span>
      </div>

      <div className="border-b border-subtle bg-canvas px-3 py-2">
        <p className="code-font text-[11px] text-secondary">
          {tape.operations[opIndex] ?? 'Fin de operaciones'}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="code-font flex flex-wrap gap-0.5 text-sm">
          {chars.map((ch, idx) => (
            <span
              key={idx}
              className={cn(
                'rounded px-0.5',
                idx < cursor && 'bg-success/15 text-success',
                idx === cursor && 'bg-accent text-canvas',
                idx > cursor && 'text-muted'
              )}
            >
              {ch === '\n' ? '\u21b5' : ch}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-subtle px-3 py-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-subtle p-1.5 text-muted hover:text-primary"
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          onClick={advance}
          disabled={cursor >= chars.length}
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
        >
          Avanzar cursor <ChevronRight size={13} />
        </button>
        <span className="ml-auto code-font text-[11px] text-muted">
          pos {cursor} / {chars.length}
        </span>
      </div>
    </div>
  );
}

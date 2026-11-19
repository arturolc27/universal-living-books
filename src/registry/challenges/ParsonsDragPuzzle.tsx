import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, IndentIncrease, IndentDecrease, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import type { ParsonsProblemBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

interface PlacedLine {
  id: string;
  code: string;
  indent: number;
}

export function ParsonsDragPuzzle({
  block,
  onResolved,
}: {
  block: ParsonsProblemBlock;
  onResolved?: () => void;
}) {
  const recordAttempt = usePlatformStore((s) => s.recordAttempt);
  const flagPcLabFailure = usePlatformStore((s) => s.flagPcLabFailure);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const safeBlocks = useMemo(() => (Array.isArray(block.blocks) ? block.blocks : []), [block.blocks]);
  const [placed, setPlaced] = useState<PlacedLine[]>([]);
  const [tray, setTray] = useState(safeBlocks.map((b) => b.id));
  const [result, setResult] = useState<'PENDING' | 'CORRECT' | 'WRONG'>('PENDING');

  useEffect(() => {
    setPlaced([]);
    setTray(safeBlocks.map((b) => b.id));
    setResult('PENDING');
  }, [block.blockId, safeBlocks]);

  const blockMap = useMemo(() => {
    const map: Record<string, ParsonsProblemBlock['blocks'][number]> = {};
    for (const b of safeBlocks) map[b.id] = b;
    return map;
  }, [safeBlocks]);

  const addToPlaced = (id: string) => {
    const source = blockMap[id];
    if (!source) return;
    setPlaced((prev) => [...prev, { id, code: source.code, indent: source.correctIndent ?? 0 }]);
    setTray((prev) => prev.filter((t) => t !== id));
    setResult('PENDING');
  };

  const removeFromPlaced = (id: string) => {
    setPlaced((prev) => prev.filter((p) => p.id !== id));
    setTray((prev) => [...prev, id]);
    setResult('PENDING');
  };

  const move = (index: number, dir: -1 | 1) => {
    setPlaced((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult('PENDING');
  };

  const changeIndent = (index: number, delta: number) => {
    setPlaced((prev) =>
      prev.map((line, i) =>
        i === index ? { ...line, indent: Math.max(0, Math.min(8, line.indent + delta)) } : line
      )
    );
    setResult('PENDING');
  };

  const validate = async () => {
    const correctLines = block.blocks
      .filter((b) => !b.isDistractor)
      .sort((a, b) => a.correctOrder - b.correctOrder);

    const isCorrect =
      placed.length === correctLines.length &&
      placed.every((line, idx) => {
        const expected = correctLines[idx];
        return line.id === expected.id && line.indent === expected.correctIndent;
      });

    setResult(isCorrect ? 'CORRECT' : 'WRONG');
    await recordAttempt(isCorrect);
    if (isCorrect) {
      pushToast({
        title: 'Estructura correcta',
        description: 'Orden e indentacion exactos.',
        iconKey: 'check',
      });
      onResolved?.();
    } else {
      if (block.linkedFlashcardId) await flagPcLabFailure(block.linkedFlashcardId);
      pushToast({
        title: 'Estructura incorrecta',
        description: 'Revisa el orden y los niveles de indentacion.',
        iconKey: 'error',
      });
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-primary">Parsons Problem</h3>
        <p className="text-xs text-muted">{block.prompt}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-3 space-y-1.5">
          <AnimatePresence>
            {placed.map((line, idx) => (
              <motion.div
                key={line.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 rounded-md border border-subtle bg-elevated/40 p-1.5"
              >
                <span className="w-5 text-center text-[10px] text-muted">{idx + 1}</span>
                <pre
                  className="code-font flex-1 overflow-x-auto whitespace-pre text-[11px] text-primary"
                  style={{ paddingLeft: `${line.indent * 8}px` }}
                >
                  {line.code}
                </pre>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => move(idx, -1)} className="rounded p-1 text-muted hover:text-primary">
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" onClick={() => move(idx, 1)} className="rounded p-1 text-muted hover:text-primary">
                    <ArrowDown size={12} />
                  </button>
                  <button type="button" onClick={() => changeIndent(idx, -1)} className="rounded p-1 text-muted hover:text-secondary">
                    <IndentDecrease size={12} />
                  </button>
                  <button type="button" onClick={() => changeIndent(idx, 1)} className="rounded p-1 text-muted hover:text-secondary">
                    <IndentIncrease size={12} />
                  </button>
                  <button type="button" onClick={() => removeFromPlaced(line.id)} className="rounded p-1 text-muted hover:text-danger">
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {placed.length === 0 && (
            <p className="rounded-md border border-dashed border-subtle p-3 text-center text-[11px] text-muted">
              Toca los bloques de abajo para construir la solucion.
            </p>
          )}
        </div>

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Bandeja de bloques
        </p>
        <div className="space-y-1.5">
          {tray.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => addToPlaced(id)}
              className="code-font w-full rounded-md border border-subtle bg-canvas px-3 py-2 text-left text-[11px] text-primary hover:border-accent"
            >
              {blockMap[id].code}
            </button>
          ))}
          {tray.length === 0 && <p className="text-[11px] text-muted">Bandeja vacia.</p>}
        </div>
      </div>

      <div className="border-t border-subtle p-3">
        {result !== 'PENDING' && (
          <div
            className={cn(
              'mb-2 flex items-center gap-2 rounded-md border p-2 text-xs',
              result === 'CORRECT'
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-danger/40 bg-danger/10 text-danger'
            )}
          >
            {result === 'CORRECT' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            {result === 'CORRECT' ? 'Estructura correcta.' : 'Aun no es correcto. Ajusta orden e indentacion.'}
          </div>
        )}
        <button
          type="button"
          onClick={validate}
          disabled={placed.length === 0}
          className="w-full rounded-md bg-accent py-2 text-xs font-semibold text-canvas disabled:opacity-40"
        >
          Validar Estructura AST
        </button>
      </div>
    </div>
  );
}

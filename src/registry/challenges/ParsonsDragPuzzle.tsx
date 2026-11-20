import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp,
  ArrowDown,
  IndentIncrease,
  IndentDecrease,
  CheckCircle2,
  XCircle,
  Trash2,
  HelpCircle,
} from 'lucide-react';
import type { ParsonsProblemBlock } from '../../types/cartridge.types';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../../ui/utils/cn';

interface PlacedLine {
  id: string;
  code: string;
  indent: number;
  subgoalLabel?: string;
}

/** Fisher-Yates determinista con semilla de texto para nunca mostrar la bandeja ya resuelta. */
function deterministicShuffleIds(ids: string[], seedStr: string): string[] {
  const arr = [...ids];
  if (arr.length <= 1) return arr;
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const nextRand = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return ((hash >>> 0) % 10000) / 10000;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // Garantizar que no coincida con el orden original cuando hay >=2 elementos
  if (arr.every((id, idx) => id === ids[idx])) {
    [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
  }
  return arr;
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
  const shuffledInitialIds = useMemo(
    () => deterministicShuffleIds(safeBlocks.map((b) => b.id), block.blockId),
    [safeBlocks, block.blockId]
  );

  const [placed, setPlaced] = useState<PlacedLine[]>([]);
  const [tray, setTray] = useState<string[]>(shuffledInitialIds);
  const [result, setResult] = useState<'PENDING' | 'CORRECT' | 'WRONG'>('PENDING');
  const [diagnosticMsg, setDiagnosticMsg] = useState<string | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);

  useEffect(() => {
    setPlaced([]);
    setTray(shuffledInitialIds);
    setResult('PENDING');
    setDiagnosticMsg(null);
    setHintText(null);
  }, [block.blockId, shuffledInitialIds]);

  const blockMap = useMemo(() => {
    const map: Record<string, ParsonsProblemBlock['blocks'][number]> = {};
    for (const b of safeBlocks) map[b.id] = b;
    return map;
  }, [safeBlocks]);

  const addToPlaced = (id: string) => {
    const source = blockMap[id];
    if (!source) return;
    // Iniciar siempre con indent=0 para exigir razonamiento real de alcance/bloques
    setPlaced((prev) => [
      ...prev,
      { id, code: source.code, indent: 0, subgoalLabel: source.subgoalLabel },
    ]);
    setTray((prev) => prev.filter((t) => t !== id));
    setResult('PENDING');
    setDiagnosticMsg(null);
  };

  const removeFromPlaced = (id: string) => {
    setPlaced((prev) => prev.filter((p) => p.id !== id));
    setTray((prev) => [...prev, id]);
    setResult('PENDING');
    setDiagnosticMsg(null);
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
    setDiagnosticMsg(null);
  };

  const changeIndent = (index: number, delta: number) => {
    setPlaced((prev) =>
      prev.map((line, i) =>
        i === index ? { ...line, indent: Math.max(0, Math.min(8, line.indent + delta)) } : line
      )
    );
    setResult('PENDING');
    setDiagnosticMsg(null);
  };

  const handleHint = () => {
    const correctLines = safeBlocks
      .filter((b) => !b.isDistractor)
      .sort((a, b) => a.correctOrder - b.correctOrder);
    const distractorPlaced = placed.find((p) => blockMap[p.id]?.isDistractor);
    if (distractorPlaced) {
      setHintText(`La línea "${distractorPlaced.code.trim()}" es un distractor con error; sácala de la solución.`);
      return;
    }
    for (let i = 0; i < placed.length; i += 1) {
      const expected = correctLines[i];
      if (!expected) break;
      if (placed[i].id !== expected.id) {
        setHintText(`En la posición ${i + 1} debería ir una instrucción distinta (revisa el flujo lógico).`);
        return;
      }
      if (placed[i].indent !== expected.correctIndent) {
        setHintText(
          `La línea ${i + 1} está en su sitio, pero su indentación debe ser ${expected.correctIndent * 4} espacios (nivel ${expected.correctIndent}).`
        );
        return;
      }
    }
    const nextExpected = correctLines[placed.length];
    if (nextExpected) {
      setHintText(`Siguiente línea esperada empieza con: "${nextExpected.code.trim().slice(0, 26)}..."`);
    }
  };

  const validate = async () => {
    const correctLines = safeBlocks
      .filter((b) => !b.isDistractor)
      .sort((a, b) => a.correctOrder - b.correctOrder);

    const distractorCount = placed.filter((p) => blockMap[p.id]?.isDistractor).length;
    const isCorrect =
      placed.length === correctLines.length &&
      placed.every((line, idx) => {
        const expected = correctLines[idx];
        return line.id === expected.id && line.indent === expected.correctIndent;
      });

    setResult(isCorrect ? 'CORRECT' : 'WRONG');
    await recordAttempt(isCorrect);
    if (isCorrect) {
      setDiagnosticMsg(null);
      pushToast({
        title: 'Estructura correcta',
        description: 'Orden e indentación exactos.',
        iconKey: 'check',
      });
      onResolved?.();
    } else {
      if (distractorCount > 0) {
        setDiagnosticMsg(`Incluiste ${distractorCount} bloque(s) distractor(es) que sobran o tienen trampa.`);
      } else if (placed.length !== correctLines.length) {
        setDiagnosticMsg(
          `Faltan ${correctLines.length - placed.length} línea(s) válidas de la bandeja para completar la lógica.`
        );
      } else {
        const wrongIndent = placed.findIndex((l, i) => l.id === correctLines[i]?.id && l.indent !== correctLines[i]?.correctIndent);
        setDiagnosticMsg(
          wrongIndent >= 0
            ? `El orden es correcto hasta la línea ${wrongIndent + 1}, pero ajusta su nivel de indentación (→ / ←).`
            : 'El orden de algunas instrucciones no coincide con el flujo de ejecución.'
        );
      }
      if (block.linkedFlashcardId) await flagPcLabFailure(block.linkedFlashcardId);
      pushToast({
        title: 'Estructura incorrecta',
        description: 'Revisa el orden y los niveles de indentación.',
        iconKey: 'error',
      });
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-subtle px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-primary">Parsons Problem</h3>
          <p className="text-xs text-muted">{block.prompt}</p>
        </div>
        <button
          type="button"
          onClick={handleHint}
          className="flex shrink-0 items-center gap-1 rounded-md border border-subtle px-2 py-1 text-[10px] font-medium text-accent hover:border-accent/50"
        >
          <HelpCircle size={11} /> Pista
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {hintText && (
          <p className="mb-2 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent">
            💡 {hintText}
          </p>
        )}

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
                  style={{ paddingLeft: `${line.indent * 12}px` }}
                >
                  {line.code}
                </pre>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => move(idx, -1)} className="rounded p-1 text-muted hover:text-primary" title="Subir">
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" onClick={() => move(idx, 1)} className="rounded p-1 text-muted hover:text-primary" title="Bajar">
                    <ArrowDown size={12} />
                  </button>
                  <button type="button" onClick={() => changeIndent(idx, -1)} className="rounded p-1 text-muted hover:text-secondary" title="Menos indentación">
                    <IndentDecrease size={12} />
                  </button>
                  <button type="button" onClick={() => changeIndent(idx, 1)} className="rounded p-1 text-muted hover:text-secondary" title="Más indentación">
                    <IndentIncrease size={12} />
                  </button>
                  <button type="button" onClick={() => removeFromPlaced(line.id)} className="rounded p-1 text-muted hover:text-danger" title="Quitar">
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {placed.length === 0 && (
            <p className="rounded-md border border-dashed border-subtle p-3 text-center text-[11px] text-muted">
              Toca los bloques de abajo en orden y ajusta su indentación (→ / ←) para construir la solución.
            </p>
          )}
        </div>

        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Bandeja de bloques (barajada)
        </p>
        <div className="space-y-1.5">
          {tray.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => addToPlaced(id)}
              className="code-font w-full rounded-md border border-subtle bg-canvas px-3 py-2 text-left text-[11px] text-primary hover:border-accent"
            >
              {blockMap[id]?.code}
            </button>
          ))}
          {tray.length === 0 && <p className="text-[11px] text-muted">Bandeja vacía.</p>}
        </div>
      </div>

      <div className="border-t border-subtle p-3">
        {result !== 'PENDING' && (
          <div
            className={cn(
              'mb-2 flex items-start gap-2 rounded-md border p-2 text-xs',
              result === 'CORRECT'
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-danger/40 bg-danger/10 text-danger'
            )}
          >
            {result === 'CORRECT' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
            <span>
              {result === 'CORRECT'
                ? '¡Orden e indentación correctos!'
                : diagnosticMsg || 'Aún no es correcto. Ajusta orden e indentación.'}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={validate}
            disabled={placed.length === 0}
            className="flex-1 rounded-lg bg-accent py-2 text-xs font-semibold text-canvas disabled:opacity-40"
          >
            Comprobar orden
          </button>
          {onResolved && result === 'CORRECT' && (
            <button
              type="button"
              onClick={onResolved}
              className="rounded-lg border border-success/50 bg-success/15 px-3 py-2 text-xs font-semibold text-success"
            >
              Siguiente paso →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import { ArrowRight, Table2 } from 'lucide-react';
import type { InteractiveVisualizerBlock } from '../../types/cartridge.types';
import { cn } from '../../ui/utils/cn';

function DataTable({
  rows,
  highlightColumns,
  variant,
}: {
  rows: Array<Record<string, string | number | boolean | null>>;
  highlightColumns: string[];
  variant: 'before' | 'after';
}) {
  const columns = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows]);

  return (
    <div className="overflow-auto rounded-md border border-subtle">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-elevated">
            {columns.map((col) => (
              <th
                key={col}
                className={cn(
                  'border-b border-subtle px-2 py-1.5 text-left font-semibold',
                  highlightColumns.includes(col) ? 'text-secondary' : 'text-muted'
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              className={cn(
                variant === 'after' && 'bg-success/5',
                'hover:bg-elevated/50'
              )}
            >
              {columns.map((col) => (
                <td
                  key={col}
                  className={cn(
                    'code-font border-b border-subtle/50 px-2 py-1',
                    highlightColumns.includes(col) ? 'text-secondary' : 'text-primary'
                  )}
                >
                  {String(row[col] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataFrameDiffVisualizer({ block }: { block: InteractiveVisualizerBlock }) {
  const snapshot = block.payload.dataframeSnapshot;

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Sin snapshot de DataFrame configurado.
      </div>
    );
  }

  const highlightColumns = snapshot.highlightColumns ?? [];

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <Table2 size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
      </div>

      <div className="border-b border-subtle bg-canvas px-3 py-2">
        <p className="code-font text-[11px] text-secondary">{snapshot.operation}</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Antes</p>
          <DataTable rows={snapshot.before} highlightColumns={highlightColumns} variant="before" />
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-success">
            Despues <ArrowRight size={11} />
          </p>
          <DataTable rows={snapshot.after} highlightColumns={highlightColumns} variant="after" />
        </div>
      </div>
    </div>
  );
}

import { Boxes, ArrowUpRight } from 'lucide-react';
import type { InteractiveVisualizerBlock } from '../../types/cartridge.types';
import { cn } from '../../ui/utils/cn';

export function OopClassDiagramVisualizer({ block }: { block: InteractiveVisualizerBlock }) {
  const graph = block.payload.oopGraph;

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted">
        Sin grafo de clases configurado.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
        <Boxes size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
      </div>

      <div className="border-b border-subtle bg-canvas px-3 py-2">
        <pre className="code-font text-[11px] text-muted">{block.codeContext}</pre>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {graph.relationships.map((rel, idx) => (
            <span
              key={idx}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                rel.kind === 'INHERITS' && 'bg-accent/15 text-accent',
                rel.kind === 'INSTANTIATES' && 'bg-secondary/15 text-secondary',
                rel.kind === 'COMPOSES' && 'bg-success/15 text-success'
              )}
            >
              {rel.from} <ArrowUpRight size={10} /> {rel.to}
              <span className="opacity-70">({rel.kind})</span>
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {graph.classes.map((cls) => (
            <div
              key={cls.id}
              className={cn(
                'rounded-md border bg-elevated/40',
                cls.isInstance ? 'border-secondary/50' : 'border-accent/40'
              )}
            >
              <div
                className={cn(
                  'rounded-t-md px-2 py-1.5 text-xs font-semibold',
                  cls.isInstance ? 'bg-secondary/15 text-secondary' : 'bg-accent/15 text-accent'
                )}
              >
                {cls.name}
                {cls.isInstance && cls.instanceOf && (
                  <span className="ml-1 text-[10px] opacity-70">instancia de {cls.instanceOf}</span>
                )}
              </div>
              <div className="space-y-1 p-2">
                {cls.attributes.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted">Atributos</p>
                    {cls.attributes.map((attr) => (
                      <p key={attr} className="code-font text-[11px] text-primary">
                        {attr}
                      </p>
                    ))}
                  </div>
                )}
                {cls.methods.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted">Metodos</p>
                    {cls.methods.map((m) => (
                      <p key={m} className="code-font text-[11px] text-primary">
                        {m}
                      </p>
                    ))}
                  </div>
                )}
                {cls.dunderMethods && cls.dunderMethods.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted">Dunder</p>
                    {cls.dunderMethods.map((d) => (
                      <p key={d} className="code-font text-[11px] text-secondary">
                        {d}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

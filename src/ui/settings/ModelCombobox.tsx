import { useMemo, useRef, useState } from 'react';
import { Search, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useOpenRouterModels } from '../../engine/compiler/openrouterModels';
import { cn } from '../utils/cn';

export function ModelCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (modelId: string) => void;
}) {
  const { models, loading } = useOpenRouterModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => `${m.id} ${m.label} ${m.vendor}`.toLowerCase().includes(q));
  }, [models, query]);

  const selected = models.find((m) => m.id === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery('');
          setTimeout(() => inputRef.current?.focus(), 40);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-subtle bg-canvas px-3 py-2 text-left text-xs text-primary outline-none hover:border-accent/50"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? `${selected.label} - ${selected.vendor}` : value || 'Selecciona un modelo'}
        </span>
        {loading ? <Loader2 size={13} className="animate-spin text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-subtle bg-elevated shadow-xl">
          <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
            <Search size={13} className="text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar entre ${models.length} modelos...`}
              className="flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-muted"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="p-3 text-center text-[11px] text-muted">Sin resultados.</p>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  m.id === value ? 'bg-accent/15' : 'hover:bg-canvas'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-primary">{m.label}</p>
                  <p className="code-font truncate text-[10px] text-muted">{m.id}</p>
                </div>
                {m.contextK > 0 && (
                  <span className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-[9px] text-muted">
                    {m.contextK}K
                  </span>
                )}
                {m.id === value && <Check size={12} className="shrink-0 text-accent" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
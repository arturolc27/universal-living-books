import { useMemo, useState } from 'react';
import { FileCode2, FilePlus2, FileText, Trash2, Table2, Braces } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../utils/cn';

function fileIcon(name: string) {
  if (name.endsWith('.csv')) return Table2;
  if (name.endsWith('.json')) return Braces;
  if (name.endsWith('.py')) return FileCode2;
  return FileText;
}

export function VirtualFileDrawer() {
  const virtualFiles = usePlatformStore((s) => s.virtualFiles);
  const updateVirtualFile = usePlatformStore((s) => s.updateVirtualFile);
  const createVirtualFile = usePlatformStore((s) => s.createVirtualFile);
  const deleteVirtualFile = usePlatformStore((s) => s.deleteVirtualFile);

  const fileNames = useMemo(() => Object.keys(virtualFiles).sort(), [virtualFiles]);
  const [selected, setSelected] = useState<string | null>(fileNames[0] ?? null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const activeName = selected && virtualFiles[selected] !== undefined ? selected : fileNames[0] ?? null;
  const activeContent = activeName ? virtualFiles[activeName] : '';

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await createVirtualFile(trimmed, '');
    setSelected(trimmed);
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Virtual FS ({fileNames.length})
        </span>
        <button
          type="button"
          onClick={() => setIsCreating((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent hover:bg-elevated"
        >
          <FilePlus2 size={13} /> Nuevo
        </button>
      </div>

      {isCreating && (
        <div className="flex items-center gap-2 border-b border-subtle px-3 py-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="data.csv"
            className="w-full rounded-md border border-subtle bg-canvas px-2 py-1 text-xs text-primary outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={handleCreate}
            className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-canvas"
          >
            Crear
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-40 shrink-0 overflow-y-auto border-r border-subtle">
          {fileNames.length === 0 && (
            <p className="p-3 text-xs text-muted">Sin archivos en memoria.</p>
          )}
          {fileNames.map((name) => {
            const Icon = fileIcon(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => setSelected(name)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                  activeName === name
                    ? 'bg-elevated text-accent'
                    : 'text-muted hover:bg-elevated/60 hover:text-primary'
                )}
              >
                <Icon size={13} />
                <span className="truncate">{name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {activeName ? (
            <>
              <div className="flex items-center justify-between border-b border-subtle px-3 py-1.5">
                <span className="code-font text-xs text-muted">{activeName}</span>
                <button
                  type="button"
                  onClick={() => deleteVirtualFile(activeName)}
                  className="rounded-md p-1 text-muted hover:bg-danger/15 hover:text-danger"
                  title="Eliminar archivo"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <textarea
                value={activeContent}
                onChange={(e) => updateVirtualFile(activeName, e.target.value)}
                spellCheck={false}
                className="code-font min-h-0 flex-1 resize-none bg-canvas p-3 text-xs leading-relaxed text-primary outline-none"
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted">
              Crea un archivo para practicar operaciones reales de entrada/salida con open(), pathlib y csv.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

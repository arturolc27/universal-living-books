import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, CheckCircle2, AlertTriangle, FileJson } from 'lucide-react';
import { validateBookCartridge, type CartridgeDiagnosticSummary } from '../../types/cartridge.schema';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../utils/cn';

export function CartridgeImporterModal({ onClose }: { onClose: () => void }) {
  const registerCartridge = usePlatformStore((s) => s.registerCartridge);
  const pushToast = usePlatformStore((s) => s.pushToast);

  const [isDragging, setIsDragging] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CartridgeDiagnosticSummary | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [pendingJson, setPendingJson] = useState<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const processText = useCallback((text: string) => {
    setDiagnostics(null);
    setIssues([]);
    setPendingJson(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setIssues(['El archivo no es un JSON valido.']);
      return;
    }
    const result = validateBookCartridge(parsed);
    if (result.success) {
      setDiagnostics(result.diagnostics);
      setPendingJson(result.cartridge);
    } else {
      setIssues(result.issues);
    }
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const MAX_CARTRIDGE_BYTES = 25 * 1024 * 1024;
      if (file.size > MAX_CARTRIDGE_BYTES) {
        setIssues(['El archivo excede el limite maximo permitido de 25 MB.']);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => processText(String(reader.result ?? ''));
      reader.onerror = () => setIssues(['No se pudo leer el archivo seleccionado.']);
      reader.readAsText(file);
    },
    [processText]
  );

  const handleInstall = async () => {
    if (!pendingJson) return;
    const result = validateBookCartridge(pendingJson);
    if (!result.success) return;
    await registerCartridge(result.cartridge, true);
    pushToast({
      title: 'Cartucho instalado',
      description: `${result.cartridge.metadata.title} ya esta disponible offline.`,
      iconKey: 'check',
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Importar Cartucho JSON"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border border-subtle bg-surface">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <h3 className="text-sm font-semibold text-primary">Importar Cartucho JSON</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="text-muted hover:text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
              isDragging ? 'border-accent bg-accent/5' : 'border-subtle hover:border-accent/50'
            )}
          >
            <Upload size={22} className="text-muted" />
            <p className="text-xs text-muted">
              Arrastra un <span className="code-font text-accent">cartridge.json</span> compilado o haz clic para seleccionar.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {issues.length > 0 && (
            <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertTriangle size={13} /> Esquema invalido
              </p>
              <ul className="space-y-0.5">
                {issues.slice(0, 8).map((issue, idx) => (
                  <li key={idx} className="code-font text-[10px] text-danger/90">
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diagnostics && (
            <div className="mt-3 rounded-md border border-success/40 bg-success/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-success">
                <CheckCircle2 size={13} /> Cartucho valido
              </p>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <span className="text-muted">Titulo:</span>
                <span className="text-primary">{diagnostics.title}</span>
                <span className="text-muted">Dificultad:</span>
                <span className="text-primary">{diagnostics.difficulty}</span>
                <span className="text-muted">Tema:</span>
                <span className="text-primary">{diagnostics.themeName}</span>
                <span className="text-muted">Capitulos:</span>
                <span className="text-primary">{diagnostics.chapterCount}</span>
                <span className="text-muted">Micro-lecciones:</span>
                <span className="text-primary">{diagnostics.lessonCount}</span>
                <span className="text-muted">Bloques interactivos:</span>
                <span className="text-primary">{diagnostics.interactiveBlocks}</span>
                <span className="text-muted">Flashcards:</span>
                <span className="text-primary">{diagnostics.flashcardCount}</span>
                <span className="text-muted">Paquetes:</span>
                <span className="text-primary">
                  {diagnostics.packages.length > 0 ? diagnostics.packages.join(', ') : 'ninguno'}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-subtle px-3 py-1.5 text-xs text-muted hover:text-primary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleInstall}
            disabled={!diagnostics}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-canvas disabled:opacity-40"
          >
            <FileJson size={13} /> Instalar en Biblioteca
          </button>
        </div>
      </div>
    </div>
  );
}

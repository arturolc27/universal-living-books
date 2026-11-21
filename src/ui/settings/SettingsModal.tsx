import { useEffect, useState } from 'react';
import { X, KeyRound, Cloud, Download, Upload, Trash2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useCloudSyncState } from '../../db/cloudSyncClient';
import { exportSyncSnapshot, importSyncSnapshot, syncWithSupabase } from '../../db/syncService';
import { livingBooksDb } from '../../db/dexieDb';
import { ModelCombobox } from './ModelCombobox';
import { cn } from '../utils/cn';
import { isSafeSupabaseUrl } from '../utils/sanitize';

type Tab = 'COMPILER' | 'SYNC' | 'DATA';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = usePlatformStore((s) => s.settings);
  const setSettings = usePlatformStore((s) => s.setSettings);
  const syncWithServer = usePlatformStore((s) => s.syncWithServer);
  const pushToast = usePlatformStore((s) => s.pushToast);
  const cloudSync = useCloudSyncState();
  const [tab, setTab] = useState<Tab>('COMPILER');
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleVpsSyncNow = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await syncWithServer();
      if (res.synced) {
        setStatus(
          `Sincronizado con tu VPS. Libros descargados: ${res.booksPulled}, subidos: ${res.booksPushed}.`
        );
      } else {
        setStatus('No se pudo conectar al servidor de tu VPS (modo offline activo).');
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportSyncSnapshot('living-books-ui');
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `living-books-sync-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Snapshot exportado.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    setBusy(true);
    try {
      const result = await importSyncSnapshot(importText);
      setStatus(`Importados ${result.mergedRecords} registros.`);
      pushToast({ title: 'Sincronizacion importada', description: `${result.mergedRecords} registros fusionados.`, iconKey: 'check' });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSupabase = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
      setStatus('Configura la URL y la anon key de Supabase.');
      return;
    }
    if (!isSafeSupabaseUrl(settings.supabaseUrl)) {
      setStatus('La URL de Supabase debe usar HTTPS (o localhost en desarrollo).');
      return;
    }
    setBusy(true);
    try {
      const result = await syncWithSupabase(settings.supabaseUrl, settings.supabaseAnonKey, settings.supabaseSyncKey);
      setStatus(`Sync ${result.status}. ${result.mergedRecords} registros fusionados.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Esto borrara todo tu progreso, cartuchos importados y repasos de este navegador. Continuar?')) return;
    await livingBooksDb.delete();
    window.location.reload();
  };

  const tabs: Array<{ id: Tab; label: string; icon: typeof KeyRound }> = [
    { id: 'COMPILER', label: 'Compilador', icon: KeyRound },
    { id: 'SYNC', label: 'Sincronizacion', icon: Cloud },
    { id: 'DATA', label: 'Datos', icon: Trash2 },
  ];

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass-strong flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-subtle">
        <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
          <h3 className="text-sm font-semibold text-primary">Configuracion</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-primary">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-subtle px-2 py-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors',
                tab === t.id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-primary'
              )}
            >
              <t.icon size={12} /> {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'COMPILER' && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted">
                Proveedor LLM para compilar libros, traducir lecciones y generar ejercicios IA. Tus ajustes se sincronizan automáticamente en tu VPS entre PC, móvil y otros navegadores.
              </p>

              <div>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Proveedor</span>
                <div className="flex gap-1.5">
                  {(['openrouter', 'gemini'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSettings({ llmProvider: p })}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                        settings.llmProvider === p
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-subtle text-muted hover:text-primary'
                      )}
                    >
                      {p === 'openrouter' ? 'OpenRouter (recomendado)' : 'Google Gemini'}
                    </button>
                  ))}
                </div>
              </div>

              {settings.llmProvider === 'openrouter' ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">OpenRouter API Key</span>
                    <input
                      type="password"
                      value={settings.openrouterApiKey}
                      onChange={(e) => setSettings({ openrouterApiKey: e.target.value })}
                      placeholder="sk-or-v1-..."
                      className="code-font w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                    />
                  </label>
                  <div>
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Modelo por defecto</span>
                    <ModelCombobox
                      value={settings.openrouterModel}
                      onChange={(modelId) => setSettings({ openrouterModel: modelId })}
                    />
                  </div>
                  <p className="text-[10px] text-muted">
                    Se cargan todos los modelos de OpenRouter (incluido DeepSeek). Obten tu clave en openrouter.ai/keys.
                  </p>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Gemini API Key</span>
                    <input
                      type="password"
                      value={settings.geminiApiKey}
                      onChange={(e) => setSettings({ geminiApiKey: e.target.value })}
                      placeholder="AIza..."
                      className="code-font w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Modelo</span>
                    <input
                      value={settings.geminiModel}
                      onChange={(e) => setSettings({ geminiModel: e.target.value })}
                      className="code-font w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                    />
                  </label>
                </>
              )}
            </div>
          )}

          {tab === 'SYNC' && (
            <div className="space-y-3">
              {/* Panel Nube Propia (VPS) */}
              <div className="rounded-xl border border-accent/40 bg-accent/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-bold text-accent">
                      <Cloud size={13} /> Nube Propia en tu VPS (Automática)
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Estado:{' '}
                      <strong className="text-primary">
                        {cloudSync.status === 'SYNCED'
                          ? 'Conectado y sincronizado'
                          : cloudSync.status === 'SYNCING'
                            ? 'Sincronizando...'
                            : cloudSync.status === 'OFFLINE'
                              ? 'Sin conexión (se subirá al reconectar)'
                              : cloudSync.status === 'UNAUTHORIZED'
                                ? 'Requiere PIN de acceso'
                                : 'Servidor local no detectado'}
                      </strong>
                    </p>
                    {cloudSync.lastSyncedAt && (
                      <p className="text-[10px] text-muted">
                        Última sincronización: {new Date(cloudSync.lastSyncedAt).toLocaleTimeString()} ·{' '}
                        {cloudSync.serverBooksCount} libros en servidor
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy || cloudSync.status === 'SYNCING'}
                    onClick={() => void handleVpsSyncNow()}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-canvas disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={cloudSync.status === 'SYNCING' ? 'animate-spin' : ''} />
                    Sincronizar
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-muted">
                Respaldo manual opcional: exporta o importa un snapshot JSON entre dispositivos sin conexión.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={handleExport} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-subtle py-2 text-xs text-primary hover:border-accent/50">
                  <Download size={13} /> Exportar
                </button>
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Pega aqui un snapshot JSON o codigo LBSYNC2:..."
                className="code-font h-24 w-full resize-none rounded-lg border border-subtle bg-canvas p-2 text-[11px] text-primary outline-none focus:border-accent"
              />
              <button type="button" onClick={handleImport} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-subtle py-2 text-xs text-primary hover:border-accent/50 disabled:opacity-50">
                <Upload size={13} /> Importar snapshot
              </button>

              <div className="border-t border-subtle pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Supabase (opcional)</p>
                <input
                  value={settings.supabaseUrl}
                  onChange={(e) => setSettings({ supabaseUrl: e.target.value })}
                  placeholder="https://xxxx.supabase.co"
                  className="code-font mb-2 w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-[11px] text-primary outline-none focus:border-accent"
                />
                <input
                  type="password"
                  value={settings.supabaseAnonKey}
                  onChange={(e) => setSettings({ supabaseAnonKey: e.target.value })}
                  placeholder="anon key"
                  className="code-font mb-2 w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-[11px] text-primary outline-none focus:border-accent"
                />
                <input
                  value={settings.supabaseSyncKey}
                  onChange={(e) => setSettings({ supabaseSyncKey: e.target.value })}
                  placeholder="sync key"
                  className="code-font mb-2 w-full rounded-lg border border-subtle bg-canvas px-3 py-2 text-[11px] text-primary outline-none focus:border-accent"
                />
                <button type="button" onClick={handleSupabase} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs font-semibold text-canvas disabled:opacity-50">
                  <Cloud size={13} /> Sincronizar ahora
                </button>
              </div>
            </div>
          )}

          {tab === 'DATA' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
                <AlertTriangle size={15} className="mt-0.5 text-danger" />
                <div>
                  <p className="text-xs font-semibold text-danger">Zona de peligro</p>
                  <p className="text-[11px] text-muted">
                    Borra todo el progreso, cartuchos importados, codigo guardado y repasos SM-2 de este navegador.
                  </p>
                </div>
              </div>
              <button type="button" onClick={handleReset} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-danger/50 py-2 text-xs font-semibold text-danger hover:bg-danger/10">
                <Trash2 size={13} /> Borrar todos los datos
              </button>
            </div>
          )}

          {status && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-subtle bg-canvas p-2 text-[11px] text-muted">
              <CheckCircle2 size={13} className="mt-0.5 text-success" />
              <span>{status}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-subtle px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-canvas">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

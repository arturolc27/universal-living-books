import { useSyncExternalStore } from 'react';
import type { BookCartridge } from '../types/cartridge.types';
import { livingBooksDb } from './dexieDb';
import { exportSyncSnapshot, importSyncSnapshot, type SyncDeltaSnapshot } from './syncService';
import { getStoredAccessPinHash } from '../ui/security/AccessGate';

export type CloudSyncStatus =
  | 'IDLE'
  | 'SYNCING'
  | 'SYNCED'
  | 'OFFLINE'
  | 'UNAUTHORIZED'
  | 'UNAVAILABLE';

export interface CloudSyncState {
  status: CloudSyncStatus;
  lastSyncedAt: number | null;
  serverBooksCount: number;
  lastError: string | null;
  authRequired: boolean;
}

interface BootstrapResponse {
  serverTime: number;
  settings: { settings: Record<string, unknown>; updatedAt: number } | null;
  state: SyncDeltaSnapshot | null;
  booksManifest: Array<{ bookId: string; updatedAt: number; sizeBytes: number; title?: string }>;
}

const SETTINGS_TS_KEY = 'living_books_settings_updated_at_v2';

export function getLocalSettingsUpdatedAt(): number {
  if (typeof localStorage === 'undefined') return 0;
  const raw = localStorage.getItem(SETTINGS_TS_KEY);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function setLocalSettingsUpdatedAt(ts: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_TS_KEY, String(ts));
  } catch {
    // ignore storage errors
  }
}

let currentState: CloudSyncState = {
  status: 'IDLE',
  lastSyncedAt: null,
  serverBooksCount: 0,
  lastError: null,
  authRequired: false,
};

const listeners = new Set<() => void>();

function updateState(partial: Partial<CloudSyncState>) {
  currentState = { ...currentState, ...partial };
  for (const listener of listeners) {
    listener();
  }
}

export function getCloudSyncState(): CloudSyncState {
  return currentState;
}

export function subscribeCloudSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCloudSyncState(): CloudSyncState {
  return useSyncExternalStore(subscribeCloudSync, getCloudSyncState, getCloudSyncState);
}

function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const pinHash = getStoredAccessPinHash();
  if (pinHash) {
    headers['X-ULB-Auth'] = pinHash;
  }
  return headers;
}

function isBrowserFetchAvailable(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

let serverAvailableCache: boolean | null = null;

async function checkServerHealth(): Promise<{ available: boolean; authRequired: boolean; booksCount: number }> {
  if (!isBrowserFetchAvailable()) {
    return { available: false, authRequired: false, booksCount: 0 };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    updateState({ status: 'OFFLINE', lastError: null });
    return { available: false, authRequired: false, booksCount: 0 };
  }
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) {
      serverAvailableCache = false;
      updateState({ status: 'UNAVAILABLE', lastError: null });
      return { available: false, authRequired: false, booksCount: 0 };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      serverAvailableCache = false;
      updateState({ status: 'UNAVAILABLE', lastError: null });
      return { available: false, authRequired: false, booksCount: 0 };
    }
    const data = (await res.json()) as { ok?: boolean; persistence?: boolean; authRequired?: boolean; booksCount?: number };
    if (!data?.ok || !data?.persistence) {
      serverAvailableCache = false;
      updateState({ status: 'UNAVAILABLE', lastError: null });
      return { available: false, authRequired: false, booksCount: 0 };
    }
    serverAvailableCache = true;
    updateState({
      authRequired: Boolean(data.authRequired),
      serverBooksCount: data.booksCount ?? 0,
    });
    return {
      available: true,
      authRequired: Boolean(data.authRequired),
      booksCount: data.booksCount ?? 0,
    };
  } catch {
    updateState({ status: 'OFFLINE', lastError: null });
    return { available: false, authRequired: false, booksCount: 0 };
  }
}

export interface BootstrapHooks {
  getLocalSettings: () => Record<string, unknown>;
  applyServerSettings: (settings: Record<string, unknown>, updatedAt: number) => void;
  registerDownloadedBook: (cartridge: BookCartridge, installedAt: number) => Promise<void>;
  removeLocallyDeletedBook: (bookId: string) => Promise<void>;
  reloadStoreFromDb: () => Promise<void>;
}

let inFlightBootstrap: Promise<{ synced: boolean; booksPulled: number; booksPushed: number }> | null = null;

/**
 * Sincronización bidireccional completa con tu VPS:
 * 1. Ajustes y API keys (Last-Write-Wins, priorizando servidor si el navegador está recién abierto).
 * 2. Libros compilados/importados (descarga nuevos del servidor y sube los que existan solo localmente).
 * 3. Estado de aprendizaje completo (progreso, FSRS, código guardado, logros, Ruta Python, ejercicios IA).
 */
export async function syncAllWithSelfHostedServer(
  hooks: BootstrapHooks
): Promise<{ synced: boolean; booksPulled: number; booksPushed: number }> {
  if (inFlightBootstrap) return inFlightBootstrap;

  inFlightBootstrap = (async () => {
    const health = await checkServerHealth();
    if (!health.available) {
      return { synced: false, booksPulled: 0, booksPushed: 0 };
    }

    updateState({ status: 'SYNCING', lastError: null });
    let booksPulled = 0;
    let booksPushed = 0;

    try {
      const bootRes = await fetch('/api/bootstrap', {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });

      if (bootRes.status === 401) {
        updateState({
          status: 'UNAUTHORIZED',
          lastError: 'Desbloquea con tu PIN de acceso para sincronizar con el servidor.',
        });
        return { synced: false, booksPulled: 0, booksPushed: 0 };
      }
      if (!bootRes.ok) {
        throw new Error(`Bootstrap HTTP ${bootRes.status}`);
      }

      const boot = (await bootRes.json()) as BootstrapResponse;

      // 1. Sincronizar configuración / API Keys
      const localSettings = hooks.getLocalSettings();
      const localSettingsTs = getLocalSettingsUpdatedAt();
      const localHasKeys = Boolean(
        (localSettings.openrouterApiKey as string)?.trim() ||
          (localSettings.geminiApiKey as string)?.trim()
      );
      const serverHasSettings = Boolean(boot.settings?.settings);

      if (serverHasSettings && boot.settings) {
        const serverTs = boot.settings.updatedAt ?? 0;
        const serverHasKeys = Boolean(
          (boot.settings.settings.openrouterApiKey as string)?.trim() ||
            (boot.settings.settings.geminiApiKey as string)?.trim()
        );
        if (serverTs > localSettingsTs || (!localHasKeys && serverHasKeys)) {
          hooks.applyServerSettings(boot.settings.settings, serverTs);
          setLocalSettingsUpdatedAt(serverTs);
        } else if (localSettingsTs > serverTs && localHasKeys) {
          await pushSettingsToCloud(localSettings, localSettingsTs);
        }
      } else if (localHasKeys || localSettingsTs > 0) {
        const ts = localSettingsTs || Date.now();
        setLocalSettingsUpdatedAt(ts);
        await pushSettingsToCloud(localSettings, ts);
      }

      // 2. Sincronizar libros instalados (tombstones + pull + push)
      const localInstalled = await livingBooksDb.installedCartridges.toArray();
      const localById = new Map(localInstalled.map((r) => [r.bookId, r]));
      const tombstones = boot.state?.deletedBookIds ?? {};

      // Aplicar eliminaciones remotas (si el tombstone es más reciente que la instalación local)
      for (const [deletedId, deletedAt] of Object.entries(tombstones)) {
        const localRec = localById.get(deletedId);
        if (localRec && deletedAt > (localRec.installedAt ?? 0)) {
          await hooks.removeLocallyDeletedBook(deletedId);
          localById.delete(deletedId);
        }
      }

      const serverManifestById = new Map(boot.booksManifest.map((m) => [m.bookId, m]));

      // Descargar libros del servidor que faltan localmente o son más recientes en el servidor
      for (const item of boot.booksManifest) {
        const localRec = localById.get(item.bookId);
        if (!localRec || item.updatedAt > (localRec.installedAt ?? 0)) {
          const bookRes = await fetch(`/api/books/${encodeURIComponent(item.bookId)}`, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          });
          if (bookRes.ok) {
            const doc = (await bookRes.json()) as {
              bookId: string;
              updatedAt: number;
              cartridge: BookCartridge;
            };
            if (doc?.cartridge) {
              await hooks.registerDownloadedBook(doc.cartridge, doc.updatedAt || Date.now());
              booksPulled += 1;
            }
          }
        }
      }

      // Subir libros locales instalados que no están aún en el servidor (o son más recientes localmente)
      for (const localRec of localById.values()) {
        const remote = serverManifestById.get(localRec.bookId);
        if (!remote || (localRec.installedAt ?? 0) > remote.updatedAt) {
          const ok = await pushBookToCloud(localRec.cartridgeJson, localRec.installedAt || Date.now());
          if (ok) booksPushed += 1;
        }
      }

      // 3. Fusión bidireccional LWW de estado (progreso, FSRS, código, Ruta Python, IA)
      const localSnapshotJson = await exportSyncSnapshot('vps-client');
      const syncRes = await fetch('/api/state/sync', {
        method: 'POST',
        headers: buildHeaders({ 'Content-Type': 'application/json' }),
        body: localSnapshotJson,
      });

      if (syncRes.ok) {
        const { state: mergedState } = (await syncRes.json()) as { state: SyncDeltaSnapshot };
        if (mergedState) {
          await importSyncSnapshot(JSON.stringify(mergedState));
        }
      }

      await hooks.reloadStoreFromDb();

      updateState({
        status: 'SYNCED',
        lastSyncedAt: Date.now(),
        serverBooksCount: Math.max(boot.booksManifest.length + booksPushed, localById.size),
        lastError: null,
      });

      return { synced: true, booksPulled, booksPushed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateState({
        status: typeof navigator !== 'undefined' && !navigator.onLine ? 'OFFLINE' : 'IDLE',
        lastError: msg,
      });
      return { synced: false, booksPulled, booksPushed };
    } finally {
      inFlightBootstrap = null;
    }
  })();

  return inFlightBootstrap;
}

export async function pushBookToCloud(
  cartridge: BookCartridge,
  updatedAt = Date.now()
): Promise<boolean> {
  if (!isBrowserFetchAvailable()) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    updateState({ status: 'OFFLINE' });
    return false;
  }
  if (serverAvailableCache === false) return false;

  try {
    updateState({ status: 'SYNCING' });
    const res = await fetch(`/api/books/${encodeURIComponent(cartridge.bookId)}`, {
      method: 'PUT',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bookId: cartridge.bookId, updatedAt, cartridge }),
    });
    if (res.status === 401) {
      updateState({ status: 'UNAUTHORIZED' });
      return false;
    }
    if (!res.ok) return false;
    serverAvailableCache = true;
    updateState({ status: 'SYNCED', lastSyncedAt: Date.now(), lastError: null });
    return true;
  } catch {
    updateState({ status: 'OFFLINE' });
    return false;
  }
}

export async function deleteBookFromCloud(bookId: string): Promise<boolean> {
  if (!isBrowserFetchAvailable() || serverAvailableCache === false) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}`, {
      method: 'DELETE',
      headers: buildHeaders(),
    });
    if (res.ok) {
      updateState({ status: 'SYNCED', lastSyncedAt: Date.now() });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function pushSettingsToCloud(
  settings: Record<string, unknown>,
  updatedAt = Date.now()
): Promise<boolean> {
  if (!isBrowserFetchAvailable() || serverAvailableCache === false) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    updateState({ status: 'OFFLINE' });
    return false;
  }
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ settings, updatedAt }),
    });
    if (res.status === 401) {
      updateState({ status: 'UNAUTHORIZED' });
      return false;
    }
    if (!res.ok) return false;
    serverAvailableCache = true;
    updateState({ status: 'SYNCED', lastSyncedAt: Date.now(), lastError: null });
    return true;
  } catch {
    updateState({ status: 'OFFLINE' });
    return false;
  }
}

let stateTimer: ReturnType<typeof setTimeout> | null = null;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleCloudStateSync(delayMs = 1100): void {
  if (!isBrowserFetchAvailable() || serverAvailableCache === false) return;
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    stateTimer = null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      updateState({ status: 'OFFLINE' });
      return;
    }
    void (async () => {
      try {
        updateState({ status: 'SYNCING' });
        const json = await exportSyncSnapshot('vps-auto-push');
        const res = await fetch('/api/state/sync', {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: json,
        });
        if (res.status === 401) {
          updateState({ status: 'UNAUTHORIZED' });
          return;
        }
        if (res.ok) {
          const { state } = (await res.json()) as { state: SyncDeltaSnapshot };
          if (state) {
            await importSyncSnapshot(JSON.stringify(state));
          }
          updateState({ status: 'SYNCED', lastSyncedAt: Date.now(), lastError: null });
        }
      } catch {
        updateState({ status: 'OFFLINE' });
      }
    })();
  }, delayMs);
}

export function scheduleCloudSettingsPush(
  settings: Record<string, unknown>,
  updatedAt: number,
  delayMs = 600
): void {
  if (!isBrowserFetchAvailable() || serverAvailableCache === false) return;
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    void pushSettingsToCloud(settings, updatedAt);
  }, delayMs);
}

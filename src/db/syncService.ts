import { createClient } from '@supabase/supabase-js';
import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';
import type { PcLabQueueItem } from '../store/usePlatformStore';
import {
  livingBooksDb,
  type LessonProgressRecord,
  type SavedUserCodeRecord,
  type SrsCardStateRecord,
  type UnlockedAchievementRecord,
  type UserStatsRecord,
} from './dexieDb';

export interface SyncDeltaSnapshot {
  snapshotVersion: '2.0';
  exportedAt: number;
  deviceTag: string;
  lessonProgress: LessonProgressRecord[];
  srsCardsState: SrsCardStateRecord[];
  savedUserCode: SavedUserCodeRecord[];
  unlockedAchievements: UnlockedAchievementRecord[];
  userStats: UserStatsRecord | null;
  pcLabQueue?: PcLabQueueItem[];
}

export interface SupabaseSyncConfig {
  url: string;
  anonKey: string;
  syncKey: string;
}

const SUPABASE_CONFIG_STORAGE_KEY = 'living_books_supabase_sync_v2';
const PC_LAB_QUEUE_STORAGE_KEY = 'ulb_pc_lab_queue';

function readPcLabQueue(): PcLabQueueItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PC_LAB_QUEUE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergePcLabQueue(incoming: PcLabQueueItem[] | undefined): void {
  if (typeof localStorage === 'undefined' || !incoming || incoming.length === 0) return;
  const current = readPcLabQueue();
  const seen = new Set(current.map((q) => `${q.bookId}::${q.lessonId}::${q.blockId}`));
  const merged = [...current];
  for (const item of incoming) {
    const key = `${item.bookId}::${item.lessonId}::${item.blockId}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  localStorage.setItem(PC_LAB_QUEUE_STORAGE_KEY, JSON.stringify(merged));
}

export function loadSavedSupabaseConfig(): SupabaseSyncConfig | null {
  try {
    const raw = localStorage.getItem(SUPABASE_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupabaseSyncConfig>;
    if (parsed.url && parsed.anonKey && parsed.syncKey) {
      return {
        url: parsed.url,
        anonKey: parsed.anonKey,
        syncKey: parsed.syncKey,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSupabaseConfig(config: SupabaseSyncConfig | null): void {
  if (!config) {
    localStorage.removeItem(SUPABASE_CONFIG_STORAGE_KEY);
    return;
  }
  localStorage.setItem(SUPABASE_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export async function exportSyncSnapshot(deviceTag = 'living-book-client'): Promise<string> {
  const [lessonProgress, srsCardsState, savedUserCode, unlockedAchievements, userStats] =
    await Promise.all([
      livingBooksDb.lessonProgress.toArray(),
      livingBooksDb.srsCardsState.toArray(),
      livingBooksDb.savedUserCode.toArray(),
      livingBooksDb.unlockedAchievements.toArray(),
      livingBooksDb.userStats.get('global'),
    ]);

  const payload: SyncDeltaSnapshot = {
    snapshotVersion: '2.0',
    exportedAt: Date.now(),
    deviceTag,
    lessonProgress,
    srsCardsState,
    savedUserCode,
    unlockedAchievements,
    userStats: userStats ?? null,
    pcLabQueue: readPcLabQueue(),
  };

  return JSON.stringify(payload, null, 2);
}

export async function exportCompactSyncCode(): Promise<string> {
  const json = await exportSyncSnapshot('compact-qr-bridge');
  const minified = JSON.stringify(JSON.parse(json));
  const compressed = zlibSync(strToU8(minified), { level: 6 });
  let binary = '';
  for (const byte of compressed) {
    binary += String.fromCharCode(byte);
  }
  return `LBSYNCZ2:${btoa(binary)}`;
}

export async function importSyncSnapshot(
  rawInput: string
): Promise<{ mergedRecords: number; exportedAt: number }> {
  let jsonText = rawInput.trim();
  if (jsonText.startsWith('LBSYNCZ2:')) {
    const base64 = jsonText.slice('LBSYNCZ2:'.length);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    jsonText = strFromU8(unzlibSync(bytes));
  } else if (jsonText.startsWith('LBSYNC2:')) {
    const base64 = jsonText.slice('LBSYNC2:'.length);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    jsonText = new TextDecoder().decode(bytes);
  }

  const snapshot = JSON.parse(jsonText) as SyncDeltaSnapshot;
  if (snapshot.snapshotVersion !== '2.0') {
    throw new Error('Incompatible sync snapshot version. Expected v2.0.');
  }
  mergePcLabQueue(snapshot.pcLabQueue);

  let mergedRecords = 0;

  await livingBooksDb.transaction(
    'rw',
    [
      livingBooksDb.lessonProgress,
      livingBooksDb.srsCardsState,
      livingBooksDb.savedUserCode,
      livingBooksDb.unlockedAchievements,
      livingBooksDb.userStats,
    ],
    async () => {
      for (const incoming of snapshot.lessonProgress ?? []) {
        const current = await livingBooksDb.lessonProgress.get([
          incoming.bookId,
          incoming.lessonId,
        ]);
        if (!current || incoming.updatedAt >= current.updatedAt) {
          await livingBooksDb.lessonProgress.put(incoming);
          mergedRecords += 1;
        }
      }

      for (const incoming of snapshot.srsCardsState ?? []) {
        const current = await livingBooksDb.srsCardsState.get([incoming.bookId, incoming.cardId]);
        if (!current || incoming.updatedAt >= current.updatedAt) {
          await livingBooksDb.srsCardsState.put(incoming);
          mergedRecords += 1;
        }
      }

      for (const incoming of snapshot.savedUserCode ?? []) {
        const current = await livingBooksDb.savedUserCode.get([
          incoming.bookId,
          incoming.blockId,
        ]);
        if (!current || incoming.updatedAt >= current.updatedAt) {
          await livingBooksDb.savedUserCode.put(incoming);
          mergedRecords += 1;
        }
      }

      for (const incoming of snapshot.unlockedAchievements ?? []) {
        const current = await livingBooksDb.unlockedAchievements.get([
          incoming.bookId,
          incoming.achievementId,
        ]);
        if (!current || incoming.unlockedAt < current.unlockedAt) {
          await livingBooksDb.unlockedAchievements.put(incoming);
          mergedRecords += 1;
        }
      }

      if (snapshot.userStats) {
        const currentStats = await livingBooksDb.userStats.get('global');
        if (!currentStats || snapshot.userStats.updatedAt >= currentStats.updatedAt) {
          await livingBooksDb.userStats.put({ ...snapshot.userStats, id: 'global' });
          mergedRecords += 1;
        }
      }
    }
  );

  return { mergedRecords, exportedAt: snapshot.exportedAt };
}

/**
 * Bidirectional Last-Write-Wins sync using a single lightweight Supabase table:
 * `living_book_sync_snapshots (sync_key text primary key, payload jsonb, updated_at bigint)`
 */
export async function syncWithSupabase(
  url: string,
  anonKey: string,
  syncKey = 'default-learner'
): Promise<{ status: 'PUSHED' | 'PULLED_AND_PUSHED'; mergedRecords: number }> {
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  const { data: remoteRow, error: fetchError } = await supabase
    .from('living_book_sync_snapshots')
    .select('payload, updated_at')
    .eq('sync_key', syncKey)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Supabase fetch failed: ${fetchError.message}`);
  }

  let mergedRecords = 0;
  if (remoteRow?.payload) {
    const payloadStr =
      typeof remoteRow.payload === 'string'
        ? remoteRow.payload
        : JSON.stringify(remoteRow.payload);
    const result = await importSyncSnapshot(payloadStr);
    mergedRecords = result.mergedRecords;
  }

  const mergedSnapshotJson = await exportSyncSnapshot('supabase-lww-client');
  const mergedSnapshotObj = JSON.parse(mergedSnapshotJson) as SyncDeltaSnapshot;

  const { error: upsertError } = await supabase.from('living_book_sync_snapshots').upsert(
    {
      sync_key: syncKey,
      payload: mergedSnapshotObj,
      updated_at: Date.now(),
    },
    { onConflict: 'sync_key' }
  );

  if (upsertError) {
    throw new Error(`Supabase upsert failed: ${upsertError.message}`);
  }

  return {
    status: remoteRow ? 'PULLED_AND_PUSHED' : 'PUSHED',
    mergedRecords,
  };
}

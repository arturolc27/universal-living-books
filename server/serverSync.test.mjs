import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLivingBooksServer } from './index.mjs';

describe('Self-Hosted VPS Sync Server (server/index.mjs)', () => {
  const TEST_PIN_HASH = 'a'.repeat(64);
  let tmpDir;
  let distDir;
  let server;
  let baseUrl;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ulb-sync-test-'));
    distDir = path.join(tmpDir, 'dist');
    const dataDir = path.join(tmpDir, 'data');
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, 'index.html'), '<!doctype html><html><body>ULB</body></html>');

    server = createLivingBooksServer({
      distDir,
      dataDir,
      expectedPinHash: TEST_PIN_HASH,
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  const authHeaders = {
    'X-ULB-Auth': TEST_PIN_HASH,
    'Content-Type': 'application/json',
  };

  it('serves /api/health publicly and blocks unauthenticated /api/bootstrap with 401', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    const healthJson = await health.json();
    expect(healthJson).toMatchObject({ ok: true, persistence: true, authRequired: true });

    const unauth = await fetch(`${baseUrl}/api/bootstrap`);
    expect(unauth.status).toBe(401);

    const wrong = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { 'X-ULB-Auth': 'b'.repeat(64) },
    });
    expect(wrong.status).toBe(401);
  });

  it('persists settings across devices with LWW timestamps', async () => {
    const put1 = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        updatedAt: 2000,
        settings: { llmProvider: 'openrouter', openrouterApiKey: 'sk-test-123' },
      }),
    });
    expect(put1.status).toBe(200);

    // Un dispositivo con timestamp más viejo no debe sobrescribir la key más nueva
    const stalePut = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        updatedAt: 1000,
        settings: { llmProvider: 'gemini', openrouterApiKey: '' },
      }),
    });
    expect(stalePut.status).toBe(200);

    const boot = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: authHeaders })).json();
    expect(boot.settings.updatedAt).toBe(2000);
    expect(boot.settings.settings.openrouterApiKey).toBe('sk-test-123');
  });

  it('persists, downloads, and deletes compiled books with tombstones', async () => {
    const sampleCartridge = {
      schemaVersion: '2.0',
      bookId: 'fluent-python-2e',
      metadata: { title: 'Fluent Python', subtitle: '', authors: ['Luciano'], edition: '2e', difficulty: 'ADVANCED', coverAccentIcon: '🐍' },
      chapters: [{ chapterId: 'c1', number: 1, title: 'Data Model', summary: '', microLessons: [] }],
    };

    const putRes = await fetch(`${baseUrl}/api/books/fluent-python-2e`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ updatedAt: 5000, cartridge: sampleCartridge }),
    });
    expect(putRes.status).toBe(200);

    const boot = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: authHeaders })).json();
    expect(boot.booksManifest.some((b) => b.bookId === 'fluent-python-2e')).toBe(true);

    const getBook = await (await fetch(`${baseUrl}/api/books/fluent-python-2e`, { headers: authHeaders })).json();
    expect(getBook.cartridge.metadata.title).toBe('Fluent Python');

    const delRes = await fetch(`${baseUrl}/api/books/fluent-python-2e`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(200);

    const bootAfter = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: authHeaders })).json();
    expect(bootAfter.booksManifest.some((b) => b.bookId === 'fluent-python-2e')).toBe(false);
    expect(bootAfter.state.deletedBookIds['fluent-python-2e']).toBeGreaterThan(0);
  });

  it('merges bidirectional LWW learning state across two devices without losing newer progress', async () => {
    // Dispositivo A (PC)
    await fetch(`${baseUrl}/api/state/sync`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        snapshotVersion: '2.1',
        exportedAt: 1000,
        deviceTag: 'pc',
        lessonProgress: [
          { bookId: 'b1', lessonId: 'l1', unlockedBlockIndex: 4, isCompleted: true, masteryTier: 'GOLD', hadMistakes: false, updatedAt: 5000 },
        ],
        srsCardsState: [],
        savedUserCode: [],
        unlockedAchievements: [],
        globalCompetencyMastery: [
          { competencyId: 'py.memory.aliasing', status: 'MASTERED', masteryScore: 88, predictionHits: 3, predictionAttempts: 3, activeExercisesPassed: 2, activeExercisesAttempts: 2, transferPassed: true, delayedReviewPassed: true, fsrsMaxStability: 10, misconceptionHits: {}, misconceptionResolved: [], sourceBookIds: ['b1'], lastPracticedAt: 5000, updatedAt: 5000 },
        ],
        userStats: { id: 'global', currentStreakDays: 2, lastStudyDate: '2026-11-21', totalFirstTryHits: 5, totalAttempts: 6, currentFirstTryStreak: 2, astMasteryCount: 1, srsReviewsCount: 3, updatedAt: 5000 },
      }),
    });

    // Dispositivo B (Móvil) tiene progreso viejo en l1 pero nuevo en l2
    const syncB = await fetch(`${baseUrl}/api/state/sync`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        snapshotVersion: '2.1',
        exportedAt: 6000,
        deviceTag: 'mobile',
        lessonProgress: [
          { bookId: 'b1', lessonId: 'l1', unlockedBlockIndex: 1, isCompleted: false, masteryTier: 'IN_PROGRESS', hadMistakes: false, updatedAt: 2000 },
          { bookId: 'b1', lessonId: 'l2', unlockedBlockIndex: 3, isCompleted: true, masteryTier: 'SILVER', hadMistakes: true, updatedAt: 6000 },
        ],
        srsCardsState: [],
        savedUserCode: [],
        unlockedAchievements: [],
        globalCompetencyMastery: [],
        userStats: { id: 'global', currentStreakDays: 2, lastStudyDate: '2026-11-21', totalFirstTryHits: 1, totalAttempts: 2, currentFirstTryStreak: 1, astMasteryCount: 0, srsReviewsCount: 4, updatedAt: 6000 },
      }),
    });
    expect(syncB.status).toBe(200);
    const { state } = await syncB.json();

    const l1 = state.lessonProgress.find((p) => p.lessonId === 'l1');
    const l2 = state.lessonProgress.find((p) => p.lessonId === 'l2');
    expect(l1.masteryTier).toBe('GOLD');
    expect(l2.masteryTier).toBe('SILVER');
    expect(state.globalCompetencyMastery).toHaveLength(1);
    expect(state.userStats.srsReviewsCount).toBe(4);
    expect(state.userStats.totalFirstTryHits).toBe(5);
  });

  it('serves SPA fallback and blocks hidden files', async () => {
    const spa = await fetch(`${baseUrl}/some/client/route`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('ULB');

    const hidden = await fetch(`${baseUrl}/.env`);
    expect(hidden.status).toBe(403);
  });
});

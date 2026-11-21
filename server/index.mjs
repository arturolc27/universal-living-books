import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE_EXTS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.txt',
]);

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; worker-src 'self' blob:; connect-src 'self' https://openrouter.ai https://generativelanguage.googleapis.com https://*.supabase.co https://cdn.jsdelivr.net https://pypi.org https://files.pythonhosted.org; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
};

const SAFE_BOOK_ID_RE = /^[a-zA-Z0-9._-]{1,120}$/;

function isSafeBookId(bookId) {
  return typeof bookId === 'string' && SAFE_BOOK_ID_RE.test(bookId) && !bookId.includes('..');
}

function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a.trim().toLowerCase(), 'utf8');
  const bufB = Buffer.from(b.trim().toLowerCase(), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function atomicWriteJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  const payload = JSON.stringify(data);
  await fsp.writeFile(tmpPath, payload, 'utf8');
  await fsp.rename(tmpPath, filePath);
}

async function readJsonOrNull(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.name === 'SyntaxError')) {
      return null;
    }
    throw err;
  }
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function sendJson(req, res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  if (body.length > 1024 && acceptEncoding.includes('gzip')) {
    const gz = zlib.gzipSync(body, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = String(gz.length);
    res.writeHead(statusCode, headers);
    res.end(gz);
    return;
  }

  headers['Content-Length'] = String(body.length);
  res.writeHead(statusCode, headers);
  res.end(body);
}

/**
 * Fusión Last-Write-Wins (LWW) determinista del estado de aprendizaje.
 * Evita que un dispositivo que estuvo offline sobrescriba progreso más reciente.
 */
export function mergeLearningState(existing, incoming) {
  const base = existing ?? {
    snapshotVersion: '2.1',
    exportedAt: 0,
    deviceTag: 'server',
    lessonProgress: [],
    srsCardsState: [],
    savedUserCode: [],
    unlockedAchievements: [],
    userStats: null,
    pcLabQueue: [],
    globalCompetencyMastery: [],
    learningTelemetry: [],
    aiExercises: [],
    deepDiveCache: [],
    deletedBookIds: {},
  };

  const mergeByKey = (currentList, incomingList, keyFn, tsFn = (x) => x.updatedAt ?? 0, keepEarliest = false) => {
    const map = new Map();
    for (const item of currentList ?? []) {
      map.set(keyFn(item), item);
    }
    for (const item of incomingList ?? []) {
      const k = keyFn(item);
      const prev = map.get(k);
      if (!prev) {
        map.set(k, item);
      } else if (keepEarliest ? tsFn(item) < tsFn(prev) : tsFn(item) >= tsFn(prev)) {
        map.set(k, item);
      }
    }
    return [...map.values()];
  };

  const lessonProgress = mergeByKey(
    base.lessonProgress,
    incoming.lessonProgress,
    (r) => `${r.bookId}::${r.lessonId}`
  );

  const srsCardsState = mergeByKey(
    base.srsCardsState,
    incoming.srsCardsState,
    (r) => `${r.bookId}::${r.cardId}`
  );

  const savedUserCode = mergeByKey(
    base.savedUserCode,
    incoming.savedUserCode,
    (r) => `${r.bookId}::${r.blockId}`
  );

  const unlockedAchievements = mergeByKey(
    base.unlockedAchievements,
    incoming.unlockedAchievements,
    (r) => `${r.bookId}::${r.achievementId}`,
    (r) => r.unlockedAt ?? 0,
    true
  );

  const globalCompetencyMastery = mergeByKey(
    base.globalCompetencyMastery,
    incoming.globalCompetencyMastery,
    (r) => r.competencyId
  );

  const aiExercises = mergeByKey(
    base.aiExercises,
    incoming.aiExercises,
    (r) => r.exerciseId,
    (r) => r.createdAt ?? 0
  );

  const deepDiveCache = mergeByKey(
    base.deepDiveCache,
    incoming.deepDiveCache,
    (r) => r.cacheKey
  );

  // Cola de PC Lab: unión deduplicada por bookId::lessonId::blockId
  const pcLabQueue = mergeByKey(
    base.pcLabQueue,
    incoming.pcLabQueue,
    (q) => `${q.bookId}::${q.lessonId}::${q.blockId}`,
    (q) => q.queuedAt ?? 0
  );

  // Telemetría: unión deduplicada (últimos 500 eventos)
  const telemetryMap = new Map();
  for (const ev of [...(base.learningTelemetry ?? []), ...(incoming.learningTelemetry ?? [])]) {
    const key = `${ev.bookId}::${ev.eventType}::${ev.blockId ?? ''}::${ev.createdAt}`;
    if (!telemetryMap.has(key)) telemetryMap.set(key, ev);
  }
  const learningTelemetry = [...telemetryMap.values()]
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .slice(-500);

  // Estadísticas globales: LWW con conservación de máximos acumulados
  let userStats = base.userStats;
  if (incoming.userStats) {
    if (!userStats || (incoming.userStats.updatedAt ?? 0) >= (userStats.updatedAt ?? 0)) {
      userStats = {
        ...incoming.userStats,
        id: 'global',
        totalAttempts: Math.max(userStats?.totalAttempts ?? 0, incoming.userStats.totalAttempts ?? 0),
        totalFirstTryHits: Math.max(userStats?.totalFirstTryHits ?? 0, incoming.userStats.totalFirstTryHits ?? 0),
        astMasteryCount: Math.max(userStats?.astMasteryCount ?? 0, incoming.userStats.astMasteryCount ?? 0),
        srsReviewsCount: Math.max(userStats?.srsReviewsCount ?? 0, incoming.userStats.srsReviewsCount ?? 0),
      };
    }
  }

  // Tombstones de libros eliminados
  const deletedBookIds = { ...(base.deletedBookIds ?? {}) };
  for (const [bId, ts] of Object.entries(incoming.deletedBookIds ?? {})) {
    if (typeof ts === 'number' && ts > (deletedBookIds[bId] ?? 0)) {
      deletedBookIds[bId] = ts;
    }
  }

  return {
    snapshotVersion: '2.1',
    exportedAt: Date.now(),
    deviceTag: 'vps-server',
    lessonProgress,
    srsCardsState,
    savedUserCode,
    unlockedAchievements,
    userStats,
    pcLabQueue,
    globalCompetencyMastery,
    learningTelemetry,
    aiExercises,
    deepDiveCache,
    deletedBookIds,
  };
}

export function createLivingBooksServer(options = {}) {
  const distDir = path.resolve(options.distDir ?? path.join(__dirname, '..', 'dist'));
  const dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? '/data');
  const booksDir = path.join(dataDir, 'books');
  const statePath = path.join(dataDir, 'state.json');
  const settingsPath = path.join(dataDir, 'settings.json');
  const expectedPinHash = (
    options.expectedPinHash ??
    process.env.APP_ACCESS_PIN_SHA256 ??
    process.env.VITE_APP_ACCESS_PIN_SHA256 ??
    ''
  )
    .trim()
    .toLowerCase();

  // Serialización simple de escrituras al disco para evitar race conditions entre pestañas
  let writeLock = Promise.resolve();
  const withLock = (fn) => {
    const next = writeLock.then(fn, fn);
    writeLock = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  async function ensureDirs() {
    await fsp.mkdir(booksDir, { recursive: true });
  }

  async function listBooksManifest() {
    await ensureDirs();
    const files = await fsp.readdir(booksDir).catch(() => []);
    const manifest = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fullPath = path.join(booksDir, file);
      try {
        const stat = await fsp.stat(fullPath);
        const parsed = await readJsonOrNull(fullPath);
        if (parsed && parsed.bookId) {
          manifest.push({
            bookId: parsed.bookId,
            updatedAt: parsed.updatedAt ?? Math.round(stat.mtimeMs),
            sizeBytes: stat.size,
            title: parsed.cartridge?.metadata?.title ?? parsed.bookId,
          });
        }
      } catch {
        // omitir archivos corruptos
      }
    }
    return manifest;
  }

  function isAuthorized(req) {
    if (!expectedPinHash) return true;
    const header = String(req.headers['x-ulb-auth'] ?? '');
    return timingSafeHexEqual(header, expectedPinHash);
  }

  async function serveStatic(req, res, pathname) {
    // Bloquear archivos ocultos (.env, .git, etc.)
    if (pathname.split('/').some((seg) => seg.startsWith('.'))) {
      res.writeHead(403, SECURITY_HEADERS);
      res.end('Forbidden');
      return;
    }

    const decoded = decodeURIComponent(pathname);
    let relPath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    let candidate = path.resolve(distDir, relPath);

    // Prevenir path traversal fuera de distDir
    if (!candidate.startsWith(distDir)) {
      res.writeHead(403, SECURITY_HEADERS);
      res.end('Forbidden');
      return;
    }

    let stat = await fsp.stat(candidate).catch(() => null);
    if (stat && stat.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
      stat = await fsp.stat(candidate).catch(() => null);
    }

    if (!stat || !stat.isFile()) {
      // Assets hashed o service worker deben devolver 404 real si no existen
      if (
        decoded.startsWith('/assets/') ||
        /^\/(sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(decoded)
      ) {
        res.writeHead(404, SECURITY_HEADERS);
        res.end('Not Found');
        return;
      }
      // Fallback SPA a index.html
      candidate = path.join(distDir, 'index.html');
      stat = await fsp.stat(candidate).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404, SECURITY_HEADERS);
        res.end('App bundle not found');
        return;
      }
    }

    const ext = path.extname(candidate).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const isNoCache =
      decoded === '/' ||
      /^\/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(decoded) ||
      candidate.endsWith('index.html');
    const isImmutable = decoded.startsWith('/assets/');

    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': contentType,
      'Cache-Control': isNoCache
        ? 'no-store, no-cache, must-revalidate'
        : isImmutable
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    };

    if (req.method === 'HEAD') {
      headers['Content-Length'] = String(stat.size);
      res.writeHead(200, headers);
      res.end();
      return;
    }

    const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
    if (COMPRESSIBLE_EXTS.has(ext) && stat.size > 1024 && acceptEncoding.includes('gzip')) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      fs.createReadStream(candidate).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return;
    }

    headers['Content-Length'] = String(stat.size);
    res.writeHead(200, headers);
    fs.createReadStream(candidate).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const pathname = urlObj.pathname;

      // 1. Healthcheck público (para Docker HEALTHCHECK y autodetección del cliente)
      if (pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        const manifest = await listBooksManifest();
        if (req.method === 'HEAD') {
          res.writeHead(200, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        sendJson(req, res, 200, {
          ok: true,
          persistence: true,
          authRequired: Boolean(expectedPinHash),
          booksCount: manifest.length,
        });
        return;
      }

      // 2. Rutas de API protegidas por X-ULB-Auth cuando APP_ACCESS_PIN_SHA256 está configurado
      if (pathname.startsWith('/api/')) {
        if (!isAuthorized(req)) {
          sendJson(req, res, 401, { error: 'Unauthorized: invalid or missing access PIN.' });
          return;
        }

        // GET /api/bootstrap
        if (pathname === '/api/bootstrap' && req.method === 'GET') {
          await ensureDirs();
          const [settingsDoc, stateDoc, booksManifest] = await Promise.all([
            readJsonOrNull(settingsPath),
            readJsonOrNull(statePath),
            listBooksManifest(),
          ]);
          sendJson(req, res, 200, {
            serverTime: Date.now(),
            settings: settingsDoc,
            state: stateDoc,
            booksManifest,
          });
          return;
        }

        // PUT /api/settings
        if (pathname === '/api/settings' && req.method === 'PUT') {
          const raw = await readRequestBody(req, 1024 * 1024);
          const body = JSON.parse(raw);
          const incomingSettings = body?.settings;
          const incomingUpdatedAt = Number(body?.updatedAt) || Date.now();
          if (!incomingSettings || typeof incomingSettings !== 'object') {
            sendJson(req, res, 400, { error: 'Invalid settings payload' });
            return;
          }

          const saved = await withLock(async () => {
            await ensureDirs();
            const current = await readJsonOrNull(settingsPath);
            if (current && (current.updatedAt ?? 0) > incomingUpdatedAt) {
              return current;
            }
            const nextDoc = {
              settings: incomingSettings,
              updatedAt: incomingUpdatedAt,
            };
            await atomicWriteJson(settingsPath, nextDoc);
            return nextDoc;
          });

          sendJson(req, res, 200, saved);
          return;
        }

        // POST /api/state/sync (LWW bidirectional merge)
        if (pathname === '/api/state/sync' && req.method === 'POST') {
          const raw = await readRequestBody(req, 15 * 1024 * 1024);
          const incoming = JSON.parse(raw);
          const merged = await withLock(async () => {
            await ensureDirs();
            const current = await readJsonOrNull(statePath);
            const nextState = mergeLearningState(current, incoming);
            await atomicWriteJson(statePath, nextState);
            return nextState;
          });
          sendJson(req, res, 200, { state: merged });
          return;
        }

        // /api/books/:bookId
        const bookMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
        if (bookMatch) {
          const bookId = decodeURIComponent(bookMatch[1]);
          if (!isSafeBookId(bookId)) {
            sendJson(req, res, 400, { error: 'Invalid bookId format' });
            return;
          }
          const bookFile = path.join(booksDir, `${bookId}.json`);

          if (req.method === 'GET') {
            const doc = await readJsonOrNull(bookFile);
            if (!doc) {
              sendJson(req, res, 404, { error: 'Book not found' });
              return;
            }
            sendJson(req, res, 200, doc);
            return;
          }

          if (req.method === 'PUT') {
            const raw = await readRequestBody(req, 60 * 1024 * 1024);
            const body = JSON.parse(raw);
            const cartridge = body?.cartridge ?? body;
            if (!cartridge || typeof cartridge !== 'object' || !Array.isArray(cartridge.chapters)) {
              sendJson(req, res, 400, { error: 'Invalid BookCartridge payload' });
              return;
            }
            const updatedAt = Number(body?.updatedAt) || Date.now();

            const savedDoc = await withLock(async () => {
              await ensureDirs();
              const doc = { bookId, updatedAt, cartridge };
              await atomicWriteJson(bookFile, doc);
              // Si existía un tombstone previo para este libro, limpiarlo
              const currentState = await readJsonOrNull(statePath);
              if (currentState?.deletedBookIds?.[bookId]) {
                delete currentState.deletedBookIds[bookId];
                await atomicWriteJson(statePath, currentState);
              }
              return doc;
            });

            sendJson(req, res, 200, { ok: true, bookId: savedDoc.bookId, updatedAt: savedDoc.updatedAt });
            return;
          }

          if (req.method === 'DELETE') {
            await withLock(async () => {
              await ensureDirs();
              await fsp.unlink(bookFile).catch(() => {});
              const currentState = await readJsonOrNull(statePath);
              const nextState = mergeLearningState(currentState, {
                deletedBookIds: { [bookId]: Date.now() },
              });
              await atomicWriteJson(statePath, nextState);
            });
            sendJson(req, res, 200, { ok: true, bookId });
            return;
          }
        }

        sendJson(req, res, 404, { error: 'API route not found' });
        return;
      }

      // 3. Archivos estáticos + fallback SPA
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, SECURITY_HEADERS);
        res.end('Method Not Allowed');
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (err) {
      const code = err && typeof err.statusCode === 'number' ? err.statusCode : 500;
      const msg = err instanceof Error ? err.message : 'Internal server error';
      // eslint-disable-next-line no-console
      console.error('[ULB Server Error]', code, msg);
      if (!res.headersSent) {
        sendJson(req, res, code, { error: msg });
      }
    }
  });

  return server;
}

// Arranque directo cuando se invoca `node server/index.mjs`
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = createLivingBooksServer();
  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[ULB Server] Listening on http://${host}:${port} (DATA_DIR=${process.env.DATA_DIR ?? '/data'})`
    );
  });
}

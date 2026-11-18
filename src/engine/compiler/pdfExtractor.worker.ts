/// <reference lib="webworker" />

/**
 * Worker dedicado a la extraccion de texto y portada de un PDF con pdf.js.
 *
 * Se ejecuta FUERA del hilo principal para que la carga de un PDF de cientos
 * de paginas no congele la interfaz. Reporta progreso pagina a pagina y
 * reconstruye las lineas usando la coordenada Y de cada fragmento de texto
 * (clave para que el LLM detecte bien el Table of Contents).
 */

interface PdfTextItem {
  str?: string;
  transform?: number[];
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfRenderTask {
  promise: Promise<void>;
}

interface PdfPage {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (opts: {
    canvasContext: OffscreenCanvasRenderingContext2D;
    viewport: PdfViewport;
    canvas?: OffscreenCanvas;
  }) => PdfRenderTask;
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
}

interface ExtractRequest {
  requestId: string;
  buffer: ArrayBuffer;
  wantCover?: boolean;
}

const PDFJS_VERSION = '4.0.379';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;
const COVER_TARGET_WIDTH = 320;

/** Reconstruye el texto de una pagina agrupando fragmentos por linea (Y). */
function reconstructPageText(items: PdfTextItem[]): string {
  const lines: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = [];
  for (const item of items) {
    const str = item.str ?? '';
    if (!str.trim()) continue;
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    let line = lines.find((l) => Math.abs(l.y - y) < 3);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, str });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Renderiza la primera pagina como miniatura JPEG (data URL). */
async function renderCover(doc: PdfDocument): Promise<string | null> {
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = COVER_TARGET_WIDTH / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    const buffer = await blob.arrayBuffer();
    return `data:image/jpeg;base64,${arrayBufferToBase64(buffer)}`;
  } catch (err) {
    self.postMessage({
      requestId: '',
      type: 'cover-error',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const { requestId, buffer, wantCover } = event.data;
  try {
    const pdfjs = (await import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`)) as unknown as PdfJsModule;
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;

    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += reconstructPageText(content.items) + '\n\n';
      self.postMessage({ requestId, type: 'progress', page: i, total: doc.numPages });
    }

    const coverDataUrl = wantCover ? await renderCover(doc) : null;
    self.postMessage({ requestId, type: 'done', text, coverDataUrl });
  } catch (err) {
    self.postMessage({
      requestId,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};

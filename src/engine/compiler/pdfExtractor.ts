/**
 * Puente hacia el Web Worker de extraccion de PDF.
 *
 * Mantiene la extraccion de texto y de la portada FUERA del hilo principal
 * para que cargar un PDF de cientos de paginas no congele la interfaz.
 */

export interface PdfExtractionProgress {
  page: number;
  total: number;
}

export interface PdfExtractionResult {
  text: string;
  coverDataUrl: string | null;
}

interface WorkerMessage {
  requestId: string;
  type: 'progress' | 'done' | 'error';
  page?: number;
  total?: number;
  text?: string;
  coverDataUrl?: string | null;
  error?: string;
}

export function extractPdfInWorker(
  file: File,
  onProgress?: (progress: PdfExtractionProgress) => void,
  options: { wantCover?: boolean } = {}
): Promise<PdfExtractionResult> {
  return new Promise<PdfExtractionResult>((resolve, reject) => {
    const worker = new Worker(new URL('./pdfExtractor.worker.ts', import.meta.url), {
      type: 'module',
    });
    const requestId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const cleanup = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data;
      if (data.requestId !== requestId) return;
      if (data.type === 'progress') {
        onProgress?.({ page: data.page ?? 0, total: data.total ?? 0 });
      } else if (data.type === 'done') {
        cleanup();
        resolve({ text: data.text ?? '', coverDataUrl: data.coverDataUrl ?? null });
      } else if (data.type === 'error') {
        cleanup();
        reject(new Error(data.error ?? 'Error desconocido al extraer el PDF.'));
      }
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Error en el worker de extraccion de PDF.'));
    };

    file
      .arrayBuffer()
      .then((buffer) =>
        worker.postMessage({ requestId, buffer, wantCover: options.wantCover ?? true }, [buffer])
      )
      .catch((err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/** Compatibilidad: devuelve solo el texto extraido. */
export async function extractPdfTextInWorker(
  file: File,
  onProgress?: (progress: PdfExtractionProgress) => void
): Promise<string> {
  const result = await extractPdfInWorker(file, onProgress, { wantCover: false });
  return result.text;
}

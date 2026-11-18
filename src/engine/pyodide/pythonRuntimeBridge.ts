import type {
  AstConstraints,
  MemoryStep,
  PythonExecutionResult,
} from '../../types/cartridge.types';

const WATCHDOG_TIMEOUT_MS = 3000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerResponse {
  requestId: string;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export class PythonRuntimeBridge {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private initializedBookId: string | null = null;
  private installedPackages: string[] = [];

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { requestId } = event.data;
      const pending = this.pending.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);

      if (event.data.ok === false && event.data.error) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve(event.data);
      }
    };

    worker.onerror = (event) => {
      const error = new Error(event.message || 'Error desconocido en el Web Worker de Python.');
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.terminateAndReset();
    };

    this.worker = worker;
    return worker;
  }

  private terminateAndReset(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initializedBookId = null;
  }

  private dispatch<T>(message: Record<string, unknown>): Promise<T> {
    const worker = this.ensureWorker();
    const requestId = `req-${++this.requestCounter}-${Date.now()}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.terminateAndReset();
        reject(
          new Error(
            `Tiempo de ejecucion excedido (${WATCHDOG_TIMEOUT_MS} ms). Posible bucle infinito detectado; el runtime de Python fue reiniciado.`
          )
        );
      }, WATCHDOG_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      worker.postMessage({ ...message, requestId });
    });
  }

  async initBookRuntime(
    bookId: string,
    packages: string[],
    virtualFiles: Record<string, string>
  ): Promise<{ installedPackages: string[]; virtualFiles: Record<string, string> }> {
    if (this.initializedBookId === bookId) {
      const synced = await this.syncVfs(virtualFiles);
      return { installedPackages: this.installedPackages, virtualFiles: synced.virtualFiles };
    }

    const result = await this.dispatch<{
      installedPackages: string[];
      virtualFiles: Record<string, string>;
    }>({
      type: 'INIT_BOOK_RUNTIME',
      packages,
      virtualFiles,
    });

    this.initializedBookId = bookId;
    this.installedPackages = result.installedPackages;
    return result;
  }

  async syncVfs(
    virtualFiles: Record<string, string>
  ): Promise<{ virtualFiles: Record<string, string> }> {
    return this.dispatch<{ virtualFiles: Record<string, string> }>({
      type: 'SYNC_VFS',
      virtualFiles,
    });
  }

  async executeAndEvaluate(
    code: string,
    options?: { astConstraints?: AstConstraints; unitTestCode?: string }
  ): Promise<PythonExecutionResult> {
    return this.dispatch<PythonExecutionResult>({
      type: 'EXECUTE_AND_EVALUATE',
      code,
      astConstraints: options?.astConstraints,
      unitTestCode: options?.unitTestCode,
    });
  }

  async traceExecutionMemory(code: string, maxSteps = 400): Promise<MemoryStep[]> {
    const result = await this.dispatch<{ memorySteps: MemoryStep[] }>({
      type: 'TRACE_EXECUTION_MEMORY',
      code,
      maxSteps,
    });
    return result.memorySteps;
  }

  dispose(): void {
    this.terminateAndReset();
  }
}

export const pythonRuntimeBridge = new PythonRuntimeBridge();

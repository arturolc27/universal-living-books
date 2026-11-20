/// <reference lib="webworker" />

import type { AstConstraints, MemoryStep } from '../../types/cartridge.types';
import { buildAstAuditScript, buildUnitTestHarness } from '../evaluators/astRulesEngine';

const PYODIDE_VERSION = '0.26.2';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const VFS_ROOT = '/home/pyodide/workspace';

interface InitBookRuntimeMessage {
  type: 'INIT_BOOK_RUNTIME';
  requestId: string;
  packages: string[];
  virtualFiles: Record<string, string>;
}

interface SyncVfsMessage {
  type: 'SYNC_VFS';
  requestId: string;
  virtualFiles: Record<string, string>;
}

interface ExecuteAndEvaluateMessage {
  type: 'EXECUTE_AND_EVALUATE';
  requestId: string;
  code: string;
  astConstraints?: AstConstraints;
  unitTestCode?: string;
}

interface TraceExecutionMessage {
  type: 'TRACE_EXECUTION_MEMORY';
  requestId: string;
  code: string;
  maxSteps?: number;
}

type WorkerRequest =
  | InitBookRuntimeMessage
  | SyncVfsMessage
  | ExecuteAndEvaluateMessage
  | TraceExecutionMessage;

interface PyodideInterface {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (names: string | string[]) => Promise<void>;
  pyimport: (name: string) => { install: (p: string[]) => Promise<void> };
  FS: {
    writeFile: (path: string, data: string, opts?: { encoding?: string }) => void;
    readFile: (path: string, opts?: { encoding?: string }) => string | Uint8Array;
    readdir: (path: string) => string[];
    mkdirTree: (path: string) => void;
    analyzePath: (path: string) => { exists: boolean };
  };
}

let pyodide: PyodideInterface | null = null;
let runtimeReady = false;
let installedPackages: string[] = [];
let matplotlibPatched = false;

function postResponse(requestId: string, payload: Record<string, unknown>): void {
  self.postMessage({ requestId, ...payload });
}

function postError(requestId: string, error: string): void {
  self.postMessage({ requestId, ok: false, error });
}

async function ensurePyodide(): Promise<PyodideInterface> {
  if (pyodide) return pyodide;

  let loadPyodideFn = (
    self as unknown as { loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface> }
  ).loadPyodide;

  if (typeof loadPyodideFn !== 'function') {
    try {
      const mod = (await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)) as {
        loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface>;
      };
      if (typeof mod.loadPyodide === 'function') {
        loadPyodideFn = mod.loadPyodide;
      }
    } catch {
      const importScriptsLike = (self as unknown as { importScripts?: (...urls: string[]) => void })
        .importScripts;
      if (typeof importScriptsLike === 'function') {
        importScriptsLike(`${PYODIDE_CDN}pyodide.js`);
        loadPyodideFn = (
          self as unknown as { loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface> }
        ).loadPyodide;
      }
    }
  }

  if (typeof loadPyodideFn !== 'function') {
    throw new Error('No se pudo cargar Pyodide desde el CDN.');
  }

  pyodide = await loadPyodideFn({ indexURL: PYODIDE_CDN });
  return pyodide;
}

function ensureVfsRoot(py: PyodideInterface): void {
  try {
    py.FS.mkdirTree(VFS_ROOT);
  } catch {
    // Directory already exists.
  }
}

function writeVirtualFiles(py: PyodideInterface, files: Record<string, string>): void {
  ensureVfsRoot(py);
  for (const [name, content] of Object.entries(files)) {
    const safeName = name.replace(/^\/+/, '');
    const fullPath = `${VFS_ROOT}/${safeName}`;
    const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
    if (dir && dir !== VFS_ROOT) {
      try {
        py.FS.mkdirTree(dir);
      } catch {
        // ignore
      }
    }
    py.FS.writeFile(fullPath, content, { encoding: 'utf8' });
  }
}

function readVirtualFiles(py: PyodideInterface): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const entries = py.FS.readdir(VFS_ROOT);
    for (const entry of entries) {
      if (entry === '.' || entry === '..') continue;
      const fullPath = `${VFS_ROOT}/${entry}`;
      try {
        const stat = py.FS.analyzePath(fullPath);
        if (!stat.exists) continue;
        const content = py.FS.readFile(fullPath, { encoding: 'utf8' });
        if (typeof content === 'string') {
          result[entry] = content;
        }
      } catch {
        // Skip binary or unreadable files.
      }
    }
  } catch {
    // VFS root not yet created.
  }
  return result;
}

async function patchMatplotlib(py: PyodideInterface): Promise<void> {
  if (matplotlibPatched) return;
  await py.runPythonAsync(`
import sys, io, base64

_plot_buffer = []

def _install_matplotlib_hook():
    try:
        import matplotlib
        matplotlib.use("AGG")
        import matplotlib.pyplot as plt
    except Exception:
        return False

    def _patched_show(*args, **kwargs):
        buf = io.BytesIO()
        plt.savefig(buf, format="png", bbox_inches="tight", dpi=110)
        buf.seek(0)
        encoded = base64.b64encode(buf.read()).decode("ascii")
        _plot_buffer.append(encoded)
        plt.close("all")

    plt.show = _patched_show
    return True

_install_matplotlib_hook()
`);
  matplotlibPatched = true;
}

async function handleInitBookRuntime(msg: InitBookRuntimeMessage): Promise<void> {
  const py = await ensurePyodide();

  const newPackages = msg.packages.filter((p) => !installedPackages.includes(p));
  if (newPackages.length > 0) {
    await py.loadPackage('micropip');
    const micropip = py.pyimport('micropip');
    await micropip.install(newPackages);
    installedPackages = [...installedPackages, ...newPackages];
  }

  writeVirtualFiles(py, msg.virtualFiles);

  if (msg.packages.includes('matplotlib')) {
    await patchMatplotlib(py);
  }

  runtimeReady = true;
  postResponse(msg.requestId, {
    ok: true,
    installedPackages,
    virtualFiles: readVirtualFiles(py),
  });
}

async function handleSyncVfs(msg: SyncVfsMessage): Promise<void> {
  const py = await ensurePyodide();
  writeVirtualFiles(py, msg.virtualFiles);
  postResponse(msg.requestId, { ok: true, virtualFiles: readVirtualFiles(py) });
}

async function handleExecuteAndEvaluate(msg: ExecuteAndEvaluateMessage): Promise<void> {
  const py = await ensurePyodide();
  const startedAt = Date.now();

  if (!runtimeReady) {
    writeVirtualFiles(py, {});
    runtimeReady = true;
  }

  const userCodeJson = JSON.stringify(msg.code);
  const execScript = `
import sys, io, json, traceback, contextlib

_user_code = json.loads(${JSON.stringify(userCodeJson)})
_ns = {"__name__": "__main__"}
_stdout_capture = io.StringIO()
_stderr_capture = io.StringIO()
_ok = True

try:
    with contextlib.redirect_stdout(_stdout_capture), contextlib.redirect_stderr(_stderr_capture):
        exec(compile(_user_code, "<user_code>", "exec"), _ns)
except Exception:
    _ok = False
    _stderr_capture.write(traceback.format_exc())

print("__EXEC_RESULT__" + json.dumps({
    "ok": _ok,
    "stdout": _stdout_capture.getvalue(),
    "stderr": _stderr_capture.getvalue(),
}))
`;

  const execOut = String(await py.runPythonAsync(execScript));
  const execMarker = '__EXEC_RESULT__';
  const execLine = execOut.split('\n').find((l) => l.startsWith(execMarker));
  const execResult = execLine
    ? (JSON.parse(execLine.slice(execMarker.length)) as {
        ok: boolean;
        stdout: string;
        stderr: string;
      })
    : { ok: false, stdout: '', stderr: 'Fallo interno del runtime.' };

  const plotsJson = String(await py.runPythonAsync('json.dumps(_plot_buffer)'));
  const plotsBase64 = JSON.parse(plotsJson) as string[];

  let astReport;
  if (msg.astConstraints) {
    const astScript = buildAstAuditScript(msg.code, msg.astConstraints);
    const astOut = String(
      await py.runPythonAsync(`
import io, contextlib
_ast_capture = io.StringIO()
with contextlib.redirect_stdout(_ast_capture):
    exec(compile(${JSON.stringify(astScript)}, "<ast_audit>", "exec"), {"__name__": "__main__"})
_ast_capture.getvalue()
`)
    );
    const { parseAstReportFromStdout } = await import('../evaluators/astRulesEngine');
    astReport = parseAstReportFromStdout(astOut);
  }

  let unitTestReport;
  if (msg.unitTestCode && msg.unitTestCode.trim()) {
    const testScript = buildUnitTestHarness(msg.code, msg.unitTestCode);
    const testOut = String(
      await py.runPythonAsync(`
import io, contextlib
_test_capture = io.StringIO()
with contextlib.redirect_stdout(_test_capture):
    exec(compile(${JSON.stringify(testScript)}, "<unit_tests>", "exec"), {"__name__": "__main__"})
_test_capture.getvalue()
`)
    );
    const { parseUnitTestReportFromStdout } = await import('../evaluators/astRulesEngine');
    unitTestReport = parseUnitTestReportFromStdout(testOut);
  }

  postResponse(msg.requestId, {
    ok: execResult.ok,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    returnValue: null,
    plotsBase64,
    updatedVirtualFiles: readVirtualFiles(py),
    astReport,
    unitTestReport,
    executionTimeMs: Date.now() - startedAt,
  });
}

async function handleTraceExecution(msg: TraceExecutionMessage): Promise<void> {
  const py = await ensurePyodide();
  const maxSteps = msg.maxSteps ?? 400;
  const userCodeJson = JSON.stringify(msg.code);

  const traceScript = `
import sys, json, io, contextlib

_user_code = json.loads(${JSON.stringify(userCodeJson)})
_max_steps = ${maxSteps}
_steps = []

_IGNORED_TYPES = (int, float, str, bool, type(None))

def _format_value(obj):
    try:
        if isinstance(obj, _IGNORED_TYPES):
            return repr(obj)
        if isinstance(obj, (list, tuple, set)):
            items = list(obj)
            preview = items[:6]
            rendered = ", ".join(repr(x) for x in preview)
            if len(items) > 6:
                rendered += ", ..."
            return type(obj).__name__ + "(" + rendered + ")"
        if isinstance(obj, dict):
            items = list(obj.items())[:5]
            rendered = ", ".join(str(k) + ": " + repr(v) for k, v in items)
            if len(obj) > 5:
                rendered += ", ..."
            return "{" + rendered + "}"
        return repr(obj)[:120]
    except Exception:
        return "<unrepresentable>"

def _snapshot(frame, line_no):
    frames = []
    f = frame
    while f is not None:
        variables = {}
        for name, value in list(f.f_locals.items()):
            if name.startswith("__"):
                continue
            variables[name] = "id" + str(id(value))
        frames.append({
            "name": f.f_code.co_name,
            "isCurrent": f is frame,
            "variables": variables,
        })
        f = f.f_back

    heap = []
    seen = set()
    for name, value in list(frame.f_locals.items()):
        if name.startswith("__"):
            continue
        heap_id = "id" + str(id(value))
        if heap_id in seen:
            continue
        seen.add(heap_id)
        heap.append({
            "id": heap_id,
            "type": type(value).__name__,
            "value": _format_value(value),
            "status": "ACTIVE",
        })

    return {
        "stepIndex": len(_steps),
        "lineNumber": line_no,
        "explanation": "Ejecutando linea " + str(line_no),
        "frames": frames,
        "heap": heap,
    }

def _tracer(frame, event, arg):
    if event == "line":
        if len(_steps) < _max_steps:
            _steps.append(_snapshot(frame, frame.f_lineno))
        else:
            return None
    return _tracer

_ns = {"__name__": "__main__"}
_capture = io.StringIO()
sys.settrace(_tracer)
try:
    with contextlib.redirect_stdout(_capture):
        exec(compile(_user_code, "<traced>", "exec"), _ns)
finally:
    sys.settrace(None)

print("__TRACE_REPORT__" + json.dumps(_steps))
`;

  const traceOut = String(
    await py.runPythonAsync(`
import io, contextlib
_trace_capture = io.StringIO()
with contextlib.redirect_stdout(_trace_capture):
    exec(compile(${JSON.stringify(traceScript)}, "<trace_runner>", "exec"), {"__name__": "__main__"})
_trace_capture.getvalue()
`)
  );

  const marker = '__TRACE_REPORT__';
  const line = traceOut.split('\n').find((l) => l.startsWith(marker));
  const steps: MemoryStep[] = line ? (JSON.parse(line.slice(marker.length)) as MemoryStep[]) : [];

  postResponse(msg.requestId, { ok: true, memorySteps: steps });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'INIT_BOOK_RUNTIME':
        await handleInitBookRuntime(msg);
        break;
      case 'SYNC_VFS':
        await handleSyncVfs(msg);
        break;
      case 'EXECUTE_AND_EVALUATE':
        await handleExecuteAndEvaluate(msg);
        break;
      case 'TRACE_EXECUTION_MEMORY':
        await handleTraceExecution(msg);
        break;
      default:
        postError((msg as { requestId: string }).requestId, 'Comando de worker desconocido.');
    }
  } catch (err) {
    postError(msg.requestId, err instanceof Error ? err.message : String(err));
  }
};

export {};

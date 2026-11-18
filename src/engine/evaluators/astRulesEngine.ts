import type {
  AstAuditReport,
  AstConstraints,
  AstRuleCheckItem,
  UnitTestItem,
  UnitTestReport,
} from '../../types/cartridge.types';

/**
 * Builds a self-contained Python script that inspects the user's source code
 * using the native `ast` module and emits a JSON report on stdout.
 *
 * The script is executed inside the Pyodide worker. It never raises on rule
 * violations; it always prints a single JSON line prefixed with `__AST_REPORT__`.
 */
export function buildAstAuditScript(userCode: string, constraints: AstConstraints): string {
  const payload = {
    userCode,
    requiredNodeTypes: constraints.requiredNodeTypes ?? [],
    forbiddenNodeTypes: constraints.forbiddenNodeTypes ?? [],
    forbiddenCalls: constraints.forbiddenCalls ?? [],
  };

  return `
import ast, json

_payload = json.loads(${JSON.stringify(JSON.stringify(payload))})
_user_code = _payload["userCode"]
_required = _payload["requiredNodeTypes"]
_forbidden_nodes = _payload["forbiddenNodeTypes"]
_forbidden_calls = _payload["forbiddenCalls"]

_report = {
    "passed": True,
    "syntaxError": None,
    "detectedNodes": [],
    "detectedCalls": [],
    "checks": [],
    "summaryMessage": "",
}

try:
    _tree = ast.parse(_user_code)
except SyntaxError as _err:
    _report["passed"] = False
    _report["syntaxError"] = f"{_err.msg} (linea {_err.lineno})"
    _report["summaryMessage"] = "El codigo no es sintacticamente valido en Python 3.12+."
    print("__AST_REPORT__" + json.dumps(_report))
    raise SystemExit(0)

_detected_nodes = set()
_detected_calls = set()
for _node in ast.walk(_tree):
    _detected_nodes.add(type(_node).__name__)
    if isinstance(_node, ast.Call):
        _func = _node.func
        if isinstance(_func, ast.Name):
            _detected_calls.add(_func.id)
        elif isinstance(_func, ast.Attribute):
            _detected_calls.add(_func.attr)

_report["detectedNodes"] = sorted(_detected_nodes)
_report["detectedCalls"] = sorted(_detected_calls)

for _req in _required:
    _ok = _req in _detected_nodes
    _report["checks"].append({
        "ruleKind": "REQUIRED_NODE",
        "target": _req,
        "passed": _ok,
        "detail": ("Nodo " + _req + " detectado.") if _ok else ("Falta el nodo obligatorio " + _req + "."),
    })
    if not _ok:
        _report["passed"] = False

for _forb in _forbidden_nodes:
    _present = _forb in _detected_nodes
    _report["checks"].append({
        "ruleKind": "FORBIDDEN_NODE",
        "target": _forb,
        "passed": not _present,
        "detail": ("Nodo prohibido " + _forb + " presente.") if _present else ("Nodo prohibido " + _forb + " ausente (correcto)."),
    })
    if _present:
        _report["passed"] = False

for _call in _forbidden_calls:
    _present = _call in _detected_calls
    _report["checks"].append({
        "ruleKind": "FORBIDDEN_CALL",
        "target": _call,
        "passed": not _present,
        "detail": ("Llamada prohibida " + _call + "() detectada.") if _present else ("Llamada prohibida " + _call + "() ausente (correcto)."),
    })
    if _present:
        _report["passed"] = False

if _report["passed"]:
    _report["summaryMessage"] = "Auditoria AST superada: la estructura del codigo cumple todas las reglas."
else:
    _report["summaryMessage"] = "Auditoria AST fallida: revisa las reglas marcadas en rojo."

print("__AST_REPORT__" + json.dumps(_report))
`;
}

/**
 * Builds a Python harness that executes the user's code and then runs the
 * provided unit test code (asserts / doctest), emitting a JSON report.
 */
export function buildUnitTestHarness(userCode: string, unitTestCode: string): string {
  const payload = { userCode, unitTestCode };

  return `
import json, io, contextlib, traceback

_payload = json.loads(${JSON.stringify(JSON.stringify(payload))})
_user_code = _payload["userCode"]
_unit_test_code = _payload["unitTestCode"]

_report = {
    "passed": True,
    "total": 0,
    "passedCount": 0,
    "items": [],
    "rawOutput": "",
}

_ns = {"__name__": "__main__"}
_capture = io.StringIO()

with contextlib.redirect_stdout(_capture), contextlib.redirect_stderr(_capture):
    try:
        exec(compile(_user_code, "<user_code>", "exec"), _ns)
    except Exception:
        _report["passed"] = False
        _report["items"].append({
            "name": "Ejecucion del codigo del usuario",
            "passed": False,
            "message": traceback.format_exc(limit=3),
        })
        _report["total"] = 1
        _report["rawOutput"] = _capture.getvalue()
        print("__TEST_REPORT__" + json.dumps(_report))
        raise SystemExit(0)

    if _unit_test_code.strip():
        _test_lines = [ln for ln in _unit_test_code.splitlines() if ln.strip()]
        _report["total"] = max(1, len(_test_lines))
        try:
            exec(compile(_unit_test_code, "<unit_tests>", "exec"), _ns)
            _report["passedCount"] = _report["total"]
            _report["items"].append({
                "name": "Suite de pruebas (assert/doctest)",
                "passed": True,
                "message": "Todas las aserciones se cumplieron.",
            })
        except AssertionError as _err:
            _report["passed"] = False
            _report["passedCount"] = 0
            _report["items"].append({
                "name": "Suite de pruebas (assert/doctest)",
                "passed": False,
                "message": "AssertionError: " + (str(_err) or "asercion fallida"),
            })
        except Exception:
            _report["passed"] = False
            _report["passedCount"] = 0
            _report["items"].append({
                "name": "Suite de pruebas (assert/doctest)",
                "passed": False,
                "message": traceback.format_exc(limit=3),
            })
    else:
        _report["total"] = 0
        _report["passedCount"] = 0

_report["rawOutput"] = _capture.getvalue()
print("__TEST_REPORT__" + json.dumps(_report))
`;
}

export function parseAstReportFromStdout(stdout: string): AstAuditReport | undefined {
  const marker = '__AST_REPORT__';
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line.slice(marker.length)) as AstAuditReport;
    parsed.checks = (parsed.checks ?? []) as AstRuleCheckItem[];
    return parsed;
  } catch {
    return undefined;
  }
}

export function parseUnitTestReportFromStdout(stdout: string): UnitTestReport | undefined {
  const marker = '__TEST_REPORT__';
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line.slice(marker.length)) as UnitTestReport;
    parsed.items = (parsed.items ?? []) as UnitTestItem[];
    return parsed;
  } catch {
    return undefined;
  }
}

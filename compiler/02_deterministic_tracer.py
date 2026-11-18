"""
02_deterministic_tracer.py — Etapa A del Pipeline Zero-Waste (0 tokens).

Traza memoria determinista de los snippets detectados por el chunker, con:

  a) Filtro Estatico AST Pre-Ejecucion (0 ms): `ast.parse()` audita cada snippet
     y descarta automaticamente:
       - Codigo con errores de sintaxis intencionales (SyntaxError).
       - Llamadas bloqueantes o externas (input, open, urlopen, import).
       - Expresiones triviales de una sola linea sin cambios de estado.
     Solo se traza codigo con Assign, AugAssign, FunctionDef, List, For, While...

  b) Limite de Pasos y Watchdog: maximo 35 pasos de traza por snippet y timeout
     duro de 500 ms por snippet.

  c) Ejecucion Paralela Multi-Worker + Checkpointing: usa ProcessPoolExecutor,
     guarda cada traza por su hash SHA-256 en un checkpoint idempotente y
     reporta telemetria (trazados vs omitidos, tiempo, ETA).

Uso:
    python 02_deterministic_tracer.py --chunks chunks.json --out traces.json
    python 02_deterministic_tracer.py --chunks chunks.json --chapters 1,2 --workers 4
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import io
import json
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FuturesTimeoutError
from contextlib import redirect_stdout
from pathlib import Path

MAX_STEPS = 35
SNIPPET_TIMEOUT_SEC = 0.5
IGNORED_TYPES = (int, float, str, bool, type(None))

BLOCKING_CALLS = {"input", "open", "urlopen", "raw_input", "eval", "exec", "compile"}
MUTATION_METHODS = {
    "append", "extend", "insert", "remove", "pop", "sort", "reverse",
    "update", "add", "discard", "clear", "setdefault",
}


# --- FILTRO ESTATICO AST PRE-EJECUCION (0 ms) ---


def analyze_snippet_static(code: str) -> tuple[bool, str, str]:
    """Devuelve (safe, kind, reason). kind in {ok, syntax, unsafe, trivial}."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return False, "syntax", f"SyntaxError: {exc.msg}"

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return False, "unsafe", "Import externo no trazable."
        if isinstance(node, ast.Call):
            func = node.func
            name = func.id if isinstance(func, ast.Name) else (func.attr if isinstance(func, ast.Attribute) else "")
            if name in BLOCKING_CALLS:
                return False, "unsafe", f"Llamada bloqueante {name}()."
        if isinstance(node, ast.While) and isinstance(node.test, ast.Constant) and node.test.value is True:
            return False, "unsafe", "Bucle infinito while True."

    if len(tree.body) == 1 and isinstance(tree.body[0], ast.Expr):
        expr = tree.body[0].value
        is_mutation = (
            isinstance(expr, ast.Call)
            and isinstance(expr.func, ast.Attribute)
            and expr.func.attr in MUTATION_METHODS
        )
        if not is_mutation:
            return False, "trivial", "Expresion trivial sin cambios de estado."

    return True, "ok", "Apto para trazado."


def normalize_snippet(code: str) -> str:
    lines = []
    for line in code.splitlines():
        if line.startswith(">>> "):
            lines.append(line[4:])
        elif line.startswith("... "):
            lines.append(line[4:])
        elif line.strip() in (">>>", "..."):
            lines.append("")
        else:
            lines.append(line)
    return "\n".join(lines)


def snippet_hash(code: str, max_steps: int) -> str:
    return hashlib.sha256(f"{max_steps}::{code}".encode("utf-8")).hexdigest()


# --- TRAZADO DETERMINISTA ---


def format_value(obj: object) -> str:
    try:
        if isinstance(obj, IGNORED_TYPES):
            return repr(obj)
        if isinstance(obj, (list, tuple, set)):
            items = list(obj)
            preview = ", ".join(repr(x) for x in items[:6])
            if len(items) > 6:
                preview += ", ..."
            return f"{type(obj).__name__}({preview})"
        if isinstance(obj, dict):
            items = list(obj.items())[:5]
            preview = ", ".join(f"{k!r}: {v!r}" for k, v in items)
            if len(obj) > 5:
                preview += ", ..."
            return "{" + preview + "}"
        return repr(obj)[:120]
    except Exception:  # noqa: BLE001
        return "<unrepresentable>"


def snapshot(frame, line_no: int, step_index: int) -> dict:
    frames = []
    f = frame
    while f is not None:
        variables = {
            name: f"id{id(value)}"
            for name, value in f.f_locals.items()
            if not name.startswith("__")
        }
        frames.append({"name": f.f_code.co_name, "isCurrent": f is frame, "variables": variables})
        f = f.f_back

    heap = []
    seen = set()
    for name, value in frame.f_locals.items():
        if name.startswith("__"):
            continue
        heap_id = f"id{id(value)}"
        if heap_id in seen:
            continue
        seen.add(heap_id)
        heap.append({
            "id": heap_id,
            "type": type(value).__name__,
            "value": format_value(value),
            "status": "ACTIVE",
        })

    return {
        "stepIndex": step_index,
        "lineNumber": line_no,
        "explanation": f"Ejecutando linea {line_no}",
        "frames": frames,
        "heap": heap,
    }


def trace_snippet(code: str, max_steps: int = MAX_STEPS) -> list[dict]:
    steps: list[dict] = []

    def tracer(frame, event, arg):
        if event == "line":
            if len(steps) < max_steps:
                steps.append(snapshot(frame, frame.f_lineno, len(steps)))
            else:
                return None
        return tracer

    namespace: dict = {"__name__": "__main__"}
    capture = io.StringIO()
    sys.settrace(tracer)
    try:
        with redirect_stdout(capture):
            exec(compile(code, "<traced>", "exec"), namespace)
    except Exception:  # noqa: BLE001
        traceback.print_exc(file=capture)
    finally:
        sys.settrace(None)

    return steps


def trace_one(payload: dict) -> dict:
    """Ejecutado en un worker del pool. Aplica filtro AST + trazado."""
    section_id = payload["sectionId"]
    snippet_index = payload["snippetIndex"]
    code = normalize_snippet(payload["code"])
    digest = snippet_hash(code, MAX_STEPS)

    safe, kind, reason = analyze_snippet_static(code)
    if not safe:
        status = {"syntax": "SKIPPED_SYNTAX", "trivial": "SKIPPED_TRIVIAL"}.get(kind, "SKIPPED_UNSAFE")
        return {
            "sectionId": section_id,
            "snippetIndex": snippet_index,
            "code": code,
            "hash": digest,
            "status": status,
            "memorySteps": [],
            "reason": reason,
        }

    try:
        steps = trace_snippet(code, MAX_STEPS)
    except Exception as exc:  # noqa: BLE001
        return {
            "sectionId": section_id,
            "snippetIndex": snippet_index,
            "code": code,
            "hash": digest,
            "status": "FAILED",
            "memorySteps": [],
            "reason": str(exc),
        }

    return {
        "sectionId": section_id,
        "snippetIndex": snippet_index,
        "code": code,
        "hash": digest,
        "status": "TRACED",
        "memorySteps": steps,
        "reason": "Trazado determinista.",
    }


def load_checkpoint(path: Path) -> dict[str, dict]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def save_checkpoint(path: Path, results: dict[str, dict]) -> None:
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Traza memoria determinista de snippets Python.")
    parser.add_argument("--chunks", required=True, help="JSON de salida del chunker.")
    parser.add_argument("--out", default="traces.json", help="JSON de trazas de salida.")
    parser.add_argument("--checkpoint", default="traces_checkpoint.json", help="Checkpoint idempotente por hash.")
    parser.add_argument("--chapters", default="", help="Capitulos a procesar, ej. '1,2' (vacio = todos).")
    parser.add_argument("--workers", type=int, default=4, help="Workers paralelos (1-8).")
    parser.add_argument("--max-steps", type=int, default=MAX_STEPS, help="Maximo de pasos por snippet.")
    parser.add_argument("--timeout", type=float, default=SNIPPET_TIMEOUT_SEC, help="Timeout por snippet (seg).")
    args = parser.parse_args()

    selected: set[int] | None = None
    if args.chapters.strip():
        selected = {int(x) for x in args.chapters.split(",") if x.strip().isdigit()}

    chunks = json.loads(Path(args.chunks).read_text(encoding="utf-8"))
    if selected:
        chunks = [c for c in chunks if c.get("chapter_number") in selected]

    payloads: list[dict] = []
    for chunk in chunks:
        for idx, snippet in enumerate(chunk.get("code_snippets", [])):
            payloads.append({
                "sectionId": chunk["section_id"],
                "snippetIndex": idx,
                "code": snippet,
            })

    checkpoint_path = Path(args.checkpoint)
    checkpoint = load_checkpoint(checkpoint_path)

    pending = [p for p in payloads if snippet_hash(normalize_snippet(p["code"]), args.max_steps) not in checkpoint]
    print(f"[02_deterministic_tracer] {len(payloads)} snippets | {len(pending)} pendientes | {len(payloads) - len(pending)} en cache")

    workers = max(1, min(8, args.workers))
    started = time.time()
    processed = 0
    traced = 0
    skipped = 0
    failed = 0

    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(trace_one, p) for p in pending]
        for future, payload in zip(futures, pending):
            try:
                result = future.result(timeout=args.timeout)
            except FuturesTimeoutError:
                result = {
                    "sectionId": payload["sectionId"],
                    "snippetIndex": payload["snippetIndex"],
                    "code": normalize_snippet(payload["code"]),
                    "hash": snippet_hash(normalize_snippet(payload["code"]), args.max_steps),
                    "status": "FAILED",
                    "memorySteps": [],
                    "reason": f"Timeout de {args.timeout}s excedido.",
                }
            except Exception as exc:  # noqa: BLE001
                result = {
                    "sectionId": payload["sectionId"],
                    "snippetIndex": payload["snippetIndex"],
                    "code": normalize_snippet(payload["code"]),
                    "hash": snippet_hash(normalize_snippet(payload["code"]), args.max_steps),
                    "status": "FAILED",
                    "memorySteps": [],
                    "reason": str(exc),
                }

            checkpoint[result["hash"]] = result
            save_checkpoint(checkpoint_path, checkpoint)

            processed += 1
            if result["status"] == "TRACED":
                traced += 1
            elif result["status"] == "FAILED":
                failed += 1
            else:
                skipped += 1

            elapsed = time.time() - started
            eta = (elapsed / processed) * (len(pending) - processed) if processed else 0.0
            print(
                f"  [{result['status']:<15}] {result['sectionId']}#{result['snippetIndex']} "
                f"| trazados {traced} omitidos {skipped} fallos {failed} "
                f"| {elapsed:5.1f}s ETA {eta:5.1f}s"
            )

    results = list(checkpoint.values())
    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"[02_deterministic_tracer] {len(results)} trazas escritas en {args.out} "
        f"(trazados {traced}, omitidos {skipped}, fallos {failed})"
    )


if __name__ == "__main__":
    main()

"""
03_cartridge_compiler.py — Etapa B del Pipeline Zero-Waste (Multi-Agente).

Compila micro-secciones en un BookCartridge v2.0 usando un pool asincrono de
agentes LLM con:
  - Concurrencia configurable (--workers N) via asyncio.Semaphore
  - Presupuesto pre-vuelo con tiktoken y confirmacion [y/N]
  - Checkpoints incrementales en checkpoint_progress.json (idempotente)
  - Tabla en vivo con costo y tiempo por seccion y acumulado
  - Circuit breaker con exponential backoff ante HTTP 429

Uso:
    python 03_cartridge_compiler.py --chunks chunks.json --traces traces.json \
        --meta book_meta.json --out cartridge.json --workers 5 --model deepseek/deepseek-v4.1-flash

Requiere la variable de entorno OPENROUTER_API_KEY (o GEMINI_API_KEY).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx

try:
    import tiktoken
    _ENC = tiktoken.get_encoding("cl100k_base")

    def count_tokens(text: str) -> int:
        return len(_ENC.encode(text))
except Exception:  # noqa: BLE001
    def count_tokens(text: str) -> int:
        return max(1, len(text) // 4)


SYSTEM_INSTRUCTION = """Eres un Compilador Pedagogico EdTech de alta precision.
Transforma una subseccion cruda de un libro tecnico de Python (junto con sus
trazas de memoria pre-calculadas) en un objeto JSON valido que cumpla
estrictamente con la interfaz MicroLesson del Motor Universal de Libros Vivos.

REGLAS ZERO-WASTE:
1. Emite EXCLUSIVAMENTE JSON valido. Sin saludos ni markdown.
2. Cero alucinacion de memoria: referencia los IDs de precomputedMemoryTraces.
3. Densidad editorial: bloques PROSE de 60 a 110 palabras.

Genera una secuencia de blocks: PROSE con glosario [[termino]],
OUTPUT_PREDICTION con gatesNextBlock, INTERACTIVE_VISUALIZER contextual,
CODE_LAB o AST_CHALLENGE, PARSONS_PROBLEM y FLASHCARD."""


# Precios por 1M tokens (USD) — ajusta segun tu proveedor.
MODEL_PRICING = {
    "deepseek/deepseek-v4.1-flash": (0.14, 0.28),
    "deepseek/deepseek-chat": (0.27, 1.10),
    "google/gemini-2.0-flash-001": (0.10, 0.40),
    "anthropic/claude-3.5-sonnet": (3.00, 15.00),
    "openai/gpt-4o-mini": (0.15, 0.60),
}

OUTPUT_EXPANSION = 1.45


@dataclass
class SectionResult:
    section_id: str
    chapter_number: int
    chapter_title: str
    section_title: str
    status: str = "QUEUED"
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    duration_sec: float = 0.0
    lesson: dict | None = None
    error_log: list[str] = field(default_factory=list)


class LiveTable:
    def __init__(self) -> None:
        self.total_cost = 0.0
        self.total_time = 0.0
        self.done = 0
        self.total = 0

    def render(self, result: SectionResult) -> None:
        self.total_cost += result.cost_usd
        self.total_time += result.duration_sec
        self.done += 1
        icon = {"COMPLETED": "OK ", "FAILED": "ERR"}.get(result.status, "...")
        print(
            f"[{icon}] {result.section_id:<14} "
            f"{result.input_tokens:>6}/{result.output_tokens:<6} tok  "
            f"${result.cost_usd:.4f}  {result.duration_sec:5.1f}s  "
            f"| acum ${self.total_cost:.4f}  {self.total_time:6.1f}s  "
            f"({self.done}/{self.total})"
        )


def build_prompt(chunk: dict, traces: list[dict]) -> str:
    relevant = [t for t in traces if t["sectionId"] == chunk["section_id"]]
    return json.dumps(
        {
            "sectionId": chunk["section_id"],
            "chapterNumber": chunk["chapter_number"],
            "chapterTitle": chunk["chapter_title"],
            "sectionTitle": chunk["section_title"],
            "cleanText": chunk["text"],
            "precomputedMemoryTraces": relevant,
        },
        ensure_ascii=False,
    )


def preflight_quote(chunks: list[dict], model: str) -> dict:
    price_in, price_out = MODEL_PRICING.get(model, (0.5, 1.5))
    total_in = 0
    total_out = 0
    total_cost = 0.0
    for chunk in chunks:
        prompt = build_prompt(chunk, [])
        tin = count_tokens(prompt) + 400
        tout = int(tin * OUTPUT_EXPANSION)
        total_in += tin
        total_out += tout
        total_cost += (tin / 1e6) * price_in + (tout / 1e6) * price_out
    return {
        "sections": len(chunks),
        "input_tokens": total_in,
        "output_tokens": total_out,
        "expected_cost_usd": total_cost,
        "min_cost_usd": total_cost * 0.7,
        "max_cost_usd": total_cost * 1.6,
    }


async def call_llm(
    client: httpx.AsyncClient,
    model: str,
    user_payload: str,
    api_key: str,
    max_retries: int = 3,
) -> tuple[dict, int, int]:
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://living-books.app",
        "X-Title": "Universal Living Book Engine",
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_INSTRUCTION},
            {"role": "user", "content": user_payload},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    for attempt in range(1, max_retries + 1):
        response = await client.post(url, headers=headers, json=body, timeout=120.0)
        if response.status_code == 429:
            backoff = min(30.0, 2.0 ** attempt) + random.random()
            print(f"  [429] rate limit, backoff {backoff:.1f}s (intento {attempt})")
            await asyncio.sleep(backoff)
            continue
        response.raise_for_status()
        data = response.json()
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        lesson = json.loads(text)
        return lesson, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)

    raise RuntimeError("Se agotaron los reintentos por rate limit.")


async def compile_section(
    sem: asyncio.Semaphore,
    client: httpx.AsyncClient,
    chunk: dict,
    traces: list[dict],
    model: str,
    api_key: str,
    table: LiveTable,
) -> SectionResult:
    result = SectionResult(
        section_id=chunk["section_id"],
        chapter_number=chunk["chapter_number"],
        chapter_title=chunk["chapter_title"],
        section_title=chunk["section_title"],
    )
    async with sem:
        started = time.time()
        try:
            lesson, tin, tout = await call_llm(client, model, build_prompt(chunk, traces), api_key)
            price_in, price_out = MODEL_PRICING.get(model, (0.5, 1.5))
            result.lesson = lesson
            result.input_tokens = tin
            result.output_tokens = tout
            result.cost_usd = (tin / 1e6) * price_in + (tout / 1e6) * price_out
            result.status = "COMPLETED"
        except Exception as exc:  # noqa: BLE001
            result.status = "FAILED"
            result.error_log.append(str(exc))
        result.duration_sec = time.time() - started
        table.render(result)
    return result


def load_checkpoint(path: Path) -> dict[str, dict]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def save_checkpoint(path: Path, results: dict[str, dict]) -> None:
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


async def main_async(args: argparse.Namespace) -> None:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise SystemExit("Falta la variable de entorno OPENROUTER_API_KEY.")

    chunks = json.loads(Path(args.chunks).read_text(encoding="utf-8"))
    traces = json.loads(Path(args.traces).read_text(encoding="utf-8"))
    meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))

    quote = preflight_quote(chunks, args.model)
    print("\n=== PRESUPUESTO PRE-VUELO ===")
    print(f"  Secciones:      {quote['sections']}")
    print(f"  Tokens in/out:  {quote['input_tokens']:,} / {quote['output_tokens']:,}")
    print(f"  Costo esperado: ${quote['expected_cost_usd']:.4f}  (rango ${quote['min_cost_usd']:.4f} - ${quote['max_cost_usd']:.4f})")
    print(f"  Workers:        {args.workers}")
    if not args.yes:
        answer = input("\nContinuar con la compilacion? [y/N] ").strip().lower()
        if answer != "y":
            print("Cancelado.")
            return

    checkpoint_path = Path(args.checkpoint)
    checkpoint = load_checkpoint(checkpoint_path)

    pending = [c for c in chunks if checkpoint.get(c["section_id"], {}).get("status") != "COMPLETED"]
    print(f"\nSecciones pendientes: {len(pending)} (omitidas {len(chunks) - len(pending)} ya completadas)\n")

    table = LiveTable()
    table.total = len(chunks)
    table.done = len(chunks) - len(pending)
    table.total_cost = sum(r.get("cost_usd", 0.0) for r in checkpoint.values())

    sem = asyncio.Semaphore(args.workers)
    async with httpx.AsyncClient() as client:
        tasks = [compile_section(sem, client, c, traces, args.model, api_key, table) for c in pending]
        for coro in asyncio.as_completed(tasks):
            result = await coro
            checkpoint[result.section_id] = asdict(result)
            save_checkpoint(checkpoint_path, checkpoint)

    chapters: dict[int, dict] = {}
    glossary: dict[str, dict] = dict(meta.get("glossary", {}))
    for chunk in chunks:
        entry = checkpoint.get(chunk["section_id"])
        if not entry or entry.get("status") != "COMPLETED" or not entry.get("lesson"):
            continue
        lesson = entry["lesson"]
        extracted = lesson.pop("extractedGlossary", None) if isinstance(lesson, dict) else None
        if isinstance(extracted, dict):
            for k, v in extracted.items():
                if k not in glossary and isinstance(v, dict):
                    glossary[k] = v
        chapter = chapters.setdefault(
            chunk["chapter_number"],
            {
                "chapterId": f"ch{chunk['chapter_number']}",
                "number": chunk["chapter_number"],
                "title": chunk["chapter_title"],
                "summary": "",
                "microLessons": [],
            },
        )
        chapter["microLessons"].append(lesson)

    cartridge = {
        "schemaVersion": "2.0",
        "bookId": meta.get("bookId", "libro-compilado"),
        "metadata": meta["metadata"],
        "themeDNA": meta["themeDNA"],
        "runtimeRequirements": meta["runtimeRequirements"],
        "glossary": glossary,
        "achievements": meta.get("achievements", []),
        "chapters": [chapters[k] for k in sorted(chapters)],
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(cartridge, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[03_cartridge_compiler] Cartucho escrito en {args.out}")
    print(f"Costo total real: ${table.total_cost:.4f}  |  Tiempo total: {table.total_time:.1f}s")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compila micro-secciones en un BookCartridge v2.0 (multi-agente).")
    parser.add_argument("--chunks", required=True)
    parser.add_argument("--traces", required=True)
    parser.add_argument("--meta", required=True)
    parser.add_argument("--out", default="cartridge.json")
    parser.add_argument("--checkpoint", default="checkpoint_progress.json")
    parser.add_argument("--workers", type=int, default=5, help="Agentes concurrentes (1-8).")
    parser.add_argument("--model", default="deepseek/deepseek-v4.1-flash")
    parser.add_argument("--yes", action="store_true", help="Omitir la confirmacion interactiva.")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()

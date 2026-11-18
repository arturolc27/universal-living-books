"""
01_semantic_chunker.py — Etapa A del Pipeline Zero-Waste (Fase 0 + Segmentador).

Flujo incremental en 4 etapas:

  Fase 0 (LLM TOC Extractor): toma unicamente las primeras ~15 paginas del PDF
  (portada, creditos y Table of Contents) y hace UNA sola llamada estructurada
  al LLM para extraer los metadatos bibliograficos y el Indice Maestro de
  Capitulos (`chaptersIndex`) con paginas reales del PDF.

  Segmentador robusto: usa ese indice para cortar el libro completo en todos
  sus capitulos reales y agrupa las subsecciones internas en 4 a 8
  micro-lecciones pedagogicas por capitulo (nunca 27 fragmentos sueltos).

Uso:
    python 01_semantic_chunker.py --pdf libro.pdf --out chunks.json
    python 01_semantic_chunker.py --pdf libro.pdf --chapters 1,2 --out chunks.json
    python 01_semantic_chunker.py --pdf libro.pdf --no-llm --out chunks.json

Requiere la variable de entorno OPENROUTER_API_KEY (o GEMINI_API_KEY) salvo que
se use --no-llm (en cuyo caso se usa el TOC embebido del PDF).
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import fitz  # PyMuPDF

try:
    import httpx
except Exception:  # noqa: BLE001
    httpx = None  # type: ignore[assignment]


NOISE_PATTERNS = [
    re.compile(r"report erratum", re.IGNORECASE),
    re.compile(r"discuss this", re.IGNORECASE),
    re.compile(r"^\s*\d+\s*$"),
    re.compile(r"^\s*chapter\s+\d+\s*$", re.IGNORECASE),
    re.compile(r"^\s*copyright\s+\d{4}", re.IGNORECASE),
    re.compile(r"^\s*all rights reserved", re.IGNORECASE),
]

MIN_SECTION_CHARS = 400
MAX_SECTION_CHARS = 9000
MIN_MICRO_LESSONS = 4
MAX_MICRO_LESSONS = 8
FRONT_MATTER_PAGES = 15

TOC_SYSTEM_INSTRUCTION = """Eres un bibliotecario experto en ingenieria inversa de indices de libros tecnicos.
Recibes las primeras paginas de un libro (portada, creditos y Table of Contents).
Devuelve EXCLUSIVAMENTE un objeto JSON valido, sin markdown ni texto adicional.

REGLAS:
1. Extrae los metadatos bibliograficos reales (title, subtitle, authors, year, edition, totalPages).
2. Reconstruye el Indice Maestro de Capitulos (chaptersIndex) con chapterNumber, title,
   startPage y endPage (paginas reales del PDF, 1-based).
3. NO inventes capitulos: usa solo los que aparecen en el Table of Contents.
4. Si un dato no aparece, usa un valor razonable y coherente (nunca null)."""


@dataclass
class SectionChunk:
    section_id: str
    chapter_number: int
    chapter_title: str
    section_title: str
    page_start: int
    page_end: int
    text: str
    code_snippets: list[str] = field(default_factory=list)


def is_noise_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    return any(pattern.search(stripped) for pattern in NOISE_PATTERNS)


def clean_page_text(raw: str) -> str:
    lines = [ln for ln in raw.splitlines() if not is_noise_line(ln)]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_code_snippets(text: str) -> list[str]:
    """Heuristica: bloques con '>>>' o lineas indentadas con 'def '/'class '."""
    snippets: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        looks_like_code = (
            line.strip().startswith(">>>")
            or line.startswith("    ")
            or line.strip().startswith(("def ", "class ", "import ", "from "))
        )
        if looks_like_code:
            current.append(line)
        elif current:
            snippets.append("\n".join(current))
            current = []
    if current:
        snippets.append("\n".join(current))
    return [s for s in snippets if len(s.strip()) > 12]


# --- FASE 0: EXTRACCION DE METADATOS E INDICE MAESTRO CON LLM ---


def extract_front_matter(doc: fitz.Document, max_pages: int = FRONT_MATTER_PAGES) -> str:
    pages = min(max_pages, doc.page_count)
    return "\n".join(doc.load_page(i).get_text("text") for i in range(pages))


def _call_llm(front_matter: str, api_key: str, model: str) -> dict:
    if httpx is None:
        raise RuntimeError("httpx no esta instalado; usa --no-llm o instala requirements.txt.")
    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://living-books.app",
            "X-Title": "Universal Living Book Engine",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": TOC_SYSTEM_INSTRUCTION},
                {"role": "user", "content": front_matter},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        },
        timeout=120.0,
    )
    response.raise_for_status()
    text = response.json()["choices"][0]["message"]["content"]
    cleaned = text.strip().removeprefix("```json").removesuffix("```").strip()
    return json.loads(cleaned)


def extract_metadata_and_toc(
    doc: fitz.Document, api_key: str | None, model: str
) -> tuple[dict, list[dict]]:
    """Devuelve (metadata, chapters_index). Usa el LLM si hay API key."""
    if api_key:
        front_matter = extract_front_matter(doc)
        payload = _call_llm(front_matter, api_key, model)
        metadata = {
            "title": payload.get("title", "Libro sin titulo"),
            "subtitle": payload.get("subtitle", ""),
            "authors": payload.get("authors", ["Autor Desconocido"]),
            "year": payload.get("year", 0),
            "edition": payload.get("edition", "1st Edition"),
            "totalPages": payload.get("totalPages", doc.page_count),
            "difficulty": payload.get("difficulty", "BEGINNER"),
            "coverAccentIcon": payload.get("coverAccentIcon", "📘"),
            "themeDNA": payload.get("themeDNA", {}),
        }
        chapters = payload.get("chaptersIndex", [])
        if chapters:
            return metadata, chapters

    # Fallback: TOC embebido del PDF.
    toc = doc.get_toc(simple=True)
    chapters = []
    for level, title, page in toc:
        if level != 1:
            continue
        match = re.search(r"(\d+)", title)
        number = int(match.group(1)) if match else len(chapters) + 1
        chapters.append({"chapterNumber": number, "title": title.strip(), "startPage": page, "endPage": page})
    for i, chapter in enumerate(chapters):
        chapter["endPage"] = chapters[i + 1]["startPage"] - 1 if i + 1 < len(chapters) else doc.page_count
    metadata = {
        "title": doc.metadata.get("title") or "Libro sin titulo",
        "subtitle": "",
        "authors": [doc.metadata.get("author") or "Autor Desconocido"],
        "year": 0,
        "edition": "1st Edition",
        "totalPages": doc.page_count,
        "difficulty": "BEGINNER",
        "coverAccentIcon": "📘",
        "themeDNA": {},
    }
    return metadata, chapters


# --- SEGMENTADOR ROBUSTO BASADO EN EL INDICE ---


def find_sub_headings(body: str) -> list[tuple[int, str]]:
    headings: list[tuple[int, str]] = []
    offset = 0
    for line in body.splitlines():
        md = re.match(r"^(#{2,4})\s+(.+)$", line)
        numbered = re.match(r"^(\d+\.\d+(?:\.\d+)?)\s+([A-Z].{2,80})$", line)
        if md:
            headings.append((offset, md.group(2).strip()))
        elif numbered:
            headings.append((offset, f"{numbered.group(1)} {numbered.group(2).strip()}"))
        offset += len(line) + 1
    return headings


def split_by_paragraphs(body: str, target_count: int) -> list[str]:
    paragraphs = [p for p in re.split(r"\n\n+", body) if p.strip()]
    if not paragraphs:
        return [body]
    per_chunk = max(1, -(-len(paragraphs) // target_count))
    return ["\n\n".join(paragraphs[i : i + per_chunk]) for i in range(0, len(paragraphs), per_chunk)]


def split_chapter_into_micro_lessons(
    body: str, chapter_number: int, chapter_title: str, target_count: int
) -> list[SectionChunk]:
    clean_body = clean_page_text(body)
    if len(clean_body) < MIN_SECTION_CHARS:
        return []

    desired = min(MAX_MICRO_LESSONS, max(MIN_MICRO_LESSONS, target_count))
    headings = find_sub_headings(clean_body)
    chunks: list[SectionChunk] = []

    def push(title: str, text: str, index: int) -> None:
        trimmed = text.strip()
        if len(trimmed) < MIN_SECTION_CHARS:
            return
        chunks.append(
            SectionChunk(
                section_id=f"ch{chapter_number}-sec{index}",
                chapter_number=chapter_number,
                chapter_title=chapter_title,
                section_title=title,
                page_start=0,
                page_end=0,
                text=trimmed[:MAX_SECTION_CHARS],
                code_snippets=extract_code_snippets(trimmed),
            )
        )

    if MIN_MICRO_LESSONS <= len(headings) <= MAX_MICRO_LESSONS:
        for i, (start, title) in enumerate(headings):
            end = headings[i + 1][0] if i + 1 < len(headings) else len(clean_body)
            push(title, clean_body[start:end], i + 1)
        return chunks

    for i, group in enumerate(split_by_paragraphs(clean_body, desired)):
        first_line = next((ln for ln in group.splitlines() if ln.strip()), "")
        title = first_line.strip()[:70] or f"{chapter_title} ({i + 1})"
        push(title, group, i + 1)
    return chunks


def segment_by_index(
    doc: fitz.Document, chapters_index: list[dict], selected: set[int] | None
) -> list[SectionChunk]:
    ordered = sorted(chapters_index, key=lambda c: c["chapterNumber"])
    chunks: list[SectionChunk] = []
    for chapter in ordered:
        number = int(chapter["chapterNumber"])
        if selected and number not in selected:
            continue
        start = max(0, int(chapter.get("startPage", 1)) - 1)
        end = min(doc.page_count, int(chapter.get("endPage", doc.page_count)))
        raw = "".join(doc.load_page(p).get_text("text") for p in range(start, end))
        page_span = max(1, end - start)
        target = min(MAX_MICRO_LESSONS, max(MIN_MICRO_LESSONS, round(page_span / 6)))
        lessons = split_chapter_into_micro_lessons(raw, number, chapter.get("title", f"Capitulo {number}"), target)
        for lesson in lessons:
            lesson.page_start = start + 1
            lesson.page_end = end
        chunks.extend(lessons)
        print(f"  [segmentador] Capitulo {number}: {len(lessons)} micro-lecciones.")
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(description="Segmenta un PDF tecnico en micro-secciones limpias.")
    parser.add_argument("--pdf", required=True, help="Ruta al PDF de entrada.")
    parser.add_argument("--out", default="chunks.json", help="Ruta del JSON de salida.")
    parser.add_argument("--meta-out", default="book_meta.json", help="Ruta del JSON de metadatos.")
    parser.add_argument("--chapters", default="", help="Capitulos a procesar, ej. '1,2' (vacio = todos).")
    parser.add_argument("--model", default="deepseek/deepseek-v4.1-flash", help="Modelo LLM para la Fase 0.")
    parser.add_argument("--no-llm", action="store_true", help="Usa el TOC embebido del PDF (sin LLM).")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise SystemExit(f"No se encontro el PDF: {pdf_path}")

    selected: set[int] | None = None
    if args.chapters.strip():
        selected = {int(x) for x in args.chapters.split(",") if x.strip().isdigit()}

    api_key = None if args.no_llm else os.environ.get("OPENROUTER_API_KEY")
    if not args.no_llm and not api_key:
        print("[01_semantic_chunker] Sin OPENROUTER_API_KEY: usando el TOC embebido del PDF.")

    doc = fitz.open(pdf_path)
    metadata, chapters_index = extract_metadata_and_toc(doc, api_key, args.model)
    print(f"[01_semantic_chunker] Fase 0: {len(chapters_index)} capitulos detectados.")

    chunks = segment_by_index(doc, chapters_index, selected)
    doc.close()

    Path(args.out).write_text(
        json.dumps([asdict(chunk) for chunk in chunks], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    Path(args.meta_out).write_text(
        json.dumps({"metadata": metadata, "chaptersIndex": chapters_index}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[01_semantic_chunker] {len(chunks)} micro-secciones escritas en {args.out}")
    print(f"[01_semantic_chunker] Metadatos e indice escritos en {args.meta_out}")


if __name__ == "__main__":
    main()

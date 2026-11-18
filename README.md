# Universal Living Book Engine v2.0

Motor Universal de Libros Vivos de Python: compila libros tecnicos en cartuchos JSON interactivos con soporte dual (PC Deep Lab de 3 paneles + Mobile Companion tactil), runtime de Python en el navegador (Pyodide) y persistencia Local-First.

## Inicio rapido

```bash
cd proyectos/universal-living-books
pnpm install
pnpm dev
```

Abre http://localhost:5173/

---

## Como cargar libros

Hay **tres formas** de cargar libros en la plataforma.

### 1. Libros demo precargados (automatico)

Al abrir la app, la Biblioteca Central carga automaticamente los dos cartuchos incluidos en `public/cartridges/`:

- 🪨 **Practical Programming** (Zen Pragmatic Dark)
- 🧭 **Intuitive Python** (Editorial Emerald & Graphite)

El cargador esta en [`src/data/bundledCartridges.ts`](src/data/bundledCartridges.ts) y lee estos archivos:

```
public/cartridges/practical-programming/cartridge.json
public/cartridges/intuitive-python/cartridge.json
```

Para agregar otro libro precargado, coloca su carpeta en `public/cartridges/<book-id>/cartridge.json` y anade la URL al arreglo `BUNDLED_CARTRIDGE_URLS`.

### 2. Importar un cartucho JSON manualmente (desde la UI)

1. En la Biblioteca Central, pulsa **[+ Importar JSON]** (o arrastra el archivo sobre la tarjeta "+ NUEVO LIBRO").
2. Selecciona o arrastra un archivo `cartridge.json` compilado.
3. El modal [`CartridgeImporterModal.tsx`](src/ui/library/CartridgeImporterModal.tsx) valida el esquema con Zod y muestra un diagnostico (titulo, capitulos, bloques interactivos, paquetes requeridos).
4. Pulsa **Instalar en Biblioteca**. El libro queda guardado offline en IndexedDB (`installedCartridges`) y sobrevive al cierre del navegador.

### 3. Compilar un libro nuevo desde un PDF (Pipeline Zero-Waste)

El pipeline en `compiler/` transforma un PDF tecnico en un `cartridge.json` valido gastando una fraccion minima de tokens.

```bash
cd compiler
pip install -r requirements.txt

# Etapa A: pre-procesamiento determinista local (0 tokens)
python 01_semantic_chunker.py --pdf libro.pdf --out chunks.json
python 02_deterministic_tracer.py --chunks chunks.json --out traces.json

# Etapa B: compilacion con LLM (JSON Schema estricto)
set GEMINI_API_KEY=tu_api_key
python 03_cartridge_compiler.py --chunks chunks.json --traces traces.json --meta book_meta.json --out cartridge.json

# Assets GPU opcionales (WebM alfa / Lottie)
python 04_gpu_asset_baker.py --manim escena.py --scene MemoryScene --out assets/
```

El prompt pedagogico reutilizable esta en [`compiler/SKILL.md`](compiler/SKILL.md).

---

## Estructura del proyecto

```
universal-living-books/
├── compiler/                  # Pipeline Zero-Waste (Python)
├── public/
│   ├── manifest.json          # PWA
│   └── cartridges/            # Cartuchos demo
└── src/
    ├── types/                 # Contrato DSL + Zod
    ├── db/                    # IndexedDB + sync
    ├── engine/                # Pyodide, AST, SM-2
    ├── registry/              # Widgets polimorficos
    ├── store/                 # Estado global Zustand
    └── ui/                    # Biblioteca, Studio, Mobile
```

## Scripts

| Comando | Descripcion |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` | Typecheck + build de produccion |
| `pnpm typecheck` | Verificacion de tipos |
| `pnpm test` | Tests de validacion de cartuchos y SM-2 |

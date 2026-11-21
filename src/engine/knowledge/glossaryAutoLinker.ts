import type { GlossaryEntry } from '../../types/cartridge.types';
import type { GlobalConceptRecord } from '../../db/dexieDb';
import { normalizeConceptKey } from './knowledgeIndexer';

export interface AutoLinkTarget {
  conceptKey: string;
  term: string;
  aliases: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Construye la lista deduplicada de términos enlazables combinando el glosario
 * local del cartucho + los conceptos globales de Dexie, ordenados de mayor a
 * menor longitud para evitar colisiones parciales (ej. "list comprehension" antes que "list").
 */
export function buildAutoLinkTargets(
  glossary: Record<string, GlossaryEntry>,
  globalConcepts: GlobalConceptRecord[] = []
): AutoLinkTarget[] {
  const byKey = new Map<string, AutoLinkTarget>();

  for (const c of globalConcepts) {
    byKey.set(c.conceptKey, {
      conceptKey: c.conceptKey,
      term: c.term,
      aliases: [...c.aliases],
    });
  }

  for (const entry of Object.values(glossary ?? {})) {
    const key = normalizeConceptKey(entry.term);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      const merged = new Set([...existing.aliases, ...(entry.aliases ?? [])]);
      existing.aliases = [...merged];
    } else {
      byKey.set(key, {
        conceptKey: key,
        term: entry.term,
        aliases: [...(entry.aliases ?? [])],
      });
    }
  }

  return [...byKey.values()];
}

/**
 * Procesa Markdown convirtiendo:
 * 1) Marcadores explícitos `[[término]]` -> `[término](#glossary:slug)`
 * 2) Auto-enlazado inteligente case-insensitive de términos y aliases:
 *    - Respeta bloques de código cercados (```...```), código inline (`...`),
 *      encabezados Markdown (`# ...`) y enlaces ya existentes (`[...](...)`).
 *    - Enlaza **únicamente la primera aparición por párrafo/sección** de cada concepto
 *      para evitar ruido visual ("árbol de navidad").
 */
export function autoLinkGlossaryMarkdown(
  markdown: string,
  targets: AutoLinkTarget[]
): string {
  const safe = typeof markdown === 'string' ? markdown : '';
  if (!safe) return '';

  // Paso 1: Reemplazar marcadores explícitos [[term]] fuera de bloques cercados
  // Separar primero por bloques de código cercados (```...```)
  const fenceSplit = safe.split(/(```[\s\S]*?```)/g);

  // Construir lookup de patrones (mínimo 4 caracteres para evitar falsos positivos con "is", "in", "or")
  interface SurfacePattern {
    surface: string;
    conceptKey: string;
  }
  const surfaces: SurfacePattern[] = [];
  const seenSurface = new Set<string>();
  for (const t of targets) {
    const candidates = [t.term, ...t.aliases];
    for (const raw of candidates) {
      const trimmed = raw.trim();
      if (trimmed.length < 4) continue;
      const lower = trimmed.toLowerCase();
      if (seenSurface.has(lower)) continue;
      seenSurface.add(lower);
      surfaces.push({ surface: trimmed, conceptKey: t.conceptKey });
    }
  }
  // Ordenar por longitud descendente (match más específico primero)
  surfaces.sort((a, b) => b.surface.length - a.surface.length);

  const surfaceToKey = new Map<string, string>();
  for (const s of surfaces) {
    surfaceToKey.set(s.surface.toLowerCase(), s.conceptKey);
  }

  const combinedRegex =
    surfaces.length > 0
      ? new RegExp(
          `(?<![\\p{L}\\p{N}_-])(${surfaces.map((s) => escapeRegExp(s.surface)).join('|')})(?![\\p{L}\\p{N}_-])`,
          'giu'
        )
      : null;

  return fenceSplit
    .map((segment) => {
      if (segment.startsWith('```')) return segment;

      // Procesar párrafo por párrafo para enlazar máx 1 ocurrencia de cada concepto por párrafo
      const paragraphs = segment.split(/(\n\s*\n)/g);
      return paragraphs
        .map((para) => {
          if (/^\s*$/.test(para)) return para;
          // No auto-enlazar encabezados Markdown (#, ##, ###, etc.)
          if (/^\s*#{1,6}\s/.test(para)) {
            return para.replace(/\[\[([^\]]+)\]\]/g, (_m, term: string) => term);
          }

          const linkedInParagraph = new Set<string>();

          // 1. Convertir [[term]] explícitos
          let processed = para.replace(/\[\[([^\]]+)\]\]/g, (_m, term: string) => {
            const key = normalizeConceptKey(term);
            linkedInParagraph.add(key);
            return `[${term}](#glossary:${encodeURIComponent(key)})`;
          });

          if (!combinedRegex) return processed;

          // 2. Proteger código inline (`...`) y enlaces Markdown existentes (`[...](...)`)
          const protectedParts = processed.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
          processed = protectedParts
            .map((part) => {
              if (!part) return part;
              if (part.startsWith('`') || (part.startsWith('[') && part.includes(']('))) {
                return part;
              }
              return part.replace(combinedRegex, (match) => {
                const key = surfaceToKey.get(match.toLowerCase());
                if (!key || linkedInParagraph.has(key)) return match;
                linkedInParagraph.add(key);
                return `[${match}](#glossary:${encodeURIComponent(key)})`;
              });
            })
            .join('');

          return processed;
        })
        .join('');
    })
    .join('');
}

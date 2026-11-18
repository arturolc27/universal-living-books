/**
 * Filtro Estatico AST Pre-Ejecucion (0 ms).
 *
 * Modulo sin dependencias (ni Dexie ni Web Workers) para poder auditar
 * snippets de forma pura y testeable. Descarta:
 *   - Codigo con errores de sintaxis intencionales (SyntaxError).
 *   - Llamadas bloqueantes o externas (input, open, urlopen, import).
 *   - Expresiones triviales de una sola linea sin cambios de estado.
 */

export interface StaticFilterVerdict {
  safe: boolean;
  trivial: boolean;
  reason: string;
}

const BLOCKING_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\binput\s*\(/, reason: 'Llamada bloqueante input().' },
  { pattern: /\bopen\s*\(/, reason: 'Acceso a disco open().' },
  { pattern: /\burlopen\s*\(/, reason: 'Llamada de red urlopen().' },
  { pattern: /\brequests\./, reason: 'Llamada de red requests.' },
  { pattern: /\bsocket\./, reason: 'Llamada de red socket.' },
  { pattern: /\btime\.sleep\s*\(/, reason: 'Espera bloqueante time.sleep().' },
  { pattern: /\bwhile\s+True\b/, reason: 'Bucle infinito while True.' },
];

const EXTERNAL_IMPORT_PATTERN = /^\s*(?:import|from)\s+\w+/m;

const MUTATION_METHOD_PATTERN =
  /\.(?:append|extend|insert|remove|pop|sort|reverse|update|add|discard|clear|setdefault)\s*\(/;

const STATEMENT_KEYWORD_PATTERN =
  /^(?:def|class|for|while|if|elif|else|try|except|finally|with|import|from|return|yield|global|nonlocal|del|assert|raise|async)\b/;

/** Normaliza prompts de REPL (`>>> `, `... `) a codigo ejecutable. */
export function normalizeSnippetCode(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      if (line.startsWith('>>> ')) return line.slice(4);
      if (line.startsWith('... ')) return line.slice(4);
      if (line.trim() === '>>>' || line.trim() === '...') return '';
      return line;
    })
    .join('\n');
}

function checkBracketBalance(code: string): string | null {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let inString: string | null = null;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (inString) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '#') {
      const nl = code.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== pairs[ch]) return `Parentesis desbalanceados cerca de "${ch}".`;
    }
  }
  if (stack.length > 0) return 'Parentesis sin cerrar (SyntaxError).';
  return null;
}

function detectSyntaxError(code: string): string | null {
  const lines = code.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Operador binario colgante al final de linea (ej. "2 +").
    if (/[+\-*/%<>&|^,]$/.test(trimmed) && !/[=<>!]=$/.test(trimmed)) {
      return `Operador colgante al final de linea: "${trimmed}".`;
    }
    // Asignacion con '=' colgante (ej. "x =").
    if (/(?<![=<>!+\-*/%])=$/.test(trimmed)) {
      return `Asignacion incompleta: "${trimmed}".`;
    }
  }
  // Asignacion a un literal (ej. "12 = x").
  if (/^\s*(?:\d+|['"][^'"]*['"])\s*=[^=]/m.test(code)) {
    return 'Asignacion a un literal (SyntaxError).';
  }
  return checkBracketBalance(code);
}

function isTrivialExpression(code: string): boolean {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length !== 1) return false;
  const line = lines[0];
  if (STATEMENT_KEYWORD_PATTERN.test(line)) return false;
  // Asignacion simple (excluye ==, <=, >=, !=).
  if (/(?:^|[^=<>!+\-*/%])=(?!=)/.test(line)) return false;
  // Asignacion aumentada.
  if (/[+\-*/%]=/.test(line)) return false;
  // Mutacion de contenedores.
  if (MUTATION_METHOD_PATTERN.test(line)) return false;
  return true;
}

/** Audita el snippet sin ejecutarlo. */
export function analyzeSnippetStatic(code: string): StaticFilterVerdict {
  const normalized = normalizeSnippetCode(code).trim();
  if (!normalized) {
    return { safe: false, trivial: true, reason: 'Snippet vacio.' };
  }

  const syntaxReason = detectSyntaxError(normalized);
  if (syntaxReason) {
    return { safe: false, trivial: false, reason: syntaxReason };
  }

  for (const { pattern, reason } of BLOCKING_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safe: false, trivial: false, reason };
    }
  }

  if (EXTERNAL_IMPORT_PATTERN.test(normalized)) {
    return { safe: false, trivial: false, reason: 'Import externo no trazable.' };
  }

  if (isTrivialExpression(normalized)) {
    return { safe: false, trivial: true, reason: 'Expresion trivial sin cambios de estado.' };
  }

  return { safe: true, trivial: false, reason: 'Apto para trazado.' };
}

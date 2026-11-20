import type { PythonExecutionResult, PythonMisconceptionId } from '../../types/cartridge.types';

export interface MisconceptionDiagnosis {
  id: PythonMisconceptionId;
  title: string;
  explanation: string;
  refutationTip: string;
  contrastiveSnippet: string;
}

export const MISCONCEPTION_CATALOG: Record<PythonMisconceptionId, Omit<MisconceptionDiagnosis, 'id'>> = {
  MUTATION_ALIASING: {
    title: 'Aliasing y mutación in-place',
    explanation:
      'En Python, `b = a` NO copia la lista ni el diccionario: ambas variables apuntan al mismo objeto en el Heap. Además, métodos como `.append()` o `.sort()` mutan el objeto y devuelven `None`.',
    refutationTip:
      'Usa `b = a.copy()` o `sorted(a)` si necesitas conservar el objeto original sin efectos secundarios.',
    contrastiveSnippet: 'a = [3, 1]\nb = a\nb.sort()  # muta el mismo objeto y devuelve None\nprint(a)  # [1, 3]',
  },
  MUTABLE_DEFAULT_ARG: {
    title: 'Argumento por defecto mutable',
    explanation:
      'Los valores por defecto (`def f(items=[]):`) se evalúan UNA sola vez al definir la función, no en cada llamada. Todas las llamadas comparten la misma lista.',
    refutationTip:
      'Usa `items=None` en la firma y crea `if items is None: items = []` dentro de la función.',
    contrastiveSnippet: 'def add(x, bag=None):\n    if bag is None:\n        bag = []\n    bag.append(x)\n    return bag',
  },
  SCOPE_LEGB_SHADOWING: {
    title: 'Alcance local vs. global (LEGB)',
    explanation:
      'Si asignas un valor a una variable dentro de una función (`x = x + 1`), Python la trata como local en toda la función, lanzando `UnboundLocalError` si la lees antes de asignarla.',
    refutationTip:
      'Pasa el valor como parámetro y devuélvelo con `return` en lugar de mutar variables externas.',
    contrastiveSnippet: 'def incrementar(x):\n    return x + 1\ntotal = incrementar(5)',
  },
  PRINT_VS_RETURN: {
    title: 'Confusión entre print() y return',
    explanation:
      '`print()` solo escribe texto en consola y devuelve `None`. Quien llama a la función necesita `return` para recibir el valor y poder probarlo o reutilizarlo.',
    refutationTip:
      'Reemplaza `print(resultado)` al final de tu función por `return resultado`.',
    contrastiveSnippet: 'def doble(n):\n    return n * 2  # NO print(n * 2)',
  },
  SHALLOW_LOOP_MUTATION: {
    title: 'Mutar una colección mientras se itera',
    explanation:
      'Eliminar elementos de una lista dentro de un `for x in lista:` desplaza los índices y provoca que Python se salte elementos sin evaluarlos.',
    refutationTip:
      'Construye una nueva lista por comprensión (`[x for x in items if ...]`) o itera sobre una copia `items[:]`.',
    contrastiveSnippet: 'pares = [x for x in nums if x % 2 == 0]',
  },
  EQUALITY_VS_IDENTITY: {
    title: 'Identidad (is) vs. Igualdad (==)',
    explanation:
      '`is` comprueba si dos variables apuntan exactamente al mismo objeto en memoria, no si tienen el mismo valor. Con enteros grandes o cadenas construidas en ejecución, `==` es `True` pero `is` puede ser `False`.',
    refutationTip:
      'Reserva `is` exclusivamente para comparar con `None` (`if x is None:`); usa `==` para valores.',
    contrastiveSnippet: 'a = 1000\nb = int("1000")\nprint(a == b, a is b)  # True False',
  },
  RECURSION_NO_BASE_OR_RETURN: {
    title: 'Recursión sin caso base o sin return',
    explanation:
      'Toda función recursiva necesita un caso base alcanzable que detenga las llamadas y un `return` explícito delante de la llamada recursiva para propagar el resultado hacia arriba.',
    refutationTip:
      'Verifica que cada rama recursiva devuelva `return fn(...)` y avance hacia el caso base.',
    contrastiveSnippet: 'def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)',
  },
};

export function detectPythonMisconception(
  userCode: string,
  execResult?: PythonExecutionResult | null
): MisconceptionDiagnosis | null {
  const stderr = execResult?.stderr ?? '';
  const testMsg =
    execResult?.unitTestReport?.items
      .filter((i) => !i.passed)
      .map((i) => `${i.message} ${i.actual ?? ''}`)
      .join('\n') ?? '';

  if (/UnboundLocalError/i.test(stderr)) {
    return { id: 'SCOPE_LEGB_SHADOWING', ...MISCONCEPTION_CATALOG.SCOPE_LEGB_SHADOWING };
  }

  if (/RecursionError/i.test(stderr)) {
    return { id: 'RECURSION_NO_BASE_OR_RETURN', ...MISCONCEPTION_CATALOG.RECURSION_NO_BASE_OR_RETURN };
  }

  // print() sin return cuando el test esperaba un valor y recibió None
  const hasDef = /\bdef\s+\w+\s*\(/.test(userCode);
  const hasPrint = /\bprint\s*\(/.test(userCode);
  const hasReturn = /\breturn\b/.test(userCode);
  if (hasDef && hasPrint && !hasReturn && (/\bNone\b/.test(testMsg) || execResult?.unitTestReport?.passed === false)) {
    return { id: 'PRINT_VS_RETURN', ...MISCONCEPTION_CATALOG.PRINT_VS_RETURN };
  }

  // Argumento por defecto mutable: def f(a=[]): o def f(a={}):
  if (/def\s+\w+\s*\([^)]*=\s*(\[\s*\]|\{\s*\})/.test(userCode)) {
    return { id: 'MUTABLE_DEFAULT_ARG', ...MISCONCEPTION_CATALOG.MUTABLE_DEFAULT_ARG };
  }

  // Uso de `is` con literales numéricos o strings
  if (/\bis\s+(?:not\s+)?(?:['"\d-])/.test(userCode)) {
    return { id: 'EQUALITY_VS_IDENTITY', ...MISCONCEPTION_CATALOG.EQUALITY_VS_IDENTITY };
  }

  // Mutar lista dentro de un bucle for x in items: items.remove(...) / pop(...)
  const loopMatch = userCode.match(/for\s+\w+\s+in\s+(\w+)\s*:[\s\S]*\1\.(remove|pop)\s*\(/);
  if (loopMatch) {
    return { id: 'SHALLOW_LOOP_MUTATION', ...MISCONCEPTION_CATALOG.SHALLOW_LOOP_MUTATION };
  }

  // Asignar el resultado de .sort() / .append() / .reverse()
  if (/=\s*\w+\.(?:sort|append|reverse|extend)\s*\(/.test(userCode)) {
    return { id: 'MUTATION_ALIASING', ...MISCONCEPTION_CATALOG.MUTATION_ALIASING };
  }

  return null;
}

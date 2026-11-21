import type { PythonMisconceptionId } from '../types/cartridge.types';

export type PythonDomainId =
  | 'basics_types'
  | 'memory_model'
  | 'control_flow'
  | 'functions_scope'
  | 'data_structures'
  | 'oop_protocols'
  | 'errors_files_modules'
  | 'idiomatic_functional'
  | 'testing_data_eco';

export interface PythonDomainSpec {
  id: PythonDomainId;
  order: number;
  title: string;
  shortTitle: string;
  description: string;
  accentColor: string;
}

export interface PythonCompetencyNode {
  id: string;
  domainId: PythonDomainId;
  title: string;
  description: string;
  complexityTier: 1 | 2 | 3;
  prerequisites: string[];
  keywords: string[];
  targetExercises: number;
}

export const PYTHON_DOMAINS: PythonDomainSpec[] = [
  {
    id: 'basics_types',
    order: 1,
    title: 'Fundamentos, Expresiones y Tipos',
    shortTitle: 'Fundamentos',
    description: 'Tipos primitivos, operadores, precedencia, cadenas y conversiones explícitas.',
    accentColor: '#38BDF8',
  },
  {
    id: 'memory_model',
    order: 2,
    title: 'Modelo de Memoria y Referencias',
    shortTitle: 'Memoria',
    description: 'Nombres vs objetos en el heap, mutabilidad, aliasing, copias superficiales y profundas.',
    accentColor: '#A78BFA',
  },
  {
    id: 'control_flow',
    order: 3,
    title: 'Control de Flujo e Iteración',
    shortTitle: 'Control de Flujo',
    description: 'Condicionales, truthiness, cortocircuito, bucles for/while, iterables e iteradores.',
    accentColor: '#34D399',
  },
  {
    id: 'functions_scope',
    order: 4,
    title: 'Funciones, Ámbito LEGB y Closures',
    shortTitle: 'Funciones y Scope',
    description: 'Parámetros, return vs print, argumentos mutables, LEGB, closures, recursión y decoradores.',
    accentColor: '#F59E0B',
  },
  {
    id: 'data_structures',
    order: 5,
    title: 'Estructuras de Datos y Complejidad',
    shortTitle: 'Estructuras',
    description: 'Listas, slicing, tuplas, diccionarios, conjuntos, hashing y costos Big-O reales.',
    accentColor: '#FB7185',
  },
  {
    id: 'oop_protocols',
    order: 6,
    title: 'OOP y Modelo de Datos (Dunders)',
    shortTitle: 'OOP y Protocolos',
    description: 'Clases, instancias, herencia, composición, dataclasses y métodos especiales (__repr__, __eq__).',
    accentColor: '#818CF8',
  },
  {
    id: 'errors_files_modules',
    order: 7,
    title: 'Excepciones, Archivos y Módulos',
    shortTitle: 'Errores y I/O',
    description: 'Try/except/finally, context managers (with), pathlib, CSV/JSON, paquetes e imports.',
    accentColor: '#2DD4BF',
  },
  {
    id: 'idiomatic_functional',
    order: 8,
    title: 'Python Idiomático, Generadores y AST',
    shortTitle: 'Idiomático',
    description: 'Comprehensions, expresiones generadoras, yield, unpacking, itertools, typing y AST.',
    accentColor: '#F472B6',
  },
  {
    id: 'testing_data_eco',
    order: 9,
    title: 'Testing, Debugging y Ecosistema de Datos',
    shortTitle: 'Testing y Datos',
    description: 'Doctest/pytest, trazado y depuración, NumPy/Pandas DataFrames, vectorización y gráficos.',
    accentColor: '#FACC15',
  },
];

/**
 * Taxonomía canónica de 54 competencias de Python organizadas en 9 dominios (DAG).
 * Sirve como espina dorsal libro-agnóstica para medir dominio demostrado real.
 */
export const PYTHON_COMPETENCIES: PythonCompetencyNode[] = [
  // 1. Fundamentos, Expresiones y Tipos (6)
  {
    id: 'py.basics.numeric_types',
    domainId: 'basics_types',
    title: 'Tipos numéricos (int, float, bool)',
    description: 'Precisión arbitraria en int, aritmética de punto flotante IEEE-754 y bool como subclase de int.',
    complexityTier: 1,
    prerequisites: [],
    keywords: ['int', 'float', 'bool', 'numero', 'numeric', 'entero', 'flotante', 'boolean', 'tipo'],
    targetExercises: 2,
  },
  {
    id: 'py.basics.operator_precedence',
    domainId: 'basics_types',
    title: 'Precedencia y evaluación de operadores',
    description: 'Orden de evaluación (** derecha a izquierda, unarios, //, %, comparaciones encadenadas).',
    complexityTier: 2,
    prerequisites: ['py.basics.numeric_types'],
    keywords: ['precedence', 'precedencia', 'operador', 'operator', 'expresion', 'expression', 'modulo', 'division'],
    targetExercises: 3,
  },
  {
    id: 'py.basics.strings_indexing',
    domainId: 'basics_types',
    title: 'Cadenas (str), inmutabilidad y métodos',
    description: 'Indexación, slicing de texto, inmutabilidad de str y métodos comunes (split, join, strip).',
    complexityTier: 1,
    prerequisites: ['py.basics.numeric_types'],
    keywords: ['str', 'string', 'cadena', 'texto', 'join', 'split', 'strip', 'unicode'],
    targetExercises: 2,
  },
  {
    id: 'py.basics.fstrings_formatting',
    domainId: 'basics_types',
    title: 'Formateo moderno con f-strings',
    description: 'Interpolación de expresiones, especificadores de formato, alineación y depuración con =.',
    complexityTier: 1,
    prerequisites: ['py.basics.strings_indexing'],
    keywords: ['f-string', 'fstring', 'format', 'formateo', 'interpolacion', 'repr'],
    targetExercises: 2,
  },
  {
    id: 'py.basics.type_conversion',
    domainId: 'basics_types',
    title: 'Tipado dinámico fuerte y conversiones',
    description: 'Diferencia entre tipado dinámico y fuerte, casting explícito (int, float, str, list) y TypeError.',
    complexityTier: 1,
    prerequisites: ['py.basics.numeric_types', 'py.basics.strings_indexing'],
    keywords: ['conversion', 'casting', 'type', 'isinstance', 'typeerror', 'dinamico'],
    targetExercises: 2,
  },
  {
    id: 'py.basics.none_and_truthiness',
    domainId: 'basics_types',
    title: 'None y evaluación de verdad (Truthiness)',
    description: 'Singleton None, comparación con `is None` y valores falsy ([], "", 0, {}, None).',
    complexityTier: 2,
    prerequisites: ['py.basics.numeric_types'],
    keywords: ['none', 'nonetype', 'truthy', 'falsy', 'truthiness', 'is none'],
    targetExercises: 3,
  },

  // 2. Modelo de Memoria y Referencias (6)
  {
    id: 'py.memory.names_and_objects',
    domainId: 'memory_model',
    title: 'Nombres, objetos en el heap e id()',
    description: 'Variables como etiquetas que enlazan objetos con identidad, tipo y valor en el heap.',
    complexityTier: 2,
    prerequisites: ['py.basics.numeric_types'],
    keywords: ['variable', 'object', 'objeto', 'heap', 'referencia', 'reference', 'id()', 'memoria', 'memory', 'binding', 'reasignacion'],
    targetExercises: 4,
  },
  {
    id: 'py.memory.mutability',
    domainId: 'memory_model',
    title: 'Mutabilidad vs inmutabilidad',
    description: 'Objetos mutables (list, dict, set) frente a inmutables (int, str, tuple) y efectos in-place.',
    complexityTier: 3,
    prerequisites: ['py.memory.names_and_objects'],
    keywords: ['mutable', 'inmutable', 'immutable', 'mutability', 'mutabilidad', 'mutation', 'mutacion', 'in-place'],
    targetExercises: 5,
  },
  {
    id: 'py.memory.aliasing',
    domainId: 'memory_model',
    title: 'Aliasing y efectos colaterales compartidos',
    description: 'Dos nombres apuntando al mismo objeto mutable: mutar por un alias altera al otro.',
    complexityTier: 3,
    prerequisites: ['py.memory.mutability'],
    keywords: ['aliasing', 'alias', 'efecto colateral', 'side effect', 'referencia compartida'],
    targetExercises: 5,
  },
  {
    id: 'py.memory.equality_vs_identity',
    domainId: 'memory_model',
    title: 'Igualdad (==) vs Identidad (is)',
    description: 'Diferencia entre equivalencia de valor (__eq__) e identidad en memoria (id), más interning.',
    complexityTier: 3,
    prerequisites: ['py.memory.names_and_objects'],
    keywords: ['equality', 'identity', 'igualdad', 'identidad', '==', 'is', 'interning'],
    targetExercises: 4,
  },
  {
    id: 'py.memory.shallow_deep_copy',
    domainId: 'memory_model',
    title: 'Copia superficial vs copia profunda',
    description: 'Slicing [:], .copy(), copy.copy() frente a copy.deepcopy() en estructuras anidadas.',
    complexityTier: 3,
    prerequisites: ['py.memory.aliasing'],
    keywords: ['shallow copy', 'deep copy', 'deepcopy', 'copia superficial', 'copia profunda', 'copy'],
    targetExercises: 5,
  },
  {
    id: 'py.memory.call_stack_frames',
    domainId: 'memory_model',
    title: 'Call Stack, Frames y ciclo de vida',
    description: 'Creación y destrucción de frames por llamada, parámetros por referencia a objeto y conteo de referencias.',
    complexityTier: 3,
    prerequisites: ['py.memory.names_and_objects'],
    keywords: ['frame', 'stack', 'call stack', 'pila', 'namespace', 'garbage', 'refcount'],
    targetExercises: 4,
  },

  // 3. Control de Flujo e Iteración (6)
  {
    id: 'py.flow.conditionals',
    domainId: 'control_flow',
    title: 'Condicionales (if/elif/else) y expresiones ternarias',
    description: 'Ramas excluyentes, guard clauses para reducir anidamiento y expresiones condicionales.',
    complexityTier: 1,
    prerequisites: ['py.basics.none_and_truthiness'],
    keywords: ['if', 'elif', 'else', 'condicional', 'conditional', 'ternario', 'guard clause'],
    targetExercises: 2,
  },
  {
    id: 'py.flow.boolean_short_circuit',
    domainId: 'control_flow',
    title: 'Lógica booleana y cortocircuito (and/or/not)',
    description: 'Evaluación perezosa de and/or, valores devueltos reales (no siempre bool) y leyes de De Morgan.',
    complexityTier: 2,
    prerequisites: ['py.flow.conditionals'],
    keywords: ['and', 'or', 'not', 'cortocircuito', 'short-circuit', 'booleano', 'de morgan'],
    targetExercises: 3,
  },
  {
    id: 'py.flow.for_loops_iterables',
    domainId: 'control_flow',
    title: 'Bucles for, range, enumerate y zip',
    description: 'Iteración idiomática sobre secuencias, índices con enumerate y recorrido paralelo con zip.',
    complexityTier: 2,
    prerequisites: ['py.flow.conditionals'],
    keywords: ['for', 'bucle', 'loop', 'range', 'enumerate', 'zip', 'iterable'],
    targetExercises: 3,
  },
  {
    id: 'py.flow.while_and_loop_control',
    domainId: 'control_flow',
    title: 'Bucles while, break, continue y for/else',
    description: 'Condiciones de parada, prevención de bucles infinitos y semántica de la cláusula else en bucles.',
    complexityTier: 2,
    prerequisites: ['py.flow.for_loops_iterables'],
    keywords: ['while', 'break', 'continue', 'for-else', 'invariante', 'centinela'],
    targetExercises: 3,
  },
  {
    id: 'py.flow.mutation_during_iteration',
    domainId: 'control_flow',
    title: 'Mutación segura durante iteración',
    description: 'Por qué eliminar elementos de una lista mientras se recorre salta índices y cómo evitarlo.',
    complexityTier: 3,
    prerequisites: ['py.flow.for_loops_iterables', 'py.memory.mutability'],
    keywords: ['mutacion durante iteracion', 'remove', 'iterar', 'loop mutation', 'shallow_loop_mutation'],
    targetExercises: 5,
  },
  {
    id: 'py.flow.pattern_matching',
    domainId: 'control_flow',
    title: 'Pattern matching estructural (match/case)',
    description: 'Desempaquetado estructural por forma, secuencias, mapeos y guardas en Python 3.10+.',
    complexityTier: 2,
    prerequisites: ['py.flow.conditionals'],
    keywords: ['match', 'case', 'pattern matching', 'estructural'],
    targetExercises: 3,
  },

  // 4. Funciones, Ámbito LEGB y Closures (6)
  {
    id: 'py.func.definition_return_vs_print',
    domainId: 'functions_scope',
    title: 'Definición de funciones: return vs print',
    description: 'Diferencia crítica entre efecto secundario en stdout (print) y valor devuelto (return / None implícito).',
    complexityTier: 2,
    prerequisites: ['py.memory.call_stack_frames'],
    keywords: ['def', 'function', 'funcion', 'return', 'print', 'print_vs_return', 'fdr', 'design recipe'],
    targetExercises: 4,
  },
  {
    id: 'py.func.parameters_args_kwargs',
    domainId: 'functions_scope',
    title: 'Parámetros posicionales, keyword, *args y **kwargs',
    description: 'Orden de parámetros, valores por defecto, argumentos solo-keyword (*) y desempaquetado en llamadas.',
    complexityTier: 2,
    prerequisites: ['py.func.definition_return_vs_print'],
    keywords: ['parametro', 'argumento', 'args', 'kwargs', 'keyword', 'posicional'],
    targetExercises: 3,
  },
  {
    id: 'py.func.mutable_default_args',
    domainId: 'functions_scope',
    title: 'Trampa de argumentos mutables por defecto',
    description: 'Los valores por defecto se evalúan una sola vez al definir la función; patrón `param=None`.',
    complexityTier: 3,
    prerequisites: ['py.func.parameters_args_kwargs', 'py.memory.mutability'],
    keywords: ['default', 'mutable default', 'argumento mutable', 'def f(x=[])', 'mutable_default_arg'],
    targetExercises: 5,
  },
  {
    id: 'py.func.legb_scope',
    domainId: 'functions_scope',
    title: 'Resolución de nombres LEGB y UnboundLocalError',
    description: 'Local, Enclosing, Global, Built-in; shadowing accidental y uso disciplinado de global/nonlocal.',
    complexityTier: 3,
    prerequisites: ['py.memory.call_stack_frames', 'py.func.definition_return_vs_print'],
    keywords: ['scope', 'ambito', 'legb', 'global', 'nonlocal', 'unboundlocalerror', 'shadowing', 'namespace'],
    targetExercises: 5,
  },
  {
    id: 'py.func.closures_decorators',
    domainId: 'functions_scope',
    title: 'Funciones de orden superior, closures y decoradores',
    description: 'Funciones como ciudadanos de primera clase, captura léxica, late binding y @wraps.',
    complexityTier: 3,
    prerequisites: ['py.func.legb_scope'],
    keywords: ['closure', 'decorador', 'decorator', 'higher-order', 'lambda', 'wraps', 'callable'],
    targetExercises: 5,
  },
  {
    id: 'py.func.recursion',
    domainId: 'functions_scope',
    title: 'Recursión, caso base y pila de llamadas',
    description: 'Diseño de caso base, paso inductivo, propagación de return y límites de recursión.',
    complexityTier: 3,
    prerequisites: ['py.memory.call_stack_frames', 'py.func.definition_return_vs_print'],
    keywords: ['recursion', 'recursivo', 'recursive', 'caso base', 'base case', 'recursionerror'],
    targetExercises: 5,
  },

  // 5. Estructuras de Datos y Complejidad (6)
  {
    id: 'py.ds.lists_slicing',
    domainId: 'data_structures',
    title: 'Listas, mutación y slicing avanzado',
    description: 'append vs extend, sort vs sorted, slices con paso negativo y creación de copias parciales.',
    complexityTier: 2,
    prerequisites: ['py.memory.mutability'],
    keywords: ['list', 'lista', 'slicing', 'slice', 'append', 'extend', 'sorted', 'sort'],
    targetExercises: 3,
  },
  {
    id: 'py.ds.tuples_unpacking',
    domainId: 'data_structures',
    title: 'Tuplas, inmutabilidad y unpacking (*)',
    description: 'Tuplas como registros inmutables, tupla de un elemento `(x,)`, swap y star-unpacking.',
    complexityTier: 2,
    prerequisites: ['py.ds.lists_slicing'],
    keywords: ['tuple', 'tupla', 'unpacking', 'desempaquetado', 'namedtuple'],
    targetExercises: 3,
  },
  {
    id: 'py.ds.dicts_hashing',
    domainId: 'data_structures',
    title: 'Diccionarios (dict), claves hashables y vistas',
    description: 'Búsqueda O(1), .get(), .setdefault(), .items(), requisitos de hashabilidad y orden de inserción.',
    complexityTier: 2,
    prerequisites: ['py.memory.mutability'],
    keywords: ['dict', 'diccionario', 'dictionary', 'hash', 'hashable', 'keyerror', 'items', 'get'],
    targetExercises: 4,
  },
  {
    id: 'py.ds.sets_algebra',
    domainId: 'data_structures',
    title: 'Conjuntos (set/frozenset) y operaciones de álgebra',
    description: 'Pertenencia O(1), deduplicación, unión, intersección, diferencia y diferencia simétrica.',
    complexityTier: 2,
    prerequisites: ['py.ds.dicts_hashing'],
    keywords: ['set', 'conjunto', 'frozenset', 'interseccion', 'union', 'deduplicar'],
    targetExercises: 3,
  },
  {
    id: 'py.ds.collections_module',
    domainId: 'data_structures',
    title: 'Módulo collections (Counter, defaultdict, deque)',
    description: 'Estructuras especializadas para conteo, agrupación y colas O(1) en ambos extremos.',
    complexityTier: 2,
    prerequisites: ['py.ds.dicts_hashing'],
    keywords: ['collections', 'counter', 'defaultdict', 'deque', 'ordereddict'],
    targetExercises: 3,
  },
  {
    id: 'py.ds.complexity_big_o',
    domainId: 'data_structures',
    title: 'Complejidad algorítmica (Big-O) en estructuras Python',
    description: 'Costos reales de `in`, inserción al inicio vs final, concatenación de strings y ordenamiento Timsort.',
    complexityTier: 3,
    prerequisites: ['py.ds.lists_slicing', 'py.ds.dicts_hashing', 'py.ds.sets_algebra'],
    keywords: ['big-o', 'big o', 'complejidad', 'complexity', 'algoritmo', 'algorithm', 'timsort', 'o(1)', 'o(n)'],
    targetExercises: 4,
  },

  // 6. OOP y Modelo de Datos (6)
  {
    id: 'py.oop.classes_instances',
    domainId: 'oop_protocols',
    title: 'Clases, instancias, __init__ y self',
    description: 'Atributos de instancia vs atributos de clase, enlace de métodos y encapsulación por convención.',
    complexityTier: 2,
    prerequisites: ['py.func.definition_return_vs_print', 'py.memory.names_and_objects'],
    keywords: ['class', 'clase', 'instancia', 'instance', '__init__', 'self', 'atributo', 'metodo', 'oop'],
    targetExercises: 4,
  },
  {
    id: 'py.oop.dunder_data_model',
    domainId: 'oop_protocols',
    title: 'Modelo de datos Python (Dunder methods)',
    description: '__repr__ vs __str__, __eq__, __hash__, __len__, __getitem__ y sobrecarga de operadores.',
    complexityTier: 3,
    prerequisites: ['py.oop.classes_instances'],
    keywords: ['dunder', '__repr__', '__str__', '__eq__', '__len__', 'data model', 'modelo de datos', 'protocolo'],
    targetExercises: 5,
  },
  {
    id: 'py.oop.inheritance_mro',
    domainId: 'oop_protocols',
    title: 'Herencia, super() y MRO (C3)',
    description: 'Jerarquías de clases, resolución de métodos MRO, sobrescritura y cuándo evitar herencia profunda.',
    complexityTier: 3,
    prerequisites: ['py.oop.classes_instances'],
    keywords: ['inheritance', 'herencia', 'super', 'mro', 'subclase', 'polimorfismo', 'polymorphism'],
    targetExercises: 4,
  },
  {
    id: 'py.oop.composition_duck_typing',
    domainId: 'oop_protocols',
    title: 'Composición, Duck Typing y Protocolos (ABC)',
    description: 'Preferir composición sobre herencia, duck typing y verificación con typing.Protocol / abc.',
    complexityTier: 3,
    prerequisites: ['py.oop.inheritance_mro'],
    keywords: ['composicion', 'composition', 'duck typing', 'abc', 'protocol', 'interfaz'],
    targetExercises: 4,
  },
  {
    id: 'py.oop.properties_descriptors',
    domainId: 'oop_protocols',
    title: 'Properties (@property), classmethod y staticmethod',
    description: 'Acceso controlado a atributos con validación y constructores alternativos con @classmethod.',
    complexityTier: 2,
    prerequisites: ['py.oop.classes_instances'],
    keywords: ['property', '@property', 'classmethod', 'staticmethod', 'descriptor', 'getter', 'setter'],
    targetExercises: 3,
  },
  {
    id: 'py.oop.dataclasses',
    domainId: 'oop_protocols',
    title: 'Dataclasses y objetos de valor inmutables',
    description: '@dataclass, field(default_factory=...), frozen=True y slots para modelar datos limpios.',
    complexityTier: 2,
    prerequisites: ['py.oop.classes_instances', 'py.func.mutable_default_args'],
    keywords: ['dataclass', 'dataclasses', 'default_factory', 'frozen', 'slots'],
    targetExercises: 3,
  },

  // 7. Excepciones, Archivos y Módulos (6)
  {
    id: 'py.io.exceptions_try_except',
    domainId: 'errors_files_modules',
    title: 'Manejo de excepciones (try/except/else/finally)',
    description: 'Captura específica (nunca bare except), EAFP vs LBYL, propagación y cláusulas else/finally.',
    complexityTier: 2,
    prerequisites: ['py.flow.conditionals'],
    keywords: ['exception', 'excepcion', 'try', 'except', 'finally', 'raise', 'traceback', 'eafp', 'lbyl'],
    targetExercises: 4,
  },
  {
    id: 'py.io.custom_exceptions',
    domainId: 'errors_files_modules',
    title: 'Excepciones personalizadas y encadenamiento (raise from)',
    description: 'Jerarquías de error de dominio y preservación de causa raíz con `raise ... from err`.',
    complexityTier: 2,
    prerequisites: ['py.io.exceptions_try_except', 'py.oop.inheritance_mro'],
    keywords: ['custom exception', 'raise from', 'valueerror', 'keyerror', 'jerarquia de errores'],
    targetExercises: 3,
  },
  {
    id: 'py.io.context_managers',
    domainId: 'errors_files_modules',
    title: 'Context Managers (with, __enter__/__exit__)',
    description: 'Liberación determinista de recursos con `with` y creación con contextlib.contextmanager.',
    complexityTier: 3,
    prerequisites: ['py.io.exceptions_try_except'],
    keywords: ['with', 'context manager', '__enter__', '__exit__', 'contextlib', 'recurso'],
    targetExercises: 4,
  },
  {
    id: 'py.io.files_pathlib',
    domainId: 'errors_files_modules',
    title: 'Lectura/escritura de archivos, cursor y pathlib',
    description: 'Modos r/w/a, codificación UTF-8, iteración línea a línea y rutas portables con pathlib.Path.',
    complexityTier: 2,
    prerequisites: ['py.io.context_managers'],
    keywords: ['file', 'archivo', 'open', 'pathlib', 'cursor', 'readline', 'utf-8', 'fichero'],
    targetExercises: 3,
  },
  {
    id: 'py.io.csv_json_serialization',
    domainId: 'errors_files_modules',
    title: 'Serialización estructurada (CSV, JSON)',
    description: 'Lectura y escritura segura con csv.DictReader y json.loads/dumps manejando tipos y errores.',
    complexityTier: 2,
    prerequisites: ['py.io.files_pathlib', 'py.ds.dicts_hashing'],
    keywords: ['csv', 'json', 'serializacion', 'dictreader', 'loads', 'dumps'],
    targetExercises: 3,
  },
  {
    id: 'py.io.modules_packages',
    domainId: 'errors_files_modules',
    title: 'Módulos, paquetes, imports y __name__ == "__main__"',
    description: 'Resolución de sys.path, imports absolutos vs relativos, ciclos de importación y punto de entrada.',
    complexityTier: 2,
    prerequisites: ['py.func.legb_scope'],
    keywords: ['module', 'modulo', 'import', 'package', 'paquete', '__main__', '__name__'],
    targetExercises: 3,
  },

  // 8. Python Idiomático, Generadores y AST (6)
  {
    id: 'py.idiom.comprehensions',
    domainId: 'idiomatic_functional',
    title: 'List, Dict y Set Comprehensions',
    description: 'Transformación y filtrado declarativo, evitar efectos secundarios y cuándo preferir un bucle.',
    complexityTier: 2,
    prerequisites: ['py.flow.for_loops_iterables', 'py.ds.lists_slicing'],
    keywords: ['comprehension', 'listcomp', 'dictcomp', 'setcomp', 'comprension', 'idiomatico'],
    targetExercises: 4,
  },
  {
    id: 'py.idiom.iterators_generators',
    domainId: 'idiomatic_functional',
    title: 'Protocolo iterador, yield y generadores perezosos',
    description: 'Evaluación lazy, consumo único de generadores, __iter__/__next__ y eficiencia en memoria.',
    complexityTier: 3,
    prerequisites: ['py.idiom.comprehensions'],
    keywords: ['generator', 'generador', 'yield', 'iterator', 'iterador', 'next', 'lazy', 'perezoso'],
    targetExercises: 5,
  },
  {
    id: 'py.idiom.itertools_functools',
    domainId: 'idiomatic_functional',
    title: 'Herramientas funcionales (itertools, functools, key=)',
    description: 'sorted(..., key=), any/all, partial, lru_cache y combinadores lazy de itertools.',
    complexityTier: 2,
    prerequisites: ['py.idiom.iterators_generators', 'py.func.closures_decorators'],
    keywords: ['itertools', 'functools', 'lru_cache', 'partial', 'any', 'all', 'map', 'filter'],
    targetExercises: 3,
  },
  {
    id: 'py.idiom.type_hints',
    domainId: 'idiomatic_functional',
    title: 'Anotaciones de tipo modernas (Type Hints)',
    description: 'list[int], dict[str, Any], union `X | None`, Callable y validación estática sin costo en runtime.',
    complexityTier: 2,
    prerequisites: ['py.func.parameters_args_kwargs'],
    keywords: ['typing', 'type hint', 'anotacion', 'mypy', 'optional', 'union'],
    targetExercises: 3,
  },
  {
    id: 'py.idiom.ast_introspection',
    domainId: 'idiomatic_functional',
    title: 'Árbol de Sintaxis Abstracta (AST) e introspección',
    description: 'Cómo Python parsea código en nodos AST (Module, FunctionDef, ListComp) y análisis estructural.',
    complexityTier: 3,
    prerequisites: ['py.idiom.comprehensions', 'py.oop.classes_instances'],
    keywords: ['ast', 'syntax tree', 'arbol sintactico', 'bytecode', 'introspeccion', 'parse'],
    targetExercises: 4,
  },
  {
    id: 'py.idiom.concurrency_basics',
    domainId: 'idiomatic_functional',
    title: 'Fundamentos de concurrencia (GIL, async/await)',
    description: 'I/O-bound vs CPU-bound, el GIL, corrutinas async/await y cuándo usar procesos vs tareas.',
    complexityTier: 3,
    prerequisites: ['py.idiom.iterators_generators'],
    keywords: ['async', 'await', 'asyncio', 'gil', 'thread', 'concurrencia', 'concurrency', 'multiprocessing'],
    targetExercises: 4,
  },

  // 9. Testing, Debugging y Ecosistema de Datos (6)
  {
    id: 'py.data.doctest_pytest',
    domainId: 'testing_data_eco',
    title: 'Pruebas unitarias (assert, doctest, pytest)',
    description: 'Diseño de casos de prueba, partición de equivalencias, casos borde y contrato de funciones.',
    complexityTier: 2,
    prerequisites: ['py.func.definition_return_vs_print'],
    keywords: ['test', 'unittest', 'pytest', 'doctest', 'assert', 'prueba', 'caso borde'],
    targetExercises: 3,
  },
  {
    id: 'py.data.debugging_tracebacks',
    domainId: 'testing_data_eco',
    title: 'Lectura sistemática de Tracebacks y Depuración',
    description: 'Leer tracebacks de abajo hacia arriba, aislar hipótesis mínimas y diagnosticar causa raíz.',
    complexityTier: 2,
    prerequisites: ['py.io.exceptions_try_except'],
    keywords: ['debug', 'debugging', 'depuracion', 'traceback', 'bug', 'autopsy', 'autopsia', 'error'],
    targetExercises: 4,
  },
  {
    id: 'py.data.numpy_vectorization',
    domainId: 'testing_data_eco',
    title: 'Arrays NumPy, broadcasting y vectorización',
    description: 'Operaciones vectorizadas sin bucles Python, máscaras booleanas y shapes.',
    complexityTier: 3,
    prerequisites: ['py.ds.lists_slicing'],
    keywords: ['numpy', 'array', 'vectorization', 'vectorizacion', 'broadcasting', 'matriz'],
    targetExercises: 4,
  },
  {
    id: 'py.data.pandas_dataframes',
    domainId: 'testing_data_eco',
    title: 'Pandas Series, DataFrames e indexación (loc/iloc)',
    description: 'Selección por etiqueta/posición, filtrado booleano y prevención de SettingWithCopyWarning.',
    complexityTier: 3,
    prerequisites: ['py.data.numpy_vectorization', 'py.io.csv_json_serialization'],
    keywords: ['pandas', 'dataframe', 'series', 'loc', 'iloc', 'columna', 'tabla'],
    targetExercises: 5,
  },
  {
    id: 'py.data.pandas_groupby_clean',
    domainId: 'testing_data_eco',
    title: 'Limpieza de datos, valores nulos y GroupBy',
    description: 'Manejo de NaN (dropna/fillna), agregaciones groupby, merge/join y pipelines reproducibles.',
    complexityTier: 3,
    prerequisites: ['py.data.pandas_dataframes'],
    keywords: ['groupby', 'merge', 'nan', 'fillna', 'limpieza', 'agregacion', 'transformacion'],
    targetExercises: 4,
  },
  {
    id: 'py.data.visualization_matplotlib',
    domainId: 'testing_data_eco',
    title: 'Visualización reproducible con Matplotlib',
    description: 'Interfaz orientada a objetos (fig, ax), gráficos de barras/líneas/dispersión y etiquetado claro.',
    complexityTier: 2,
    prerequisites: ['py.data.pandas_dataframes'],
    keywords: ['matplotlib', 'plot', 'grafico', 'chart', 'barras', 'visualizacion', 'plt'],
    targetExercises: 3,
  },
];

export const PYTHON_COMPETENCY_BY_ID: Record<string, PythonCompetencyNode> = Object.fromEntries(
  PYTHON_COMPETENCIES.map((c) => [c.id, c])
);

export const PYTHON_DOMAIN_BY_ID: Record<PythonDomainId, PythonDomainSpec> = Object.fromEntries(
  PYTHON_DOMAINS.map((d) => [d.id, d])
) as Record<PythonDomainId, PythonDomainSpec>;

const MISCONCEPTION_TO_COMPETENCY: Record<PythonMisconceptionId, string> = {
  MUTATION_ALIASING: 'py.memory.aliasing',
  MUTABLE_DEFAULT_ARG: 'py.func.mutable_default_args',
  SCOPE_LEGB_SHADOWING: 'py.func.legb_scope',
  PRINT_VS_RETURN: 'py.func.definition_return_vs_print',
  SHALLOW_LOOP_MUTATION: 'py.flow.mutation_during_iteration',
  EQUALITY_VS_IDENTITY: 'py.memory.equality_vs_identity',
  RECURSION_NO_BASE_OR_RETURN: 'py.func.recursion',
};

export function competencyForMisconception(id: PythonMisconceptionId): string {
  return MISCONCEPTION_TO_COMPETENCY[id];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Mapea determinísticamente etiquetas libres, títulos de lección o términos de glosario
 * a los IDs canónicos de competencias de Python (máximo `maxResults`).
 */
export function matchCompetenciesFromText(inputs: string[], maxResults = 3): string[] {
  const explicit = new Set<string>();
  const joined = normalizeText(inputs.filter(Boolean).join(' '));
  if (!joined.trim()) return [];

  for (const raw of inputs) {
    if (PYTHON_COMPETENCY_BY_ID[raw]) {
      explicit.add(raw);
    }
  }
  if (explicit.size >= maxResults) {
    return [...explicit].slice(0, maxResults);
  }

  const scored: Array<{ id: string; score: number }> = [];
  for (const node of PYTHON_COMPETENCIES) {
    if (explicit.has(node.id)) continue;
    let score = 0;
    for (const kw of node.keywords) {
      const normKw = normalizeText(kw);
      if (normKw.length <= 2) {
        const re = new RegExp(`\\b${normKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (re.test(joined)) score += 2;
      } else if (joined.includes(normKw)) {
        score += normKw.includes(' ') ? 4 : 3;
      }
    }
    if (score > 0) {
      scored.push({ id: node.id, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const result = [...explicit];
  for (const item of scored) {
    if (result.length >= maxResults) break;
    result.push(item.id);
  }
  return result;
}

export interface GlobalCompetencyMasteryInput {
  predictionHits: number;
  predictionAttempts: number;
  activeExercisesPassed: number;
  activeExercisesAttempts: number;
  transferPassed: boolean;
  delayedReviewPassed: boolean;
  fsrsMaxStability: number;
  misconceptionHits: Record<string, number>;
  misconceptionResolved: string[];
  lastPracticedAt?: number;
}

/**
 * Calcula un puntaje de dominio demostrado (0..100) estrictamente basado en evidencia:
 * - Predicción 1.er intento (Máquina Nocional): 0..30 pts
 * - Práctica activa y transferencia (Parsons/Cloze/Autopsy/Lab): 0..35 pts
 * - Retención espaciada (estabilidad FSRS / repaso diferido): 0..25 pts
 * - Resolución de misconceptions (0..10 pts; penaliza misconceptions aún abiertas)
 * - Decaimiento suave si pasaron > 30 días sin practicar y estabilidad FSRS < 14 días.
 */
export function computeCompetencyMasteryScore(
  input: GlobalCompetencyMasteryInput | undefined,
  now = Date.now()
): { score: number; status: 'UNSEEN' | 'PRACTICING' | 'NEEDS_REVIEW' | 'MASTERED' } {
  if (!input) return { score: 0, status: 'UNSEEN' };

  const totalSignals =
    input.predictionAttempts +
    input.activeExercisesAttempts +
    (input.transferPassed ? 1 : 0) +
    (input.delayedReviewPassed ? 1 : 0);

  if (totalSignals === 0 && Object.keys(input.misconceptionHits).length === 0) {
    return { score: 0, status: 'UNSEEN' };
  }

  // 1. Predicción (0..30)
  const predRate =
    input.predictionAttempts > 0
      ? input.predictionHits / input.predictionAttempts
      : input.activeExercisesPassed > 0
        ? 0.5
        : 0;
  const predWeight = Math.min(1, input.predictionAttempts / 2);
  const predScore = predRate * 30 * Math.max(0.5, predWeight);

  // 2. Práctica activa + Transferencia (0..35)
  const exRate =
    input.activeExercisesAttempts > 0
      ? input.activeExercisesPassed / input.activeExercisesAttempts
      : 0;
  const volumeBonus = Math.min(1, input.activeExercisesPassed / 3);
  const practiceScore = exRate * 20 * volumeBonus + (input.transferPassed ? 15 : 0);

  // 3. Retención FSRS (0..25)
  const stabilityRatio = Math.min(1, (input.fsrsMaxStability ?? 0) / 14);
  const retentionScore = (input.delayedReviewPassed ? 15 : 0) + stabilityRatio * 10;

  // 4. Diagnóstico de misconceptions (0..10)
  const triggeredIds = Object.keys(input.misconceptionHits).filter(
    (k) => (input.misconceptionHits[k] ?? 0) > 0
  );
  const unresolvedCount = triggeredIds.filter(
    (id) => !input.misconceptionResolved.includes(id)
  ).length;
  const misconceptionScore =
    triggeredIds.length === 0
      ? input.activeExercisesPassed > 0 || input.predictionHits > 0
        ? 6
        : 0
      : unresolvedCount === 0
        ? 10
        : Math.max(0, 4 - unresolvedCount * 3);

  let rawScore = predScore + practiceScore + retentionScore + misconceptionScore;

  // Decaimiento por inactividad prolongada si aún no tiene estabilidad consolidada
  if (input.lastPracticedAt) {
    const daysIdle = Math.max(0, (now - input.lastPracticedAt) / (24 * 60 * 60 * 1000));
    if (daysIdle > 21 && (input.fsrsMaxStability ?? 0) < 14) {
      const decayFactor = Math.max(0.65, 1 - (daysIdle - 21) * 0.01);
      rawScore *= decayFactor;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let status: 'UNSEEN' | 'PRACTICING' | 'NEEDS_REVIEW' | 'MASTERED';
  if (unresolvedCount > 0) {
    status = 'NEEDS_REVIEW';
  } else if (score >= 78 && (input.transferPassed || input.delayedReviewPassed || input.fsrsMaxStability >= 6)) {
    status = 'MASTERED';
  } else if (score < 45 && totalSignals >= 2) {
    status = 'NEEDS_REVIEW';
  } else {
    status = 'PRACTICING';
  }

  return { score, status };
}

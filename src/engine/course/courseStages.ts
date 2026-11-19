import type { BlockType, LessonBlock, MicroLesson } from '../../types/cartridge.types';

export type CourseStageId =
  | 'FOUNDATION'
  | 'MENTAL_MODEL'
  | 'QUICK_CHECK'
  | 'PRACTICE'
  | 'EVALUATION';

export interface CourseStageMeta {
  id: CourseStageId;
  order: number;
  label: string;
  shortLabel: string;
  description: string;
}

export interface CourseStageGroup {
  stage: CourseStageMeta;
  blockIndices: number[];
  blocks: LessonBlock[];
}

export const COURSE_STAGES: Record<CourseStageId, CourseStageMeta> = {
  FOUNDATION: {
    id: 'FOUNDATION',
    order: 1,
    label: '1. Fundamento',
    shortLabel: 'Fundamento',
    description: 'Conceptos clave y lectura guiada del modulo.',
  },
  MENTAL_MODEL: {
    id: 'MENTAL_MODEL',
    order: 2,
    label: '2. Modelo Mental',
    shortLabel: 'Modelo',
    description: 'Visualizacion de memoria, AST y flujo de ejecucion.',
  },
  QUICK_CHECK: {
    id: 'QUICK_CHECK',
    order: 3,
    label: '3. Comprobacion',
    shortLabel: 'Comprobar',
    description: 'Retos rapidos de sintaxis y prediccion de salida.',
  },
  PRACTICE: {
    id: 'PRACTICE',
    order: 4,
    label: '4. Practica',
    shortLabel: 'Practica',
    description: 'Laboratorios de codigo, Parsons y autopsia de bugs.',
  },
  EVALUATION: {
    id: 'EVALUATION',
    order: 5,
    label: '5. Evaluacion',
    shortLabel: 'Evaluar',
    description: 'Test de dominio y sintesis del aprendizaje.',
  },
};

export function classifyBlockStage(blockType: BlockType): CourseStageId {
  switch (blockType) {
    case 'PROSE':
    case 'YOUTUBE_REF':
      return 'FOUNDATION';
    case 'INTERACTIVE_VISUALIZER':
    case 'GPU_ANIMATION':
      return 'MENTAL_MODEL';
    case 'OUTPUT_PREDICTION':
    case 'SYNTAX_CLOZE':
    case 'FLASHCARD':
      return 'QUICK_CHECK';
    case 'CODE_LAB':
    case 'AST_CHALLENGE':
    case 'PARSONS_PROBLEM':
    case 'BUG_AUTOPSY':
      return 'PRACTICE';
    case 'QUICK_QUIZ':
      return 'EVALUATION';
    default:
      return 'FOUNDATION';
  }
}

export function isPcOnlyBlock(block: LessonBlock | undefined | null): boolean {
  if (!block) return false;
  return block.type === 'CODE_LAB' || block.type === 'AST_CHALLENGE';
}

export function getBlockDisplayTitle(block: LessonBlock): string {
  switch (block.type) {
    case 'PROSE':
      return block.callout?.title || 'Lectura conceptual';
    case 'GPU_ANIMATION':
    case 'INTERACTIVE_VISUALIZER':
    case 'CODE_LAB':
    case 'AST_CHALLENGE':
    case 'BUG_AUTOPSY':
    case 'SYNTAX_CLOZE':
    case 'QUICK_QUIZ':
    case 'YOUTUBE_REF':
      return block.title;
    case 'PARSONS_PROBLEM':
      return 'Ordena la logica (Parsons)';
    case 'OUTPUT_PREDICTION':
      return 'Predice la salida';
    case 'FLASHCARD':
      return 'Repaso activo (SM-2)';
    default:
      return 'Bloque';
  }
}

/**
 * Agrupa los bloques de una micro-leccion en las 5 etapas pedagogicas del curso,
 * preservando el indice real de cada bloque para el desbloqueo progresivo.
 */
export function groupBlocksIntoStages(lesson: MicroLesson): CourseStageGroup[] {
  const buckets = new Map<CourseStageId, { indices: number[]; blocks: LessonBlock[] }>();

  lesson.blocks.forEach((block, index) => {
    const stageId = classifyBlockStage(block.type);
    const existing = buckets.get(stageId) ?? { indices: [], blocks: [] };
    existing.indices.push(index);
    existing.blocks.push(block);
    buckets.set(stageId, existing);
  });

  const orderedIds: CourseStageId[] = [
    'FOUNDATION',
    'MENTAL_MODEL',
    'QUICK_CHECK',
    'PRACTICE',
    'EVALUATION',
  ];

  const groups: CourseStageGroup[] = [];
  for (const id of orderedIds) {
    const bucket = buckets.get(id);
    if (!bucket || bucket.blocks.length === 0) continue;
    groups.push({
      stage: COURSE_STAGES[id],
      blockIndices: bucket.indices,
      blocks: bucket.blocks,
    });
  }
  return groups;
}

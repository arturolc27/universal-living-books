import { z } from 'zod';
import type { BookCartridge } from './cartridge.types';

export const ThemeDNASchema = z.object({
  themeName: z.string().min(1),
  mode: z.enum(['dark', 'light']),
  colors: z.object({
    bgCanvas: z.string().min(4),
    bgSurface: z.string().min(4),
    bgElevated: z.string().min(4),
    borderSubtle: z.string().min(4),
    textPrimary: z.string().min(4),
    textMuted: z.string().min(4),
    accentPrimary: z.string().min(4),
    accentSecondary: z.string().min(4),
    accentSuccess: z.string().min(4),
    accentDanger: z.string().min(4),
  }),
  typography: z.object({
    editorialFont: z.enum(['serif', 'sans']),
    codeFont: z.string().min(1),
  }),
});

export const RuntimeRequirementsSchema = z.object({
  pythonVersion: z.string().min(1),
  packages: z.array(z.string()),
  enableLiveMemoryTracer: z.boolean(),
  virtualFileSystemSeed: z.record(z.string(), z.string()),
});

export const DeepDiveSectionSchema = z.object({
  internalMechanics: z.string().min(1),
  edgeCases: z.array(z.string()),
  commonPitfalls: z.array(z.string()),
  realWorldContrast: z.string().min(1),
  codeExample: z.string().optional(),
});

export const GlossaryEntrySchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  chapterIntroduced: z.number().int().nonnegative(),
  pageRef: z.number().int().positive().optional(),
  snippet: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  competencyIds: z.array(z.string()).optional(),
  lessonId: z.string().optional(),
  deepDive: DeepDiveSectionSchema.optional(),
});

export const AchievementSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  iconKey: z.string().min(1),
  rule: z.object({
    metric: z.enum(['LESSON_COMPLETE', 'FIRST_TRY_STREAK', 'AST_MASTERY', 'SRS_REVIEWS']),
    threshold: z.number().int().positive(),
    targetId: z.string().optional(),
  }),
});

const PythonMisconceptionSchema = z.enum([
  'MUTATION_ALIASING',
  'MUTABLE_DEFAULT_ARG',
  'SCOPE_LEGB_SHADOWING',
  'PRINT_VS_RETURN',
  'SHALLOW_LOOP_MUTATION',
  'EQUALITY_VS_IDENTITY',
  'RECURSION_NO_BASE_OR_RETURN',
]);

const SubgoalLabelSchema = z.object({
  label: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  description: z.string().optional(),
});

const BaseBlockFields = {
  blockId: z.string().min(1),
  gatesNextBlock: z.boolean().optional(),
  conceptTags: z.array(z.string()).optional(),
  competencyIds: z.array(z.string()).optional(),
  misconceptionId: PythonMisconceptionSchema.optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
};

export const ProseBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('PROSE'),
  markdown: z.string().min(1),
  subgoals: z.array(SubgoalLabelSchema).optional(),
  callout: z
    .object({
      kind: z.enum(['TIP', 'WARNING', 'BOOK_NOTE', 'ERROR_TRAP']),
      title: z.string().min(1),
      body: z.string().min(1),
    })
    .optional(),
});

export const GpuAnimationBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('GPU_ANIMATION'),
  title: z.string().min(1),
  caption: z.string(),
  format: z.enum(['WEBM_ALPHA', 'LOTTIE_JSON', 'ANIMATED_SVG']),
  assetUrl: z.string().min(1),
  aspectRatio: z.enum(['16:9', '4:3', '21:9']),
  loop: z.boolean(),
});

export const MemoryStepSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  lineNumber: z.number().int().nonnegative(),
  explanation: z.string(),
  frames: z.array(
    z.object({
      name: z.string().min(1),
      isCurrent: z.boolean(),
      variables: z.record(z.string(), z.string()),
      returnValue: z.string().optional(),
    })
  ),
  heap: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      value: z.string(),
      status: z.enum(['NEW', 'ACTIVE', 'MUTATED', 'ORPHANED']),
    })
  ),
  interactiveDragTask: z
    .object({
      fromFrame: z.string().min(1),
      variable: z.string().min(1),
      expectedHeapId: z.string().min(1),
      hint: z.string(),
    })
    .optional(),
});

export const InteractiveVisualizerBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('INTERACTIVE_VISUALIZER'),
  visualizerKind: z.enum([
    'MEMORY_MODEL',
    'AST_COLLAPSER',
    'DATAFRAME_DIFF',
    'OOP_CLASS_GRAPH',
    'FILE_CURSOR_TAPE',
  ]),
  title: z.string().min(1),
  codeContext: z.string(),
  payload: z.object({
    memorySteps: z.array(MemoryStepSchema).optional(),
    astTokens: z
      .object({
        tokens: z.array(z.string()),
        tapOrder: z.array(z.number().int().nonnegative()),
        collapses: z.array(z.string()),
        explanations: z.array(z.string()).optional(),
      })
      .optional(),
    dataframeSnapshot: z
      .object({
        before: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
        after: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
        operation: z.string(),
        highlightColumns: z.array(z.string()).optional(),
      })
      .optional(),
    oopGraph: z
      .object({
        classes: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            attributes: z.array(z.string()),
            methods: z.array(z.string()),
            dunderMethods: z.array(z.string()).optional(),
            isInstance: z.boolean().optional(),
            instanceOf: z.string().optional(),
          })
        ),
        relationships: z.array(
          z.object({
            from: z.string().min(1),
            to: z.string().min(1),
            kind: z.enum(['INHERITS', 'INSTANTIATES', 'COMPOSES']),
            label: z.string().optional(),
          })
        ),
      })
      .optional(),
    fileTape: z
      .object({
        filename: z.string().min(1),
        content: z.string(),
        operations: z.array(z.string()),
      })
      .optional(),
  }),
});

export const CodeLabBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('CODE_LAB'),
  title: z.string().min(1),
  instructions: z.string().min(1),
  scaffoldMode: z.enum(['FREE_SANDBOX', 'FDR_5_STEPS', 'MULTI_FILE_PROJECT']),
  labPhase: z.enum(['MODIFY', 'FADED', 'MAKE']).optional(),
  starterCode: z.string(),
  referenceSolution: z.string().optional(),
  targetFileName: z.string().optional(),
  unitTestCode: z.string(),
  hiddenTestCode: z.string().optional(),
  progressiveHints: z.array(z.string()).optional(),
  fdrGuide: z
    .object({
      examples: z.string(),
      header: z.string(),
      description: z.string(),
      body: z.string(),
      test: z.string(),
    })
    .optional(),
  linkedFlashcardId: z.string().optional(),
});

export const AstChallengeBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('AST_CHALLENGE'),
  title: z.string().min(1),
  instructions: z.string().min(1),
  starterCode: z.string(),
  referenceSolution: z.string().optional(),
  astConstraints: z.object({
    requiredNodeTypes: z.array(z.string()),
    forbiddenNodeTypes: z.array(z.string()).optional(),
    forbiddenCalls: z.array(z.string()).optional(),
    customAstMessage: z.string().min(1),
  }),
  unitTestCode: z.string(),
  hiddenTestCode: z.string().optional(),
  progressiveHints: z.array(z.string()).optional(),
  linkedFlashcardId: z.string().optional(),
});

export const ParsonsProblemBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('PARSONS_PROBLEM'),
  prompt: z.string().min(1),
  blocks: z.array(
    z.object({
      id: z.string().min(1),
      code: z.string().min(1),
      correctOrder: z.number().int().min(-1),
      correctIndent: z.number().int().nonnegative(),
      isDistractor: z.boolean(),
      subgoalLabel: z.string().optional(),
    })
  ),
  subgoals: z.array(SubgoalLabelSchema).optional(),
  linkedFlashcardId: z.string().optional(),
});

export const OutputPredictionBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('OUTPUT_PREDICTION'),
  prompt: z.string().min(1),
  codeSnippet: z.string().min(1),
  options: z.array(z.string()).min(2),
  correctOptionIndex: z.number().int().nonnegative(),
  expectedReturnType: z.string().min(1),
  explanation: z.string().min(1),
  linkedFlashcardId: z.string().optional(),
});

export const BugAutopsyBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('BUG_AUTOPSY'),
  title: z.string().min(1),
  prompt: z.string().min(1),
  codeSnippet: z.string().min(1),
  tracebackText: z.string().min(1),
  culpritLineNumber: z.number().int().positive(),
  options: z.array(z.string()).min(2),
  correctOptionIndex: z.number().int().nonnegative(),
  explanation: z.string().min(1),
  linkedFlashcardId: z.string().optional(),
});

export const SyntaxClozeBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('SYNTAX_CLOZE'),
  title: z.string().min(1),
  prompt: z.string().min(1),
  codeTemplate: z.string().min(1),
  blanks: z
    .array(
      z.object({
        id: z.string().min(1),
        options: z.array(z.string()).min(2),
        correctOption: z.string().min(1),
        hint: z.string().optional(),
      })
    )
    .min(1),
  explanation: z.string().min(1),
  linkedFlashcardId: z.string().optional(),
});

export const QuickQuizBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('QUICK_QUIZ'),
  title: z.string().min(1),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        options: z.array(z.string()).min(2),
        correctIndex: z.number().int().nonnegative(),
        explanation: z.string().min(1),
      })
    )
    .min(1),
  passingScorePct: z.number().int().min(1).max(100).optional(),
});

export const FlashcardBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('FLASHCARD'),
  cardId: z.string().min(1),
  frontMarkdown: z.string().min(1),
  backMarkdown: z.string().min(1),
  codeExample: z.string().optional(),
  tags: z.array(z.string()),
  conceptTerm: z.string().optional(),
  sourceBlockId: z.string().optional(),
});

export const YouTubeRefBlockSchema = z.object({
  ...BaseBlockFields,
  type: z.literal('YOUTUBE_REF'),
  videoId: z.string().min(1),
  title: z.string().min(1),
  channelName: z.string().min(1),
  timestampStartSec: z.number().int().nonnegative().optional(),
  contextWhyWatch: z.string().min(1),
});

export const LessonBlockSchema = z.discriminatedUnion('type', [
  ProseBlockSchema,
  GpuAnimationBlockSchema,
  InteractiveVisualizerBlockSchema,
  CodeLabBlockSchema,
  AstChallengeBlockSchema,
  ParsonsProblemBlockSchema,
  OutputPredictionBlockSchema,
  BugAutopsyBlockSchema,
  SyntaxClozeBlockSchema,
  QuickQuizBlockSchema,
  FlashcardBlockSchema,
  YouTubeRefBlockSchema,
]);

export const MicroLessonSchema = z.object({
  lessonId: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  estimatedMinutes: z.number().positive(),
  learningObjectives: z.array(z.string()).optional(),
  takeaways: z.array(z.string()).optional(),
  sourceBookMarkdown: z.string().optional(),
  sourcePageRange: z.string().optional(),
  deepDive: DeepDiveSectionSchema.optional(),
  competencyIds: z.array(z.string()).optional(),
  exerciseBank: z.array(LessonBlockSchema).optional(),
  blocks: z.array(LessonBlockSchema).min(1),
});

export const ChapterSchema = z.object({
  chapterId: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  summary: z.string(),
  diagnosticCheck: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        options: z.array(z.string()).min(2),
        correctIndex: z.number().int().nonnegative(),
        explanation: z.string().min(1),
      })
    )
    .optional(),
  microLessons: z.array(MicroLessonSchema).min(1),
});

export const BookCartridgeSchema = z.object({
  schemaVersion: z.literal('2.0'),
  bookId: z.string().min(1),
  metadata: z.object({
    title: z.string().min(1),
    subtitle: z.string(),
    authors: z.array(z.string()).min(1),
    edition: z.string().min(1),
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
    coverAccentIcon: z.string().min(1),
    coverImageDataUrl: z.string().optional(),
  }),
  themeDNA: ThemeDNASchema,
  runtimeRequirements: RuntimeRequirementsSchema,
  glossary: z.record(z.string(), GlossaryEntrySchema),
  achievements: z.array(AchievementSpecSchema),
  chapters: z.array(ChapterSchema).min(1),
});

export interface CartridgeDiagnosticSummary {
  bookId: string;
  title: string;
  authors: string[];
  difficulty: string;
  themeName: string;
  chapterCount: number;
  lessonCount: number;
  totalBlocks: number;
  interactiveBlocks: number;
  flashcardCount: number;
  glossaryTerms: number;
  packages: string[];
}

export function validateBookCartridge(raw: unknown):
  | { success: true; cartridge: BookCartridge; diagnostics: CartridgeDiagnosticSummary }
  | { success: false; issues: string[] } {
  const parsed = BookCartridgeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`
      ),
    };
  }

  const cartridge = parsed.data as BookCartridge;
  let lessonCount = 0;
  let totalBlocks = 0;
  let interactiveBlocks = 0;
  let flashcardCount = 0;

  for (const chapter of cartridge.chapters) {
    lessonCount += chapter.microLessons.length;
    for (const lesson of chapter.microLessons) {
      totalBlocks += lesson.blocks.length;
      for (const block of lesson.blocks) {
        if (block.type !== 'PROSE' && block.type !== 'YOUTUBE_REF') {
          interactiveBlocks += 1;
        }
        if (block.type === 'FLASHCARD') {
          flashcardCount += 1;
        }
      }
    }
  }

  return {
    success: true,
    cartridge,
    diagnostics: {
      bookId: cartridge.bookId,
      title: cartridge.metadata.title,
      authors: cartridge.metadata.authors,
      difficulty: cartridge.metadata.difficulty,
      themeName: cartridge.themeDNA.themeName,
      chapterCount: cartridge.chapters.length,
      lessonCount,
      totalBlocks,
      interactiveBlocks,
      flashcardCount,
      glossaryTerms: Object.keys(cartridge.glossary).length,
      packages: cartridge.runtimeRequirements.packages,
    },
  };
}

export type DeviceMode = 'PC' | 'MOBILE';

export type BlockType =
  | 'PROSE'
  | 'GPU_ANIMATION'
  | 'INTERACTIVE_VISUALIZER'
  | 'CODE_LAB'
  | 'AST_CHALLENGE'
  | 'PARSONS_PROBLEM'
  | 'OUTPUT_PREDICTION'
  | 'BUG_AUTOPSY'
  | 'SYNTAX_CLOZE'
  | 'QUICK_QUIZ'
  | 'FLASHCARD'
  | 'YOUTUBE_REF';

export type VisualizerKind =
  | 'MEMORY_MODEL'
  | 'AST_COLLAPSER'
  | 'DATAFRAME_DIFF'
  | 'OOP_CLASS_GRAPH'
  | 'FILE_CURSOR_TAPE';

export interface ThemeDNA {
  themeName: string;
  mode: 'dark' | 'light';
  colors: {
    bgCanvas: string;
    bgSurface: string;
    bgElevated: string;
    borderSubtle: string;
    textPrimary: string;
    textMuted: string;
    accentPrimary: string;
    accentSecondary: string;
    accentSuccess: string;
    accentDanger: string;
  };
  typography: {
    editorialFont: 'serif' | 'sans';
    codeFont: string;
  };
}

export interface RuntimeRequirements {
  pythonVersion: string;
  packages: string[];
  enableLiveMemoryTracer: boolean;
  virtualFileSystemSeed: Record<string, string>;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  chapterIntroduced: number;
  pageRef?: number;
  snippet?: string;
}

export interface AchievementSpec {
  id: string;
  title: string;
  description: string;
  iconKey: string;
  rule: {
    metric: 'LESSON_COMPLETE' | 'FIRST_TRY_STREAK' | 'AST_MASTERY' | 'SRS_REVIEWS';
    threshold: number;
    targetId?: string;
  };
}

export interface BaseBlock {
  blockId: string;
  type: BlockType;
  gatesNextBlock?: boolean;
}

export interface ProseBlock extends BaseBlock {
  type: 'PROSE';
  markdown: string;
  callout?: {
    kind: 'TIP' | 'WARNING' | 'BOOK_NOTE' | 'ERROR_TRAP';
    title: string;
    body: string;
  };
}

export interface GpuAnimationBlock extends BaseBlock {
  type: 'GPU_ANIMATION';
  title: string;
  caption: string;
  format: 'WEBM_ALPHA' | 'LOTTIE_JSON' | 'ANIMATED_SVG';
  assetUrl: string;
  aspectRatio: '16:9' | '4:3' | '21:9';
  loop: boolean;
}

export interface MemoryStep {
  stepIndex: number;
  lineNumber: number;
  explanation: string;
  frames: Array<{
    name: string;
    isCurrent: boolean;
    variables: Record<string, string>;
    returnValue?: string;
  }>;
  heap: Array<{
    id: string;
    type: string;
    value: string;
    status: 'NEW' | 'ACTIVE' | 'MUTATED' | 'ORPHANED';
  }>;
  interactiveDragTask?: {
    fromFrame: string;
    variable: string;
    expectedHeapId: string;
    hint: string;
  };
}

export interface AstTokensPayload {
  tokens: string[];
  tapOrder: number[];
  collapses: string[];
  explanations?: string[];
}

export interface DataFrameSnapshotPayload {
  before: Array<Record<string, string | number | boolean | null>>;
  after: Array<Record<string, string | number | boolean | null>>;
  operation: string;
  highlightColumns?: string[];
}

export interface OopClassNode {
  id: string;
  name: string;
  attributes: string[];
  methods: string[];
  dunderMethods?: string[];
  isInstance?: boolean;
  instanceOf?: string;
}

export interface OopRelationshipEdge {
  from: string;
  to: string;
  kind: 'INHERITS' | 'INSTANTIATES' | 'COMPOSES';
  label?: string;
}

export interface OopGraphPayload {
  classes: OopClassNode[];
  relationships: OopRelationshipEdge[];
}

export interface FileTapePayload {
  filename: string;
  content: string;
  operations: string[];
}

export interface InteractiveVisualizerBlock extends BaseBlock {
  type: 'INTERACTIVE_VISUALIZER';
  visualizerKind: VisualizerKind;
  title: string;
  codeContext: string;
  payload: {
    memorySteps?: MemoryStep[];
    astTokens?: AstTokensPayload;
    dataframeSnapshot?: DataFrameSnapshotPayload;
    oopGraph?: OopGraphPayload;
    fileTape?: FileTapePayload;
  };
}

export interface FdrStepGuide {
  examples: string;
  header: string;
  description: string;
  body: string;
  test: string;
}

export interface CodeLabBlock extends BaseBlock {
  type: 'CODE_LAB';
  title: string;
  instructions: string;
  scaffoldMode: 'FREE_SANDBOX' | 'FDR_5_STEPS' | 'MULTI_FILE_PROJECT';
  starterCode: string;
  targetFileName?: string;
  unitTestCode: string;
  fdrGuide?: FdrStepGuide;
  linkedFlashcardId?: string;
}

export interface AstConstraints {
  requiredNodeTypes: string[];
  forbiddenNodeTypes?: string[];
  forbiddenCalls?: string[];
  customAstMessage: string;
}

export interface AstChallengeBlock extends BaseBlock {
  type: 'AST_CHALLENGE';
  title: string;
  instructions: string;
  starterCode: string;
  astConstraints: AstConstraints;
  unitTestCode: string;
  linkedFlashcardId?: string;
}

export interface ParsonsCodeLine {
  id: string;
  code: string;
  correctOrder: number;
  correctIndent: number;
  isDistractor: boolean;
}

export interface ParsonsProblemBlock extends BaseBlock {
  type: 'PARSONS_PROBLEM';
  prompt: string;
  blocks: ParsonsCodeLine[];
  linkedFlashcardId?: string;
}

export interface OutputPredictionBlock extends BaseBlock {
  type: 'OUTPUT_PREDICTION';
  prompt: string;
  codeSnippet: string;
  options: string[];
  correctOptionIndex: number;
  expectedReturnType: string;
  explanation: string;
  linkedFlashcardId?: string;
}

export interface BugAutopsyBlock extends BaseBlock {
  type: 'BUG_AUTOPSY';
  title: string;
  prompt: string;
  codeSnippet: string;
  tracebackText: string;
  culpritLineNumber: number;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  linkedFlashcardId?: string;
}

export interface SyntaxClozeBlank {
  id: string;
  options: string[];
  correctOption: string;
  hint?: string;
}

export interface SyntaxClozeBlock extends BaseBlock {
  type: 'SYNTAX_CLOZE';
  title: string;
  prompt: string;
  /** Codigo con marcadores ___0___, ___1___ o ___ para cada hueco. */
  codeTemplate: string;
  blanks: SyntaxClozeBlank[];
  explanation: string;
  linkedFlashcardId?: string;
}

export interface QuickQuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface QuickQuizBlock extends BaseBlock {
  type: 'QUICK_QUIZ';
  title: string;
  questions: QuickQuizQuestion[];
  passingScorePct?: number;
}

export interface FlashcardBlock extends BaseBlock {
  type: 'FLASHCARD';
  cardId: string;
  frontMarkdown: string;
  backMarkdown: string;
  codeExample?: string;
  tags: string[];
}

export interface YouTubeRefBlock extends BaseBlock {
  type: 'YOUTUBE_REF';
  videoId: string;
  title: string;
  channelName: string;
  timestampStartSec?: number;
  contextWhyWatch: string;
}

export type LessonBlock =
  | ProseBlock
  | GpuAnimationBlock
  | InteractiveVisualizerBlock
  | CodeLabBlock
  | AstChallengeBlock
  | ParsonsProblemBlock
  | OutputPredictionBlock
  | BugAutopsyBlock
  | SyntaxClozeBlock
  | QuickQuizBlock
  | FlashcardBlock
  | YouTubeRefBlock;

export interface MicroLesson {
  lessonId: string;
  order: number;
  title: string;
  estimatedMinutes: number;
  learningObjectives?: string[];
  takeaways?: string[];
  blocks: LessonBlock[];
}

export interface Chapter {
  chapterId: string;
  number: number;
  title: string;
  summary: string;
  microLessons: MicroLesson[];
}

export interface BookCartridge {
  schemaVersion: '2.0';
  bookId: string;
  metadata: {
    title: string;
    subtitle: string;
    authors: string[];
    edition: string;
    difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    coverAccentIcon: string;
    /** Miniatura de la portada (data URL JPEG) extraida del PDF. */
    coverImageDataUrl?: string;
  };
  themeDNA: ThemeDNA;
  runtimeRequirements: RuntimeRequirements;
  glossary: Record<string, GlossaryEntry>;
  achievements: AchievementSpec[];
  chapters: Chapter[];
}

// --- RUNTIME & PLATFORM EVALUATION CONTRACTS ---

export type MasteryTier = 'LOCKED' | 'IN_PROGRESS' | 'SILVER' | 'GOLD';

export interface AstRuleCheckItem {
  ruleKind: 'REQUIRED_NODE' | 'FORBIDDEN_NODE' | 'FORBIDDEN_CALL';
  target: string;
  passed: boolean;
  detail: string;
}

export interface AstAuditReport {
  passed: boolean;
  syntaxError?: string;
  detectedNodes: string[];
  detectedCalls: string[];
  checks: AstRuleCheckItem[];
  summaryMessage: string;
}

export interface UnitTestItem {
  name: string;
  passed: boolean;
  message: string;
}

export interface UnitTestReport {
  passed: boolean;
  total: number;
  passedCount: number;
  items: UnitTestItem[];
  rawOutput?: string;
}

export interface PythonExecutionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  returnValue: string | null;
  plotsBase64: string[];
  updatedVirtualFiles: Record<string, string>;
  astReport?: AstAuditReport;
  unitTestReport?: UnitTestReport;
  executionTimeMs: number;
}

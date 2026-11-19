import { Suspense, lazy, type ReactNode } from 'react';
import type { DeviceMode, LessonBlock } from '../types/cartridge.types';

const MemoryHeapVisualizer = lazy(() =>
  import('./visualizers/MemoryHeapVisualizer').then((m) => ({ default: m.MemoryHeapVisualizer }))
);
const AstExpressionCollapser = lazy(() =>
  import('./visualizers/AstExpressionCollapser').then((m) => ({ default: m.AstExpressionCollapser }))
);
const DataFrameDiffVisualizer = lazy(() =>
  import('./visualizers/DataFrameDiffVisualizer').then((m) => ({ default: m.DataFrameDiffVisualizer }))
);
const OopClassDiagramVisualizer = lazy(() =>
  import('./visualizers/OopClassDiagramVisualizer').then((m) => ({ default: m.OopClassDiagramVisualizer }))
);
const FileCursorTapeVisualizer = lazy(() =>
  import('./visualizers/FileCursorTapeVisualizer').then((m) => ({ default: m.FileCursorTapeVisualizer }))
);
const GpuMediaStage = lazy(() =>
  import('./visualizers/GpuMediaStage').then((m) => ({ default: m.GpuMediaStage }))
);
const CodeLabWorkspace = lazy(() =>
  import('./challenges/CodeLabWorkspace').then((m) => ({ default: m.CodeLabWorkspace }))
);
const AstStructuralChallenge = lazy(() =>
  import('./challenges/AstStructuralChallenge').then((m) => ({ default: m.AstStructuralChallenge }))
);
const OutputPredictionCard = lazy(() =>
  import('./challenges/OutputPredictionCard').then((m) => ({ default: m.OutputPredictionCard }))
);
const ParsonsDragPuzzle = lazy(() =>
  import('./challenges/ParsonsDragPuzzle').then((m) => ({ default: m.ParsonsDragPuzzle }))
);
const BugAutopsyChallenge = lazy(() =>
  import('./challenges/BugAutopsyChallenge').then((m) => ({ default: m.BugAutopsyChallenge }))
);
const SyntaxClozeChallenge = lazy(() =>
  import('./challenges/SyntaxClozeChallenge').then((m) => ({ default: m.SyntaxClozeChallenge }))
);
const QuickQuizChallenge = lazy(() =>
  import('./challenges/QuickQuizChallenge').then((m) => ({ default: m.QuickQuizChallenge }))
);
const PcOnlyLabHandoffCard = lazy(() =>
  import('./challenges/PcOnlyLabHandoffCard').then((m) => ({ default: m.PcOnlyLabHandoffCard }))
);

export interface WidgetRenderOptions {
  onResolved?: () => void;
  deviceMode?: DeviceMode;
}

function WidgetLoaderFallback() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-subtle border-t-accent" />
    </div>
  );
}

/**
 * Polymorphic widget router. Maps any LessonBlock variant to its lazy-loaded
 * React component. Enforces PC-only execution for CODE_LAB and AST_CHALLENGE.
 */
export function renderBlockWidget(block: LessonBlock, options?: WidgetRenderOptions): ReactNode {
  const deviceMode = options?.deviceMode ?? 'PC';
  let content: ReactNode = null;

  switch (block.type) {
    case 'INTERACTIVE_VISUALIZER':
      switch (block.visualizerKind) {
        case 'MEMORY_MODEL':
          content = <MemoryHeapVisualizer block={block} />;
          break;
        case 'AST_COLLAPSER':
          content = <AstExpressionCollapser block={block} />;
          break;
        case 'DATAFRAME_DIFF':
          content = <DataFrameDiffVisualizer block={block} />;
          break;
        case 'OOP_CLASS_GRAPH':
          content = <OopClassDiagramVisualizer block={block} />;
          break;
        case 'FILE_CURSOR_TAPE':
          content = <FileCursorTapeVisualizer block={block} />;
          break;
        default:
          content = null;
      }
      break;
    case 'GPU_ANIMATION':
      content = <GpuMediaStage block={block} />;
      break;
    case 'CODE_LAB':
      content =
        deviceMode === 'MOBILE' ? (
          <PcOnlyLabHandoffCard block={block} onResolved={options?.onResolved} />
        ) : (
          <CodeLabWorkspace block={block} />
        );
      break;
    case 'AST_CHALLENGE':
      content =
        deviceMode === 'MOBILE' ? (
          <PcOnlyLabHandoffCard block={block} onResolved={options?.onResolved} />
        ) : (
          <AstStructuralChallenge block={block} />
        );
      break;
    case 'OUTPUT_PREDICTION':
      content = <OutputPredictionCard block={block} onResolved={options?.onResolved} />;
      break;
    case 'PARSONS_PROBLEM':
      content = <ParsonsDragPuzzle block={block} onResolved={options?.onResolved} />;
      break;
    case 'BUG_AUTOPSY':
      content = <BugAutopsyChallenge block={block} onResolved={options?.onResolved} />;
      break;
    case 'SYNTAX_CLOZE':
      content = <SyntaxClozeChallenge block={block} onResolved={options?.onResolved} />;
      break;
    case 'QUICK_QUIZ':
      content = <QuickQuizChallenge block={block} onResolved={options?.onResolved} />;
      break;
    default:
      content = null;
  }

  if (!content) return null;
  return <Suspense fallback={<WidgetLoaderFallback />}>{content}</Suspense>;
}

export function isInteractiveBlock(block: LessonBlock): boolean {
  return block.type !== 'PROSE' && block.type !== 'YOUTUBE_REF' && block.type !== 'FLASHCARD';
}

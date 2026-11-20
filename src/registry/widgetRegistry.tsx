import { Component, Suspense, lazy, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import type { DeviceMode, LessonBlock } from '../types/cartridge.types';

class WidgetErrorBoundary extends Component<
  { blockId: string; onSkip?: () => void; children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { blockId: string; onSkip?: () => void; children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[WidgetErrorBoundary]', this.props.blockId, error, info.componentStack);
  }

  componentDidUpdate(prevProps: { blockId: string }) {
    if (prevProps.blockId !== this.props.blockId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-xs font-semibold text-secondary">
            Este bloque interactivo tuvo un problema de formato
          </p>
          <p className="max-w-sm text-[11px] text-muted">{this.state.error.message}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:border-accent/50"
            >
              Reintentar
            </button>
            {this.props.onSkip && (
              <button
                type="button"
                onClick={this.props.onSkip}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-canvas"
              >
                Saltar bloque y continuar
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    const RELOAD_KEY = 'ulb_chunk_reload_once';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const mod = await factory();
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          // ignore
        }
        return mod;
      } catch (err) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
          continue;
        }
        try {
          if (!sessionStorage.getItem(RELOAD_KEY)) {
            sessionStorage.setItem(RELOAD_KEY, '1');
            window.location.reload();
          }
        } catch {
          // ignore
        }
        throw err;
      }
    }
    return factory();
  });
}

const MemoryHeapVisualizer = lazyWithRetry(() =>
  import('./visualizers/MemoryHeapVisualizer').then((m) => ({ default: m.MemoryHeapVisualizer }))
);
const AstExpressionCollapser = lazyWithRetry(() =>
  import('./visualizers/AstExpressionCollapser').then((m) => ({ default: m.AstExpressionCollapser }))
);
const DataFrameDiffVisualizer = lazyWithRetry(() =>
  import('./visualizers/DataFrameDiffVisualizer').then((m) => ({ default: m.DataFrameDiffVisualizer }))
);
const OopClassDiagramVisualizer = lazyWithRetry(() =>
  import('./visualizers/OopClassDiagramVisualizer').then((m) => ({ default: m.OopClassDiagramVisualizer }))
);
const FileCursorTapeVisualizer = lazyWithRetry(() =>
  import('./visualizers/FileCursorTapeVisualizer').then((m) => ({ default: m.FileCursorTapeVisualizer }))
);
const GpuMediaStage = lazyWithRetry(() =>
  import('./visualizers/GpuMediaStage').then((m) => ({ default: m.GpuMediaStage }))
);
const CodeLabWorkspace = lazyWithRetry(() =>
  import('./challenges/CodeLabWorkspace').then((m) => ({ default: m.CodeLabWorkspace }))
);
const AstStructuralChallenge = lazyWithRetry(() =>
  import('./challenges/AstStructuralChallenge').then((m) => ({ default: m.AstStructuralChallenge }))
);
const OutputPredictionCard = lazyWithRetry(() =>
  import('./challenges/OutputPredictionCard').then((m) => ({ default: m.OutputPredictionCard }))
);
const ParsonsDragPuzzle = lazyWithRetry(() =>
  import('./challenges/ParsonsDragPuzzle').then((m) => ({ default: m.ParsonsDragPuzzle }))
);
const BugAutopsyChallenge = lazyWithRetry(() =>
  import('./challenges/BugAutopsyChallenge').then((m) => ({ default: m.BugAutopsyChallenge }))
);
const SyntaxClozeChallenge = lazyWithRetry(() =>
  import('./challenges/SyntaxClozeChallenge').then((m) => ({ default: m.SyntaxClozeChallenge }))
);
const QuickQuizChallenge = lazyWithRetry(() =>
  import('./challenges/QuickQuizChallenge').then((m) => ({ default: m.QuickQuizChallenge }))
);
const PcOnlyLabHandoffCard = lazyWithRetry(() =>
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
          <CodeLabWorkspace block={block} onResolved={options?.onResolved} />
        );
      break;
    case 'AST_CHALLENGE':
      content =
        deviceMode === 'MOBILE' ? (
          <PcOnlyLabHandoffCard block={block} onResolved={options?.onResolved} />
        ) : (
          <AstStructuralChallenge block={block} onResolved={options?.onResolved} />
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
  return (
    <WidgetErrorBoundary key={block.blockId} blockId={block.blockId} onSkip={options?.onResolved}>
      <Suspense fallback={<WidgetLoaderFallback />}>{content}</Suspense>
    </WidgetErrorBoundary>
  );
}

export function isInteractiveBlock(block: LessonBlock): boolean {
  return block.type !== 'PROSE' && block.type !== 'YOUTUBE_REF' && block.type !== 'FLASHCARD';
}

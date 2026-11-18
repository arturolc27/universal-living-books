import type { ReactNode } from 'react';
import type { LessonBlock } from '../types/cartridge.types';
import { MemoryHeapVisualizer } from './visualizers/MemoryHeapVisualizer';
import { AstExpressionCollapser } from './visualizers/AstExpressionCollapser';
import { DataFrameDiffVisualizer } from './visualizers/DataFrameDiffVisualizer';
import { OopClassDiagramVisualizer } from './visualizers/OopClassDiagramVisualizer';
import { FileCursorTapeVisualizer } from './visualizers/FileCursorTapeVisualizer';
import { GpuMediaStage } from './visualizers/GpuMediaStage';
import { CodeLabWorkspace } from './challenges/CodeLabWorkspace';
import { AstStructuralChallenge } from './challenges/AstStructuralChallenge';
import { OutputPredictionCard } from './challenges/OutputPredictionCard';
import { ParsonsDragPuzzle } from './challenges/ParsonsDragPuzzle';
import { BugAutopsyChallenge } from './challenges/BugAutopsyChallenge';

export interface WidgetRenderOptions {
  onResolved?: () => void;
}

/**
 * Polymorphic widget router. Maps any LessonBlock variant to its isolated
 * React component. New visualizers/challenges can be registered here without
 * touching the layout shells.
 */
export function renderBlockWidget(block: LessonBlock, options?: WidgetRenderOptions): ReactNode {
  switch (block.type) {
    case 'INTERACTIVE_VISUALIZER':
      switch (block.visualizerKind) {
        case 'MEMORY_MODEL':
          return <MemoryHeapVisualizer block={block} />;
        case 'AST_COLLAPSER':
          return <AstExpressionCollapser block={block} />;
        case 'DATAFRAME_DIFF':
          return <DataFrameDiffVisualizer block={block} />;
        case 'OOP_CLASS_GRAPH':
          return <OopClassDiagramVisualizer block={block} />;
        case 'FILE_CURSOR_TAPE':
          return <FileCursorTapeVisualizer block={block} />;
        default:
          return null;
      }
    case 'GPU_ANIMATION':
      return <GpuMediaStage block={block} />;
    case 'CODE_LAB':
      return <CodeLabWorkspace block={block} />;
    case 'AST_CHALLENGE':
      return <AstStructuralChallenge block={block} />;
    case 'OUTPUT_PREDICTION':
      return <OutputPredictionCard block={block} onResolved={options?.onResolved} />;
    case 'PARSONS_PROBLEM':
      return <ParsonsDragPuzzle block={block} onResolved={options?.onResolved} />;
    case 'BUG_AUTOPSY':
      return <BugAutopsyChallenge block={block} onResolved={options?.onResolved} />;
    default:
      return null;
  }
}

export function isInteractiveBlock(block: LessonBlock): boolean {
  return block.type !== 'PROSE' && block.type !== 'YOUTUBE_REF' && block.type !== 'FLASHCARD';
}

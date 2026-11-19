import { Loader2, CheckCircle2, AlertTriangle, Pause, X } from 'lucide-react';
import {
  compilationOrchestrator,
  useCompilationOrchestrator,
} from '../../engine/compiler/compilationOrchestrator';
import { usePlatformStore } from '../../store/usePlatformStore';
import { cn } from '../utils/cn';

function fmtShortEta(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function CompilerBackgroundPill() {
  const state = useCompilationOrchestrator();
  const compilerOpen = usePlatformStore((s) => s.compilerOpen);
  const setCompilerOpen = usePlatformStore((s) => s.setCompilerOpen);

  if (state.phase === 'IDLE' || compilerOpen) return null;

  const totalSec = state.telemetry?.totalSections ?? Object.keys(state.sections).length;
  const doneSec = state.telemetry?.completedSections ?? 0;
  const pct = totalSec > 0 ? Math.round((doneSec / totalSec) * 100) : 0;

  let label = 'Compilando...';
  if (state.phase === 'TRACING' && state.tracerTelemetry) {
    const t = state.tracerTelemetry;
    const processed = t.tracedCount + t.cachedCount + t.skippedTrivialOrUnsafeCount + t.failedCount;
    label = `Trazando ${processed}/${t.totalSnippets}`;
  } else if (state.phase === 'COMPILING') {
    const eta = state.telemetry ? ` · ~${fmtShortEta(state.telemetry.etaSec)}` : '';
    label = `Compilando ${pct}%${eta}`;
  } else if (state.phase === 'PAUSED') {
    label = `Pausado (${pct}%)`;
  } else if (state.phase === 'COMPLETED') {
    label = `Listo (${state.readyChapters.length} caps)`;
  } else if (state.phase === 'FAILED') {
    label = 'Compilacion con fallos';
  } else if (state.phase === 'CANCELLED') {
    label = 'Cancelado';
  }

  const isFinished =
    state.phase === 'COMPLETED' || state.phase === 'FAILED' || state.phase === 'CANCELLED';

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        state.phase === 'COMPLETED'
          ? 'border-success/50 bg-success/10 text-success'
          : state.phase === 'FAILED'
            ? 'border-danger/50 bg-danger/10 text-danger'
            : 'border-accent/50 bg-accent/10 text-accent'
      )}
    >
      <button
        type="button"
        onClick={() => setCompilerOpen(true)}
        className="flex items-center gap-1.5 hover:underline"
        title={`Ver progreso de ${state.bookTitle || 'compilacion'}`}
      >
        {(state.phase === 'TRACING' || state.phase === 'COMPILING') && (
          <Loader2 size={12} className="animate-spin" />
        )}
        {state.phase === 'PAUSED' && <Pause size={12} />}
        {state.phase === 'COMPLETED' && <CheckCircle2 size={12} />}
        {(state.phase === 'FAILED' || state.phase === 'CANCELLED') && <AlertTriangle size={12} />}
        <span className="max-w-[11rem] truncate">{label}</span>
      </button>

      {isFinished && (
        <button
          type="button"
          onClick={() => compilationOrchestrator.dismiss()}
          aria-label="Ocultar estado de compilacion"
          className="ml-0.5 opacity-70 hover:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

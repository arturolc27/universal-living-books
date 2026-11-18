import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Target, Trophy, X } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';

export function GamificationHud() {
  const userStats = usePlatformStore((s) => s.userStats);
  const accuracy =
    userStats.totalAttempts > 0
      ? Math.round((userStats.totalFirstTryHits / userStats.totalAttempts) * 100)
      : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-secondary">
        <Flame size={12} /> {userStats.currentStreakDays}d
      </span>
      <span className="flex items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-accent">
        <Target size={12} /> {accuracy}%
      </span>
      <span className="flex items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-success">
        <Trophy size={12} /> {userStats.astMasteryCount}
      </span>
    </div>
  );
}

export function ToastStack() {
  const toasts = usePlatformStore((s) => s.toasts);
  const dismissToast = usePlatformStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-72 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-subtle bg-elevated p-3 shadow-lg"
          >
            <Trophy size={15} className="mt-0.5 text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-primary">{toast.title}</p>
              <p className="text-[11px] text-muted">{toast.description}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-muted hover:text-primary"
            >
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

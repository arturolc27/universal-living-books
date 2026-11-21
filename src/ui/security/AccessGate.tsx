import { useState, type FormEvent, type ReactNode } from 'react';
import { Lock, ShieldCheck, AlertTriangle } from 'lucide-react';

const EXPECTED_HASH = (import.meta.env.VITE_APP_ACCESS_PIN_SHA256 ?? '').trim().toLowerCase();
const STORAGE_KEY = 'ulb_access_gate_verified';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

export function getStoredAccessPinHash(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(STORAGE_KEY);
      if (val) return val;
    }
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(STORAGE_KEY) ?? '';
    }
  } catch {
    // ignore storage errors
  }
  return '';
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (!EXPECTED_HASH) return true;
    return getStoredAccessPinHash() === EXPECTED_HASH;
  });
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number>(0);

  if (unlocked || !EXPECTED_HASH) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now < lockedUntil) {
      const waitSec = Math.ceil((lockedUntil - now) / 1000);
      setError(`Demasiados intentos. Espera ${waitSec}s antes de reintentar.`);
      return;
    }

    const hash = await sha256Hex(pin);
    if (hash === EXPECTED_HASH) {
      try {
        localStorage.setItem(STORAGE_KEY, EXPECTED_HASH);
        sessionStorage.setItem(STORAGE_KEY, EXPECTED_HASH);
      } catch {
        // ignore storage errors
      }
      setUnlocked(true);
      setError(null);
      window.dispatchEvent(new CustomEvent('living-books:access-unlocked'));
      return;
    }

    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setPin('');
    if (nextAttempts >= MAX_ATTEMPTS) {
      setLockedUntil(Date.now() + LOCKOUT_MS);
      setAttempts(0);
      setError('Demasiados intentos fallidos. Bloqueo temporal de 60 segundos.');
    } else {
      setError(`Clave incorrecta (${MAX_ATTEMPTS - nextAttempts} intentos restantes).`);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-subtle bg-surface p-6 shadow-xl"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-primary">Acceso Protegido</h1>
            <p className="text-[11px] text-muted">Universal Living Books</p>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-[11px] font-medium text-secondary">Clave de acceso</span>
          <div className="relative">
            <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Introduce tu clave..."
              autoFocus
              className="w-full rounded-xl border border-subtle bg-canvas py-2 pl-8 pr-3 text-xs text-primary outline-none focus:border-accent"
            />
          </div>
        </label>

        {error && (
          <div className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
            <AlertTriangle size={13} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!pin.trim()}
          className="w-full rounded-xl bg-accent py-2 text-xs font-semibold text-canvas disabled:opacity-40"
        >
          Desbloquear plataforma
        </button>
      </form>
    </div>
  );
}

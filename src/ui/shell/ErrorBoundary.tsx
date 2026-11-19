import { Component, type ErrorInfo, type ReactNode } from 'react';
import { livingBooksDb } from '../../db/dexieDb';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: string;
}

/**
 * Captura cualquier error de render para evitar la "pantalla negra" y mostrar
 * un mensaje accionable con opcion de reparar la base de datos local.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ info: info.componentStack ?? '' });
  }

  private handleReset = async (): Promise<void> => {
    try {
      await livingBooksDb.delete();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('No se pudo borrar la base de datos:', err);
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <div className="max-w-lg rounded-2xl border border-danger/40 bg-danger/5 p-5">
          <h1 className="mb-2 text-sm font-semibold text-danger">La aplicacion encontro un error</h1>
          <p className="mb-3 text-xs text-primary">{this.state.error.message}</p>
          <pre className="code-font max-h-40 overflow-auto rounded-lg bg-canvas p-2 text-left text-[10px] text-muted">
            {this.state.info || this.state.error.stack}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-subtle px-3 py-1.5 text-xs text-primary hover:border-accent/50"
            >
              Recargar
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-canvas"
            >
              Reparar (borrar datos locales)
            </button>
          </div>
        </div>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class TvPageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostics in the browser console without exposing internals to visitors.
    console.error('[testagram-tv-page] render failure', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section role="alert" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">Live TV could not start</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          The TV page encountered a startup problem. Your account and the rest of Testagram are still available.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Reload TV
          </button>
          <a href="/" className="rounded-xl border px-4 py-2 text-sm font-semibold">
            Return to Testagram
          </a>
        </div>
      </section>
    );
  }
}

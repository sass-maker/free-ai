import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Minimal error boundary for the playground SPA — a render-time crash should
 * show a recoverable message, never a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Playground crashed:', error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <main
          style={{
            maxWidth: 880,
            margin: '0 auto',
            padding: 24,
            fontFamily: 'ui-sans-serif, system-ui',
          }}
        >
          <h1>Something went wrong</h1>
          <p style={{ color: '#334155' }}>
            The playground hit an unexpected error. Reload the page to try again.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

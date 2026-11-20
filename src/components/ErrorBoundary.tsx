import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((args: { error: Error; reset: () => void }) => ReactNode);
  resetKeys?: unknown[];
  onError?: (error: Error, info: ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export function haveResetKeysChanged(
  prevKeys: unknown[] | undefined,
  nextKeys: unknown[] | undefined,
): boolean {
  if (!prevKeys && !nextKeys) return false;
  if (!prevKeys || !nextKeys) return true;
  if (prevKeys.length !== nextKeys.length) return true;
  for (let i = 0; i < prevKeys.length; i += 1) {
    if (!Object.is(prevKeys[i], nextKeys[i])) {
      return true;
    }
  }
  return false;
}

function DefaultErrorFallback({
  error,
  onReset,
}: {
  error: Error | null;
  onReset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      data-testid="app-error-boundary"
      className="min-h-[60vh] w-full flex items-center justify-center p-6 bg-[var(--rm-bg)] text-[var(--rm-ink)]"
    >
      <div className="max-w-lg w-full bg-[var(--rm-surface)] border border-[var(--rm-border)] rounded-2xl p-6 sm:p-8 space-y-5 shadow-sm">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-[#E05252]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold tracking-tight text-[var(--rm-ink)]">
              {t('errorBoundary.title')}
            </h1>
            <p className="text-sm text-[var(--rm-ink-muted)] mt-1 leading-relaxed">
              {t('errorBoundary.subtitle')}
            </p>
          </div>
        </div>

        {error?.message && (
          <details className="rounded-xl bg-[var(--rm-surface-muted)] border border-[var(--rm-border)] px-3.5 py-2.5 text-xs">
            <summary className="cursor-pointer font-semibold text-[var(--rm-ink-muted)] select-none">
              {t('errorBoundary.detailsLabel')}
            </summary>
            <p className="mt-2 font-mono text-[11px] text-[#E05252] break-words">
              {error.message}
            </p>
          </details>
        )}

        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            type="button"
            onClick={onReset}
            data-testid="error-boundary-retry"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#FF8738] hover:bg-[#F07322] text-white text-xs font-semibold cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('errorBoundary.retry')}</span>
          </button>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#182333] dark:bg-[#223044] hover:bg-[#223044] dark:hover:bg-[#2D4059] text-white text-xs font-semibold cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('errorBoundary.reload')}</span>
          </button>

          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--rm-border)] bg-[var(--rm-surface)] hover:bg-[var(--rm-surface-hover)] text-[var(--rm-ink)] text-xs font-semibold transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            <span>{t('errorBoundary.goHome')}</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RestoMax ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      if (typeof fallback === 'function') {
        return error
          ? fallback({ error, reset: this.resetErrorBoundary })
          : null;
      }
      if (fallback) {
        return fallback;
      }
      return (
        <DefaultErrorFallback
          error={error}
          onReset={this.resetErrorBoundary}
        />
      );
    }

    return children;
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKeys={[location.pathname]}>{children}</ErrorBoundary>
  );
}

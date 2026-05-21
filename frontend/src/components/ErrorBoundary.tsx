// Sprint 7: глобальный ErrorBoundary вокруг роутов.
// Ловит unhandled-исключения из React-дерева, показывает fallback с reload.
// В dev-режиме показывает технические детали; в production — только понятное сообщение.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Опциональный кастомный fallback. По умолчанию — стандартная карточка. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  private reset = (): void => {
    this.setState({ error: null, errorInfo: null });
  };

  render(): ReactNode {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    const isDev = import.meta.env.DEV;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
        <div className="max-w-xl w-full rounded-lg border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <h1 className="text-lg font-semibold">Что-то пошло не так</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Произошла непредвиденная ошибка в приложении. Попробуйте перезагрузить страницу.
            Если проблема повторяется — обратитесь к администратору.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" /> Перезагрузить
            </Button>
            <Button variant="outline" onClick={this.reset}>
              Попробовать снова
            </Button>
          </div>
          {isDev ? (
            <details className="text-xs text-muted-foreground border-t pt-3">
              <summary className="cursor-pointer font-medium">Технические детали (только в dev)</summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="font-mono font-semibold text-destructive">{error.name}: {error.message}</div>
                </div>
                {error.stack ? (
                  <pre className="font-mono whitespace-pre-wrap max-h-64 overflow-auto bg-muted/40 p-2 rounded">
                    {error.stack}
                  </pre>
                ) : null}
                {errorInfo?.componentStack ? (
                  <pre className="font-mono whitespace-pre-wrap max-h-64 overflow-auto bg-muted/40 p-2 rounded">
                    {errorInfo.componentStack}
                  </pre>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    );
  }
}

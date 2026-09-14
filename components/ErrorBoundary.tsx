"use client";

import React from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const { error, errorInfo } = this.state;

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <div className="max-w-lg w-full bg-white rounded-2xl border border-red-200 shadow-lg p-8 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-xl">💥</div>
            <div>
              <div className="font-semibold text-gray-900 text-base">Unerwarteter Fehler</div>
              <div className="text-xs text-gray-400">Ein Teil der Seite konnte nicht geladen werden</div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-800 font-mono break-all">
              {error.message}
            </div>
          )}

          {errorInfo && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-600">Stack Trace anzeigen</summary>
              <pre className="mt-2 bg-gray-50 rounded-lg p-3 overflow-auto max-h-48 text-gray-600 text-[10px] leading-relaxed">
                {errorInfo.componentStack}
              </pre>
            </details>
          )}

          <button
            onClick={this.reset}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors self-start"
          >
            ↺ Neu laden
          </button>
        </div>
      </div>
    );
  }
}

/**
 * Lightweight function wrapper — catches render errors in a subtree.
 * Usage: <ErrorBoundaryWrapper><YourComponent /></ErrorBoundaryWrapper>
 */
export function ErrorBoundaryWrapper({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <span>💥</span>
          <span>{label ? `„${label}" konnte nicht geladen werden` : "Komponente fehlerhaft"}</span>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

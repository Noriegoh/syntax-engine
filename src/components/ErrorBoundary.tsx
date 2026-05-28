import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  sectionName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl space-y-2 font-mono text-xs text-rose-200">
          <div className="font-bold flex items-center gap-1.5 text-rose-400">
            <span>⚠️ Component Error</span>
            {this.props.sectionName && <span className="opacity-60">[{this.props.sectionName}]</span>}
          </div>
          <p className="opacity-80 leading-relaxed max-h-32 overflow-y-auto">
            {this.state.error?.message || "An unexpected rendering error occurred in this view section."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-2 py-1 bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/40 hover:border-rose-500/60 rounded text-[10px] text-rose-300 font-bold tracking-wider uppercase transition-all"
            id="error-boundary-retry-button"
          >
            Attempt Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

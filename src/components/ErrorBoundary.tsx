import React, { ReactNode, useState } from 'react';

interface ErrorBoundaryProps {
children: ReactNode;
fallback?: ReactNode;
}

interface ErrorBoundaryState {
hasError: boolean;
error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
constructor(props: ErrorBoundaryProps) {
super(props);
this.state = { hasError: false, error: null };
}

static getDerivedStateFromError(error: Error): ErrorBoundaryState {
return { hasError: true, error };
}

componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
console.error('ErrorBoundary caught an error:', error, errorInfo);
}

render() {
if (this.state.hasError) {
if (this.props.fallback) {
return this.props.fallback;
}

return (
<div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-8">
<div className="max-w-md w-full glass-card rounded-2xl p-8 border border-red-500/20">
<div className="text-center mb-6">
<div className="text-5xl mb-4">⚠️</div>
<h1 className="text-2xl font-bold text-red-400 mb-2">
Something Went Wrong
</h1>
<p className="text-slate-400 text-sm">
The application encountered an unexpected error.
</p>
</div>

{this.state.error && (
<div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
<div className="text-xs font-mono text-red-300 break-all">
{this.state.error.message}
</div>
</div>
)}

<div className="flex gap-3">
<button
onClick={() => window.location.reload()}
className="flex-1 btn-primary py-3 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl font-bold text-white"
>
🔄 Reload Application
</button>
<button
onClick={() => {
localStorage.clear();
window.location.reload();
}}
className="flex-1 py-3 glass-input rounded-xl font-bold text-white border border-white/10"
>
🧹 Clear Cache
</button>
</div>

<div className="mt-4 text-center">
<button
onClick={() => this.setState({ hasError: false, error: null })}
className="text-xs text-slate-500 hover:text-cyan-400 transition-colors"
>
Try to recover (experimental)
</button>
</div>
</div>
</div>
);
}

return this.props.children;
}
}

export function FallbackErrorBoundary({ children }: { children: ReactNode }) {
const [hasError, setHasError] = useState(false);

if (hasError) {
return (
<div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-8">
<div className="text-center">
<div className="text-5xl mb-4">⚠️</div>
<h1 className="text-2xl font-bold text-red-400 mb-2">Something Went Wrong</h1>
<button
onClick={() => window.location.reload()}
className="btn-primary py-3 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl font-bold text-white"
>
🔄 Reload
</button>
</div>
</div>
);
}

return (
<ErrorBoundary fallback={null}>
{children}
</ErrorBoundary>
);
}

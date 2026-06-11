import React from 'react';
import { motion } from 'motion/react';
import { Search, AlertCircle, GitBranch, Link } from 'lucide-react';
import { LexicalScope, SymbolDefinition, SymbolReference } from '../lib/engine';
import { cn } from '../lib/utils';
import { ErrorBoundary } from './ErrorBoundary';

interface CstScopesTabProps {
  scopeSearchQuery: string;
  setScopeSearchQuery: (val: string) => void;
  scopeError: string | null;
  scopeChain: LexicalScope | null;
  selectedScope: LexicalScope | null;
  setSelectedScope: (scope: LexicalScope | null) => void;
  selectedSymbol: SymbolDefinition | null;
  setSelectedSymbol: (sym: SymbolDefinition | null) => void;
  setHoveredScope: (scope: LexicalScope | null) => void;
  selectedReference: SymbolReference | null;
  setSelectedReference: (ref: SymbolReference | null) => void;
  setHoveredSymbol: (sym: SymbolDefinition | null) => void;
  setHoveredReference: (ref: SymbolReference | null) => void;
  findSymbolById: (id: string) => SymbolDefinition | null;
  debouncedTestInput: string;
  testInput: string;
  scrollToNode: (node: any) => void;
  getLineAndCol: (text: string, offset: number) => { line: number, col: number };
}

export const CstScopesTab: React.FC<CstScopesTabProps> = ({
  scopeSearchQuery,
  setScopeSearchQuery,
  scopeError,
  scopeChain,
  selectedScope,
  setSelectedScope,
  selectedSymbol,
  setSelectedSymbol,
  setHoveredScope,
  selectedReference,
  setSelectedReference,
  setHoveredSymbol,
  setHoveredReference,
  findSymbolById,
  debouncedTestInput,
  testInput,
  scrollToNode,
  getLineAndCol,
}) => {
  const currentScope = (selectedScope || scopeChain || { name: 'None', symbols: [], references: [], type: 'global', id: 'global', start: 0, end: 0 }) as any;
  
  const filteredSymbols = currentScope.symbols.filter((s: SymbolDefinition) => 
    (s.name || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase()) ||
    (s.datatype || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase())
  );

  const renderScope = (scope: LexicalScope, depth: number = 0): React.ReactNode => {
    const isSelected = selectedScope?.id === scope.id || (!selectedScope && scope.id === 'global');
    const symbolMatchCount = scope.symbols.filter(s => 
      (s.name || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase()) ||
      (s.datatype || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase())
    ).length;

    const showMatchBadge = scopeSearchQuery.length > 0 && symbolMatchCount > 0;

    return (
      <div key={scope.id} className="space-y-0.5">
        <div 
          onClick={() => {
            setSelectedScope(scope);
            setSelectedSymbol(null);
          }}
          onMouseEnter={() => {
            setHoveredScope(scope);
          }}
          onMouseLeave={() => {
            setHoveredScope(null);
          }}
          className={cn(
            "flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border",
            isSelected 
              ? "bg-indigo-500/15 border-indigo-500/30 text-white font-semibold" 
              : "border-transparent bg-transparent hover:bg-white/[0.02] text-slate-400 hover:text-white"
          )}
          style={{ paddingLeft: `${Math.max(8, depth * 16 + 8)}px` }}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              scope.type === 'global' ? "bg-purple-400" :
              scope.type === 'struct' ? "bg-amber-400" :
              scope.type === 'function' ? "bg-emerald-400" : "bg-sky-400"
            )} />
            <span className="text-[10px] font-mono truncate">{scope.name}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {showMatchBadge && (
              <span className="px-1 text-[8px] bg-indigo-500/30 text-indigo-200 border border-indigo-500/50 font-black rounded uppercase">
                {symbolMatchCount} Match
              </span>
            )}
            <span className="text-[8px] font-mono opacity-50 px-1 py-0.5 rounded bg-black/40 border border-white/5">
              ({scope.symbols.length}s / {scope.references.length}r)
            </span>
          </div>
        </div>
        {scope.children.map(child => renderScope(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-row overflow-hidden text-slate-300 bg-slate-950/20">
      {/* 1. Left Sidebar: Scopes Tree & Search */}
      <div className="w-[45%] border-r border-white/5 flex flex-col overflow-hidden bg-black/80">
        <div className="p-3 border-b border-white/5 bg-white/[0.01] space-y-2">
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
            Lexical Scopes
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search symbols..."
              value={scopeSearchQuery}
              onChange={(e) => setScopeSearchQuery(e.target.value)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-1.5 pl-8 pr-3 text-[11px] text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          <ErrorBoundary sectionName="Scope Tree Panel">
          {scopeError ? (
            <div className="p-4 m-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono text-center">
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-black uppercase text-rose-400 mb-1.5 animate-pulse">
                <AlertCircle className="w-3.5 h-3.5" /> Resolver Error
              </div>
              <div className="text-[11px] text-left leading-relaxed max-h-[300px] overflow-auto custom-scrollbar font-normal p-1 bg-black/30 rounded border border-white/5 select-text">
                {scopeError}
              </div>
              <div className="mt-3 text-[9px] text-slate-400">
                Please check the custom code under <strong className="text-indigo-400">Designer &gt; Scope Resolver</strong> to fix this error.
              </div>
            </div>
          ) : scopeChain ? (
            renderScope(scopeChain)
          ) : (
            <div className="p-4 text-center text-slate-500 italic text-[11px]">
              No scopes resolved.
            </div>
          )}
          </ErrorBoundary>
        </div>
      </div>

      {/* 2. Right Detail Panel */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-slate-950/40">
        <ErrorBoundary sectionName="Scope Details Pane">
          <div className="space-y-4">
            <div className="p-3 bg-white/[0.02] border border-white/10 rounded-xl space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[8px] font-bold tracking-widest uppercase border",
                  currentScope.type === 'global' ? "bg-purple-500/10 text-purple-300 border-purple-500/30" :
                  currentScope.type === 'struct' ? "bg-amber-500/10 text-amber-300 border-amber-500/30" :
                  currentScope.type === 'function' ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                  "bg-sky-500/10 text-sky-300 border-sky-500/30"
                )}>
                  {currentScope.type} SCOPE
                </span>
                <span className="text-[11px] font-mono text-slate-300 truncate font-bold">
                  {currentScope.name}
                </span>
              </div>
              <div className="text-[9px] font-mono text-slate-500 flex items-center gap-3 pt-1">
                <span>Offset: {currentScope.start} - {currentScope.end}</span>
                <span>Symbols: {currentScope.symbols.length}</span>
                <span>Usages: {currentScope.references.length}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase mb-2">
                  Declared Symbols ({filteredSymbols.length})
                </div>
                {filteredSymbols.length === 0 ? (
                  <div className="p-3 bg-white/[0.01] border border-white/5 border-dashed rounded-lg text-slate-500 text-[10px] italic font-mono">
                    No symbols declared in this scope boundary{scopeSearchQuery ? " matching search" : ""}.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {filteredSymbols.map((sym: SymbolDefinition) => {
                      const isActive = selectedSymbol?.id === sym.id;
                      return (
                        <div 
                          key={sym.id}
                          onClick={() => setSelectedSymbol(sym)}
                          onMouseEnter={() => setHoveredSymbol(sym)}
                          onMouseLeave={() => setHoveredSymbol(null)}
                          className={cn(
                            "p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1.5 font-mono",
                            isActive 
                              ? "bg-indigo-500/15 border-indigo-500/40 shadow-lg" 
                              : "bg-black/40 border-white/5 hover:border-white/10"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-black text-rose-300 font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5 uppercase">
                                {sym.kind}
                              </span>
                              <span className="text-[11px] font-mono font-bold text-white">
                                {sym.name}
                              </span>
                            </div>
                            <div className="text-[9.5px] font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                              {sym.datatype}
                            </div>
                          </div>
                          <div className="text-[8px] font-mono text-slate-500 flex items-center gap-3">
                            <span>Range: {sym.start}-{sym.end}</span>
                            <span className="text-emerald-400 font-bold">{sym.references.length} references</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedSymbol && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-indigo-950/20 border border-indigo-500/20 rounded-xl space-y-3 font-mono"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-indigo-500/10">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-indigo-400" />
                      <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">
                        Symbol Details & Graph
                      </span>
                    </div>
                    <button 
                      onClick={() => setSelectedSymbol(null)}
                      className="text-[9px] text-slate-400 hover:text-white"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="space-y-3 text-[11px] font-mono text-slate-300">
                    <div className="space-y-1.5 bg-black/50 p-3 rounded-lg border border-white/5">
                      <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1">Lexical Resolve Path</span>
                      <div className="flex flex-col gap-1 text-[10px]">
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                          <span>Scope: {selectedSymbol.scopeId} ({currentScope.type})</span>
                        </div>
                        <div className="pl-3 border-l-2 border-dashed border-indigo-500/40 text-rose-300 font-bold flex items-center gap-1.5">
                          <span>↳ Declared Node: <b>{selectedSymbol.name}</b> as <b>{selectedSymbol.datatype}</b></span>
                        </div>
                        {selectedSymbol.references.map((r, ri) => (
                          <div key={r.id} className="pl-3 border-l-2 border-dashed border-indigo-500/40 text-emerald-400 flex items-center gap-1.5">
                            <span>↳ Ref #{ri+1}: at Offset {r.start} resolved to declaration symbol</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider">Symbol Snippet Source</span>
                      <pre className="p-2.5 rounded bg-black/60 border border-indigo-500/20 text-[10px] text-emerald-400 leading-relaxed overflow-x-auto truncate">
                        {(testInput || "").substring(selectedSymbol.start, selectedSymbol.end) || "Empty Definition Match"}
                      </pre>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider">Code usages / references ({selectedSymbol.references.length})</span>
                      {selectedSymbol.references.length === 0 ? (
                        <div className="text-[10px] italic text-slate-500">No active usages analyzed.</div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedSymbol.references.map((r, ri) => {
                            const rLoc = getLineAndCol(testInput, r.start);
                            return (
                              <div 
                                key={r.id}
                                onClick={() => {
                                  scrollToNode(r);
                                }}
                                className="p-1.5 px-2 bg-emerald-500/5 hover:bg-indigo-500/20 border border-emerald-500/20 hover:border-indigo-500/40 rounded text-[10px] text-emerald-300 transition-all flex items-center gap-1.5 cursor-pointer"
                                title={`Click to jump to line ${rLoc.line}`}
                              >
                                <Link className="w-3 h-3 text-emerald-400/80" />
                                <span>Ref #{ri+1} (Line {rLoc.line}, Col {rLoc.col})</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              <div>
                <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase mb-2">
                  Referenced Identifiers in Scope ({currentScope.references.length})
                </div>
                {currentScope.references.length === 0 ? (
                  <div className="p-3 bg-white/[0.01] border border-white/5 border-dashed rounded-lg text-slate-500 text-[10px] italic">
                    No symbol references used inside this scope.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                    {currentScope.references.map((ref: SymbolReference) => {
                      const isActive = selectedReference?.id === ref.id;
                      return (
                        <div 
                          key={ref.id}
                          onClick={() => {
                            setSelectedReference(ref);
                            if (ref.resolvedSymbolId) {
                              const sym = findSymbolById(ref.resolvedSymbolId);
                              if (sym) {
                                setSelectedSymbol(sym);
                              }
                            } else {
                              setSelectedSymbol(null);
                            }
                          }}
                          onMouseEnter={() => {
                            setHoveredReference(ref);
                            if (ref.resolvedSymbolId) {
                              const sym = findSymbolById(ref.resolvedSymbolId);
                              if (sym) {
                                setHoveredSymbol(sym);
                              }
                            }
                          }}
                          onMouseLeave={() => {
                            setHoveredReference(null);
                            setHoveredSymbol(null);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            scrollToNode(ref);
                          }}
                          title="Double-click to locate this reference in the editor"
                          className={cn(
                            "p-2.5 rounded-lg border flex flex-col gap-1 font-mono cursor-pointer transition-all",
                            isActive 
                              ? "bg-sky-500/15 border-sky-500/40 shadow-[0_4px_16px_rgba(14,165,233,0.15)] text-sky-200" 
                              : "bg-black/20 border-white/5 text-slate-300 hover:border-sky-500/25 hover:bg-black/40"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sky-300">{ref.name}</span>
                            <span className={cn(
                              "text-[8px] uppercase px-1 border rounded font-black tracking-tighter",
                              ref.resolvedSymbolId 
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                                : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                            )}>
                              {ref.resolvedSymbolId ? "RESOLVED" : "UNRESOLVED"}
                            </span>
                          </div>
                          <div className="text-[8px] text-slate-500 flex items-center justify-between">
                            <span>Offset: {ref.start}-{ref.end}</span>
                            <span>L: {getLineAndCol(debouncedTestInput, ref.start).line} C: {getLineAndCol(debouncedTestInput, ref.start).col}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
};

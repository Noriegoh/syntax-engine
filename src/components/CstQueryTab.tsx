import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Search, MapPin, Check, Copy } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { CSTQuery } from '../lib/engine';
import { cn } from '../lib/utils';

const queryEditorTheme = EditorView.theme({
  "&": {
    color: "#cbd5e1",
    fontSize: "12px",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  ".cm-cursor": {
    borderLeftColor: "#818cf8"
  }
});

interface CstQueryTabProps {
  queryText: string;
  setQueryText: (val: string) => void;
  visualizeMode: 'cst' | 'ast';
  astResult: any;
  parseResult: any;
  debouncedTestInput: string;
  copiedMap: Record<string, boolean>;
  doCopy: (key: string, val: string) => void;
  hoveredQueryNode: any;
  setHoveredQueryNode: (node: any) => void;
  setHoveredCstNode: (node: any) => void;
  setSelectedCstNode: (node: any) => void;
  scrollToNode: (node: any) => void;
  getLineAndCol: (text: string, offset: number) => { line: number, col: number };
}

export const CstQueryTab: React.FC<CstQueryTabProps> = ({
  queryText,
  setQueryText,
  visualizeMode,
  astResult,
  parseResult,
  debouncedTestInput,
  copiedMap,
  doCopy,
  hoveredQueryNode,
  setHoveredQueryNode,
  setHoveredCstNode,
  setSelectedCstNode,
  scrollToNode,
  getLineAndCol,
}) => {
  try {
    const query = new CSTQuery(queryText);
    const matches = query.run(visualizeMode === 'ast' ? astResult : parseResult);
    
    const getNodeText = (node: any): string => {
      if (!node) return "";
      const start = typeof node.start === 'number' ? node.start : node.offset;
      const end = typeof node.end === 'number' ? node.end : (typeof node.offset === 'number' && typeof node.width === 'number' ? node.offset + node.width : undefined);
      if (typeof start === 'number' && typeof end === 'number') {
        return debouncedTestInput.substring(start, end);
      }
      if (Array.isArray(node)) {
        return node.map(getNodeText).join("");
      }
      if (node.value !== undefined) {
        if (typeof node.value === 'string') return node.value;
        if (Array.isArray(node.value)) return node.value.map(getNodeText).join("");
        return getNodeText(node.value);
      }
      if (node.children !== undefined) {
        return getNodeText(node.children);
      }
      return String(node);
    };

    const renderNodeCard = (node: any, titleStr: string, badgeColor: string, copyKey: string) => {
      if (!node) return null;
      const matchedText = getNodeText(node);
      const activeStart = typeof node.start === 'number' ? node.start : node.offset;
      const activeEnd = typeof node.end === 'number' ? node.end : (typeof node.offset === 'number' && typeof node.width === 'number' ? node.offset + node.width : undefined);
      const startCoords = typeof activeStart === 'number' ? getLineAndCol(debouncedTestInput, activeStart) : { line: 1, col: 1 };
      const endCoords = typeof activeEnd === 'number' ? getLineAndCol(debouncedTestInput, activeEnd) : { line: 1, col: 1 };
      const isCopied = copiedMap[copyKey];

      return (
        <div 
          className={cn(
            "flex flex-col gap-2 p-3.5 rounded-xl border transition-all text-slate-300 relative select-text",
            hoveredQueryNode === node 
              ? "bg-indigo-500/15 border-indigo-500/40 shadow-[0_4px_16px_rgba(99,102,241,0.15)]" 
              : "bg-black/40 border-white/5 hover:border-white/10"
          )}
          onMouseEnter={() => {
            setHoveredQueryNode(node);
            setHoveredCstNode(node);
          }}
          onMouseLeave={() => {
            setHoveredQueryNode(null);
            setHoveredCstNode(null);
          }}
          onClick={() => {
            setSelectedCstNode(node);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            scrollToNode(node);
          }}
          title="Double-click to navigate inside the editor"
        >
          <div className="flex items-center justify-between select-none">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span className={cn("text-[8px] font-extrabold uppercase tracking-tighter px-2 py-0.5 rounded border antialiased shrink-0", badgeColor)}>
                {titleStr}
              </span>
              <span className="text-[9px] font-mono text-slate-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 truncate max-w-[150px]">
                {node.type || 'Rule'}
              </span>
            </div>
            
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToNode(node);
                }}
                title="Locate details in editor (Double-click card)"
                className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all active:scale-95"
              >
                <MapPin className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  doCopy(copyKey, matchedText);
                }}
                title="Copy matched text"
                className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all active:scale-95"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          
          <pre className="text-[11px] font-mono text-emerald-300 bg-[#0c0c0e] p-2.5 rounded-lg border border-white/5 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto custom-scrollbar select-text selection:bg-indigo-500/30">
            {matchedText || <span className="text-slate-600 italic">Empty match</span>}
          </pre>
          
          <div className="flex flex-wrap items-center justify-between text-[8px] font-bold text-slate-500 bg-white/[0.01] px-2 py-1 rounded border border-white/[0.02] select-none">
            <span className="text-slate-400 flex items-center gap-1">
              <span className="text-[10px] text-indigo-400/50">📍</span>
              Ln {startCoords.line}, Col {startCoords.col} &rarr; Ln {endCoords.line}, Col {endCoords.col}
            </span>
            <div className="flex gap-2">
              <span>LEN: {typeof node.end === 'number' && typeof node.start === 'number' ? (node.end - node.start) : matchedText.length} chars</span>
              {typeof node.start === 'number' && <span>OFFSET: {node.start}-{node.end}</span>}
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="h-full flex flex-col overflow-hidden bg-slate-950/20">
        <div className="p-4 border-b border-white/5 bg-white/[0.02]">
          <div className="relative group border border-white/10 bg-slate-900/50 rounded-lg overflow-hidden flex min-h-[100px] items-stretch focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all max-h-[160px]">
            <div className="absolute top-3.5 left-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors z-10">
              <Search className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 pl-8 min-h-[100px]">
              <CodeMirror
                value={queryText}
                onChange={(val) => setQueryText(val)}
                theme="none"
                extensions={[queryEditorTheme]}
                basicSetup={{
                  lineNumbers: false,
                  foldGutter: false,
                  dropCursor: false,
                  allowMultipleSelections: false,
                  indentOnInput: false,
                  syntaxHighlighting: false,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: false,
                }}
                className="w-full h-full text-xs font-mono"
                placeholder="Enter S-expression query (e.g. (struct_decl (id @name)))"
              />
            </div>
            <div className="absolute right-3 bottom-2.5 flex gap-1 pointer-events-none z-10">
               <div className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[8px] font-bold text-slate-500 uppercase tracking-tighter">S-Expr Parser</div>
            </div>
          </div>
          
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 font-medium select-none">Examples:</span>
            <button 
              onClick={() => setQueryText('(struct_decl (identifier) @struct_name)')}
              className="text-[10px] bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/15 rounded px-1.5 py-0.5 font-mono cursor-pointer transition-colors"
              title="Click to load direct child query"
            >
              Direct Child
            </button>
            <button 
              onClick={() => setQueryText('(hlsl_func_decl .. param @p)')}
              className="text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/15 rounded px-1.5 py-0.5 font-mono cursor-pointer transition-colors"
              title="Click to load descendant query searching params inside any function"
            >
              .. Descendant Params
            </button>
            <button 
              onClick={() => setQueryText('(struct_decl .. (var_decl (identifier) @field))')}
              className="text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/15 rounded px-1.5 py-0.5 font-mono cursor-pointer transition-colors"
              title="Click to load descendant query searching fields nested inside a struct"
            >
              .. Nested Fields
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
          {matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-600 opacity-40 text-center gap-2">
              <Search className="w-8 h-8 mb-2" />
              <p className="text-xs font-bold uppercase tracking-widest">No matches found</p>
              <p className="text-[10px]">Try a different query or adjust your code.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              <div className="px-4 py-2.5 bg-indigo-500/5 border-b border-white/5 flex items-center justify-between">
                <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">{matches.length} matches found</span>
                <span className="text-[8px] font-semibold text-slate-500 uppercase tracking-tight">Double-click match to locate</span>
              </div>
              {matches.map((match, mIdx) => (
                <div key={mIdx} className="p-4 hover:bg-white/[0.01] transition-colors group">
                  <div className="flex items-center justify-between mb-3 select-none">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-indigo-500/15 flex items-center justify-center text-[10px] font-extrabold text-indigo-400 border border-indigo-500/25">
                        {mIdx + 1}
                      </div>
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Match</span>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    {/* Render matched root node */}
                    {match.node && renderNodeCard(
                      match.node,
                      "Whole Match",
                      "bg-indigo-500/10 border-indigo-500/20 text-indigo-400",
                      `root-${mIdx}`
                    )}
                    
                    {/* Render Named Captures if they exist */}
                    {match.captures && match.captures.length > 0 ? (
                      <div className="pt-1.5 space-y-2">
                        <div className="px-1 text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5 select-none">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
                          Captures ({match.captures.length})
                        </div>
                        {match.captures.map((cap, cIdx) => (
                          <div key={cIdx}>
                            {renderNodeCard(
                              cap.node,
                              `@${cap.name}`,
                              "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                              `cap-${mIdx}-${cIdx}`
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[8px] font-semibold text-slate-500 italic px-1 pt-1 select-none">
                        No named captures in query. Displaying root matched node above.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  } catch (e) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-slate-950/20">
        <div className="p-4 border-b border-white/5 bg-white/[0.02]">
          <div className="relative group border border-white/10 bg-slate-900/50 rounded-lg overflow-hidden flex min-h-[100px] items-stretch focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all max-h-[160px]">
            <div className="absolute top-3.5 left-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors z-10">
              <Search className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 pl-8 min-h-[100px]">
              <CodeMirror
                value={queryText}
                onChange={(val) => setQueryText(val)}
                theme="none"
                extensions={[queryEditorTheme]}
                basicSetup={{
                  lineNumbers: false,
                  foldGutter: false,
                  dropCursor: false,
                  allowMultipleSelections: false,
                  indentOnInput: false,
                  syntaxHighlighting: false,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: false,
                }}
                className="w-full h-full text-xs font-mono"
                placeholder="Enter S-expression query (e.g. (struct_decl (id @name)))"
              />
            </div>
          </div>
        </div>
        <div className="p-6 text-rose-400 bg-rose-400/5 m-4 rounded-xl border border-rose-400/20 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest">Query Syntax Error</span>
          </div>
          <p className="text-[11px] font-mono break-words">{(e as any).message}</p>
        </div>
      </div>
    );
  }
};

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PanelLeftOpen, PanelLeftClose, Zap, CheckCircle2, AlertCircle, 
  ChevronDown, ChevronUp, PanelRightOpen, PanelRightClose, 
  FileCode, Copy, ZoomIn, ZoomOut, Maximize, X, Terminal 
} from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import ReactJson from 'react-json-view';

import { cn } from '../lib/utils';
import { TestCodeMirror } from './TestCodeMirror';
import { CstVisualizer } from './CstVisualizer';
import { CstQueryTab } from './CstQueryTab';
import { CstInvestigatorTab } from './CstInvestigatorTab';
import { CstScopesTab } from './CstScopesTab';
import { ParserProfiler } from './ParserProfiler';

interface PlaygroundTabProps {
  // Input section
  testInput: string;
  setTestInput: (val: string) => void;
  debouncedTestInput: string;
  useIncremental: boolean;
  setUseIncremental: (val: boolean) => void;
  parseDuration: number;
  cacheStats: any;
  parseError: any;
  recoveredErrors: any[];
  
  // Editor references and syncs
  testEditorRef: React.RefObject<any>;
  editorScrollContainerRef: React.RefObject<HTMLDivElement>;
  pendingEditsRef: React.MutableRefObject<any[]>;
  shiftAstAndStateOffsets: (editOffset: number, removedLength: number, delta: number) => void;
  setCursorPosition: (pos: { line: number; col: number }) => void;
  cursorPosition: { line: number; col: number };
  getLineAndCol: (text: string, offset: number) => { line: number; col: number };
  allSymbolsAndReferences: { symbols: any[]; references: any[] };

  // CST View Settings & Tab State
  cstViewMode: 'json' | 'visual' | 'query' | 'scopes' | 'performance' | 'investigate';
  setCstViewMode: (mode: 'json' | 'visual' | 'query' | 'scopes' | 'performance' | 'investigate') => void;
  visualizeMode: 'cst' | 'ast';
  setVisualizeMode: (mode: 'cst' | 'ast') => void;
  astResult: any;
  parseResult: any;
  
  // Navigation & selection states
  selectedCstNode: any;
  setSelectedCstNode: (node: any) => void;
  hoveredCstNode: any;
  setHoveredCstNode: (node: any) => void;
  scrollToNode: (node: any) => void;

  // S-expression queries
  queryText: string;
  setQueryText: (val: string) => void;
  copiedMap: Record<string, boolean>;
  doCopy: (key: string, val: string) => void;
  
  // Investigate mode specific
  pinnedOffset: number | null;
  setPinnedOffset: (val: number | null) => void;
  hoveredOffset: number | null;
  setHoveredOffset: (val: number | null) => void;
  investigateHoveredNode: any;
  setInvestigateHoveredNode: (node: any) => void;
  debouncedInvestigateOffset: number | null;

  // Scopes view specific
  scopeSearchQuery: string;
  setScopeSearchQuery: (val: string) => void;
  scopeError: string | null;
  scopeChain: any;
  selectedScope: any;
  setSelectedScope: (scope: any) => void;
  selectedSymbol: any;
  setSelectedSymbol: (sym: any) => void;
  setHoveredScope: (scope: any) => void;
  selectedReference: any;
  setSelectedReference: (ref: any) => void;
  setHoveredSymbol: (sym: any) => void;
  setHoveredReference: (ref: any) => void;
  findSymbolById: (id: string) => any;
  
  // Performance spec
  profileRoot: any;
}

export const PlaygroundTab: React.FC<PlaygroundTabProps> = ({
  testInput,
  setTestInput,
  debouncedTestInput,
  useIncremental,
  setUseIncremental,
  parseDuration,
  cacheStats,
  parseError,
  recoveredErrors,
  
  testEditorRef,
  editorScrollContainerRef,
  pendingEditsRef,
  shiftAstAndStateOffsets,
  setCursorPosition,
  cursorPosition,
  getLineAndCol,
  allSymbolsAndReferences,
  
  cstViewMode,
  setCstViewMode,
  visualizeMode,
  setVisualizeMode,
  astResult,
  parseResult,
  
  selectedCstNode,
  setSelectedCstNode,
  hoveredCstNode,
  setHoveredCstNode,
  scrollToNode,
  
  queryText,
  setQueryText,
  copiedMap,
  doCopy,
  
  pinnedOffset,
  setPinnedOffset,
  hoveredOffset,
  setHoveredOffset,
  investigateHoveredNode,
  setInvestigateHoveredNode,
  debouncedInvestigateOffset,
  
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
  
  profileRoot,
}) => {
  // Playground Local Layout State
  const [playgroundCstWidth, setPlaygroundCstWidth] = useState(500);
  const [playgroundCstCollapsed, setPlaygroundCstCollapsed] = useState(false);
  const [playgroundInputCollapsed, setPlaygroundInputCollapsed] = useState(false);
  const [isRecoveredErrorsExpanded, setIsRecoveredErrorsExpanded] = useState(false);
  const transformComponentRef = useRef<any>(null);

  const startPlaygroundResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = playgroundCstWidth;
    
    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setPlaygroundCstWidth(Math.max(250, Math.min(1000, startWidth - deltaX)));
    };
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <motion.div 
      key="playground"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex-1 flex overflow-hidden"
    >
      {/* Optional Collapsed Test Input Selector Bar */}
      {playgroundInputCollapsed ? (
        <div className="w-[42px] border-r border-white/10 bg-[#121214]/60 backdrop-blur-lg flex flex-col items-center py-4 gap-6 shrink-0 relative z-30 select-none">
          <button
            onClick={() => setPlaygroundInputCollapsed(false)}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer shadow-lg"
            title="Expand Test Input"
          >
            <PanelLeftOpen className="w-4 h-4 text-indigo-400" />
          </button>
          <div className="flex-1 flex items-center justify-center flex-col gap-1">
            <span className="rotate-90 text-[8.5px] font-black tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
              TEST INPUT
            </span>
          </div>
        </div>
      ) : (
        /* Playground Left: Large Input */
        <section className="flex-1 border-r border-white/10 bg-black/20 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setPlaygroundInputCollapsed(true)}
                className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer mr-1"
                title="Collapse Test Input"
              >
                <PanelLeftClose className="w-4 h-4 text-indigo-400" />
              </button>
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Test Input</h3>
              
              {/* Incremental Toggle */}
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-0.5 rounded-md">
                <button
                  onClick={() => setUseIncremental(true)}
                  className={cn(
                    "px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-tight rounded transition-all duration-150 flex items-center gap-1 border",
                    useIncremental 
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  )}
                  title="Incremental parsing only updates altered regions"
                >
                  <Zap className="w-2.5 h-2.5" /> Incremental ON
                </button>
                <button
                  onClick={() => setUseIncremental(false)}
                  className={cn(
                    "px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-tight rounded transition-all duration-150 border",
                    !useIncremental 
                      ? "bg-[#ecc94b]/10 border-[#ecc94b]/20 text-[#ecc94b]" 
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  )}
                  title="Regular Full-parsing re-parses whole document on each edit"
                >
                  Full Parse
                </button>
              </div>

              {/* Benchmarks & Performance Metrics */}
              {cacheStats && (
                <div className="hidden lg:flex items-center gap-3 text-[9px] font-mono text-slate-400 select-none border-l border-white/10 pl-4 leading-none">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    <span>Time:</span>
                    <span className={cn(
                      "font-bold",
                      parseDuration < 0.5 ? "text-emerald-400" : parseDuration < 2 ? "text-[#ecc94b]" : "text-rose-400"
                    )}>
                      {parseDuration.toFixed(2)}ms
                    </span>
                  </span>

                  {useIncremental && (
                    <>
                      <span className="text-slate-600">|</span>
                      <span>Reused Nodes (Hits): <strong className="text-emerald-400">{cacheStats.hits}</strong></span>
                      <span className="text-slate-600">|</span>
                      <span>Evaluated (Misses): <strong className="text-amber-400">{cacheStats.misses}</strong></span>
                      <span className="text-slate-600">|</span>
                      <span>Cache Size: <strong className="text-indigo-400">{cacheStats.size}</strong></span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded-full border border-white/10">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shadow-[0_0_8px]",
                parseError ? "bg-red-500 shadow-red-500" : "bg-emerald-500 shadow-emerald-500"
              )}></div>
              <span className="text-[8px] text-white font-bold uppercase tracking-tighter">
                {parseError ? 'Failed' : 'Valid'}
              </span>
            </div>
          </div>
          
          <div ref={editorScrollContainerRef} className="flex-1 overflow-auto custom-scrollbar bg-[#161618] relative flex flex-row">
            <TestCodeMirror
              editorRef={testEditorRef}
              onGotoDefinition={(def) => {
                setSelectedSymbol(def);
              }}
              value={testInput}
              onChange={(code, edit) => {
                if (edit) {
                  pendingEditsRef.current.push(edit);
                  const delta = edit.insertedText.length - edit.removedLength;
                  if (delta !== 0 || edit.removedLength > 0) {
                    shiftAstAndStateOffsets(edit.editOffset, edit.removedLength, delta);
                  }
                }
                setTestInput(code);
              }}
              setCursorPosition={setCursorPosition}
              parserState={{
                debouncedTestInput,
                parseResult,
                hoveredScope: null, // internally bound via tabs, but we can pass it down
                selectedScope: null,
                hoveredSymbol: null,
                selectedSymbol: null,
                hoveredReference: null,
                selectedReference: null,
                parseError,
                symbols: allSymbolsAndReferences.symbols,
                references: allSymbolsAndReferences.references
              }}
              className="h-full"
            />
          </div>
          
          {/* Editor Status Bar */}
          <div className="shrink-0 bg-black/40 border-t border-white/5 py-1.5 px-4 text-[11px] font-mono text-slate-500 flex items-center justify-between select-none">
            {/* Left Side: Stats */}
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="font-bold text-slate-400">{testInput.split('\n').length}</span> lines
              </span>
              <span className="text-slate-700">|</span>
              <span className="flex items-center gap-1.5">
                <span className="font-bold text-slate-400">{testInput.length}</span> chars
              </span>
            </div>

            {/* Right Side: cursor location */}
            <div className="flex items-center gap-4">
              <div className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-md text-emerald-400 font-bold flex items-center gap-1.5 shadow-[0_1px_5px_rgba(0,0,0,0.2)]">
                <span>Ln {cursorPosition.line}</span>
                <span className="text-slate-600 font-normal">,</span>
                <span>Col {cursorPosition.col}</span>
              </div>
              <span className="text-slate-700">|</span>
              <span className="text-slate-400">Spaces: 4</span>
              <span className="text-slate-700">|</span>
              <span className="text-slate-400">UTF-8</span>
            </div>
          </div>
          
          {parseError && (
            <div className="p-6 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-xs font-mono">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-500" />
                <div>
                  <p className="font-bold text-rose-400 mb-1 tracking-tighter uppercase">Fatal Parsing Failure</p>
                  <p className="opacity-90 leading-relaxed max-w-2xl">{parseError.message}</p>
                  {parseError.offset !== undefined && (
                    <div className="mt-3 flex items-center gap-4">
                      <span className="text-indigo-400 font-bold px-2 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
                        Line {getLineAndCol(debouncedTestInput, parseError.offset).line}, Col {getLineAndCol(debouncedTestInput, parseError.offset).col}
                      </span>
                      <span className="text-slate-500 text-[10px]">RULE: {parseError.ruleId}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {recoveredErrors.length > 0 && (
            <div className="bg-amber-500/10 border-t border-amber-500/20 text-amber-200 text-xs font-mono shrink-0">
              <button 
                onClick={() => setIsRecoveredErrorsExpanded(!isRecoveredErrorsExpanded)}
                className="w-full flex items-center justify-between p-4 hover:bg-amber-500/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 flex-shrink-0 text-amber-500" />
                  <span className="font-bold text-amber-400 tracking-tighter uppercase">
                    Recovered Errors ({recoveredErrors.length})
                  </span>
                </div>
                {isRecoveredErrorsExpanded ? (
                  <ChevronDown className="w-4 h-4 text-amber-500/70" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-amber-500/70" />
                )}
              </button>
              <AnimatePresence>
                {isRecoveredErrorsExpanded && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 pt-0 max-h-64 overflow-y-auto custom-scrollbar">
                      <div className="space-y-3">
                        {recoveredErrors.map((err, i) => (
                          <div key={i} className="flex items-start justify-between p-2.5 bg-black/20 rounded border border-white/5 gap-3">
                            <span className="opacity-80 break-words whitespace-pre-wrap flex-1 leading-relaxed" title={err.message}>{err.message}</span>
                            <span className="text-amber-500/60 font-bold shrink-0 text-[11px]">L{getLineAndCol(debouncedTestInput, err.offset).line}:C{getLineAndCol(debouncedTestInput, err.offset).col}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </section>
      )}

      {/* Adjust Width Handle for Playground CST */}
      {!playgroundCstCollapsed && !playgroundInputCollapsed && (
        <div
          onMouseDown={startPlaygroundResize}
          onDoubleClick={() => setPlaygroundCstWidth(500)}
          className="w-1.5 hover:w-2 bg-white/5 hover:bg-indigo-500/50 active:bg-indigo-500 cursor-col-resize select-none relative z-30 transition-all flex items-center justify-center group shrink-0"
          title="Drag to resize, Double click to reset"
        >
          <div className="absolute top-1/2 -translate-y-1/2 w-4 h-[32px] rounded-md bg-slate-900 border border-white/10 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none gap-0.5">
            <span className="w-0.5 h-1.5 bg-white/40 rounded-full" />
            <span className="w-0.5 h-1.5 bg-white/40 rounded-full" />
          </div>
        </div>
      )}

      {/* Playground Right: Huge CST Inspector */}
      {!playgroundCstCollapsed ? (
        <aside 
          style={playgroundInputCollapsed ? undefined : { width: `${playgroundCstWidth}px` }}
          className={cn(
            "bg-black/40 backdrop-blur-xl flex flex-col overflow-hidden",
            playgroundInputCollapsed ? "flex-1" : "shrink-0"
          )}
        >
          <div className="px-4 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setPlaygroundCstCollapsed(true)}
                className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer mr-1"
                title="Collapse CST Panel"
              >
                <PanelRightClose className="w-4 h-4 text-indigo-400" />
              </button>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#a5b4fc] bg-[#4f46e5]/10 px-2.5 py-1 rounded-md border border-[#4f46e5]/20 flex items-center gap-1.5 shadow-sm">
                <FileCode className="w-3.5 h-3.5" /> CST Parser Tree
              </span>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex bg-white/5 rounded-md border border-white/10 p-0.5 font-mono">
                {['json', 'visual', 'query', 'scopes', 'investigate', 'performance'].map((mode: any) => (
                  <button 
                    key={mode}
                    onClick={() => setCstViewMode(mode)}
                    className={cn(
                      "px-1.5 py-0.5 text-[8px] font-bold transition-all rounded uppercase",
                      cstViewMode === mode 
                        ? mode === 'investigate' ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-black shadow-sm" :
                          mode === 'performance' ? "bg-orange-600/20 text-orange-400 border border-orange-500/25 font-black shadow-sm" :
                          mode === 'scopes' ? "bg-indigo-500 text-white" : "bg-white/10 text-white" 
                        : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {mode === 'investigate' ? '🔍 Investigate' : mode === 'performance' ? '⚡ Perf' : mode}
                  </button>
                ))}
              </div>

              <button 
                onClick={() => {
                  const targetData = parseResult;
                  navigator.clipboard.writeText(JSON.stringify(targetData, null, 2));
                  alert(`CST JSON copied!`);
                }}
                className="text-[9px] font-bold p-1.5 hover:bg-white/5 rounded border border-white/10 text-indigo-400 hover:text-white transition-all uppercase tracking-widest flex items-center gap-1.5 shadow-sm"
              >
                <Copy className="w-3 h-3" /> Copy JSON
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-0 custom-scrollbar relative bg-[#0a0a0a] bg-[radial-gradient(#ffffff05_1px,transparent_1px)] [background-size:20px_20px]">
            {parseResult ? (
              cstViewMode === 'json' ? (
                <div className="ast-view-container font-mono text-[12px] h-full overflow-auto p-6 custom-scrollbar">
                  <ReactJson 
                    src={visualizeMode === 'ast' ? astResult : parseResult} 
                    theme="ocean" 
                    style={{ background: 'transparent', fontSize: '11px' }}
                    displayDataTypes={false}
                    displayObjectSize={true}
                    enableClipboard={false}
                    name={false}
                    collapsed={2}
                    iconStyle="square"
                    indentWidth={4}
                  />
                </div>
              ) : cstViewMode === 'visual' ? (
                <div className="h-full flex flex-col overflow-hidden relative group/canvas">
                  <TransformWrapper
                    ref={transformComponentRef}
                    initialScale={0.8}
                    initialPositionX={50}
                    initialPositionY={50}
                    centerOnInit={false}
                    minScale={0.1}
                    maxScale={4}
                    limitToBounds={false}
                    doubleClick={{ disabled: false, mode: "reset" }}
                  >
                    {({ zoomIn, zoomOut, resetTransform }: any) => (
                      <>
                        <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
                          <div className="flex bg-black/60 backdrop-blur-md rounded-lg border border-white/10 p-1 shadow-2xl">
                            <button 
                              onClick={() => zoomIn()}
                              className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                              title="Zoom In"
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => zoomOut()}
                              className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                              title="Zoom Out"
                            >
                              <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <div className="w-px h-4 bg-white/10 mx-1 self-center" />
                            <button 
                              onClick={() => resetTransform()}
                              className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                              title="Reset View"
                            >
                              <Maximize className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        
                        <div className="absolute bottom-4 right-4 z-50 text-[10px] font-bold text-slate-600 uppercase tracking-widest pointer-events-none opacity-0 group-hover/canvas:opacity-100 transition-opacity">
                          drag to pan • scroll to zoom
                        </div>

                        <TransformComponent
                          wrapperStyle={{ width: '100%', height: '100%' }}
                          contentStyle={{ width: '100%', height: '100%' }}
                        >
                          <div className="p-16 min-h-full min-w-full flex items-center justify-center bg-transparent">
                            <CstVisualizer node={visualizeMode === 'ast' ? astResult : parseResult} selectedCstNode={selectedCstNode} setSelectedCstNode={setSelectedCstNode} hoveredCstNode={hoveredCstNode} setHoveredCstNode={setHoveredCstNode} />
                          </div>
                        </TransformComponent>
                      </>
                    )}
                  </TransformWrapper>

                  {/* Floating Node Details Panel */}
                  {(() => {
                    const activeNode = hoveredCstNode || selectedCstNode;
                    if (!activeNode) return null;
                    
                    let nodeText = "";
                    if (typeof activeNode === 'object' && activeNode !== null) {
                      if (typeof activeNode.start === 'number' && typeof activeNode.end === 'number') {
                        nodeText = debouncedTestInput.substring(Math.max(0, activeNode.start), Math.min(debouncedTestInput.length, activeNode.end));
                      } else if (activeNode.value !== undefined) {
                        nodeText = String(activeNode.value);
                      }
                    } else {
                      nodeText = String(activeNode);
                    }
                    const isPinned = !!selectedCstNode;

                    return (
                      <div className="absolute bottom-4 left-4 z-50 w-80 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 max-h-[75%] overflow-y-auto custom-scrollbar transition-all">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                            <FileCode className="w-3.5 h-3.5 text-indigo-400" /> Node Inspector
                          </span>
                          <div className="flex items-center gap-2">
                            {isPinned && hoveredCstNode && hoveredCstNode !== selectedCstNode && (
                              <span className="text-[8px] bg-indigo-500/20 text-indigo-300 px-1 border border-indigo-500/30 rounded font-bold uppercase tracking-widest">
                                Hover Preview
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setSelectedCstNode(null);
                                setHoveredCstNode(null);
                              }}
                              className="p-1 text-slate-400 hover:text-white hover:bg-white/5 rounded transition-all cursor-pointer"
                              title="Clear Selection"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-3.5 text-xs">
                          <div className="flex flex-col gap-1">
                            <span className="text-[8.5px] font-black uppercase tracking-[0.2em] text-indigo-400 leading-none">Rule Name / Type</span>
                            <span className="text-sm font-black text-rose-300 font-mono tracking-tight bg-white/5 px-2 py-0.5 rounded border border-white/10 inline-block align-middle self-start">
                              {activeNode.type || activeNode.ruleId || 'Token'}
                            </span>
                          </div>

                          {typeof activeNode.start === 'number' && typeof activeNode.end === 'number' && (
                            <div className="grid grid-cols-2 gap-2 text-slate-400 font-mono text-[10px]">
                              <div className="bg-white/[0.02] p-1.5 rounded border border-white/5">
                                <span className="block text-[8px] text-slate-600 font-black uppercase tracking-widest mb-0.5">Offset Range</span>
                                <span className="text-white font-bold">{activeNode.start} &ndash; {activeNode.end}</span>
                              </div>
                              <div className="bg-white/[0.02] p-1.5 rounded border border-white/5">
                                <span className="block text-[8px] text-slate-600 font-black uppercase tracking-widest mb-0.5">Length (chars)</span>
                                <span className="text-indigo-300 font-bold">{activeNode.end - activeNode.start}</span>
                              </div>
                              <div className="bg-white/[0.02] p-1.5 rounded border border-white/5 col-span-2">
                                <span className="block text-[8px] text-slate-600 font-black uppercase tracking-widest mb-0.5">Match Location</span>
                                <span className="text-emerald-400 font-bold">
                                  Line {getLineAndCol(debouncedTestInput, activeNode.start).line}, Col {getLineAndCol(debouncedTestInput, activeNode.start).col}
                                </span>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col gap-1.5">
                            <span className="text-[8.5px] font-black uppercase tracking-[0.2em] text-indigo-400 leading-none">Matched Source Code</span>
                            <div className="bg-black/50 p-2.5 rounded-lg border border-white/5 max-h-36 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap text-emerald-300 break-all leading-normal custom-scrollbar bg-[#161618]">
                              {nodeText || <span className="text-slate-500 italic">Empty match</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : cstViewMode === 'query' ? (
                <CstQueryTab
                  queryText={queryText}
                  setQueryText={setQueryText}
                  visualizeMode={visualizeMode}
                  astResult={astResult}
                  parseResult={parseResult}
                  debouncedTestInput={debouncedTestInput}
                  copiedMap={copiedMap}
                  doCopy={doCopy}
                  hoveredQueryNode={null}
                  setHoveredQueryNode={() => {}}
                  setHoveredCstNode={setHoveredCstNode}
                  setSelectedCstNode={setSelectedCstNode}
                  scrollToNode={scrollToNode}
                  getLineAndCol={getLineAndCol}
                />
              ) : cstViewMode === 'investigate' ? (
                <CstInvestigatorTab
                  debouncedTestInput={debouncedTestInput}
                  pinnedOffset={pinnedOffset}
                  setPinnedOffset={setPinnedOffset}
                  hoveredOffset={hoveredOffset}
                  setHoveredOffset={setHoveredOffset}
                  investigateHoveredNode={investigateHoveredNode}
                  setInvestigateHoveredNode={setInvestigateHoveredNode}
                  debouncedInvestigateOffset={debouncedInvestigateOffset}
                  parseResult={parseResult}
                  setSelectedCstNode={setSelectedCstNode}
                />
              ) : cstViewMode === 'scopes' ? (
                <CstScopesTab
                  scopeSearchQuery={scopeSearchQuery}
                  setScopeSearchQuery={setScopeSearchQuery}
                  scopeError={scopeError}
                  scopeChain={scopeChain}
                  selectedScope={selectedScope}
                  setSelectedScope={setSelectedScope}
                  selectedSymbol={selectedSymbol}
                  setSelectedSymbol={setSelectedSymbol}
                  setHoveredScope={setHoveredScope}
                  selectedReference={selectedReference}
                  setSelectedReference={setSelectedReference}
                  setHoveredSymbol={setHoveredSymbol}
                  setHoveredReference={setHoveredReference}
                  findSymbolById={findSymbolById}
                  debouncedTestInput={debouncedTestInput}
                  testInput={testInput}
                  scrollToNode={scrollToNode}
                  getLineAndCol={getLineAndCol}
                />
              ) : (
                <ParserProfiler 
                  profileRoot={profileRoot} 
                  testInput={testInput} 
                  parseDuration={parseDuration} 
                  cacheStats={cacheStats} 
                />
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4 italic text-sm opacity-40 text-center px-8">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border border-white/10 mb-2">
                  <Terminal className="w-8 h-8" />
                </div>
                <p>CST will appear here once the input matches your grammar rules perfectly.</p>
              </div>
            )}
          </div>
        </aside>
      ) : (
        <div className="w-[42px] border-l border-white/10 bg-[#121214]/60 backdrop-blur-lg flex flex-col items-center py-4 gap-6 shrink-0 relative z-30 select-none">
          <button
            onClick={() => setPlaygroundCstCollapsed(false)}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer shadow-lg animate-pulse"
            title="Expand CST Panel"
          >
            <PanelRightOpen className="w-4 h-4 text-indigo-400" />
          </button>
          <div className="flex-1 flex items-center justify-center">
            <span className="-rotate-90 text-[8.5px] font-black tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
              CST INSPECTOR
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
};

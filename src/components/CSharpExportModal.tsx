import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Code2, X, Check, Rocket, Copy, FileCode } from "lucide-react";
import { cn } from "../lib/utils";

interface GeneratedFile {
  name: string;
  content: string;
}

interface CSharpExportModalProps {
  showCSharpModal: boolean;
  setShowCSharpModal: (val: boolean) => void;
  csNamespace: string;
  setCsNamespace: (val: string) => void;
  csExportMode: "bundle" | "modular";
  setCsExportMode: (val: "bundle" | "modular") => void;
  csAstSeparate: boolean;
  setCsAstSeparate: (val: boolean) => void;
  csGeneratedFiles: GeneratedFile[];
  csSelectedFileIndex: number;
  setCsSelectedFileIndex: (val: number) => void;
  downloadAllFiles: () => void;
  downloadSingleFile: (name: string, content: string) => void;
  copiedFileIndex: number | null;
  setCopiedFileIndex: (val: number | null) => void;
}

export const CSharpExportModal: React.FC<CSharpExportModalProps> = ({
  showCSharpModal,
  setShowCSharpModal,
  csNamespace,
  setCsNamespace,
  csExportMode,
  setCsExportMode,
  csAstSeparate,
  setCsAstSeparate,
  csGeneratedFiles,
  csSelectedFileIndex,
  setCsSelectedFileIndex,
  downloadAllFiles,
  downloadSingleFile,
  copiedFileIndex,
  setCopiedFileIndex,
}) => {
  return (
    <AnimatePresence>
      {showCSharpModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-lg flex items-center justify-center p-6"
          onClick={() => setShowCSharpModal(false)}
        >
          <motion.div 
            initial={{ scale: 0.95, y: 15 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 15 }}
            className="w-full max-w-6xl bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                  <Code2 className="text-indigo-400 w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight leading-none mb-1">C# Engine Export</h2>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-widest font-mono">Compiler Codegen & Export Options</p>
                </div>
              </div>
              <button 
                onClick={() => setShowCSharpModal(false)}
                className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main Split Layout */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Drawer: Configuration Panel */}
              <div className="w-80 border-r border-white/5 bg-black/10 overflow-y-auto p-6 space-y-6 shrink-0">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 font-mono">Namespace</label>
                  <input 
                    type="text" 
                    value={csNamespace}
                    onChange={(e) => setCsNamespace(e.target.value.replace(/[^a-zA-Z0-9_.]/g, ''))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                    placeholder="SyntaxEngine"
                  />
                </div>

                <div>
                  <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 font-mono">Export Mode</span>
                  <div className="grid grid-cols-1 gap-2">
                    <button 
                      onClick={() => { setCsExportMode('bundle'); setCsSelectedFileIndex(0); }}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all cursor-pointer",
                        csExportMode === 'bundle' 
                          ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                          : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                      )}
                    >
                      <div className="text-xs mb-1 font-bold">Single File Bundle</div>
                      <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Everything consolidated in a single C# file. Ready for drag-and-drop.</div>
                    </button>

                    <button 
                      onClick={() => { setCsExportMode('modular'); setCsSelectedFileIndex(0); }}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all cursor-pointer",
                        csExportMode === 'modular' 
                          ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                          : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                      )}
                    >
                      <div className="text-xs mb-1 font-bold">Modular Core & Engine</div>
                      <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Splits code into Core structures and separate Parser + Nodes files. Ideal for multi-parser projects.</div>
                    </button>
                  </div>
                </div>

                {csExportMode === 'modular' && (
                  <div className="pt-2">
                    <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 font-mono">AST Nodes Style</span>
                    <div className="grid grid-cols-1 gap-2">
                      <button 
                        onClick={() => { setCsAstSeparate(false); setCsSelectedFileIndex(0); }}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all cursor-pointer",
                          !csAstSeparate 
                            ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                            : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                        )}
                      >
                        <div className="text-xs mb-1 font-bold">Single AST File</div>
                        <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Contains all strongly-typed AST node classes in SyntaxEngine.AstNodes.cs.</div>
                      </button>

                      <button 
                        onClick={() => { setCsAstSeparate(true); setCsSelectedFileIndex(0); }}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all cursor-pointer",
                          csAstSeparate 
                            ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                            : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                        )}
                      >
                        <div className="text-xs mb-1 font-bold">Separate Node Files</div>
                        <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Generates individual C# file for every AST element sequentially.</div>
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-white/5 space-y-3">
                  <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 font-mono">Engine Enhancements</span>
                  <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Allman Braces</strong>: Every curly brace resides on a clean newline.</span>
                  </div>
                  <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Typed Node Enum</strong>: Fast Enum matching avoids slow runtime string routing.</span>
                  </div>
                  <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>String-Free Cache Key</strong>: Hash struct cache lookup bypasses allocations completely!</span>
                  </div>
                </div>
              </div>

              {/* Right Area: Code Tabs & Content Preview */}
              <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/40">
                {/* File Tabs Bar */}
                <div className="flex items-center justify-between border-b border-white/5 px-6 py-2 shrink-0 bg-black/15">
                  <div className="flex items-center gap-2 overflow-x-auto max-w-[65%] pb-1 pt-1.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                    {csGeneratedFiles.map((file, idx) => (
                      <button 
                        key={file.name}
                        onClick={() => setCsSelectedFileIndex(idx)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[11px] font-mono font-medium transition-all flex items-center gap-1.5 shrink-0 border cursor-pointer",
                          csSelectedFileIndex === idx 
                            ? "bg-white/10 border-white/10 text-white shadow-md font-bold" 
                            : "bg-transparent border-transparent text-slate-500 hover:text-slate-300"
                        )}
                      >
                        <FileCode className="w-3.5 h-3.5 text-slate-400" />
                        {file.name}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {csGeneratedFiles.length > 1 && (
                      <button 
                        onClick={downloadAllFiles}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Rocket className="w-3.5 h-3.5" /> Download All
                      </button>
                    )}
                    <button 
                      onClick={() => {
                        const file = csGeneratedFiles[csSelectedFileIndex];
                        if (file) {
                          navigator.clipboard.writeText(file.content);
                          setCopiedFileIndex(csSelectedFileIndex);
                          setTimeout(() => setCopiedFileIndex(null), 1500);
                        }
                      }}
                      className="px-3 py-1.5 bg-white/5 border border-white/15 hover:bg-white/10 text-slate-200 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedFileIndex === csSelectedFileIndex ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedFileIndex === csSelectedFileIndex ? 'Copied' : 'Copy'}
                    </button>
                    <button 
                      onClick={() => {
                        const file = csGeneratedFiles[csSelectedFileIndex];
                        if (file) downloadSingleFile(file.name, file.content);
                      }}
                      className="px-3 py-1.5 bg-white/5 border border-white/15 hover:bg-white/10 text-slate-200 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileCode className="w-3.5 h-3.5 text-indigo-400" /> Download
                    </button>
                  </div>
                </div>

                {/* Code Viewer Viewport */}
                <div className="flex-1 overflow-auto p-6 font-mono text-[11px] text-slate-300 select-text leading-relaxed bg-slate-950/80 custom-scrollbar">
                  {csGeneratedFiles[csSelectedFileIndex] ? (
                    <pre className="whitespace-pre overflow-auto font-mono text-[11px] select-all">
                      <code>{csGeneratedFiles[csSelectedFileIndex].content}</code>
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-600">No content available</div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

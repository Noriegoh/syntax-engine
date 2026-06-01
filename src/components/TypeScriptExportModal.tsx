import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Code2, X, Check, Copy, FileCode } from "lucide-react";

interface GeneratedFile {
  name: string;
  content: string;
}

interface TypeScriptExportModalProps {
  showTSModal: boolean;
  setShowTSModal: (val: boolean) => void;
  tsGeneratedFiles: GeneratedFile[];
  tsSelectedFileIndex: number;
  setTsSelectedFileIndex: (val: number) => void;
  downloadSingleFile: (name: string, content: string) => void;
  copiedFileIndex: number | null;
  setCopiedFileIndex: (val: number | null) => void;
}

export const TypeScriptExportModal: React.FC<TypeScriptExportModalProps> = ({
  showTSModal,
  setShowTSModal,
  tsGeneratedFiles,
  tsSelectedFileIndex,
  setTsSelectedFileIndex,
  downloadSingleFile,
  copiedFileIndex,
  setCopiedFileIndex,
}) => {
  return (
    <AnimatePresence>
      {showTSModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-lg flex items-center justify-center p-6"
          onClick={() => setShowTSModal(false)}
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
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
                  <Code2 className="text-orange-400 w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight leading-none mb-1">TypeScript Engine Export</h2>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-widest font-mono">Stand-alone TypeScript Parser & AST Classes</p>
                </div>
              </div>
              <button 
                onClick={() => setShowTSModal(false)}
                className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main Split Layout */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Drawer: Configuration Panel */}
              <div className="w-80 border-r border-white/5 bg-black/10 overflow-y-auto p-6 space-y-6 shrink-0">
                <div className="space-y-3">
                  <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 font-mono">Engine Enhancements</span>
                  <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>100% Dependency Free</strong>: Requires zero npm runtime packages. Pure TypeScript.</span>
                  </div>
                  <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Strongly Typed AST</strong>: Classes generated derived directly from grammar elements.</span>
                  </div>
                  <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Incremental Ready</strong>: Perfectly optimized for spatial-index parsing and lexing.</span>
                  </div>
                </div>
              </div>

              {/* Right Area: Code Tabs & Content Preview */}
              <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/40">
                {/* File Tabs Bar */}
                <div className="flex items-center justify-between border-b border-white/5 px-6 py-2 shrink-0 bg-black/15">
                  <div className="flex items-center gap-2 overflow-x-auto max-w-[65%] pb-1 pt-1.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                    {tsGeneratedFiles.map((file, idx) => (
                      <button 
                        key={file.name}
                        onClick={() => setTsSelectedFileIndex(idx)}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold border bg-white/10 border-white/10 text-white shadow-md flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <FileCode className="w-3.5 h-3.5 text-slate-400" />
                        {file.name}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      onClick={() => {
                        const file = tsGeneratedFiles[tsSelectedFileIndex];
                        if (file) {
                          navigator.clipboard.writeText(file.content);
                          setCopiedFileIndex(tsSelectedFileIndex);
                          setTimeout(() => setCopiedFileIndex(null), 1500);
                        }
                      }}
                      className="px-3 py-1.5 bg-white/5 border border-white/15 hover:bg-white/10 text-slate-200 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedFileIndex === tsSelectedFileIndex ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedFileIndex === tsSelectedFileIndex ? 'Copied' : 'Copy'}
                    </button>
                    <button 
                      onClick={() => {
                        const file = tsGeneratedFiles[tsSelectedFileIndex];
                        if (file) downloadSingleFile(file.name, file.content);
                      }}
                      className="px-3 py-1.5 bg-white/5 border border-white/15 hover:bg-white/10 text-slate-200 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileCode className="w-3.5 h-3.5 text-orange-400" /> Download
                    </button>
                  </div>
                </div>

                {/* Code Viewer Viewport */}
                <div className="flex-1 overflow-auto p-6 font-mono text-[11px] text-slate-300 select-text leading-relaxed bg-slate-950/80 custom-scrollbar">
                  {tsGeneratedFiles[tsSelectedFileIndex] ? (
                    <pre className="whitespace-pre overflow-auto font-mono text-[11px] select-all">
                      <code>{tsGeneratedFiles[tsSelectedFileIndex].content}</code>
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-600 font-sans">No content available</div>
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

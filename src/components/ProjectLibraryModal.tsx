import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { FolderOpen, X, FileCode, Terminal, Settings, Trash2, Plus } from "lucide-react";

interface SavedProject {
  id: string;
  name: string;
  grammar: string;
  input: string;
  scopeResolver?: string;
  ast?: string;
  updatedAt: number;
}

interface ProjectLibraryModalProps {
  showLibrary: boolean;
  setShowLibrary: (val: boolean) => void;
  savedProjects: SavedProject[];
  loadProject: (project: SavedProject) => void;
  deleteProject: (id: string, e: React.MouseEvent) => void;
  newProject: () => void;
}

export const ProjectLibraryModal: React.FC<ProjectLibraryModalProps> = ({
  showLibrary,
  setShowLibrary,
  savedProjects,
  loadProject,
  deleteProject,
  newProject,
}) => {
  return (
    <AnimatePresence>
      {showLibrary && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6"
          onClick={() => setShowLibrary(false)}
        >
          <motion.div 
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                   <FolderOpen className="text-indigo-400 w-5 h-5" />
                 </div>
                 <div>
                   <h2 className="text-xl font-bold text-white tracking-tight leading-none mb-1">Project Library</h2>
                   <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Saved Grammar Engines</p>
                 </div>
               </div>
               <button 
                onClick={() => setShowLibrary(false)}
                className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-slate-400 transition-colors"
               >
                 <X className="w-5 h-5" />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-3">
              {savedProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-4 opacity-50">
                  <FolderOpen className="w-12 h-12" />
                  <p className="text-sm font-medium">No projects saved yet.</p>
                </div>
              ) : (
                savedProjects.map((project) => (
                  <div 
                    key={project.id}
                    onClick={() => loadProject(project)}
                    className="group p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-indigo-500/50 hover:bg-white/[0.08] transition-all cursor-pointer flex items-center justify-between shadow-sm"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-indigo-500/20 group-hover:border-indigo-500/30 transition-all">
                         <FileCode className="w-6 h-6 text-slate-400 group-hover:text-indigo-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-200 mb-0.5 group-hover:text-white transition-colors">{project.name}</h3>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 font-medium uppercase tracking-widest">
                          <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> {project.grammar?.length || 0} chars</span>
                          <span className="flex items-center gap-1"><Settings className="w-3 h-3" /> {new Date(project.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => deleteProject(project.id, e)}
                      className="p-2 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-white/5 bg-white/[0.01] flex justify-center">
               <button 
                onClick={newProject}
                className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-widest border border-white/10 transition-all flex items-center gap-2"
               >
                 <Plus className="w-4 h-4" /> Start New Project
               </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

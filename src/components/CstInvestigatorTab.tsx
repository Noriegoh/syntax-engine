import React from 'react';
import { Search, Layers, MousePointer } from 'lucide-react';
import { cn } from '../lib/utils';

interface CstInvestigatorTabProps {
  debouncedTestInput: string;
  pinnedOffset: number | null;
  setPinnedOffset: (val: number | null) => void;
  hoveredOffset: number | null;
  setHoveredOffset: (val: number | null) => void;
  investigateHoveredNode: any;
  setInvestigateHoveredNode: (node: any) => void;
  debouncedInvestigateOffset: number | null;
  parseResult: any;
  setSelectedCstNode: (node: any) => void;
}

export const CstInvestigatorTab: React.FC<CstInvestigatorTabProps> = ({
  debouncedTestInput,
  pinnedOffset,
  setPinnedOffset,
  hoveredOffset,
  setHoveredOffset,
  investigateHoveredNode,
  setInvestigateHoveredNode,
  debouncedInvestigateOffset,
  parseResult,
  setSelectedCstNode,
}) => {
  const code = debouncedTestInput || "";
  const lines = code.split("\n");
  let absoluteOffset = 0;

  // Highlight ranges of nodes hovered in investigator sidebar
  const extraHighlightStart = investigateHoveredNode?.offset ?? -1;
  const extraHighlightEnd = extraHighlightStart + (investigateHoveredNode?.width ?? 0);

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden text-slate-300 bg-[#0e0e11]/80 backdrop-blur-xl">
      {/* Left Side: Interactive Char Monospace Grid */}
      <div className="w-full md:w-1/2 border-b md:border-b-0 md:border-r border-white/5 flex flex-col overflow-hidden bg-black/50">
        <div className="p-3 bg-white/[0.01] border-b border-white/5 flex items-center justify-between select-none">
          <div className="flex items-center gap-1.5 flex-1">
            <Search className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Hover Code Matrix
            </span>
          </div>
          <div className="flex items-center gap-2">
            {pinnedOffset !== null && (
              <button
                onClick={() => setPinnedOffset(null)}
                className="px-2 py-0.5 text-[8.5px] font-bold bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30 hover:bg-indigo-500/30 transition-all flex items-center gap-1 cursor-pointer"
              >
                Unpin Offset ({pinnedOffset})
              </button>
            )}
            <span className="text-[9.5px] font-mono text-slate-500">
              Offset: <strong className="text-emerald-400 font-bold">{pinnedOffset ?? hoveredOffset ?? 0}</strong>
            </span>
          </div>
        </div>

        <div className="flex-1 p-3 overflow-auto custom-scrollbar font-mono bg-black/20 select-none">
          {lines.map((line, lineIdx) => {
            const chars = Array.from(line);
            const lineStartOffset = absoluteOffset;
            absoluteOffset += line.length + 1; // including \n

            return (
              <div key={lineIdx} className="flex hover:bg-white/[0.02] py-[1.5px] leading-relaxed transition-all min-h-[22px]">
                {/* Line Gutter */}
                <div className="w-8 shrink-0 text-[10px] font-mono text-slate-600 border-r border-white/5 pr-2 select-none text-right">
                  {lineIdx + 1}
                </div>
                <div className="flex pl-2.5 font-mono text-[12.5px] flex-wrap">
                  {chars.map((char, charIdx) => {
                    const charOffset = lineStartOffset + charIdx;
                    const isCharHovered = charOffset === hoveredOffset;
                    const isPinned = charOffset === pinnedOffset;
                    const isInInvestigateRange = charOffset >= extraHighlightStart && charOffset < extraHighlightEnd;

                    return (
                      <span
                        key={charIdx}
                        onMouseEnter={() => setHoveredOffset(charOffset)}
                        onMouseLeave={() => setHoveredOffset(null)}
                        onClick={() => {
                          if (pinnedOffset === charOffset) {
                            setPinnedOffset(null);
                          } else {
                            setPinnedOffset(charOffset);
                          }
                        }}
                        className={cn(
                          "cursor-crosshair font-mono px-[0.5px] rounded transition-all select-none",
                          isPinned 
                            ? "bg-amber-500/40 text-amber-100 ring-2 ring-amber-500 outline-none font-bold"
                            : isCharHovered 
                            ? "bg-indigo-500/30 text-indigo-100 outline outline-1 outline-indigo-500 font-bold scale-[1.05] relative z-10 shadow-lg"
                            : isInInvestigateRange
                            ? "bg-emerald-500/25 text-emerald-200 border-b-2 border-emerald-400"
                            : "text-slate-300 hover:bg-white/10"
                        )}
                      >
                        {char === ' ' ? '\u00A0' : char}
                      </span>
                    );
                  })}
                  {line.length === 0 && (
                    <span 
                      onMouseEnter={() => setHoveredOffset(lineStartOffset)}
                      onMouseLeave={() => setHoveredOffset(null)}
                      onClick={() => {
                        if (pinnedOffset === lineStartOffset) setPinnedOffset(null);
                        else setPinnedOffset(lineStartOffset);
                      }}
                      className={cn(
                        "text-slate-600/35 italic text-[10px] select-none cursor-crosshair pl-1 transition-all rounded",
                        pinnedOffset === lineStartOffset ? "bg-amber-500/20 text-amber-300" :
                        hoveredOffset === lineStartOffset ? "bg-white/10 text-slate-400" : ""
                      )}
                    >
                      ¶
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Side: Resolved Rule Stack */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/40 p-3">
        <div className="p-1 mb-2 select-none">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Rule Stack Encompassed
          </div>
          <p className="text-[10px] text-slate-500 leading-normal">
            Move cursor over characters or click to pin. The rule hierarchy matching that position is resolved bottom-up.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 mt-2">
          {(() => {
            const currentOffset = pinnedOffset ?? debouncedInvestigateOffset;
            if (currentOffset === null) {
              return (
                <div className="h-full flex flex-col items-center justify-center p-6 text-slate-500/60 font-mono text-[11px] text-center italic leading-relaxed border border-dashed border-white/5 rounded-xl m-2 bg-black/10 select-none">
                  <MousePointer className="w-5 h-5 text-indigo-400/40 animate-bounce mb-2" />
                  <span>Hover over the code matrix to trace matching rules!</span>
                </div>
              );
            }

            // Recursive rule gatherer
            const matching: any[] = [];
            const findMatching = (node: any) => {
              if (!node || typeof node !== 'object') return;
              const start = node.offset;
              const width = node.width;
              if (typeof start !== 'number' || typeof width !== 'number') return;
              const end = start + width;
              if (currentOffset >= start && currentOffset < end) {
                matching.push(node);
                const val = node.value;
                if (Array.isArray(val)) {
                  for (const child of val) {
                    findMatching(child);
                  }
                } else if (val && typeof val === 'object') {
                  findMatching(val);
                }
              }
            };

            if (parseResult) {
              findMatching(parseResult);
            }

            if (matching.length === 0) {
              return (
                <div className="p-4 rounded-xl bg-slate-900 border border-white/5 text-slate-500 font-mono text-[10.5px] italic text-center select-none">
                  No grammatical rules matched at offset {currentOffset}.
                </div>
              );
            }

            return (
              <div className="space-y-2 select-text p-1">
                {matching.map((node, index) => {
                  const length = node.width;
                  const snippet = debouncedTestInput.substring(node.offset, node.offset + length);
                  const collapsedSnippet = snippet.length > 120 ? snippet.substring(0, 120) + "..." : snippet;
                  const isLeaf = !Array.isArray(node.value) && typeof node.value !== 'object';

                  return (
                    <div 
                      key={index}
                      onMouseEnter={() => setInvestigateHoveredNode(node)}
                      onMouseLeave={() => setInvestigateHoveredNode(null)}
                      onClick={() => {
                        setSelectedCstNode(node);
                      }}
                      className={cn(
                        "group p-3 rounded-xl border font-mono transition-all flex flex-col gap-2 cursor-pointer relative shadow-sm",
                        isLeaf ? "bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/15" : "bg-black/30 hover:bg-white/[0.02] border-white/5 hover:border-indigo-500/30"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border leading-none shadow-sm",
                            isLeaf 
                              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" 
                              : "bg-[#4f46e5]/15 border-[#4f46e5]/30 text-indigo-300"
                          )}>
                            {node.type || `rule-${node.ruleId}`}
                          </span>
                          <span className="text-[10px] text-slate-600 font-extrabold select-none">
                            #{node.green?.id || node.id || ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 select-none">
                          <span className="text-[8.5px] font-mono text-indigo-400 bg-indigo-400/5 px-2 py-0.5 border border-indigo-400/15 rounded-md">
                            range: {node.offset} - {node.offset + length}
                          </span>
                          <span className="text-[8.5px] font-mono text-slate-500 bg-black/40 px-1.5 py-0.5 border border-white/5 rounded-md">
                            width: {length}
                          </span>
                        </div>
                      </div>

                      <div className="text-[10.5px] font-mono text-slate-300 bg-black/40 px-2 py-1 border border-white/5 rounded-md leading-relaxed whitespace-pre truncate max-h-[85px] overflow-hidden">
                        {collapsedSnippet}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

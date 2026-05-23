import React, { useMemo, useState } from "react";
import { 
  Timer, 
  Flame, 
  Search, 
  SlidersHorizontal, 
  ChevronRight, 
  Info, 
  Sparkles, 
  ZoomIn, 
  TrendingUp, 
  BookOpen, 
  ChevronDown, 
  TrendingDown, 
  ArrowUpDown
} from "lucide-react";

/**
 * Types for Parser Profiler
 */
export interface PerformanceNode {
  name: string;
  id: number;
  offset: number;
  duration: number; // in ms
  selfTime: number; // in ms
  cacheHit: boolean;
  children: PerformanceNode[];
  // Preprocessed absolute timelines
  absStart?: number;
  absEnd?: number;
}

interface ParserProfilerProps {
  profileRoot: PerformanceNode | null;
  testInput: string;
  parseDuration: number;
  cacheStats: {
    hits: number;
    misses: number;
    size: number;
  };
}

/**
 * Basic stable color hash for rule names
 */
function getRuleColor(name: string, isHeatMode: boolean, selfTime: number, duration: number): string {
  if (isHeatMode) {
    // Heat color: from soft golden yellow (0ms selfTime) to blazing crimson red (long selfTime)
    // Map selfTime to heat ratio [0, 1]
    const maxVal = 0.5; // nodes taking >= 0.5ms selfTime are max hot
    const ratio = Math.min(1, selfTime / maxVal);
    // HSL: 50 (gold/yellow) -> 0 (red) -> -10 (deep crimson)
    const hue = Math.max(0, 50 - ratio * 55);
    const lightness = Math.max(30, 60 - ratio * 20);
    const saturation = 75 + ratio * 20;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  } else {
    // Rule based consistent pastel hashing
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 42%)`;
  }
}

export function ParserProfiler({ profileRoot, testInput, parseDuration, cacheStats }: ParserProfilerProps) {
  const [activeSubTab, setActiveSubTab] = useState<"flame" | "culprits">("flame");
  const [colorMode, setColorMode] = useState<"rule" | "heat">("rule");
  const [searchQuery, setSearchQuery] = useState("");
  const [minDuration, setMinDuration] = useState<number>(0); // hide nodes below X ms
  const [hoveredNode, setHoveredNode] = useState<PerformanceNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<PerformanceNode | null>(null);
  const [sortKey, setSortKey] = useState<"totalTime" | "selfTime" | "count" | "name">("totalTime");
  const [sortAsc, setSortAsc] = useState(false);

  // 1. Traverse and assign absolute start and end times to the tree
  const processedRoot = useMemo(() => {
    if (!profileRoot) return null;
    
    // Create a deep copy of the tree to prevent mutating original state directly
    const copyTree = (node: PerformanceNode): PerformanceNode => {
      return {
        ...node,
        children: node.children.map(copyTree)
      };
    };

    const rootCopy = copyTree(profileRoot);

    const assignTimelines = (node: PerformanceNode, absStart: number) => {
      node.absStart = absStart;
      let currentAbs = absStart;
      for (const child of node.children) {
        assignTimelines(child, currentAbs);
        currentAbs += child.duration;
      }
      node.absEnd = absStart + node.duration;
    };

    assignTimelines(rootCopy, 0);
    return rootCopy;
  }, [profileRoot]);

  // Keep track of parent navigation path for selected zoomed node
  const [zoomStack, setZoomStack] = useState<PerformanceNode[]>([]);
  const currentZoomNode = zoomStack[zoomStack.length - 1] || processedRoot;

  // Whenever root changes, reset zooms
  React.useEffect(() => {
    setZoomStack([]);
    setSelectedNode(null);
    setHoveredNode(null);
  }, [processedRoot]);

  // 2. Compute aggregate rule stats (Culprits)
  const aggregatedStats = useMemo(() => {
    if (!profileRoot) return [];
    
    const statsMap = new Map<string, { 
      name: string; 
      id: number; 
      count: number; 
      totalTime: number; 
      selfTime: number; 
      cacheHits: number; 
    }>();

    const traverse = (node: PerformanceNode) => {
      let stats = statsMap.get(node.name);
      if (!stats) {
        stats = { name: node.name, id: node.id, count: 0, totalTime: 0, selfTime: 0, cacheHits: 0 };
        statsMap.set(node.name, stats);
      }
      stats.count += 1;
      stats.totalTime += node.duration;
      stats.selfTime += node.selfTime;
      if (node.cacheHit) {
        stats.cacheHits += 1;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(profileRoot);
    return Array.from(statsMap.values());
  }, [profileRoot]);

  // Sorted aggregate statistics
  const sortedStats = useMemo(() => {
    return [...aggregatedStats].sort((a, b) => {
      let aVal: any = a[sortKey];
      let bVal: any = b[sortKey];
      if (typeof aVal === "string") {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
  }, [aggregatedStats, sortKey, sortAsc]);

  // 3. Build level list (rows) of the visual tree relative to the zoomed root
  const { visibleRows, totalCallsCount } = useMemo(() => {
    if (!currentZoomNode) return { visibleRows: [] as PerformanceNode[][], totalCallsCount: 0 };

    const rows: PerformanceNode[][] = [];
    let callsCount = 0;

    const traverse = (node: PerformanceNode, depth: number) => {
      callsCount++;
      if (depth >= 30) return; // limit depth to avoid excessive rows
      
      if (!rows[depth]) {
        rows[depth] = [];
      }
      rows[depth].push(node);

      for (const child of node.children) {
        // Only recurse if the child intersects or is fully nested (which it is since it's hierarchical)
        traverse(child, depth + 1);
      }
    };

    traverse(currentZoomNode, 0);
    return { visibleRows: rows, totalCallsCount: callsCount };
  }, [currentZoomNode]);

  // Change sort parameters
  const handleSort = (key: "totalTime" | "selfTime" | "count" | "name") => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  // Safe source preview extraction
  const getSnippet = (offset: number, duration: number) => {
    if (!testInput) return "";
    const cleanOffset = Math.max(0, Math.min(testInput.length, offset));
    // Sample up to 60 characters
    const len = 60;
    const snippet = testInput.substring(cleanOffset, cleanOffset + len);
    return snippet.length >= len ? snippet + "..." : snippet;
  };

  // Zoom into a specific node
  const handleNodeZoom = (node: PerformanceNode) => {
    if (node === currentZoomNode) return;
    
    // Find path in actual tree to set the navigation stack
    const path: PerformanceNode[] = [];
    const findPath = (curr: PerformanceNode, target: PerformanceNode): boolean => {
      path.push(curr);
      if (curr === target) return true;
      for (const child of curr.children) {
        if (findPath(child, target)) return true;
      }
      path.pop();
      return false;
    };

    if (processedRoot) {
      findPath(processedRoot, node);
      setZoomStack(path);
    }
  };

  // Zoom out to a stack level
  const handlePopZoom = (index: number) => {
    if (index === -1) {
      setZoomStack([]);
    } else {
      setZoomStack(zoomStack.slice(0, index + 1));
    }
    setSelectedNode(null);
    setHoveredNode(null);
  };

  if (!profileRoot) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-500 text-center select-none gap-4">
        <div className="p-4 rounded-full bg-slate-900 border border-white/5 animate-pulse text-indigo-400">
          <Timer className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">No Profiling Data Available</h3>
          <p className="text-[10px] text-slate-500 mt-1 max-w-xs">
            Edit your input or ensure your parser rules compile to execute profiling trace logs.
          </p>
        </div>
      </div>
    );
  }

  // Active duration to compute percentages against
  const entireDuration = processedRoot?.duration || 1;
  const zoomDuration = currentZoomNode?.duration || 1;

  return (
    <div className="flex flex-col h-full overflow-hidden select-none text-slate-300">
      
      {/* 1. Perf Tabs Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-slate-950/60 shrink-0 gap-2">
        <div className="flex bg-white/5 rounded-md border border-white/15 p-0.5">
          <button
            onClick={() => setActiveSubTab("flame")}
            className={`px-3 py-1 text-[9px] font-bold uppercase tracking-wider transition-all rounded flex items-center gap-1.5 ${
              activeSubTab === "flame"
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
          >
            <Flame className="w-3 h-3 text-orange-400" /> Flame Graph
          </button>
          <button
            onClick={() => setActiveSubTab("culprits")}
            className={`px-3 py-1 text-[9px] font-bold uppercase tracking-wider transition-all rounded flex items-center gap-1.5 ${
              activeSubTab === "culprits"
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
          >
            <Timer className="w-3 h-3 text-rose-400" /> Culprit Rules
          </button>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Time: <strong className="text-white">{parseDuration.toFixed(2)} ms</strong></span>
          </div>
          <div className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1">
            <span>Hits: <strong className="text-emerald-300">{cacheStats.hits}</strong></span>
            <span>/</span>
            <span>Misses: <strong className="text-rose-400">{cacheStats.misses}</strong></span>
          </div>
        </div>
      </div>

      {/* 2. Top Banner / Controls */}
      <div className="px-4 py-3 border-b border-white/5 bg-white/[0.01] shrink-0 flex flex-wrap items-center justify-between gap-4">
        
        {/* Flame graph subtab controls */}
        {activeSubTab === "flame" ? (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter by rule name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-900 border border-white/10 rounded px-2.5 pl-7 py-1 text-[10px] w-48 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10 placeholder:text-slate-600 font-mono"
                />
              </div>

              {/* Threshold Slider */}
              <div className="flex items-center gap-2 border border-white/5 bg-slate-950/40 rounded px-2 py-0.5">
                <SlidersHorizontal className="w-3 h-3 text-slate-500" />
                <span className="text-[9px] text-slate-400 uppercase font-black tracking-widest whitespace-nowrap">Threshold:</span>
                <input
                  type="range"
                  min="0"
                  max={Math.min(2, entireDuration).toFixed(2)}
                  step="0.01"
                  value={minDuration}
                  onChange={(e) => setMinDuration(parseFloat(e.target.value))}
                  className="w-20 accent-indigo-500 h-1 rounded cursor-pointer"
                />
                <span className="text-[10px] font-mono text-white whitespace-nowrap">{minDuration.toFixed(2)}ms</span>
              </div>

              {/* Color Toggles */}
              <div className="flex bg-slate-900 rounded p-0.5 border border-white/10 font-mono text-[9px]">
                <button
                  onClick={() => setColorMode("rule")}
                  className={`px-2 py-0.5 rounded transition ${
                    colorMode === "rule" ? "bg-white/10 text-white font-bold" : "text-slate-500 hover:text-slate-300"
                  }`}
                  title="Consistent colors per rule name"
                >
                  Pastel
                </button>
                <button
                  onClick={() => setColorMode("heat")}
                  className={`px-2 py-0.5 rounded transition ${
                    colorMode === "heat" ? "bg-orange-500/20 text-orange-400 font-bold" : "text-slate-500 hover:text-slate-300"
                  }`}
                  title="Heat colors (Red represents high execution selfTime)"
                >
                  Heat (Self)
                </button>
              </div>
            </div>

            {/* Hint */}
            <div className="text-[9px] bg-slate-900/60 border border-white/5 text-slate-400 px-3 py-1 rounded flex items-center gap-1.5 max-w-sm">
              <Info className="w-3 h-3 text-indigo-400 shrink-0" />
              <span>Click a rule to zoom, double click to lock, select to inspect sub-ranges!</span>
            </div>
          </>
        ) : (
          /* Aggregate subtab content summary */
          <div className="flex items-center gap-3 justify-between w-full">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-extrabold flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-indigo-400" /> Aggregate parser breakdown showing cumulative consumption per syntax rule
            </div>
            <span className="text-[9px] bg-indigo-505/20 text-indigo-300 px-2 py-0.5 rounded font-mono">
              Total aggregated rules: {aggregatedStats.length}
            </span>
          </div>
        )}
      </div>

      {/* 3. Main Content Panes */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#070708]">
        
        {/* FLAME GRAPH TAB */}
        {activeSubTab === "flame" ? (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative select-none">
            
            {/* Navigational Breadcrumbs */}
            <div className="px-4 py-1.5 bg-black/30 border-b border-white/5 text-[9px] font-mono flex items-center gap-1 overflow-x-auto whitespace-nowrap custom-scrollbar text-slate-500 shrink-0 select-none">
              <span className="uppercase tracking-widest font-black text-indigo-400 shrink-0">Zoom Context:</span>
              <button 
                onClick={() => handlePopZoom(-1)}
                className={`hover:text-white transition-colors underline decoration-dashed shrink-0 ${!zoomStack.length ? "text-indigo-300 font-black" : ""}`}
              >
                Root ({entireDuration.toFixed(3)}ms)
              </button>
              
              {zoomStack.map((node, index) => {
                const isLast = index === zoomStack.length - 1;
                return (
                  <React.Fragment key={index}>
                    <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />
                    <button
                      disabled={isLast}
                      onClick={() => handlePopZoom(index)}
                      className={`hover:text-white transition-colors underline decoration-dashed truncate max-w-[120px] shrink-0 ${
                        isLast ? "text-indigo-300 font-extrabold no-underline" : ""
                      }`}
                    >
                      {node.name} ({node.duration.toFixed(3)}ms)
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Flame/Icicle Chart Scroll Container */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 custom-scrollbar flex flex-col gap-0.5">
              
              {visibleRows.length > 0 ? (
                visibleRows.map((row, level) => {
                  const hasVisibleBlocks = row.some(node => {
                    const absStart = node.absStart ?? 0;
                    const absEnd = node.absEnd ?? 0;
                    const zoomStart = currentZoomNode?.absStart ?? 0;
                    const zoomEnd = currentZoomNode?.absEnd ?? 0;
                    
                    // Filter: Intersects with zoom window or is the zoomNode itself
                    const intersects = absEnd > zoomStart && absStart < zoomEnd;
                    if (!intersects) return false;
                    
                    // Filter: Min duration threshold or matched search
                    if (node.duration < minDuration) {
                      const mat = searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());
                      if (!mat) return false;
                    }
                    return true;
                  });

                  // If no blocks in this row are visible, still render a tiny row helper of height 0 or skip
                  if (!hasVisibleBlocks && level !== 0) return null;

                  return (
                    <div 
                      key={level} 
                      className="relative h-6.5 w-full flex items-center border border-white/[0.02] bg-white/[0.01] rounded overflow-hidden"
                    >
                      {/* Depth Label */}
                      <span className="absolute left-1.5 text-[8px] font-mono font-black text-slate-800 tracking-tighter select-none pointer-events-none z-10 uppercase">
                        D{level}
                      </span>
                      
                      {row.map((node, nodeIdx) => {
                        const absStart = node.absStart ?? 0;
                        const absEnd = node.absEnd ?? 0;
                        const zoomStart = currentZoomNode?.absStart ?? 0;
                        const zoomEnd = currentZoomNode?.absEnd ?? 0;

                        // Calculate bounds check
                        const intersects = absEnd > zoomStart && absStart < zoomEnd;
                        if (!intersects) return null;

                        // Check search filter matches
                        const isSearchMatch = searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());
                        
                        // Check duration filter
                        if (node.duration < minDuration && !isSearchMatch) return null;

                        // Coordinates relative to zoom window
                        const relStart = Math.max(0, absStart - zoomStart);
                        const relEnd = Math.min(zoomDuration, absEnd - zoomStart);
                        const relDuration = relEnd - relStart;

                        // Percentages for css left/width
                        const leftPct = (relStart / zoomDuration) * 100;
                        const widthPct = (relDuration / zoomDuration) * 100;

                        // Clip extremely fine blocks
                        if (widthPct < 0.04) return null;

                        const isHovered = hoveredNode === node;
                        const isSelected = selectedNode === node;
                        const colorStr = getRuleColor(node.name, colorMode === "heat", node.selfTime, node.duration);

                        return (
                          <div
                            key={nodeIdx}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              backgroundColor: colorStr
                            }}
                            className={`absolute h-full border-r border-black/20 text-white rounded-[2px] cursor-pointer transition-all duration-150 flex items-center justify-between px-2 overflow-hidden select-none hover:brightness-125 hover:z-20 ${
                              isHovered ? "ring-1 ring-white/60 shadow-lg scale-y-[1.05]" : ""
                            } ${
                              isSelected ? "ring-2 ring-indigo-400 bg-indigo-700/80 brightness-150 shadow-2xl z-30 font-black" : ""
                            } ${
                              isSearchMatch ? "ring-1 ring-amber-400 brightness-110 shadow-lg" : ""
                            }`}
                            onMouseEnter={() => setHoveredNode(node)}
                            onMouseLeave={() => setHoveredNode(null)}
                            onClick={() => setSelectedNode(node)}
                            onDoubleClick={() => handleNodeZoom(node)}
                          >
                            <span className={`text-[9px] font-bold font-mono tracking-tight text-white/95 truncate ${isSearchMatch ? "text-amber-200" : ""}`}>
                              {node.name}
                            </span>
                            <span className="text-[8px] font-mono opacity-80 pl-1 shrink-0">
                              {node.duration.toFixed(2)}ms
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                <div className="p-12 text-slate-600 italic text-center text-xs">Could not build visible rows trace</div>
              )}
            </div>

            {/* Dynamic Card / Hover Inspector */}
            {(() => {
              const activeNode = hoveredNode || selectedNode;
              if (!activeNode) {
                return (
                  <div className="h-28 border-t border-white/5 bg-slate-950/40 p-4 shrink-0 flex items-center justify-center text-slate-600 italic text-[10px] select-none uppercase tracking-widest gap-2">
                    <Timer className="w-4 h-4 text-slate-700" /> Hover or Select any block to inspect full trace stats and character snippets
                  </div>
                );
              }
              const percentageOverall = ((activeNode.duration / entireDuration) * 100).toFixed(1);
              const percentageZoom = ((activeNode.duration / zoomDuration) * 100).toFixed(1);
              const codeString = getSnippet(activeNode.offset, activeNode.duration);

              return (
                <div className="h-28 border-t border-white/5 bg-[#0b0c0f] p-4 shrink-0 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-y-auto custom-scrollbar select-text">
                  <div className="flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-rose-300 font-mono tracking-tight bg-white/5 px-2 py-0.5 rounded border border-white/10">
                          {activeNode.name}
                        </span>
                        <span className="text-[9px] text-slate-500 font-mono lowercase">RULE ID: #{activeNode.id}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono mt-1.5 flex items-center gap-2">
                        <span>Offset: <strong>{activeNode.offset} &rarr; {activeNode.offset + Math.max(1, codeString.length)}</strong></span>
                        {activeNode.cacheHit && (
                          <span className="bg-emerald-500/15 text-emerald-300 font-bold px-1.5 py-0 rounded text-[9px] border border-emerald-500/30 uppercase tracking-tighter">
                            Memo Hit
                          </span>
                        )}
                      </p>
                    </div>
                    {hoveredNode && selectedNode && hoveredNode !== selectedNode && (
                      <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">Previewing hovered node • Click locked node to lock</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="bg-white/[0.01] p-1.5 rounded border border-white/5 flex flex-col justify-center">
                      <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest leading-none">Total Duration</span>
                      <span className="text-white text-xs font-black mt-1">
                        {activeNode.duration.toFixed(3)} ms 
                        <span className="text-slate-500 text-[9px] font-normal ml-1">({percentageOverall}%)</span>
                      </span>
                    </div>
                    <div className="bg-white/[0.01] p-1.5 rounded border border-white/5 flex flex-col justify-center">
                      <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest leading-none">Self Time</span>
                      <span className="text-indigo-300 text-xs font-black mt-1">
                        {activeNode.selfTime.toFixed(3)} ms 
                        <span className="text-slate-500 text-[9px] font-normal ml-1">({((activeNode.selfTime/entireDuration)*100).toFixed(1)}%)</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col justify-between">
                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest leading-none mb-1">Snippet Preview</span>
                    <div className="flex-1 bg-black/60 p-2 rounded border border-white/5 max-h-16 overflow-y-auto font-mono text-[10px] whitespace-pre-wrap text-emerald-400 break-all leading-normal custom-scrollbar bg-[#161618]">
                      {codeString ? `"${codeString}"` : <span className="text-slate-600 italic">Empty token/literal match</span>}
                    </div>
                  </div>
                </div>
              );
            })()}

          </div>
        ) : (
          
          /* CULPRITS AGGREGATE BREAKDOWN TABLE */
          <div className="flex-1 overflow-auto p-4 custom-scrollbar select-text">
            <table className="w-full text-left text-xs text-slate-400 select-text">
              <thead>
                <tr className="border-b border-white/10 text-[9px] font-black uppercase tracking-widest text-slate-500">
                  <th className="py-2.5 px-3 cursor-pointer hover:text-white" onClick={() => handleSort("name")}>
                    <span className="flex items-center gap-1.5">Rule Name <ArrowUpDown className="w-3 h-3 text-slate-600" /></span>
                  </th>
                  <th className="py-2.5 px-3 cursor-pointer hover:text-white text-right" onClick={() => handleSort("count")}>
                    <span className="flex items-center gap-1.5 justify-end">Call Count <ArrowUpDown className="w-3 h-3 text-slate-600" /></span>
                  </th>
                  <th className="py-2.5 px-3 cursor-pointer hover:text-white text-right" onClick={() => handleSort("totalTime")}>
                    <span className="flex items-center gap-1.5 justify-end">Cumulative Duration <ArrowUpDown className="w-3 h-3 text-slate-700" /></span>
                  </th>
                  <th className="py-2.5 px-3 cursor-pointer hover:text-white text-right" onClick={() => handleSort("selfTime")}>
                    <span className="flex items-center gap-1.5 justify-end">Cumulative Self Time <ArrowUpDown className="w-3 h-3 text-slate-700" /></span>
                  </th>
                  <th className="py-2.5 px-3 hover:text-white text-right">
                    <span>Self %</span>
                  </th>
                  <th className="py-2.5 px-3 hover:text-white text-right">
                    <span>Cache Hits (Hits %)</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedStats.map((stat, idx) => {
                  const selfPercent = ((stat.selfTime / entireDuration) * 100);
                  const hitPct = stat.count > 0 ? (stat.cacheHits / stat.count) * 100 : 0;
                  
                  return (
                    <tr 
                      key={idx} 
                      className="hover:bg-white/[0.02] border-b border-white/[0.02] cursor-pointer"
                      onClick={() => {
                        // Click jumps to flamegraph & filters matching rule name!
                        setSearchQuery(stat.name);
                        setActiveSubTab("flame");
                      }}
                      title="Click to locate inside the flame graph"
                    >
                      <td className="py-3 px-3">
                        <span className="font-bold text-rose-300 font-mono text-xs">{stat.name}</span>
                        <span className="text-[10px] text-slate-600 block">ID: #{stat.id}</span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-300">
                        {stat.count.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-400 font-extrabold text-xs">
                        {stat.totalTime.toFixed(3)} ms
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-indigo-300 font-extrabold text-xs">
                        {stat.selfTime.toFixed(3)} ms
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        <div className="flex items-center gap-2 justify-end">
                          <span className={`${selfPercent > 10 ? "text-rose-400 font-black" : "text-slate-500"}`}>{selfPercent.toFixed(1)}%</span>
                          <div className="w-12 h-1.5 bg-slate-900 rounded overflow-hidden">
                            <div className="h-full bg-indigo-505 bg-indigo-500" style={{ width: `${selfPercent}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-[11px]">
                        <span className={stat.cacheHits > 0 ? "text-emerald-400 font-bold" : "text-slate-500"}>
                          {stat.cacheHits}
                        </span>
                        <span className="text-slate-600 text-[10px] ml-1">({hitPct.toFixed(0)}%)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}

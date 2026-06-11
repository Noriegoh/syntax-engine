import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface CstVisualizerProps {
  node: any;
  selectedCstNode: any;
  setSelectedCstNode: (node: any) => void;
  hoveredCstNode: any;
  setHoveredCstNode: (node: any) => void;
  depth?: number;
  isLast?: boolean;
  path?: string;
}

export const CstVisualizer: React.FC<CstVisualizerProps> = ({
  node,
  selectedCstNode,
  setSelectedCstNode,
  hoveredCstNode,
  setHoveredCstNode,
  depth = 0,
  isLast = true,
  path = "root"
}) => {
  if (!node) return null;
  
  // Handle primitive nodes (strings/numbers/booleans) directly
  if (typeof node !== 'object') {
    return (
      <div key={path} className="p-2 px-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl text-[11px] font-mono text-emerald-300/90 inline-block shadow-sm">
         {String(node)}
      </div>
    );
  }

  let type = node.type;
  let value = node.value;
  if (value === undefined && node.children !== undefined) {
    value = node.children;
  } else if (value === undefined && node.data !== undefined) {
    value = node.data;
  }
  
  if (!type && !value) {
    const keys = Object.keys(node).filter(k => k !== 'ruleId');
    if (keys.length === 1) {
      type = keys[0];
      value = node[keys[0]];
    }
  }

  if (type === 'error_node') {
    const isSelected = selectedCstNode === node;
    const isHovered = hoveredCstNode === node;

    return (
      <motion.div 
        key={path} 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          setSelectedCstNode(node);
        }}
        onMouseEnter={(e: React.MouseEvent) => {
          e.stopPropagation();
          setHoveredCstNode(node);
        }}
        onMouseLeave={() => {
          setHoveredCstNode(null);
        }}
        className={cn(
          "p-3.5 bg-red-500/10 border rounded-xl flex items-start gap-3 max-w-[320px] shadow-lg shadow-red-500/5 relative group cursor-pointer transition-all text-left",
          isSelected ? "border-red-500 ring-2 ring-red-500/30 bg-red-500/20" : "border-red-500/40 hover:border-red-500/80",
          isHovered ? "bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)] border-red-400" : ""
        )}
      >
        <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        <div className="flex flex-col">
          <span className="text-[8px] font-black uppercase tracking-widest text-red-400 mb-1">RECOVERED ERROR NODE</span>
          <span className="text-[11px] font-mono text-red-100/80 leading-relaxed italic truncate max-w-[240px]">
            {node.message}
          </span>
          <span className="text-[8px] font-bold text-red-400/50 mt-2 uppercase tracking-tighter">
            Panic Recovery offset {node.start}..{node.end}
          </span>
        </div>
      </motion.div>
    );
  }

  const isArray = Array.isArray(value);
  const isLeaf = !isArray && typeof value !== 'object';
  const isSelected = selectedCstNode === node;
  const isHovered = hoveredCstNode === node;
  
  // Extract list of children nodes
  let children: any[] = [];
  if (isArray) {
    children = value.filter(n => n !== null && n !== undefined);
  } else if (typeof value === 'object' && value !== null) {
    children = [value];
  }

  const hasChildren = children.length > 0;

  return (
    <div key={path} className="flex flex-col items-center relative">
      {/* Main Node Box */}
      <div 
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          setSelectedCstNode(node);
        }}
        onMouseEnter={(e: React.MouseEvent) => {
          e.stopPropagation();
          setHoveredCstNode(node);
        }}
        onMouseLeave={() => {
          setHoveredCstNode(null);
        }}
        className={cn(
          "inline-flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all border group shadow-md relative z-10 cursor-pointer min-w-[124px] justify-center text-center",
          isLeaf ? "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/15" : "bg-black/80 border-white/10 hover:bg-white/[0.08]",
          isSelected ? "ring-2 ring-indigo-500 bg-indigo-500/20 border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.35)]" : "hover:border-indigo-500/40",
          isHovered ? "border-indigo-400 bg-indigo-950/40 shadow-[0_0_15px_rgba(99,102,241,0.25)]" : ""
        )}
      >
        <div className={cn(
          "w-2 h-2 rounded-full shrink-0 ring-4 ring-black/40",
          isLeaf ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" : "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]"
        )} />
        
        <div className="flex flex-col items-center">
          <span className={cn(
            "text-[8px] font-black uppercase tracking-[0.25em] leading-none mb-1.5 opacity-60",
            isLeaf ? "text-emerald-400" : "text-indigo-400"
          )}>
            {type || 'Rule'}
          </span>
          {isLeaf ? (
            <span className="text-[11px] font-mono text-white/95 break-all max-w-[210px] font-medium leading-tight">
              {value !== undefined ? String(value) : "null"}
            </span>
          ) : isArray ? (
            <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider font-mono">
              {children.length} {children.length === 1 ? 'branch' : 'branches'}
            </span>
          ) : null}
        </div>
      </div>

      {/* Vertical connective track going down to horizontal split line */}
      {hasChildren && (
        <div className="w-px h-6 bg-indigo-500/30 relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-indigo-500/40 rounded-full" />
        </div>
      )}

      {/* Horizontal flex of sub-children */}
      {hasChildren && (
        <div className="flex flex-row items-start justify-center gap-x-8 relative">
          {children.map((child: any, idx: number) => {
            const isFirst = idx === 0;
            const isLastChild = idx === children.length - 1;
            return (
              <div key={`${path}-${idx}`} className="flex flex-col items-center relative">
                {/* Left and right connecting segments */}
                {children.length > 1 && (
                  <>
                    {!isFirst && <div className="absolute top-0 left-0 right-1/2 h-px bg-indigo-500/30" />}
                    {!isLastChild && <div className="absolute top-0 left-1/2 right-0 h-px bg-indigo-500/30" />}
                  </>
                )}
                {/* Incoming line of the child itself */}
                <div className="w-px h-6 bg-indigo-500/30 relative">
                  <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-500 rounded-full" />
                </div>
                
                {/* Recurse on children */}
                <CstVisualizer
                  node={child}
                  selectedCstNode={selectedCstNode}
                  setSelectedCstNode={setSelectedCstNode}
                  hoveredCstNode={hoveredCstNode}
                  setHoveredCstNode={setHoveredCstNode}
                  depth={depth + 1}
                  isLast={isLastChild}
                  path={`${path}-${idx}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { motion } from 'motion/react';
import { 
  Layers, PanelRightClose, List, GitFork, MousePointer, 
  ZoomIn, ZoomOut, Maximize, AlertCircle, Search, ArrowLeft, Zap, Database
} from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { cn } from '../lib/utils';
import { SyntaxElement } from '../lib/engine';

// UI visual styles shared between List View and Graph View
export interface RuleVisualConfig {
  typeName: string;
  subtitle: string;
  badgeClass: string;
  borderStyle: string;
  textAccent: string;
  iconDotColor: string;
}

export function getRuleVisualConfig(type: string, value: any, isToken?: boolean): RuleVisualConfig {
  const isArrayVal = Array.isArray(value);

  switch (type) {
    case 'literal':
      return {
        typeName: 'Expects Match',
        subtitle: 'LITERAL MATCH',
        badgeClass: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
        borderStyle: 'bg-sky-500/5 border-sky-500/30 hover:bg-sky-500/10',
        textAccent: 'text-sky-300 font-mono',
        iconDotColor: 'bg-sky-400 ring-4 ring-sky-500/20 shadow-[0_0_10px_rgba(56,189,248,0.6)]'
      };
    case 'strictLiteral':
      return {
        typeName: 'Strict-Liter',
        subtitle: 'STRICT LITERAL MATCH',
        badgeClass: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
        borderStyle: 'bg-sky-500/5 border-sky-500/30 hover:bg-sky-500/10',
        textAccent: 'text-sky-300 font-mono',
        iconDotColor: 'bg-sky-400 ring-4 ring-sky-500/20 shadow-[0_0_10px_rgba(56,189,248,0.6)]'
      };
    case 'caseInsensitiveStrictLiteral':
      return {
        typeName: 'CI-Strict-Liter',
        subtitle: 'CASE-INSENSITIVE STRICT LITERAL',
        badgeClass: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
        borderStyle: 'bg-sky-500/5 border-sky-500/30 hover:bg-sky-500/10',
        textAccent: 'text-sky-300 font-mono',
        iconDotColor: 'bg-sky-400 ring-4 ring-sky-500/20 shadow-[0_0_10px_rgba(56,189,248,0.6)]'
      };
    case 'caseInsensitiveLiteral':
      return {
        typeName: 'Case-Insens',
        subtitle: 'CASE-INSENSITIVE LITERAL',
        badgeClass: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
        borderStyle: 'bg-sky-500/5 border-sky-500/30 hover:bg-sky-500/10',
        textAccent: 'text-sky-300 font-mono',
        iconDotColor: 'bg-sky-400 ring-4 ring-sky-500/20 shadow-[0_0_10px_rgba(56,189,248,0.6)]'
      };
    case 'regex':
      return {
        typeName: 'Regex',
        subtitle: 'REGEX PATTERN',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
        borderStyle: 'bg-emerald-500/5 border-emerald-500/30 hover:bg-emerald-500/10',
        textAccent: 'text-emerald-300 font-mono',
        iconDotColor: 'bg-emerald-400 ring-4 ring-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.6)]'
      };
    case 'whitespace':
      return {
        typeName: 'Whitespace',
        subtitle: 'WHITESPACE SKIP',
        badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
        borderStyle: 'bg-slate-500/5 border-slate-500/20 hover:bg-slate-500/10',
        textAccent: 'text-slate-300',
        iconDotColor: 'bg-slate-400 ring-4 ring-slate-500/20 shadow-[0_0_10px_rgba(156,163,175,0.6)]'
      };
    case 'eof':
      return {
        typeName: 'EOF Boundary',
        subtitle: 'EOF BOUNDARY',
        badgeClass: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
        borderStyle: 'bg-zinc-500/5 border-zinc-500/25 hover:bg-zinc-500/10',
        textAccent: 'text-zinc-300',
        iconDotColor: 'bg-zinc-400 ring-4 ring-zinc-500/20'
      };
    case 'beginScope':
      return {
        typeName: 'Begin Scope',
        subtitle: 'BEGIN SCOPE BOUNDARY',
        badgeClass: 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
        borderStyle: 'bg-violet-500/5 border-violet-500/30 hover:bg-violet-500/10 shadow-[0_0_12px_rgba(139,92,246,0.1)]',
        textAccent: 'text-violet-300 font-mono font-semibold',
        iconDotColor: 'bg-violet-400 ring-4 ring-violet-500/20 shadow-[0_0_10px_rgba(167,139,250,0.6)]'
      };
    case 'endScope':
      return {
        typeName: 'End Scope',
        subtitle: 'END SCOPE BOUNDARY',
        badgeClass: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
        borderStyle: 'bg-violet-500/5 border-violet-500/30 hover:bg-violet-500/10 shadow-[0_0_12px_rgba(139,92,246,0.1)]',
        textAccent: 'text-violet-300 font-mono font-semibold',
        iconDotColor: 'bg-violet-400 ring-4 ring-violet-500/20 shadow-[0_0_10px_rgba(167,139,250,0.6)]'
      };
    case 'element':
      return {
        typeName: 'Rule Call',
        subtitle: 'CALL SYNTAX ELEMENT',
        badgeClass: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
        borderStyle: 'bg-violet-500/5 border-violet-500/30 hover:bg-violet-500/10 shadow-[0_0_12px_rgba(139,92,246,0.1)]',
        textAccent: 'text-violet-300 font-mono font-semibold',
        iconDotColor: 'bg-indigo-400 ring-4 ring-indigo-500/20 shadow-[0_0_10px_rgba(129,140,248,0.6)]'
      };
    case 'choice':
      return {
        typeName: 'OneOf Choice',
        subtitle: 'BRANCH SELECTOR',
        badgeClass: 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20',
        borderStyle: 'bg-fuchsia-500/5 border-fuchsia-500/30 hover:bg-fuchsia-500/10',
        textAccent: 'text-fuchsia-300 font-bold',
        iconDotColor: 'bg-fuchsia-400 ring-4 ring-fuchsia-500/20 shadow-[0_0_10px_rgba(232,121,249,0.6)]'
      };
    case 'optional':
      return {
        typeName: 'Optional',
        subtitle: 'CARDINALITY: 0..1',
        badgeClass: 'bg-teal-500/10 text-teal-400 border border-teal-500/20',
        borderStyle: 'bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10',
        textAccent: 'text-amber-300',
        iconDotColor: 'bg-amber-400 ring-4 ring-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.6)]'
      };
    case 'zeroOrMore':
      return {
        typeName: isToken ? 'ZeroOrMoreToken' : 'Any Count',
        subtitle: isArrayVal ? 'ZERO OR MORE BRANCHES' : 'CARDINALITY: 0..*',
        badgeClass: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
        borderStyle: 'bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10',
        textAccent: 'text-amber-300',
        iconDotColor: 'bg-amber-400 ring-4 ring-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.6)]'
      };
    case 'oneOrMore':
      return {
        typeName: isToken ? 'OneOrMoreToken' : 'Some Count',
        subtitle: isArrayVal ? 'ONE OR MORE BRANCHES' : 'CARDINALITY: 1..*',
        badgeClass: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
        borderStyle: 'bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10',
        textAccent: 'text-amber-300',
        iconDotColor: 'bg-amber-400 ring-4 ring-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.6)]'
      };
    case 'not':
      return {
        typeName: 'Not matched',
        subtitle: 'LOOKAHEAD NEGATION',
        badgeClass: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
        borderStyle: 'bg-rose-500/10 border-rose-500/40 hover:bg-rose-500/20',
        textAccent: 'text-rose-300',
        iconDotColor: 'bg-rose-400 ring-4 ring-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.6)]'
      };
    default:
      return {
        typeName: 'Expects Match',
        subtitle: 'SYNTAX MATCH',
        badgeClass: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
        borderStyle: 'bg-zinc-500/5 border-zinc-500/25 hover:bg-zinc-500/10',
        textAccent: 'text-zinc-300',
        iconDotColor: 'bg-zinc-400 ring-4 ring-zinc-500/20'
      };
  }
}

export interface RuleGraphNode {
  id: string;
  label: string;
  type: string;
  subtitle?: string;
  children?: RuleGraphNode[];
  targetElementId?: string;
}

export function buildRuleGraphTree(
  item: any, 
  idPrefix: string = "root", 
  visited: Set<string> = new Set()
): RuleGraphNode | null {
  if (!item) return null;

  // 1. Root SyntaxElement
  if (item.name && Array.isArray(item.rules)) {
    if (visited.has(item.id)) {
      return {
        id: `${idPrefix}-${item.id || item.name}-recursive`,
        label: `⟳ ${item.name} (Recursive Ref)`,
        type: 'recursive',
        subtitle: 'CYCLE BOUNDARY',
        targetElementId: item.id
      };
    }

    const newVisited = new Set(visited);
    if (item.id) newVisited.add(item.id);

    return {
      id: `${idPrefix}-${item.id || item.name}`,
      label: item.name,
      type: 'root',
      subtitle: item.isHidden ? 'Hidden Node (AST-only)' : 'CST Node Producer',
      children: item.rules
        .map((r: any, idx: number) => buildRuleGraphTree(r, `${idPrefix}-${item.id || item.name}-rule-${idx}`, newVisited))
        .filter(Boolean) as RuleGraphNode[]
    };
  }

  // 2. Individual grammar rules
  if (item.type && item.id) {
    const nodeType = item.type;
    const ruleId = item.id;

    let children: RuleGraphNode[] = [];
    let label = '';
    let targetElementId: string | undefined = undefined;

    // Call config mapping to dynamically fetch the subtitle once
    const config = getRuleVisualConfig(nodeType, item.value, item.isToken);
    let subtitle = config.subtitle;

    switch (nodeType) {
      case 'literal':
        label = `"${String(item.value)}"`;
        break;
      case 'strictLiteral':
        label = `"${String(item.value?.literal ?? '')}" strictly matching /${item.value?.pattern?.source ?? ''}/`;
        break;
      case 'caseInsensitiveStrictLiteral':
        label = `"${String(item.value?.literal ?? '')}" case-insensitively strictly matching /${item.value?.pattern?.source ?? ''}/`;
        break;
      case 'caseInsensitiveLiteral':
        label = `"${String(item.value)}" (i)`;
        break;
      case 'regex':
        const regexStr = item.value instanceof RegExp ? item.value.source : String(item.value);
        label = `/${regexStr}/`;
        break;
      case 'whitespace':
        label = 'ws (Skip whitespace/comments)';
        break;
      case 'eof':
        label = 'EOF';
        break;
      case 'beginScope':
        label = `BeginScope: "${typeof item.value === 'string' ? item.value : (item.value?.name || 'pattern')}"`;
        break;
      case 'endScope':
        label = `EndScope: "${typeof item.value === 'string' ? item.value : (item.value?.name || 'pattern')}"`;
        break;
      case 'element':
        const calledEl = item.value;
        if (calledEl && calledEl.name) {
          label = `Call: ${calledEl.name}`;
          targetElementId = calledEl.id;
          if (calledEl.rules) {
            const nextVisited = new Set(visited);
            if (calledEl.id) nextVisited.add(calledEl.id);
            children = calledEl.rules
              .map((r: any, idx: number) => buildRuleGraphTree(r, `${idPrefix}-${ruleId}-call-${calledEl.id}-rule-${idx}`, nextVisited))
              .filter(Boolean) as RuleGraphNode[];
          }
        } else {
          label = 'Call: (anonymous)';
        }
        break;

      case 'choice':
        label = 'Choice (OneOf)';
        if (Array.isArray(item.value)) {
          const nextVisited = new Set(visited);
          children = item.value
            .map((branch: any, bIdx: number) => {
              if (branch && branch.id && branch.name) {
                return buildRuleGraphTree(branch, `${idPrefix}-${ruleId}-choice-${bIdx}`, nextVisited);
              } else {
                return {
                  id: `${idPrefix}-${ruleId}-choice-${bIdx}-value`,
                  label: branch instanceof RegExp ? `/${branch.source}/` : `"${String(branch)}"`,
                  type: 'literal',
                  subtitle: 'BRANCH LITERAL'
                };
              }
            })
            .filter(Boolean) as RuleGraphNode[];
        }
        break;

      case 'optional':
        label = 'Optional (0 or 1)';
        if (item.value) {
          const nextVisited = new Set(visited);
          if (item.value.id && item.value.type) {
            const sub = buildRuleGraphTree(item.value, `${idPrefix}-${ruleId}-opt-inner`, nextVisited);
            if (sub) children = [sub];
          } else if (Array.isArray(item.value)) {
            children = item.value
              .map((r: any, idx: number) => buildRuleGraphTree(r, `${idPrefix}-${ruleId}-opt-rule-${idx}`, nextVisited))
              .filter(Boolean) as RuleGraphNode[];
          }
        }
        break;

      case 'zeroOrMore':
      case 'oneOrMore':
      case 'not':
        label = nodeType === 'zeroOrMore' ? 'ZeroOrMore (0..*)' : nodeType === 'oneOrMore' ? 'OneOrMore (1..*)' : 'NotMatched';
        if (item.value) {
          const nextVisited = new Set(visited);
          if (Array.isArray(item.value)) {
            children = item.value
              .map((r: any, idx: number) => buildRuleGraphTree(r, `${idPrefix}-${ruleId}-inner-rule-${idx}`, nextVisited))
              .filter(Boolean) as RuleGraphNode[];
          } else if (item.value.id && item.value.type) {
            const innerNode = buildRuleGraphTree(item.value, `${idPrefix}-${ruleId}-inner`, visited);
            if (innerNode) children = [innerNode];
          } else {
            children = [{
              id: `${idPrefix}-${ruleId}-inner-literal`,
              label: item.value instanceof RegExp ? `/${item.value.source}/` : String(item.value),
              type: 'literal',
              subtitle: 'INNER VAL'
            }];
          }
        }
        break;
      default:
        label = `Match: ${String(item.value)}`;
        break;
    }

    return {
      id: `${idPrefix}-${ruleId}`,
      label,
      type: nodeType,
      subtitle,
      children: children.length > 0 ? children : undefined,
      targetElementId
    };
  }

  return null;
}

interface VisualRulesInspectorProps {
  hierarchy: any;
  activeGrammarElement: any;
  ruleViewMode: 'list' | 'graph';
  setRuleViewMode: (m: 'list' | 'graph') => void;
  visualFlowCollapsed: boolean;
  setVisualFlowCollapsed: (c: boolean) => void;
  parseError?: any;
  selectElementWithHistory: (id: string | null) => void;
  ruleSearch: string;
  setRuleSearch: (s: string) => void;
  allElements: any[];
  activeElementRelations: { referencedBy: any[]; references: any[] };
  explorationHistory: string[];
  goBackHistory: () => void;
}

export const VisualRulesInspector: React.FC<VisualRulesInspectorProps> = ({
  hierarchy,
  activeGrammarElement,
  ruleViewMode,
  setRuleViewMode,
  visualFlowCollapsed,
  setVisualFlowCollapsed,
  parseError,
  selectElementWithHistory,
  ruleSearch,
  setRuleSearch,
  allElements,
  activeElementRelations,
  explorationHistory,
  goBackHistory
}) => {

  const renderRuleGraphTreeElement = (
    node: RuleGraphNode, 
    depth: number = 0, 
    isLast: boolean = true, 
    path: string = "root"
  ): React.ReactNode => {
    if (!node) return null;

    const hasChildren = node.children && node.children.length > 0;
    
    // Core visual values loaded from decentralized mapping helper
    let borderStyle = "border-white/10 bg-black/80 hover:bg-white/[0.04]";
    let textAccent = "text-indigo-400";
    let iconDotColor = "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]";
    let badgeBg = "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";

    if (node.type === 'root') {
      borderStyle = "bg-indigo-950/40 border-indigo-500/50 hover:bg-indigo-950/60 shadow-[0_0_20px_rgba(99,102,241,0.15)]";
      textAccent = "text-indigo-300 font-extrabold";
      iconDotColor = "bg-indigo-400 ring-4 ring-indigo-500/20 shadow-[0_0_10px_rgba(129,140,248,0.6)]";
      badgeBg = "bg-indigo-500/20 text-indigo-300 border-indigo-500/30";
    } else if (node.type === 'recursive') {
      borderStyle = "bg-rose-500/10 border-rose-500/40 hover:bg-rose-500/20 shadow-[0_0_12px_rgba(244,63,94,0.15)] animate-pulse";
      textAccent = "text-rose-300 font-mono italic";
      iconDotColor = "bg-rose-400 ring-4 ring-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.6)]";
      badgeBg = "bg-rose-500/20 text-rose-400 border-rose-500/20";
    } else {
      const config = getRuleVisualConfig(node.type, null, false);
      borderStyle = config.borderStyle;
      textAccent = config.textAccent;
      iconDotColor = config.iconDotColor;
      badgeBg = config.badgeClass;
    }

    return (
      <div key={node.id} className="flex flex-col items-center relative font-sans">
        {/* Main Node Box */}
        <div 
          onClick={(e) => {
            if (node.targetElementId) {
              e.stopPropagation();
              selectElementWithHistory(node.targetElementId);
            }
          }}
          className={cn(
            "inline-flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all border group shadow-md relative z-10 min-w-[140px] justify-center text-center",
            borderStyle,
            node.targetElementId ? "cursor-pointer ring-1 ring-violet-500/20 hover:ring-violet-500/40" : "cursor-default"
          )}
        >
          <div className={cn(
            "w-2 h-2 rounded-full shrink-0 ring-4 ring-black/40",
            iconDotColor
          )} />
          
          <div className="flex flex-col items-center">
            {node.subtitle && (
              <span className={cn(
                "text-[8px] font-black uppercase tracking-[0.25em] leading-none mb-1.5 opacity-60",
                badgeBg.split(' ')[1] || textAccent
              )}>
                {node.subtitle}
              </span>
            )}
            <span className={cn(
              "text-[11px] break-all max-w-[210px] leading-tight text-center font-medium",
              textAccent
            )}>
              {node.label}
            </span>
            {node.targetElementId && (
              <span className="text-[7.5px] text-violet-400/80 uppercase tracking-tighter mt-1 font-bold group-hover:text-violet-300 transition-colors">
                explore rule &rarr;
              </span>
            )}
          </div>
        </div>

        {/* Vertical connective track going down to horizontal split line */}
        {hasChildren && (
          <div className="w-px h-6 bg-indigo-500/30 relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-indigo-500/40 rounded-full" />
          </div>
        )}

        {/* Horizontal flex of sub-children */}
        {hasChildren && node.children && (
          <div className="flex flex-row items-start justify-center gap-x-8 relative">
            {node.children.map((child: RuleGraphNode, idx: number) => {
              const isFirst = idx === 0;
              const isLast = idx === node.children!.length - 1;
              return (
                <div key={child.id} className="flex flex-col items-center relative">
                  {/* Left and right connecting segments */}
                  {node.children!.length > 1 && (
                    <>
                      {!isFirst && <div className="absolute top-0 left-0 right-1/2 h-px bg-indigo-500/30" />}
                      {!isLast && <div className="absolute top-0 left-1/2 right-0 h-px bg-indigo-500/30" />}
                    </>
                  )}
                  {/* Incoming line of the child itself */}
                  <div className="w-px h-6 bg-indigo-500/30 relative">
                    <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-500 rounded-full" />
                  </div>
                  
                  {/* Recurse on children */}
                  {renderRuleGraphTreeElement(child, depth + 1, idx === node.children!.length - 1, child.id)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (visualFlowCollapsed) {
    return (
      <div className="w-[42px] border-l border-white/10 bg-[#121214]/60 backdrop-blur-lg flex flex-col items-center py-4 gap-6 shrink-0 relative z-30 select-none h-full">
        <button
          onClick={() => setVisualFlowCollapsed(false)}
          className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer shadow-lg"
          title="Expand Logic Flow"
        >
          <Layers className="w-4 h-4 text-indigo-400" />
        </button>
        <div className="flex-1 flex items-center justify-center">
          <span className="-rotate-90 text-[8.5px] font-black tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
            VISUAL LOGIC FLOW
          </span>
        </div>
      </div>
    );
  }

  return (
    <section className="flex-1 bg-[#09090c] flex flex-col overflow-hidden relative border-l border-white/5 h-full">
      <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVisualFlowCollapsed(true)}
            className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer mr-2"
            title="Collapse Logic Flow"
          >
            <PanelRightClose className="w-4 h-4 text-indigo-400" />
          </button>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 animate-fade">
            <Layers className="w-3.5 h-3.5" /> Visual Rules Inspector
          </span>
        </div>

        {/* View Switcher for Rules */}
        {hierarchy && activeGrammarElement && (
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-0.5 rounded-lg shrink-0">
            <button
              onClick={() => setRuleViewMode('list')}
              className={cn(
                "px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all cursor-pointer border flex items-center gap-1",
                ruleViewMode === 'list' 
                  ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300 shadow-sm" 
                  : "border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
              )}
              title="View linear sequence of match rules"
            >
              <List className="w-3 h-3" /> List Steps
            </button>
            <button
              onClick={() => setRuleViewMode('graph')}
              className={cn(
                "px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all cursor-pointer border flex items-center gap-1",
                ruleViewMode === 'graph' 
                  ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300 shadow-sm" 
                  : "border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
              )}
              title="View rule composition as an interactive tree graph"
            >
              <GitFork className="w-3 h-3" /> Graph Mode
            </button>
          </div>
        )}
      </div>

      {hierarchy ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left side rule selector rail inside panel */}
          <aside className="w-56 border-r border-white/5 bg-slate-950/25 flex flex-col shrink-0 overflow-hidden">
            {/* Search header container */}
            <div className="p-3 border-b border-white/5 bg-white/[0.01]">
              <div className="relative group">
                <div className="absolute inset-y-0 left-2.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                  <Search className="w-3 h-3" />
                </div>
                <input 
                  type="text"
                  value={ruleSearch}
                  onChange={(e) => setRuleSearch(e.target.value)}
                  placeholder="Search grammar rules..."
                  className="w-full bg-slate-900/50 border border-white/5 rounded-lg py-1.5 pl-8 pr-3 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30 focus:ring-1 focus:ring-indigo-500/10 transition-all font-sans"
                />
              </div>
            </div>

            {/* Rules List Rail */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-black/10">
              {(() => {
                const filtered = allElements.filter((el: any) => el.name.toLowerCase().includes(ruleSearch.toLowerCase().trim()));
                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-8 text-slate-600 font-mono text-[10px] italic">
                      No rules found
                    </div>
                  );
                }
                return filtered.map((el: any) => {
                  const isActive = activeGrammarElement?.id === el.id;
                  return (
                    <button
                      key={el.id}
                      onClick={() => selectElementWithHistory(el.id)}
                      className={cn(
                        "w-full text-left p-2.5 rounded-xl flex items-center justify-between transition-all group shrink-0",
                        isActive 
                          ? "bg-indigo-600/15 border border-indigo-500/25 ring-1 ring-indigo-500/10 text-indigo-300 shadow-sm shadow-indigo-500/5" 
                          : "border border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                      )}
                    >
                      <span className="text-[11px] truncate font-sans font-medium">
                        {el.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {el.precedence > 0 && (
                          <span className="text-[8px] bg-indigo-500/10 text-indigo-400 font-black px-1 rounded border border-indigo-500/20">
                            P{el.precedence}
                          </span>
                        )}
                        <span className="text-[9px] bg-slate-800 text-slate-500 group-hover:bg-slate-700 font-mono px-1.5 py-0.5 rounded-full border border-white/5">
                          {el.rules?.length || 0}
                        </span>
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          </aside>

          {/* Main workspace */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/20">
            {activeGrammarElement ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Grammar Detail Info Card */}
                <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 space-y-3 shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1.5">
                        {explorationHistory.length > 0 && (
                          <button
                            onClick={goBackHistory}
                            className="px-2 py-0.5 text-[10px] font-bold bg-white/5 hover:bg-white/10 text-indigo-400 hover:text-indigo-300 border border-white/10 rounded-lg flex items-center gap-1 transition-all cursor-pointer shadow-sm shrink-0"
                            title={`Go back (stack: ${explorationHistory.length})`}
                          >
                            <ArrowLeft className="w-3 h-3 text-indigo-400" />
                            <span>Back</span>
                          </button>
                        )}
                        <h2 className="text-sm font-black tracking-tight text-white font-mono uppercase">
                          {activeGrammarElement.name}
                        </h2>
                        {activeGrammarElement.precedence > 0 && (
                          <span className="bg-indigo-500/20 border border-indigo-500/40 rounded px-1.5 py-0.5 text-[8.5px] font-black text-indigo-300 uppercase tracking-tighter">
                            PRECEDENCE: {activeGrammarElement.precedence}
                          </span>
                        )}
                        {activeGrammarElement.isHidden && (
                          <span className="bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 text-[8.5px] font-extrabold text-amber-400/80 uppercase tracking-widest leading-none">
                            Hidden Node
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-slate-400 font-medium font-mono">
                        {activeGrammarElement.name === '_root' 
                          ? "Project entry-point. Parser starts here."
                          : `Defines matching structure for parser token class '${activeGrammarElement.name}'.`}
                      </p>
                    </div>

                    {activeGrammarElement.isAutoHealing && (
                      <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg text-[9.5px] text-[#868e96] font-medium font-mono">
                        <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                          <Zap className="w-3 h-3 text-emerald-400" /> Self-Healing Active
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Tree Relationships Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-white/5 text-[9.5px]">
                    <div>
                      <span className="text-slate-500 uppercase font-black tracking-widest block mb-1">Referenced By (Callers)</span>
                      {activeElementRelations.referencedBy.length === 0 ? (
                        <span className="text-slate-600 font-mono italic">None (Root element)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {activeElementRelations.referencedBy.map((el: any) => (
                            <button
                              key={el.id}
                              onClick={() => selectElementWithHistory(el.id)}
                              className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 hover:border-indigo-500/30 hover:bg-indigo-500/10 text-slate-300 hover:text-white transition-all font-mono text-[9px] cursor-pointer"
                            >
                              {el.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-slate-500 uppercase font-black tracking-widest block mb-1 font-sans">References (Callees)</span>
                      {activeElementRelations.references.length === 0 ? (
                        <span className="text-slate-600 font-mono italic">None (Leaf parser node)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {activeElementRelations.references.map((el: any) => (
                            <button
                              key={el.id}
                              onClick={() => selectElementWithHistory(el.id)}
                              className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 hover:border-indigo-500/30 hover:bg-indigo-500/10 text-slate-300 hover:text-white transition-all font-mono text-[9px] cursor-pointer"
                            >
                              {el.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Execution representation (timeline track list or interactive graph) */}
                {ruleViewMode === 'graph' ? (
                  <div className="flex-1 min-h-[500px] bg-slate-950/40 border border-white/5 rounded-2xl relative overflow-hidden flex flex-col shadow-inner backdrop-blur-md">
                    <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-slate-900/90 border border-white/10 px-3 py-1.5 rounded-xl backdrop-blur-md shadow-lg text-[9px] text-slate-400 font-mono select-none">
                      <MousePointer className="w-3 h-3 text-indigo-400 animate-pulse" />
                      <span>Drag to Pan &bull; Scroll to Zoom</span>
                    </div>

                    {(() => {
                      const ruleGraphTree = buildRuleGraphTree(activeGrammarElement);
                      if (!ruleGraphTree) {
                        return (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 italic text-[11px] font-mono">
                            No rules defined to build visual rule graph.
                          </div>
                        );
                      }
                      return (
                        <TransformWrapper
                          initialScale={1}
                          minScale={0.1}
                          maxScale={3}
                          limitToBounds={false}
                          centerOnInit={true}
                          panning={{
                            velocityDisabled: true,
                          }}
                        >
                          {({ zoomIn, zoomOut, resetTransform }) => (
                            <>
                              <div className="absolute top-4 left-4 z-20 flex gap-1.5 bg-slate-900/90 border border-white/10 p-1 rounded-xl backdrop-blur-md shadow-lg">
                                <button
                                  onClick={() => zoomIn()}
                                  className="p-1 px-1.5 hover:bg-white/10 rounded-md text-slate-300 hover:text-white transition-colors cursor-pointer text-[10px] font-bold flex items-center gap-1 border border-white/5"
                                  title="Zoom In"
                                >
                                  <ZoomIn className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => zoomOut()}
                                  className="p-1 px-1.5 hover:bg-white/10 rounded-md text-slate-300 hover:text-white transition-colors cursor-pointer text-[10px] font-bold flex items-center gap-1 border border-white/5"
                                  title="Zoom Out"
                                >
                                  <ZoomOut className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => resetTransform()}
                                  className="p-1 px-1.5 hover:bg-white/10 rounded-md text-slate-300 hover:text-white transition-colors cursor-pointer text-[10px] font-bold flex items-center gap-1 border border-white/5"
                                  title="Recenter"
                                >
                                  <Maximize className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <TransformComponent
                                wrapperStyle={{ width: "100%", height: "100%" }}
                                contentStyle={{ width: "100%", height: "100%" }}
                              >
                                <div className="p-16 flex items-center justify-center min-w-[800px] min-h-[500px] cursor-grab active:cursor-grabbing bg-transparent">
                                  {renderRuleGraphTreeElement(ruleGraphTree)}
                                </div>
                              </TransformComponent>
                            </>
                          )}
                        </TransformWrapper>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="space-y-4 max-w-2xl">
                    {activeGrammarElement.rules?.length === 0 ? (
                      <div className="text-center py-4 text-slate-500 italic text-[11px] font-mono">
                        No rules defined in this syntax element yet.
                      </div>
                    ) : (
                      activeGrammarElement.rules?.map((rule: any, idx: number) => {
                        const isErrorHighlight = parseError?.ruleId === rule.id;
                        
                        // Unified metadata configuration via shared config mapper helper
                        const config = getRuleVisualConfig(rule.type, rule.value, rule.isToken);

                        return (
                          <div key={rule.id} className="flex relative group">
                            {/* Connector timeline track line */}
                            <div className="w-8 flex flex-col items-center flex-shrink-0 relative">
                              <div className={cn(
                                "w-2 h-2 rounded-full z-10 transition-all border mt-4",
                                rule.type === 'not' ? "bg-rose-500 border-rose-400 ring-2 ring-rose-500/15" : "bg-indigo-500 border-indigo-400 ring-2 ring-indigo-500/15",
                                isErrorHighlight && "bg-red-500 border-red-400 ring-4 ring-red-500/15 animate-pulse"
                              )} />
                              {idx < activeGrammarElement.rules.length - 1 && (
                                <div className="absolute top-4 bottom-0 w-px bg-white/5 group-hover:bg-indigo-500/20 transition-all" />
                              )}
                            </div>

                            <div className={cn(
                              "flex-1 p-4 bg-white/[0.02] border border-white/5 backdrop-blur-md rounded-2xl flex flex-col gap-2.5 transition-all hover:bg-white/[0.04] hover:border-white/10 shadow-sm",
                              rule.type === 'not' && "bg-rose-500/5 border-rose-500/15 hover:border-rose-500/30",
                              isErrorHighlight && "border-red-500/30 bg-red-500/5"
                            )}>
                              <div className="flex items-center justify-between gap-4 shrink-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold text-slate-500 font-mono uppercase tracking-wider">
                                    Step {idx + 1}
                                  </span>
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter leading-none shrink-0",
                                    config.badgeClass
                                  )}>
                                    {config.typeName}
                                  </span>
                                  {rule.isToken && (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter leading-none shrink-0 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                      {(() => {
                                        const hasLead = !!SyntaxElement.defaultLeadingTrivia;
                                        const hasTrail = !!SyntaxElement.defaultTrailingTrivia;
                                        if (hasLead && hasTrail) return '✨ Leads & Trails Skipped';
                                        if (hasLead) return '✨ Leads Skipped';
                                        if (hasTrail) return '✨ Trails Skipped';
                                        return '✨ No Trivia';
                                      })()}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                {rule.type === 'whitespace' ? (
                                  <span className="text-[11px] font-mono text-amber-300 bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10">
                                    Skip Whitespace &amp; Comments [\s\r\n\t]
                                  </span>
                                ) : rule.type === 'eof' ? (
                                  <span className="text-[11px] font-mono text-slate-500 bg-slate-500/5 px-2 py-0.5 rounded border border-slate-500/10 block">
                                    EOF (End Of File)
                                  </span>
                                ) : rule.type === 'regex' ? (
                                  <code className="text-[11px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                                    Regex("/{rule.value instanceof RegExp ? rule.value.source : String(rule.value)}/")
                                  </code>
                                ) : (rule.type === 'beginScope' || rule.type === 'endScope') ? (
                                  <code className="text-[11px] font-mono text-violet-300 bg-violet-500/5 px-2 py-0.5 rounded border border-violet-500/10 font-bold">
                                    {rule.type === 'beginScope' ? 'Begin' : 'End'}: "{String(rule.value)}"
                                  </code>
                                ) : rule.type === 'literal' ? (
                                  <code className="text-[11px] font-mono text-sky-300 bg-sky-500/5 px-2 py-0.5 rounded border border-sky-500/10">
                                    "{String(rule.value)}"
                                  </code>
                                ) : rule.type === 'caseInsensitiveLiteral' ? (
                                  <code className="text-[11px] font-mono text-sky-300 bg-sky-500/5 px-2 py-0.5 rounded border border-sky-500/10">
                                    "{String(rule.value)}" (case-insensitive)
                                  </code>
                                ) : rule.type === 'strictLiteral' ? (
                                  <code className="text-[11px] font-mono text-sky-300 bg-sky-500/5 px-2 py-0.5 rounded border border-sky-500/10">
                                    "{String(rule.value?.literal)}" strictly matching /regex/ /{rule.value?.pattern?.source}/
                                  </code>
                                ) : rule.type === 'caseInsensitiveStrictLiteral' ? (
                                  <code className="text-[11px] font-mono text-sky-300 bg-sky-500/5 px-2 py-0.5 rounded border border-sky-500/10">
                                    "{String(rule.value?.literal)}" case-insensitively strictly matching /regex/ /{rule.value?.pattern?.source}/
                                  </code>
                                ) : rule.type === 'element' ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-mono text-indigo-300 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10">
                                      {rule.value?.name || 'anonymous'}
                                    </span>
                                    <button
                                      onClick={() => {
                                        if (rule.value?.id) selectElementWithHistory(rule.value.id);
                                      }}
                                      className="p-0.5 px-1.5 rounded hover:bg-white/10 text-indigo-400 hover:text-white text-[9.5px] font-bold flex items-center gap-1 transition-colors border border-white/5 cursor-pointer lowercase"
                                    >
                                      Explore &rarr;
                                    </button>
                                  </div>
                                ) : (rule.type === 'choice' || ((rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') && Array.isArray(rule.value))) ? (
                                  <div className="flex flex-col gap-1 w-full">
                                    <div className="flex flex-wrap gap-1">
                                      {(rule.value as any[]).map((branch, bIdx) => {
                                        const isElement = branch && branch.id && branch.name;
                                        return (
                                          <div 
                                            key={bIdx}
                                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/30 border border-white/5 text-[10.5px] font-mono"
                                          >
                                            <span className="text-[#ecc94b] font-bold">#{bIdx + 1}</span>
                                            <span className={isElement ? "text-indigo-300" : "text-slate-400"}>
                                              {isElement ? branch.name : (branch instanceof RegExp ? `/${branch.source}/` : String(branch))}
                                            </span>
                                            {isElement && (
                                              <button
                                                onClick={() => selectElementWithHistory(branch.id)}
                                                className="w-3.5 h-3.5 rounded hover:bg-white/10 text-indigo-400 flex items-center justify-center text-[9px] cursor-pointer"
                                              >
                                                &rarr;
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-1 w-full">
                                    <div className="flex items-center gap-1.5">
                                      {(() => {
                                        const val = rule.value;
                                        const isObj = val && typeof val === 'object';
                                        const isHierarchicalElement = isObj && 'name' in val && 'id' in val;

                                        if (isHierarchicalElement) {
                                          return (
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] font-mono text-indigo-300 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10">
                                                {val.name}
                                              </span>
                                              <button
                                                onClick={() => selectElementWithHistory(val.id)}
                                                className="px-1.5 py-0.5 rounded hover:bg-white/10 text-indigo-400 hover:text-indigo-300 text-[10px] font-bold border border-white/5 cursor-pointer flex items-center gap-1"
                                              >
                                                Explore &rarr;
                                              </button>
                                            </div>
                                          );
                                        }

                                        return (
                                          <code className="text-[11px] font-mono text-slate-300 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                                            {val instanceof RegExp ? `Regex("${val.source}")` : String(val)}
                                          </code>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <p className="text-[10px] text-slate-500 font-sans italic">
                                {rule.type === 'literal' ? "Strict literal: matches the exact character sequence of this token keyword." :
                                 rule.type === 'caseInsensitiveLiteral' ? "Case-insensitive literal: matches the exact character sequence of this token keyword, ignoring capitalization rules." :
                                 rule.type === 'strictLiteral' ? "Strict literal regex check: matches a pattern regex first, then fails if the matched string is not identical to the given literal." :
                                 rule.type === 'caseInsensitiveStrictLiteral' ? "Case-insensitive strict literal regex check: matches a pattern regex first, then fails if the matched string is not case-insensitively identical to the given literal." :
                                 rule.type === 'regex' ? "Regexp scan: matches standard compiler token patterns, identifiers, numbers, etc." :
                                 rule.type === 'element' ? "Sub-element: executes another rule segment to build nested CST syntax nodes." :
                                 rule.type === 'whitespace' ? "Noise filter: parses and skips spaces, comments, and formatting characters dynamically." :
                                 rule.type === 'choice' ? "Precedence branch: tests each alternative branch option and resolves the longest matching path." :
                                 rule.type === 'optional' ? "Zero-to-One: tries to match the rule pattern option, but continues safely if missing." :
                                 rule.type === 'zeroOrMore' ? (rule.isToken ? "ZeroOrMoreToken repetition: loops through matches, automatically skipping default leading/trailing trivia around each loop item." : "Star repetition: iteratively compiles as many matches of this child as are found.") :
                                 rule.type === 'oneOrMore' ? (rule.isToken ? "OneOrMoreToken repetition: loops through matches (at least 1 required), automatically skipping default leading/trailing trivia around each loop item." : "Plus repetition: loops through consecutive matches, requiring at least one successful parse.") :
                                 rule.type === 'not' ? "Negative constraint: verifies this token sequence is absent before matching starts." :
                                 rule.type === 'eof' ? "EOF boundary: verifies the parser head has completed parsing the entire code document." : ""}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3 opacity-50">
                <Layers className="w-8 h-8 font-extrabold" />
                <p className="text-xs font-medium">Select a grammar rule to inspect details.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-4 opacity-50">
          <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center border border-white/10">
            <Database className="w-8 h-8" />
          </div>
          <p className="text-sm font-medium">Define 'root' in grammar to visualize.</p>
        </div>
      )}
    </section>
  );
};
